import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getConfig } from '../config/index.js';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { logAudit } from '../utils/audit.js';
import type { EventBus } from '../events/event-bus.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
    role: 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver';
    displayName: string;
    hasCompletedOnboarding?: boolean;
  };
  requestId?: string;
  eventBus?: EventBus;
  // How the caller authenticated on this request. Set by requireAuth /
  // requireSession. Handlers can gate sensitive branches (e.g. final
  // assessment state transitions) on 'session' so that programmatic
  // API keys cannot reach them even when the route otherwise accepts a key.
  authMethod?: 'session' | 'apikey';
}

const config = getConfig();

/**
 * Hash an API key for storage or lookup using SHA-256.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Authenticate via the X-Api-Key header. Returns the user if valid,
 * or null if the header is absent / the key is invalid.
 */
async function authenticateApiKey(req: AuthRequest): Promise<AuthRequest['user'] | null> {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || typeof apiKey !== 'string') return null;

  const keyHash = hashApiKey(apiKey);
  const db = getDatabase();

  const row = await db
    .selectFrom('api_key')
    .where('key_hash', '=', keyHash)
    .selectAll()
    .executeTakeFirst();

  if (!row) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  const user = await db
    .selectFrom('app_user')
    .where('id', '=', row.user_id)
    .where('is_active', '=', true)
    .selectAll()
    .executeTakeFirst();

  if (!user) return null;

  // Update last_used_at (fire and forget)
  db.updateTable('api_key')
    .set({ last_used_at: new Date() })
    .where('id', '=', row.id)
    .execute()
    .catch(() => {});

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    hasCompletedOnboarding: user.has_completed_onboarding,
  };
}

/**
 * Authenticate via the httpOnly session cookie. Returns the user if
 * valid, or null if the cookie is absent / the session is invalid.
 */
async function authenticateCookie(req: AuthRequest): Promise<AuthRequest['user'] | null> {
  const token = req.cookies?.token;
  if (!token) return null;

  let decoded: Record<string, unknown>;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as Record<string, unknown>;
  } catch {
    return null;
  }

  const db = getDatabase();
  const session = await db
    .selectFrom('session')
    .where('id', '=', decoded.sessionId as string)
    .where('expires_at', '>', new Date())
    .selectAll()
    .executeTakeFirst();

  if (!session) return null;

  const user = await db
    .selectFrom('app_user')
    .where('id', '=', session.user_id)
    .where('is_active', '=', true)
    .selectAll()
    .executeTakeFirst();

  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    hasCompletedOnboarding: user.has_completed_onboarding,
  };
}

/**
 * Attempt to authenticate the request without rejecting unauthenticated
 * callers.  Returns the user object when credentials are present and
 * valid, or null otherwise.
 */
export async function tryAuthenticate(
  req: AuthRequest
): Promise<AuthRequest['user'] | null> {
  try {
    const apiKeyAuth = await authenticateApiKey(req);
    return apiKeyAuth ?? await authenticateCookie(req);
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Try API key first (programmatic access), then fall back to cookie
    // (browser session).
    const apiKeyUser = await authenticateApiKey(req);
    const user = apiKeyUser ?? await authenticateCookie(req);

    if (!user) {
      res.status(401).json({ error: 'Authentication required. Provide a session cookie or X-Api-Key header.' });
      return;
    }

    req.user = user;
    req.authMethod = apiKeyUser ? 'apikey' : 'session';
    next();
  } catch (error) {
    logger.error('Authentication error', {
      error,
      requestId: req.requestId,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Like requireAuth, but rejects programmatic API-key callers. Use this on
 * endpoints that must only be driven from an interactive browser session:
 * credential management, audit-log reads, bulk import/export, and other
 * high-blast-radius operations that no machine integration should perform.
 *
 * A caller presenting an X-Api-Key header gets 403 (their credential is
 * valid but not permitted here); a caller with no credentials gets 401.
 */
export async function requireSession(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // An X-Api-Key header is an explicit programmatic attempt. Reject it
    // before touching the cookie so the 403 is unambiguous, even if a
    // session cookie also happens to be present on the request.
    if (req.headers['x-api-key']) {
      res.status(403).json({
        error: 'This endpoint requires an interactive session and cannot be used with an API key.',
      });
      return;
    }

    const user = await authenticateCookie(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Sign in to continue.' });
      return;
    }

    req.user = user;
    req.authMethod = 'session';
    next();
  } catch (error) {
    logger.error('Session authentication error', {
      error,
      requestId: req.requestId,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}

// NOTE: A `requireRole(...roles)` middleware lived here previously and
// gated routes by role name. It was removed deliberately. Authorization
// in this codebase is permission keyed, not role keyed: roles are only
// a convenience grouping of permission rows, and any new gate must use
// `requirePermission(...)` against permission keys from the DB. See the
// memory note `feedback_permissions_only` for the reasoning. Do not
// reintroduce a role name based middleware.

export async function getPermissionsForRole(roleKey: string): Promise<string[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('role')
    .innerJoin('role_permission', 'role.id', 'role_permission.role_id')
    .innerJoin('permission', 'permission.id', 'role_permission.permission_id')
    .where('role.key', '=', roleKey)
    .select('permission.key')
    .execute();
  return rows.map(r => r.key);
}

export function requirePermission(...requiredPermissions: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const db = getDatabase();

      // Look up user's role, then get all permission keys for that role
      const userPermissions = await db
        .selectFrom('role')
        .innerJoin('role_permission', 'role.id', 'role_permission.role_id')
        .innerJoin('permission', 'permission.id', 'role_permission.permission_id')
        .where('role.key', '=', req.user.role)
        .select('permission.key')
        .execute();

      const permissionKeys = userPermissions.map(p => p.key);

      const hasPermission = requiredPermissions.some(rp => permissionKeys.includes(rp));
      if (!hasPermission) {
        logger.warn('Unauthorized access attempt', {
          userId: req.user.id,
          requiredPermissions,
          userPermissions: permissionKeys,
          requestId: req.requestId,
        });

        // Persist the denial to the audit log. Previously individual
        // call sites logged denials inconsistently; this central hook
        // guarantees every 403 out of this middleware leaves a trail
        // suitable for SIEM ingestion and incident response. Fire and
        // forget: the log call already swallows its own errors, and
        // failing to write an audit row must not upgrade the 403 into
        // a 500.
        void logAudit(db, {
          entityType: 'auth',
          entityId: req.user.id,
          action: 'authz_denied',
          userId: req.user.id,
          changes: {
            requiredPermissions,
            userPermissions: permissionKeys,
            method: req.method,
            path: req.originalUrl,
            requestId: req.requestId,
          },
        });

        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      next();
    } catch (error) {
      logger.error('Permission check error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

