/**
 * Admin notification rules CRUD API.
 *
 * Routes for managing system-level notification rules.
 * All routes require admin role.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { createRuleSchema, updateRuleSchema, ADMIN_VALID_EVENT_TYPES, validateEventTypes } from './notification-rules-helpers.js';

const router = Router();

/**
 * GET /admin/notification-rules
 * List all system notification rules
 */
router.get('/', requireAuth, requirePermission('admin.notification_rules'), asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const rules = await db
    .selectFrom('notification_rule')
    .where('scope', '=', 'system')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();

  res.json(rules as Record<string, unknown>[]);
}));

/**
 * POST /admin/notification-rules
 * Create a new system notification rule
 */
router.post('/', requireAuth, requirePermission('admin.notification_rules'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createRuleSchema.parse(req.body);
    const db = getDatabase();
    const ruleId = uuidv4();

    // Validate event types are from catalog
    const validationError = validateEventTypes(data.eventTypes, ADMIN_VALID_EVENT_TYPES);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    // Create rule
    await db
      .insertInto('notification_rule')
      .values({
        id: ruleId,
        name: data.name,
        scope: 'system',
        channel: data.channel,
        event_types: JSON.stringify(data.eventTypes),
        filters: JSON.stringify(data.filters),
        destination: JSON.stringify(data.destination),
        enabled: data.enabled,
        created_by: req.user?.id,
      })
      .execute();

    const rule = await db
      .selectFrom('notification_rule')
      .where('id', '=', ruleId)
      .selectAll()
      .executeTakeFirstOrThrow();

    logger.info('Created notification rule', {
      ruleId,
      userId: req.user?.id,
    });

    res.status(201).json(rule);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

/**
 * GET /admin/notification-rules/:id
 * Get a single system notification rule
 */
router.get('/:id', requireAuth, requirePermission('admin.notification_rules'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const db = getDatabase();

  const rule = await db
    .selectFrom('notification_rule')
    .where('id', '=', id)
    .where('scope', '=', 'system')
    .selectAll()
    .executeTakeFirst();

  if (!rule) {
    res.status(404).json({ error: 'Notification rule not found' });
    return;
  }

  res.json(rule);
}));

/**
 * PUT /admin/notification-rules/:id
 * Update a system notification rule
 */
router.put('/:id', requireAuth, requirePermission('admin.notification_rules'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateRuleSchema.parse(req.body);
    const db = getDatabase();

    // Check rule exists
    const existing = await db
      .selectFrom('notification_rule')
      .where('id', '=', id)
      .where('scope', '=', 'system')
      .selectAll()
      .executeTakeFirst();

    if (!existing) {
      res.status(404).json({ error: 'Notification rule not found' });
      return;
    }

    // Validate event types if provided
    if (data.eventTypes) {
      const validationError = validateEventTypes(data.eventTypes, ADMIN_VALID_EVENT_TYPES);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    // Update rule
    const updates: Record<string, unknown> = {};
    if (data.name) updates.name = data.name;
    if (data.channel) updates.channel = data.channel;
    if (data.eventTypes) updates.event_types = JSON.stringify(data.eventTypes);
    if (data.filters) updates.filters = JSON.stringify(data.filters);
    if (data.destination) updates.destination = JSON.stringify(data.destination);
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    updates.updated_at = new Date();

    await db
      .updateTable('notification_rule')
      .set(updates)
      .where('id', '=', id)
      .execute();

    const rule = await db
      .selectFrom('notification_rule')
      .where('id', '=', id)
      .selectAll()
      .executeTakeFirstOrThrow();

    logger.info('Updated notification rule', {
      ruleId: id,
      userId: req.user?.id,
    });

    res.json(rule);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

/**
 * DELETE /admin/notification-rules/:id
 * Delete a system notification rule
 */
router.delete('/:id', requireAuth, requirePermission('admin.notification_rules'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const db = getDatabase();

  // Check rule exists
  const existing = await db
    .selectFrom('notification_rule')
    .where('id', '=', id)
    .where('scope', '=', 'system')
    .selectAll()
    .executeTakeFirst();

  if (!existing) {
    res.status(404).json({ error: 'Notification rule not found' });
    return;
  }

  // Delete rule
  await db
    .deleteFrom('notification_rule')
    .where('id', '=', id)
    .execute();

  logger.info('Deleted notification rule', {
    ruleId: id,
    userId: req.user?.id,
  });

  res.status(204).send();
}));

export default router;
