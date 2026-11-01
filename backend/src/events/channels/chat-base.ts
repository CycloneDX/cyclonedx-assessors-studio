/**
 * Base class for chat notification channels.
 *
 * Shared delivery, retry, and auto-disable logic for Slack, Teams,
 * and Mattermost. Each platform subclass provides:
 *   - platform: string identifier
 *   - formatMessage(): platform-specific payload builder
 *   - static validateWebhookUrl(): URL format check
 */

import { v4 as uuidv4 } from 'uuid';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { getConfig } from '../../config/index.js';
import type { NotificationChannel } from '../channel.js';
import type { EventEnvelope } from '../types.js';
import { CHANNEL_CHAT_DISABLED, CHANNEL_TEST } from '../catalog.js';
import { safeFetch, UnsafeUrlError } from '../../utils/safe-fetch.js';
import { encryptionService, isEncryptedEnvelope } from '../../utils/encryption.js';

/**
 * Read a chat_integration.webhook_url that may be either an encrypted
 * envelope (new + migrated rows) or legacy plaintext (pre-encryption
 * rows that haven't been re-saved yet). Lazy migration upgrades the
 * row implicitly on the next admin PUT.
 */
function readWebhookUrl(stored: string): string {
  return isEncryptedEnvelope(stored) ? encryptionService.decrypt(stored) : stored;
}

/** Retry delay schedule in milliseconds (attempt index 0-based). */
const RETRY_DELAYS_MS = [
  0,            // attempt 1: immediate
  60_000,       // attempt 2: 1 minute
  300_000,      // attempt 3: 5 minutes
  1_800_000,    // attempt 4: 30 minutes
  7_200_000,    // attempt 5: 2 hours
];

const MAX_RETRIES = 5;
const AUTO_DISABLE_THRESHOLD = 50;
const RETRY_POLL_INTERVAL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 3_600_000; // 1 hour

export abstract class BaseChatChannel implements NotificationChannel {
  abstract platform: string;
  abstract formatMessage(envelope: EventEnvelope, appUrl: string): Record<string, unknown>;

  // Expose name as a getter so it always reflects the subclass platform
  // ("slack" / "teams" / "mattermost"). A plain field set in this
  // constructor would be overridden by the subclass field initializer
  // (TC39 class-field semantics), which left every chat channel
  // registering with name "chat" and colliding with each other.
  get name(): string {
    return this.platform;
  }

  private getDb: () => Kysely<Database>;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private emitEvent: ((type: string, data: Record<string, unknown>) => void) | null = null;

  constructor(getDb: () => Kysely<Database>) {
    this.getDb = getDb;
  }

  /**
   * Set a callback so the channel can emit events (e.g., channel.chat.disabled).
   */
  setEmitter(emitFn: (type: string, data: Record<string, unknown>) => void): void {
    this.emitEvent = emitFn;
  }

  initialize(): Promise<void> {
    this.retryTimer = setInterval(() => {
      void this.processRetries().catch((err) => {
        logger.error(`Chat channel (${this.platform}) retry processing error`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, RETRY_POLL_INTERVAL_MS);

    this.cleanupTimer = setInterval(() => {
      void this.cleanupDeliveries().catch((err) => {
        logger.error(`Chat channel (${this.platform}) cleanup error`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, CLEANUP_INTERVAL_MS);

    logger.info(`Chat channel (${this.platform}) initialized`);
    return Promise.resolve();
  }

  /**
   * Quick filter: always returns true because actual integration/category
   * filtering happens in process(). The channel needs to query the DB
   * to know if any integrations match, so we defer to process().
   */
  handles(_envelope: EventEnvelope): boolean {
    return true;
  }

  /**
   * Process the event: query matching integrations and POST to each webhook.
   */
  async process(envelope: EventEnvelope): Promise<void> {
    // Don't deliver test events back to chat to avoid loops
    if (envelope.type === CHANNEL_TEST) {
      return;
    }

    try {
      const db = this.getDb();

      const integrations = await db
        .selectFrom('chat_integration')
        .where('platform', '=', this.platform as 'slack' | 'teams' | 'mattermost')
        .where('is_active', '=', true)
        .selectAll()
        .execute();

      for (const integration of integrations) {
        const categories = this.parseEventCategories(integration.event_categories);

        // Check category or event type filter
        // Stored values can be category names (e.g. "assessment") or specific
        // event types (e.g. "assessment.created"). Match against either.
        if (
          !categories.includes('*') &&
          !categories.includes(envelope.category) &&
          !categories.includes(envelope.type)
        ) {
          continue;
        }

        // Dispatch delivery asynchronously (non-blocking)
        this.createAndDispatchDelivery(integration, envelope).catch((err) => {
          logger.error(`Chat channel (${this.platform}) dispatch error`, {
            integrationId: integration.id,
            eventId: envelope.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (error) {
      logger.error(`Chat channel (${this.platform}) process error`, {
        eventId: envelope.id,
        error: error instanceof Error ? error.message : String(error),
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
    logger.debug(`Chat channel (${this.platform}) shutdown`);
  }

  /**
   * Send a test message to a specific integration. Used by the management API.
   */
  async sendTestMessage(integrationId: string): Promise<{ success: boolean; message: string }> {
    const db = this.getDb();
    const config = getConfig();
    const appUrl = config.APP_URL || 'https://studio.example.com';

    const integration = await db
      .selectFrom('chat_integration')
      .where('id', '=', integrationId)
      .selectAll()
      .executeTakeFirst();

    if (!integration) {
      return { success: false, message: 'Integration not found' };
    }

    const testEnvelope: EventEnvelope = {
      id: `evt_test_${uuidv4()}`,
      type: 'channel.test',
      category: 'system',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: null, displayName: 'System' },
      data: {
        message: 'This is a test message from CycloneDX Assessors Studio',
        integrationName: integration.name,
      },
    };

    const messageBody = this.formatMessage(testEnvelope, appUrl);
    const timeout = config.CHAT_TIMEOUT;

    // Decrypt the stored URL once. The DB column holds an encryption
    // envelope; the actual network call needs the plaintext.
    const webhookUrlPlain = readWebhookUrl(integration.webhook_url);

    // Delivery-time SSRF guard (security review X1): safeFetch refuses
    // private/reserved targets, pins the socket to the validated address
    // and never follows redirects. This hand-triggered admin test reaches
    // out to the same URL, so it gets the same treatment.
    try {
      const response = await safeFetch(webhookUrlPlain, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CycloneDX-Assessors-Studio/1.0',
        },
        body: JSON.stringify(messageBody),
        timeoutMs: timeout,
        maxResponseBytes: 1024,
      });

      if (response.ok) {
        return { success: true, message: `Test message sent successfully (HTTP ${response.status})` };
      }
      return { success: false, message: `Webhook returned HTTP ${response.status}` };
    } catch (error: unknown) {
      if (error instanceof UnsafeUrlError) {
        logger.warn(`Chat test message blocked by delivery-time URL check (${this.platform})`, {
          integrationId,
          reason: error.message,
        });
        return { success: false, message: `Test delivery blocked: ${error.message}` };
      }
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private parseEventCategories(stored: string): string[] {
    if (!stored) return [];

    // Try JSON array first
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON
    }

    // Comma-separated
    return stored.split(',').map((c) => c.trim()).filter(Boolean);
  }

  private async createAndDispatchDelivery(
    integration: { id: string; webhook_url: string; consecutive_failures: number },
    envelope: EventEnvelope,
  ): Promise<void> {
    const db = this.getDb();
    const deliveryId = uuidv4();

    await db
      .insertInto('chat_delivery')
      .values({
        id: deliveryId,
        integration_id: integration.id,
        event_id: envelope.id,
        event_type: envelope.type,
        status: 'pending',
        attempt: 1,
      })
      .execute();

    await this.dispatchDelivery(deliveryId, integration, envelope, 1);
  }

  private async dispatchDelivery(
    deliveryId: string,
    integration: { id: string; webhook_url: string; consecutive_failures: number },
    envelope: EventEnvelope,
    attempt: number,
  ): Promise<void> {
    const db = this.getDb();
    const config = getConfig();
    const appUrl = config.APP_URL || 'https://studio.example.com';
    const timeout = config.CHAT_TIMEOUT;

    const messageBody = this.formatMessage(envelope, appUrl);
    const webhookUrlPlain = readWebhookUrl(integration.webhook_url);

    // Delivery-time SSRF guard (security review X1); see sendTestMessage.
    try {
      const response = await safeFetch(webhookUrlPlain, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CycloneDX-Assessors-Studio/1.0',
        },
        body: JSON.stringify(messageBody),
        timeoutMs: timeout,
        maxResponseBytes: 1024,
      });

      if (response.ok) {
        await db
          .updateTable('chat_delivery')
          .set({
            status: 'success',
            http_status: response.status,
            delivered_at: new Date(),
          })
          .where('id', '=', deliveryId)
          .execute();

        // Reset consecutive failures on success
        if (integration.consecutive_failures > 0) {
          await db
            .updateTable('chat_integration')
            .set({ consecutive_failures: 0, updated_at: new Date() })
            .where('id', '=', integration.id)
            .execute();
        }
      } else {
        await this.handleFailure(deliveryId, integration, attempt, response.status, `HTTP ${response.status}`);
      }
    } catch (error: unknown) {
      if (error instanceof UnsafeUrlError) {
        logger.warn(`Chat delivery blocked by delivery-time URL check (${this.platform})`, {
          integrationId: integration.id,
          deliveryId,
          reason: error.message,
        });
        await this.handleFailure(deliveryId, integration, attempt, null, `Delivery blocked: ${error.message}`);
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleFailure(deliveryId, integration, attempt, null, errorMessage);
    }
  }

  private async handleFailure(
    deliveryId: string,
    integration: { id: string; webhook_url: string; consecutive_failures: number },
    attempt: number,
    httpStatus: number | null,
    errorMessage: string,
  ): Promise<void> {
    const db = this.getDb();

    if (attempt >= MAX_RETRIES) {
      // Exhausted
      await db
        .updateTable('chat_delivery')
        .set({
          status: 'exhausted',
          http_status: httpStatus,
          error_message: errorMessage,
        })
        .where('id', '=', deliveryId)
        .execute();
    } else {
      // Schedule retry
      const delayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetryAt = new Date(Date.now() + delayMs);

      await db
        .updateTable('chat_delivery')
        .set({
          status: 'failed',
          http_status: httpStatus,
          error_message: errorMessage,
          next_retry_at: nextRetryAt,
        })
        .where('id', '=', deliveryId)
        .execute();
    }

    // Increment consecutive failures
    const newFailureCount = integration.consecutive_failures + 1;
    const updates: Record<string, unknown> = {
      consecutive_failures: newFailureCount,
      updated_at: new Date(),
    };

    if (newFailureCount >= AUTO_DISABLE_THRESHOLD) {
      updates.is_active = false;

      if (this.emitEvent) {
        this.emitEvent(CHANNEL_CHAT_DISABLED, {
          integrationId: integration.id,
          platform: this.platform,
          consecutiveFailures: newFailureCount,
        });
      }

      logger.warn(`Chat integration auto-disabled (${this.platform})`, {
        integrationId: integration.id,
        consecutiveFailures: newFailureCount,
      });
    }

    await db
      .updateTable('chat_integration')
      .set(updates)
      .where('id', '=', integration.id)
      .execute();
  }

  /**
   * Process pending retries. Called by the polling timer every 30 seconds.
   */
  private async processRetries(): Promise<void> {
    const db = this.getDb();
    const now = new Date();

    const pendingRetries = await db
      .selectFrom('chat_delivery')
      .innerJoin('chat_integration', 'chat_integration.id', 'chat_delivery.integration_id')
      .where('chat_delivery.status', '=', 'failed' as const)
      .where('chat_delivery.next_retry_at', '<=', now)
      .where('chat_delivery.attempt', '<', MAX_RETRIES)
      .where('chat_integration.is_active', '=', true)
      .where('chat_integration.platform', '=', this.platform as 'slack' | 'teams' | 'mattermost')
      .select([
        'chat_delivery.id as delivery_id',
        'chat_delivery.attempt',
        'chat_delivery.event_id',
        'chat_delivery.event_type',
        'chat_integration.id as integration_id',
        'chat_integration.webhook_url',
        'chat_integration.consecutive_failures',
      ])
      .execute();

    for (const row of pendingRetries) {
      const newAttempt = (row.attempt as number) + 1;

      // Increment attempt counter
      await db
        .updateTable('chat_delivery')
        .set({ attempt: newAttempt, status: 'pending', next_retry_at: null })
        .where('id', '=', row.delivery_id)
        .execute();

      // Reconstruct a minimal envelope for re-delivery
      const envelope: EventEnvelope = {
        id: row.event_id,
        type: row.event_type,
        category: row.event_type.split('.')[0],
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: null, displayName: 'System' },
        data: {},
      };

      this.dispatchDelivery(
        row.delivery_id,
        {
          id: row.integration_id,
          webhook_url: row.webhook_url,
          consecutive_failures: row.consecutive_failures as number,
        },
        envelope,
        newAttempt,
      ).catch((err) => {
        logger.error(`Chat retry delivery error (${this.platform})`, {
          deliveryId: row.delivery_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Clean up old delivery records. Runs once per hour.
   */
  private async cleanupDeliveries(): Promise<void> {
    const db = this.getDb();
    const config = getConfig();
    const cutoff = new Date(
      Date.now() - config.CHAT_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await db
      .deleteFrom('chat_delivery')
      .where('created_at', '<', cutoff)
      .where('status', 'in', ['success', 'exhausted'])
      .execute();

    const deleted = Number(result[0]?.numDeletedRows ?? 0);
    if (deleted > 0) {
      logger.info(`Cleaned up old chat deliveries (${this.platform})`, { deleted });
    }
  }
}
