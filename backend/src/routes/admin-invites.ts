import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/index.js';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { type AuthRequest, requireAuth, requirePermission, requireSession } from '../middleware/auth.js';
import { generateToken, hashToken } from '../utils/crypto.js';
import { VALID_ROLE_KEYS } from '../utils/roles.js';

const router = Router();

/**
 * Admin invite management.
 *
 * Invites are single use tokens an administrator issues so that a
 * specific person can register an account when the server is running
 * with REGISTRATION_MODE=invite_only. Invites can also be used under
 * REGISTRATION_MODE=open to pre-assign an elevated role.
 *
 * Security notes:
 *   - The plaintext token is returned to the admin exactly once, on
 *     create. The server stores only a SHA-256 hash.
 *   - All endpoints in this router require the admin.users permission.
 *   - Tokens carry a required expiration and are invalidated on first
 *     use, on explicit revocation, or when the expiration elapses.
 */

const createInviteSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  intendedRole: z.enum(VALID_ROLE_KEYS).default('assessee'),
  // Default to seven days. Clamp to a week at most so stale invites
  // cannot linger indefinitely in the database.
  expiresInHours: z.coerce.number().int().positive().max(24 * 30).default(24 * 7),
});

/**
 * GET /api/v1/admin/invites/email-configured
 *
 * Reports whether an outbound SMTP channel is configured so the UI can
 * warn the admin up front that the invite will not be emailed. We keep
 * this endpoint separate from /admin/integrations/status (which exposes
 * the host, port, and other details and is gated on admin.settings)
 * because user managers who hold admin.users but not admin.settings
 * still need to know whether they must hand deliver the token.
 *
 * The response intentionally carries only a boolean — no host, port,
 * user, or from-address leaks to a role that cannot otherwise see SMTP
 * configuration. "Configured" means SMTP_ENABLED is true AND a host is
 * set; either missing piece makes email delivery impossible.
 */
router.get(
  '/email-configured',
  requireAuth,
  requirePermission('admin.users'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const config = getConfig();
    const emailConfigured = config.SMTP_ENABLED && config.SMTP_HOST.trim().length > 0;
    res.json({ emailConfigured });
  })
);

/**
 * POST /api/v1/admin/invites
 *
 * Issue a new invite. Returns the plaintext token exactly once so the
 * admin can share it out of band. The database stores only the hash.
 */
router.post(
  '/',
  requireSession,
  requirePermission('admin.users'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const data = createInviteSchema.parse(req.body);
      const db = getDatabase();

      const token = generateToken();
      const tokenHash = hashToken(token);
      const id = uuidv4();
      const expiresAt = new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000);

      await db
        .insertInto('user_invite')
        .values({
          id,
          token_hash: tokenHash,
          email: data.email ?? null,
          intended_role: data.intendedRole,
          created_by: req.user.id,
          expires_at: expiresAt,
        })
        .execute();

      logger.info('Admin issued user invite', {
        inviteId: id,
        issuedBy: req.user.id,
        intendedRole: data.intendedRole,
        scopedEmail: Boolean(data.email),
        expiresAt: expiresAt.toISOString(),
        requestId: req.requestId,
      });

      res.status(201).json({
        id,
        token,
        email: data.email ?? null,
        intendedRole: data.intendedRole,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

/**
 * GET /api/v1/admin/invites
 *
 * List invites. Never returns the plaintext token. Callers can see
 * whether an invite is still pending, has been consumed, or was
 * revoked. Results are ordered newest first.
 */
router.get(
  '/',
  requireAuth,
  requirePermission('admin.users'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const rows = await db
      .selectFrom('user_invite')
      .select([
        'id',
        'email',
        'intended_role',
        'created_by',
        'created_at',
        'expires_at',
        'consumed_at',
        'consumed_by',
        'revoked_at',
      ])
      .orderBy('created_at', 'desc')
      .execute();

    const now = Date.now();
    const invites = rows.map((row) => {
      let status: 'pending' | 'consumed' | 'revoked' | 'expired';
      if (row.consumed_at) {
        status = 'consumed';
      } else if (row.revoked_at) {
        status = 'revoked';
      } else if (new Date(row.expires_at).getTime() < now) {
        status = 'expired';
      } else {
        status = 'pending';
      }
      return {
        id: row.id,
        email: row.email,
        intendedRole: row.intended_role,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
        consumedBy: row.consumed_by,
        revokedAt: row.revoked_at,
        status,
      };
    });

    res.json({ invites });
  })
);

/**
 * DELETE /api/v1/admin/invites/:id
 *
 * Revoke an invite that has not yet been consumed. Already consumed
 * invites cannot be revoked because the associated user would not be
 * affected.
 */
router.delete(
  '/:id',
  requireSession,
  requirePermission('admin.users'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const db = getDatabase();
    const inviteId = req.params.id;

    const invite = await db
      .selectFrom('user_invite')
      .where('id', '=', inviteId)
      .select(['id', 'consumed_at', 'revoked_at'])
      .executeTakeFirst();

    if (!invite) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    if (invite.consumed_at) {
      res.status(409).json({ error: 'Invite has already been consumed' });
      return;
    }

    if (invite.revoked_at) {
      // Idempotent: treat an already revoked invite as a no op.
      res.status(204).send();
      return;
    }

    await db
      .updateTable('user_invite')
      .set({ revoked_at: new Date() })
      .where('id', '=', inviteId)
      .where('consumed_at', 'is', null)
      .execute();

    logger.info('Admin revoked user invite', {
      inviteId,
      revokedBy: req.user.id,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

export default router;
