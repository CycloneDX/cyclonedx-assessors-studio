/**
 * Webhook notification channel.
 *
 * Fans out event envelopes to registered webhook subscriptions with
 * HMAC-SHA256 signed payloads, exponential backoff retries, and
 * auto-disable after consecutive failures.
 */

import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import type { NotificationChannel } from './channel.js';
import type { EventEnvelope } from './types.js';
import { CHANNEL_WEBHOOK_DISABLED } from './catalog.js';
import { encryptionService } from '../utils/encryption.js';
import { safeFetch, UnsafeUrlError } from '../utils/safe-fetch.js';

/** Retry delay schedule in milliseconds (attempt index 0 based). */
const RETRY_DELAYS_MS = [
  0,            // attempt 1: immediate
  60_000,       // attempt 2: 1 minute
  300_000,      // attempt 3: 5 minutes
  1_800_000,    // attempt 4: 30 minutes
  7_200_000,    // attempt 5: 2 hours
];

const AUTO_DISABLE_THRESHOLD = 50;
const RETRY_POLL_INTERVAL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 3_600_000; // 1 hour

/**
 * Compute the HMAC-SHA256 signature for a webhook delivery.
 */
export function computeSignature(secret: string, timestamp: number, body: string): string {
  const payload = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export class WebhookChannel implements NotificationChannel {
  name = 'webhook';
  private getDb: () => Kysely<Database>;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private emitEvent: ((type: string, data: Record<string, unknown>) => void) | null = null;

  constructor(getDb: () => Kysely<Database>) {
    this.getDb = getDb;
  }

  /**
   * Set a callback so the channel can emit events (e.g., channel.webhook.disabled).
   * Called by the event system after initialization to avoid circular dependency.
   */
  setEmitter(emitFn: (type: string, data: Record<string, unknown>) => void): void {
    this.emitEvent = emitFn;
  }

  async initialize(): Promise<void> {
    const config = getConfig();
    if (!config.WEBHOOK_ENABLED) {
      logger.info('Webhook channel disabled by configuration');
      return;
    }

    // Start the retry polling timer
    this.retryTimer = setInterval(() => {
      this.processRetries().catch((err) => {
        logger.error('Webhook retry processing error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, RETRY_POLL_INTERVAL_MS);

    // Start the delivery retention cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupDeliveries().catch((err) => {
        logger.error('Webhook delivery cleanup error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, CLEANUP_INTERVAL_MS);

    logger.debug('WebhookChannel initialized');
  }

  /**
   * Webhooks handle all events. Filtering is done per subscription.
   */
  handles(_envelope: EventEnvelope): boolean {
    const config = getConfig();
    return config.WEBHOOK_ENABLED;
  }

  /**
   * Fan out the event to all matching active webhook subscriptions.
   */
  async process(envelope: EventEnvelope): Promise<void> {
    const db = this.getDb();

    // Find all active webhooks that subscribe to this event type or wildcard
    const webhooks = await db
      .selectFrom('webhook')
      .where('is_active', '=', true)
      .selectAll()
      .execute();

    const matchingWebhooks = webhooks.filter((wh) => {
      const types = wh.event_types as string[];
      return types.includes('*') || types.includes(envelope.type);
    });

    // Dispatch each delivery asynchronously (non-blocking)
    for (const webhook of matchingWebhooks) {
      this.deliverToWebhook(webhook, envelope).catch((err) => {
        logger.error('Webhook delivery dispatch error', {
          webhookId: webhook.id,
          eventId: envelope.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  async shutdown(): Promise<void> {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Deliver an event to a single webhook endpoint. Creates a delivery
   * record and performs the HTTP request.
   */
  private async deliverToWebhook(
    webhook: { id: string; name?: string; url: string; secret: string; consecutive_failures: number },
    envelope: EventEnvelope,
  ): Promise<void> {
    const db = this.getDb();
    const config = getConfig();
    const deliveryId = uuidv4();
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);
    const decryptedSecret = encryptionService.decrypt(webhook.secret);
    const signature = computeSignature(decryptedSecret, timestamp, body);

    // Create the delivery record
    await db
      .insertInto('webhook_delivery')
      .values({
        id: deliveryId,
        webhook_id: webhook.id,
        event_id: envelope.id,
        event_type: envelope.type,
        status: 'pending',
        attempt: 1,
        request_body: JSON.parse(body),
      })
      .execute();

    // Perform the delivery
    await this.attemptDelivery(deliveryId, webhook, body, timestamp, signature, config.WEBHOOK_TIMEOUT);
  }

  /**
   * Attempt an HTTP delivery and update the delivery record.
   */
  async attemptDelivery(
    deliveryId: string,
    webhook: { id: string; name?: string; url: string; secret: string; consecutive_failures: number },
    body: string,
    timestamp: number,
    signature: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const db = this.getDb();
    const config = getConfig();

    // Delivery-time SSRF guard (security review X1). safeFetch re-resolves
    // the hostname, refuses private/reserved targets, pins the socket to
    // the validated address (no DNS rebinding) and never follows
    // redirects, so a 3xx to an internal address is just a failed
    // delivery. Response bodies are not stored: they were readable back
    // through the deliveries API, which turned a blind SSRF into a read.
    try {
      const response = await safeFetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CycloneDX-Assessors-Studio/1.0',
          'X-Webhook-Id': webhook.id,
          'X-Webhook-Event': JSON.parse(body).type || '',
          'X-Webhook-Timestamp': String(timestamp),
          'X-Webhook-Signature': `sha256=${signature}`,
        },
        body,
        timeoutMs,
        maxResponseBytes: 1024,
      });

      if (response.ok) {
        await db
          .updateTable('webhook_delivery')
          .set({
            status: 'success',
            http_status: response.status,
            response_body: null,
            delivered_at: new Date(),
          })
          .where('id', '=', deliveryId)
          .execute();

        // Reset consecutive failures on success
        if (webhook.consecutive_failures > 0) {
          await db
            .updateTable('webhook')
            .set({ consecutive_failures: 0, updated_at: new Date() })
            .where('id', '=', webhook.id)
            .execute();
        }

        return true;
      }
      const reason = response.status >= 300 && response.status < 400
        ? `Redirect (HTTP ${response.status}) not followed`
        : null;
      await this.handleFailure(deliveryId, webhook, response.status, null, reason, config);
      return false;
    } catch (error: unknown) {
      if (error instanceof UnsafeUrlError) {
        logger.warn('Webhook delivery blocked by delivery-time URL check', {
          webhookId: webhook.id,
          deliveryId,
          reason: error.message,
        });
        await this.handleFailure(deliveryId, webhook, null, null, `Delivery blocked: ${error.message}`, config);
        return false;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleFailure(deliveryId, webhook, null, null, errorMessage, config);
      return false;
    }
  }

  /**
   * Handle a failed delivery: update the delivery record, increment
   * consecutive failures, schedule retries, or exhaust.
   */
  private async handleFailure(
    deliveryId: string,
    webhook: { id: string; name?: string; url: string; secret: string; consecutive_failures: number },
    httpStatus: number | null,
    responseBody: string | null,
    errorMessage: string | null,
    config: ReturnType<typeof getConfig>,
  ): Promise<void> {
    const db = this.getDb();

    // Get current attempt number
    const delivery = await db
      .selectFrom('webhook_delivery')
      .where('id', '=', deliveryId)
      .select(['attempt'])
      .executeTakeFirst();

    const attempt = delivery?.attempt ?? 1;
    const maxRetries = config.WEBHOOK_MAX_RETRIES;

    if (attempt >= maxRetries) {
      // Exhausted all retries
      await db
        .updateTable('webhook_delivery')
        .set({
          status: 'exhausted',
          http_status: httpStatus,
          response_body: responseBody,
          error_message: errorMessage,
        })
        .where('id', '=', deliveryId)
        .execute();
    } else {
      // Schedule retry
      const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetryAt = new Date(Date.now() + delayMs);

      await db
        .updateTable('webhook_delivery')
        .set({
          status: 'failed',
          http_status: httpStatus,
          response_body: responseBody,
          error_message: errorMessage,
          next_retry_at: nextRetryAt,
        })
        .where('id', '=', deliveryId)
        .execute();
    }

    // Increment consecutive failures
    const newFailureCount = webhook.consecutive_failures + 1;
    const updates: Record<string, unknown> = {
      consecutive_failures: newFailureCount,
      updated_at: new Date(),
    };

    // Auto-disable if threshold reached
    if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
      updates.is_active = false;

      // Emit channel.webhook.disabled event
      if (this.emitEvent) {
        this.emitEvent(CHANNEL_WEBHOOK_DISABLED, {
          webhookId: webhook.id,
          // Name, not URL: this event fans out to every '*' subscriber,
          // and a webhook URL can carry a token (security review X11).
          webhookName: webhook.name ?? webhook.id,
          consecutiveFailures: newFailureCount,
        });
      }

      logger.warn('Webhook auto-disabled after consecutive failures', {
        webhookId: webhook.id,
        consecutiveFailures: newFailureCount,
      });
    }

    await db
      .updateTable('webhook')
      .set(updates)
      .where('id', '=', webhook.id)
      .execute();
  }

  /**
   * Process pending retries. Called by the polling timer every 30 seconds.
   */
  async processRetries(): Promise<void> {
    const db = this.getDb();
    const config = getConfig();
    const now = new Date();

    // Find failed deliveries ready for retry (capped to prevent memory exhaustion)
    const RETRY_BATCH_SIZE = 100;
    const pendingRetries = await db
      .selectFrom('webhook_delivery')
      .innerJoin('webhook', 'webhook.id', 'webhook_delivery.webhook_id')
      .where('webhook_delivery.status', '=', 'failed')
      .where('webhook_delivery.next_retry_at', '<=', now)
      .where('webhook_delivery.attempt', '<', config.WEBHOOK_MAX_RETRIES)
      .where('webhook.is_active', '=', true)
      .select([
        'webhook_delivery.id as delivery_id',
        'webhook_delivery.attempt',
        'webhook_delivery.request_body',
        'webhook.id as webhook_id',
        'webhook.name',
        'webhook.url',
        'webhook.secret',
        'webhook.consecutive_failures',
      ])
      .orderBy('webhook_delivery.next_retry_at', 'asc')
      .limit(RETRY_BATCH_SIZE)
      .execute();

    for (const row of pendingRetries) {
      const body = JSON.stringify(row.request_body);
      const timestamp = Math.floor(Date.now() / 1000);
      const decryptedSecret = encryptionService.decrypt(row.secret);
      const signature = computeSignature(decryptedSecret, timestamp, body);

      // Increment the attempt counter
      await db
        .updateTable('webhook_delivery')
        .set({
          attempt: typeof row.attempt === 'number' ? row.attempt + 1 : 2,
          status: 'pending',
          next_retry_at: null,
        })
        .where('id', '=', row.delivery_id)
        .execute();

      this.attemptDelivery(
        row.delivery_id,
        {
          id: row.webhook_id,
          name: row.name,
          url: row.url,
          secret: row.secret,
          consecutive_failures: row.consecutive_failures as number,
        },
        body,
        timestamp,
        signature,
        config.WEBHOOK_TIMEOUT,
      ).catch((err) => {
        logger.error('Webhook retry delivery error', {
          deliveryId: row.delivery_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Clean up old delivery records. Runs once per hour.
   */
  async cleanupDeliveries(): Promise<void> {
    const db = this.getDb();
    const config = getConfig();
    const cutoff = new Date(Date.now() - config.WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const result = await db
      .deleteFrom('webhook_delivery')
      .where('created_at', '<', cutoff)
      .where('status', 'in', ['success', 'exhausted'])
      .execute();

    const deleted = Number(result[0]?.numDeletedRows ?? 0);
    if (deleted > 0) {
      logger.info('Cleaned up old webhook deliveries', { deleted });
    }
  }
}
