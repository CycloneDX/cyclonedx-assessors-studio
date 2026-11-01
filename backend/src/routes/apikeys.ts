import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import crypto from 'node:crypto';
import { getDatabase } from '../db/connection.js';
import { AuthRequest, requireAuth, requireSession, hashApiKey, getPermissionsForRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

/**
 * Generate a cryptographically random API key with a recognizable prefix.
 * Format: cdxa_<40 hex chars>  (total 45 chars)
 */
function generateApiKey(): { key: string; prefix: string } {
  const raw = crypto.randomBytes(20).toString('hex');
  const key = `cdxa_${raw}`;
  const prefix = key.slice(0, 8); // "cdxa_xxx" visible prefix for identification
  return { key, prefix };
}

/**
 * POST /api/v1/apikeys
 * Create a new API key for the authenticated user (or another user if admin).
 * Body: { name: string, expiresInDays?: number, userId?: string }
 */
const DEFAULT_API_KEY_DAYS = 90;
const MAX_API_KEY_DAYS = 365;
const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(255),
  expiresInDays: z.number().int().min(1).max(MAX_API_KEY_DAYS).optional(),
  userId: z.string().uuid().optional(),
});

router.post(
  '/',
  requireSession,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: `A name (1 to 255 characters) is required; expiresInDays must be a whole number from 1 to ${MAX_API_KEY_DAYS}.`,
      });
      return;
    }
    const { name, userId } = parsed.data;
    // Keys always expire (security review A3): default 90 days, at most a year.
    const expiresInDays = parsed.data.expiresInDays ?? DEFAULT_API_KEY_DAYS;

    // Non-admins can only create keys for themselves
    const userPermissions = await getPermissionsForRole(req.user!.role);
    const isAdmin = userPermissions.includes('admin.settings');
    const targetUserId = userId && isAdmin ? userId : req.user!.id;

    const db = getDatabase();

    // When creating a key for another user, validate they exist and are active
    if (targetUserId !== req.user!.id) {
      // Only id and is_active are needed for this check; avoid loading
      // password_hash or any other sensitive column unnecessarily.
      const targetUser = await db
        .selectFrom('app_user')
        .where('id', '=', targetUserId)
        .select(['id', 'is_active'])
        .executeTakeFirst();

      if (!targetUser) {
        res.status(404).json({ error: 'Target user not found' });
        return;
      }

      if (!targetUser.is_active) {
        res.status(400).json({ error: 'Cannot create API key for a deactivated user' });
        return;
      }
    }

    const { key, prefix } = generateApiKey();
    const keyHash = hashApiKey(key);

    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const row = await db
      .insertInto('api_key')
      .values({
        name,
        prefix,
        key_hash: keyHash,
        user_id: targetUserId,
        expires_at: expiresAt,
        created_at: new Date(),
      })
      .returning(['id', 'name', 'prefix', 'expires_at', 'created_at'])
      .executeTakeFirstOrThrow();

    // Add audit log entry when creating a key for another user
    if (req.user && targetUserId !== req.user.id) {
      await logAudit(db, {
        entityType: 'api_key',
        entityId: row.id,
        action: 'create_for_other',
        userId: req.user.id,
        changes: { targetUserId, keyName: name },
      });
    }

    logger.info('API key created', {
      keyId: row.id,
      userId: targetUserId,
      requestId: req.requestId,
    });

    // Return the plaintext key exactly ONCE. It cannot be retrieved again.
    res.status(201).json({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      key,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    });
  })
);

/**
 * GET /api/v1/apikeys
 * List API keys for the authenticated user (admins see all).
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    let query = db
      .selectFrom('api_key')
      .select(['id', 'name', 'prefix', 'user_id', 'expires_at', 'last_used_at', 'created_at']);

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userPermissions = await getPermissionsForRole(req.user.role);
    const isAdmin = userPermissions.includes('admin.settings');
    if (!isAdmin) {
      query = query.where('user_id', '=', req.user.id);
    }

    const keys = await query.orderBy('created_at', 'desc').execute();

    res.json({ data: keys });
  })
);

/**
 * DELETE /api/v1/apikeys/:id
 * Revoke (delete) an API key. Users can revoke their own; admins can revoke any.
 */
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const keyId = req.params.id;

    const existing = await db
      .selectFrom('api_key')
      .where('id', '=', keyId)
      .select(['id', 'user_id'])
      .executeTakeFirst();

    if (!existing) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    // Non-admins can only delete their own keys
    const userPermissions = await getPermissionsForRole(req.user!.role);
    const isAdmin = userPermissions.includes('admin.settings');
    if (!isAdmin && existing.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    await db.deleteFrom('api_key').where('id', '=', keyId).execute();

    logger.info('API key revoked', {
      keyId,
      revokedBy: req.user!.id,
      requestId: req.requestId,
    });

    res.json({ message: 'API key revoked' });
  })
);

export default router;
