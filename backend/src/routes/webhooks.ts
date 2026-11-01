/**
 * Webhook management API routes.
 *
 * Admin-only endpoints for creating, updating, deleting, testing,
 * and re-enabling webhook subscriptions, plus delivery log access.
 */

import { auditMutations } from '../utils/audit.js';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabase } from '../db/connection.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { AuthRequest, requireAuth, requirePermission, requireSession } from '../middleware/auth.js';
import { getEventBus } from '../events/index.js';
import { CHANNEL_TEST } from '../events/catalog.js';
import { validatePagination } from '../utils/pagination.js';
import { encryptionService } from '../utils/encryption.js';
import { hostnameResolvesToPrivate, isPrivateOrReservedUrl } from '../utils/url-safety.js';

const router = Router();
router.use(auditMutations('webhook'));

/**
 * Generate a cryptographically secure webhook secret.
 */
function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`;
}

// Custom Zod refinement for safe webhook URLs
const UNSAFE_WEBHOOK_URL = 'Webhook URL must use HTTPS and cannot target private, reserved, or internal network addresses';

const safeWebhookUrl = z.string().url('URL must be a valid URL').refine(
  (url) => !isPrivateOrReservedUrl(url),
  UNSAFE_WEBHOOK_URL
);

/** Refuses a URL whose hostname resolves inside the network; responds 400. */
async function rejectInternalHost(url: string | undefined, res: Response): Promise<boolean> {
  if (!url || !(await hostnameResolvesToPrivate(url))) return false;
  res.status(400).json({ error: 'Invalid input', details: [{ path: ['url'], message: UNSAFE_WEBHOOK_URL }] });
  return true;
}

interface WebhookUpdateInput {
  name?: string;
  url?: string;
  eventTypes?: string[];
  isActive?: boolean;
  regenerateSecret?: boolean;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: unknown;
  is_active: boolean;
}

/**
 * Build webhook update data from request payload.
 */
function buildWebhookUpdates(data: WebhookUpdateInput): Record<string, unknown> {
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.url !== undefined) updates.url = data.url;
  if (data.eventTypes !== undefined) updates.event_types = data.eventTypes;
  if (data.isActive !== undefined) {
    updates.is_active = data.isActive;
    if (data.isActive) updates.consecutive_failures = 0;
  }
  return updates;
}

/**
 * Apply update fields from `data` to `result`, returning the mutated object.
 */
function applyWebhookUpdatesToResult(
  result: Record<string, unknown>,
  webhook: WebhookRow,
  data: WebhookUpdateInput,
): Record<string, unknown> {
  result.name = data.name ?? webhook.name;
  result.url = data.url ?? webhook.url;
  result.eventTypes = data.eventTypes ?? webhook.event_types;
  result.isActive = data.isActive ?? webhook.is_active;
  return result;
}

/**
 * Build webhook response object from webhook record and request data.
 */
function buildWebhookResponse(
  webhook: WebhookRow,
  data: WebhookUpdateInput,
  newSecret: string | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = { id: webhook.id };
  applyWebhookUpdatesToResult(result, webhook, data);

  if (newSecret) {
    result.secret = newSecret;
  }

  return result;
}

// ---- Schemas ----

const createWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  url: safeWebhookUrl,
  eventTypes: z.array(z.string().min(1)).min(1, 'At least one event type is required'),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: safeWebhookUrl.optional(),
  eventTypes: z.array(z.string().min(1)).min(1).optional(),
  regenerateSecret: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ---- Routes ----

/**
 * GET /api/v1/webhooks
 * List all webhooks (admin only).
 */
router.get(
  '/',
  requireAuth,
  requirePermission('admin.webhooks'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const webhooks = await db
      .selectFrom('webhook')
      .select([
        'id', 'name', 'url', 'event_types', 'is_active',
        'consecutive_failures', 'created_by', 'created_at', 'updated_at',
      ])
      .orderBy('created_at', 'desc')
      .execute();

    res.json({ data: webhooks });
  }),
);

/**
 * POST /api/v1/webhooks
 * Create a webhook (admin only).
 */
router.post(
  '/',
  requireSession,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createWebhookSchema.parse(req.body);
      if (await rejectInternalHost(data.url, res)) return;
      const db = getDatabase();

      const id = uuidv4();
      const secret = generateSecret();
      const encryptedSecret = encryptionService.encrypt(secret);

      await db
        .insertInto('webhook')
        .values({
          id,
          name: data.name,
          url: data.url,
          secret: encryptedSecret,
          event_types: data.eventTypes as string[],
          is_active: true,
          consecutive_failures: 0,
          created_by: req.user!.id,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      // Return the secret only on create (it is never returned again in full)
      res.status(201).json({
        id,
        name: data.name,
        url: data.url,
        secret,
        eventTypes: data.eventTypes,
        isActive: true,
        consecutiveFailures: 0,
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * GET /api/v1/webhooks/:id
 * Get webhook details with recent delivery stats (admin only).
 */
router.get(
  '/:id',
  requireAuth,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', req.params.id)
      .select([
        'id', 'name', 'url', 'event_types', 'is_active',
        'consecutive_failures', 'created_by', 'created_at', 'updated_at',
      ])
      .executeTakeFirst();

    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    // Get recent delivery stats
    const stats = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', req.params.id)
      .select([
        db.fn.count<number>('id').as('total_deliveries'),
      ])
      .executeTakeFirst();

    const successCount = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', req.params.id)
      .where('status', '=', 'success')
      .select(db.fn.count<number>('id').as('count'))
      .executeTakeFirst();

    const lastSuccess = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', req.params.id)
      .where('status', '=', 'success')
      .orderBy('delivered_at', 'desc')
      .select('delivered_at')
      .executeTakeFirst();

    res.json({
      ...webhook,
      deliveryStats: {
        totalDeliveries: Number(stats?.total_deliveries ?? 0),
        successfulDeliveries: Number(successCount?.count ?? 0),
        lastSuccessAt: lastSuccess?.delivered_at || null,
      },
    });
  }),
);

/**
 * PUT /api/v1/webhooks/:id
 * Update webhook config (admin only).
 */
router.put(
  '/:id',
  requireSession,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateWebhookSchema.parse(req.body);
      if (await rejectInternalHost(data.url, res)) return;
      const db = getDatabase();

      // buildWebhookResponse only needs the fields listed here; avoid
      // loading the encrypted `secret` column unnecessarily.
      const webhook = await db
        .selectFrom('webhook')
        .where('id', '=', req.params.id)
        .select(['id', 'name', 'url', 'event_types', 'is_active'])
        .executeTakeFirst();

      if (!webhook) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
      }

      const updates = buildWebhookUpdates(data);
      let newSecret: string | null = null;

      if (data.regenerateSecret) {
        newSecret = generateSecret();
        updates.secret = encryptionService.encrypt(newSecret);
      }

      await db
        .updateTable('webhook')
        .set(updates)
        .where('id', '=', req.params.id)
        .execute();

      const result = buildWebhookResponse(webhook, data, newSecret);
      res.json(result);
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * DELETE /api/v1/webhooks/:id
 * Delete webhook and all delivery history (admin only).
 */
router.delete(
  '/:id',
  requireSession,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    // Verify the webhook exists before deleting
    const existing = await db
      .selectFrom('webhook')
      .select('id')
      .where('id', '=', req.params.id)
      .executeTakeFirst();

    if (!existing) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    await db
      .deleteFrom('webhook')
      .where('id', '=', req.params.id)
      .execute();

    res.json({ message: 'Webhook deleted successfully' });
  }),
);

/**
 * POST /api/v1/webhooks/:id/test
 * Deliver a channel.test event to this webhook (admin only).
 */
router.post(
  '/:id/test',
  requireSession,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    // Only id and name are referenced when emitting the test event; restrict
    // the projection so the encrypted secret column is never loaded here.
    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', req.params.id)
      .select(['id', 'name'])
      .executeTakeFirst();

    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    // Emit a test event through the event bus
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const eventBus = getEventBus();
    const envelope = eventBus.emit(
      CHANNEL_TEST,
      {
        webhookId: webhook.id,
        webhookName: webhook.name,
        message: 'This is a test delivery from CycloneDX Assessors Studio',
      },
      { userId: req.user.id, displayName: req.user.displayName },
    );

    res.json({
      message: 'Test event emitted',
      eventId: envelope?.id || null,
    });
  }),
);

/**
 * POST /api/v1/webhooks/:id/enable
 * Re-enable a disabled webhook and reset its failure counter (admin only).
 */
router.post(
  '/:id/enable',
  requireSession,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    // Existence check only — no webhook columns beyond id are used below,
    // so avoid loading the encrypted secret or other fields.
    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', req.params.id)
      .select('id')
      .executeTakeFirst();

    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    await db
      .updateTable('webhook')
      .set({
        is_active: true,
        consecutive_failures: 0,
        updated_at: new Date(),
      })
      .where('id', '=', req.params.id)
      .execute();

    res.json({
      message: 'Webhook re-enabled',
      id: webhook.id,
      isActive: true,
      consecutiveFailures: 0,
    });
  }),
);

/**
 * GET /api/v1/webhooks/:id/deliveries
 * Paginated delivery log for a webhook (admin only).
 */
router.get(
  '/:id/deliveries',
  requireAuth,
  requirePermission('admin.webhooks'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const { limit, offset } = validatePagination(req.query);

    // Verify webhook exists
    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', req.params.id)
      .select('id')
      .executeTakeFirst();

    if (!webhook) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const totalResult = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', req.params.id)
      .select(db.fn.count<number>('id').as('count'))
      .executeTakeFirst();

    const total = Number(totalResult?.count ?? 0);

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', req.params.id)
      // Never response_body: older rows may hold a target's response,
      // which made SSRF readable (security review X1).
      .select([
        'id', 'webhook_id', 'event_id', 'event_type', 'status', 'http_status',
        'attempt', 'next_retry_at', 'request_body', 'error_message', 'delivered_at', 'created_at',
      ])
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit)
      .execute();

    res.json({
      data: deliveries,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  }),
);

export default router;
