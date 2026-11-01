import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { sql } from 'kysely';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { AuthRequest, requireAuth, getPermissionsForRole } from '../middleware/auth.js';
import { hashPassword, verifyPassword, hashToken } from '../utils/crypto.js';
import { validatePasswordPolicy, PASSWORD_MAX_LENGTH } from '../utils/password-policy.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { authLoginTotal } from '../metrics/index.js';
import { fetchUserById, fetchUserByUsername, formatUserProfile } from '../utils/user-queries.js';
import { checkResourceExists } from '../utils/resource-checks.js';
import { logAudit } from '../utils/audit.js';
import { buildSessionCookieOptions, buildClearCookieOptions } from '../utils/cookies.js';
import { deliverPasswordReset } from '../services/password-reset-mail.js';

/**
 * argon2 hash of random bytes, computed once. Verified against on the
 * unknown-user and locked-account paths so they take as long as a real
 * password check.
 */
let dummyPasswordHash: Promise<string> | null = null;
function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword(crypto.randomBytes(32).toString('base64url'));
  return dummyPasswordHash;
}

const router = Router();
const config = getConfig();

// Login accepts any non-empty password. A stricter minimum here would
// lock out accounts whose password was set before the current policy
// took effect. The handler only verifies against the stored hash, so a
// short string simply fails to match and returns a generic 401.
const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});

// Register defers detailed password policy enforcement to
// validatePasswordPolicy, which has access to the resolved config
// (min length, HIBP opt in) and context (username, email, display
// name) the user just provided. The schema enforces only the
// static upper bound here to fail closed on obvious DoS attempts.
const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
  displayName: z.string().min(1, 'Display name is required'),
  inviteToken: z.string().optional(),
});

/**
 * GET /api/v1/auth/password-policy
 *
 * Public endpoint that exposes only the bounds the client needs to
 * render validation hints and placeholder copy consistent with the
 * server. Deliberately omits the breach check toggle and deny list
 * contents: those stay server side because they let an attacker
 * pre-filter a guessing list. The bounds themselves are already
 * visible through 400 error messages on register and setup, so
 * surfacing them here does not create a new disclosure (NIST SP
 * 800-63B §5.1.1.2 and OWASP ASVS v5 §V6.2 both treat policy
 * parameters as non-secret).
 *
 * Reads config at request time so an operator who tunes
 * PASSWORD_MIN_LENGTH does not need to restart the frontend build to
 * see the new value reflected in the UI.
 */
router.get('/password-policy', (_req, res) => {
  const current = getConfig();
  res.json({
    minLength: current.PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  });
});

router.post('/login', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const db = getDatabase();

    const user = await fetchUserByUsername(db, username);

    if (!user) {
      // Spend the same argon2 time as a real check so response timing
      // does not reveal which usernames exist (security review A6).
      await verifyPassword(await getDummyPasswordHash(), password);
      authLoginTotal.inc({ method: 'local', result: 'failure' });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Account lockout gate (mitigates credential stuffing and online
    // password guessing). We check before the password verification step
    // so a locked account cannot be probed for its password. The response
    // is intentionally the same generic 401 that bad credentials produce,
    // preventing an attacker from learning that the username exists by
    // observing a different status code or message.
    const now = new Date();
    if (user.locked_until && new Date(user.locked_until) > now) {
      await verifyPassword(await getDummyPasswordHash(), password);
      authLoginTotal.inc({ method: 'local', result: 'failure' });
      logger.warn('Login attempt against locked account', {
        userId: user.id,
        lockedUntil: user.locked_until,
        requestId: req.requestId,
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const passwordValid = await verifyPassword(user.password_hash, password);

    if (!passwordValid) {
      authLoginTotal.inc({ method: 'local', result: 'failure' });

      // Increment in the database, not read-modify-write, so concurrent
      // guesses each count. A lock that has already expired starts a fresh
      // count; otherwise one wrong password per lockout window kept a known
      // account locked forever (security review A7).
      const counted = await db
        .updateTable('app_user')
        .set({
          failed_login_count: sql<number>`CASE WHEN locked_until IS NOT NULL AND locked_until <= ${now} THEN 1 ELSE COALESCE(failed_login_count, 0) + 1 END`,
          locked_until: sql<Date | null>`CASE WHEN locked_until IS NOT NULL AND locked_until <= ${now} THEN NULL ELSE locked_until END`,
          last_failed_login_at: now,
        })
        .where('id', '=', user.id)
        .returning('failed_login_count')
        .executeTakeFirst();
      const nextCount = Number(counted?.failed_login_count ?? 1);
      const threshold = config.LOGIN_MAX_FAILED_ATTEMPTS;
      const shouldLock = threshold > 0 && nextCount >= threshold;
      const updates: { locked_until?: Date } = {};
      if (shouldLock) {
        updates.locked_until = new Date(
          now.getTime() + config.LOGIN_LOCKOUT_DURATION_MINUTES * 60 * 1000,
        );
        await db
          .updateTable('app_user')
          .set({ locked_until: updates.locked_until })
          .where('id', '=', user.id)
          .execute();
      }

      if (shouldLock) {
        logger.warn('Account locked after repeated failed logins', {
          userId: user.id,
          failedLoginCount: nextCount,
          lockedUntil: updates.locked_until,
          requestId: req.requestId,
        });
        await logAudit(db, {
          entityType: 'app_user',
          entityId: user.id,
          action: 'state_change',
          userId: user.id,
          changes: {
            event: 'account_locked',
            failedLoginCount: nextCount,
            lockoutDurationMinutes: config.LOGIN_LOCKOUT_DURATION_MINUTES,
            lockedUntil: updates.locked_until?.toISOString(),
          },
        });
      }

      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.is_active) {
      authLoginTotal.inc({ method: 'local', result: 'failure' });
      logger.warn('Login attempt for inactive user', {
        userId: user.id,
        requestId: req.requestId,
      });
      // Use generic message to avoid revealing that the account exists
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Session identity is carried by the signed JWT alone. The server
    // looks up the session row by id (see middleware/auth.ts), so there
    // is no need to generate, hash, or persist a separate bearer token
    // on the session row.
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db
      .insertInto('session')
      .values({
        id: sessionId,
        user_id: user.id,
        ip_address: req.ip || undefined,
        user_agent: req.headers['user-agent'] || undefined,
        expires_at: expiresAt,
      })
      .execute();

    // Successful login resets the failed-attempt counter and clears any
    // prior lock. Doing this in the same round trip as last_login_at keeps
    // the rows consistent even if a later step fails.
    await db
      .updateTable('app_user')
      .set({
        last_login_at: new Date(),
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null,
      })
      .where('id', '=', user.id)
      .execute();

    const jwtToken = jwt.sign(
      { sessionId },
      config.JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: config.JWT_EXPIRY,
      } as jwt.SignOptions
    );

    res.cookie('token', jwtToken, buildSessionCookieOptions(24 * 60 * 60 * 1000));

    authLoginTotal.inc({ method: 'local', result: 'success' });

    logger.info('User logged in', {
      userId: user.id,
      username: user.username,
      requestId: req.requestId,
    });

    // Fetch permissions for the user's role
    const permissions = await getPermissionsForRole(user.role);

    // Token is in the httpOnly cookie only. Never expose it in the response body.
    res.json({
      user: formatUserProfile(user),
      permissions,
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

router.post('/register', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);
    const db = getDatabase();
    const mode = config.REGISTRATION_MODE;

    // Registration gate (C2 mitigation). Default is disabled so a fresh
    // deployment is closed until an operator opts in explicitly.
    if (mode === 'disabled') {
      logger.warn('Registration attempt while REGISTRATION_MODE=disabled', {
        requestId: req.requestId,
      });
      res.status(403).json({ error: 'Registration is not available on this instance' });
      return;
    }

    // Invite token handling. Required when mode=invite_only, optional and
    // used for the intended role in mode=open (so admins can pre-issue
    // tokens for elevated accounts even when open signup is on).
    let invite: { id: string; intended_role: string; email: string | null } | undefined;
    if (data.inviteToken) {
      const tokenHash = hashToken(data.inviteToken);
      const now = new Date();
      const row = await db
        .selectFrom('user_invite')
        .where('token_hash', '=', tokenHash)
        .select(['id', 'intended_role', 'email', 'expires_at', 'consumed_at', 'revoked_at'])
        .executeTakeFirst();

      if (!row || row.consumed_at || row.revoked_at || row.expires_at < now) {
        res.status(400).json({ error: 'Invitation is invalid or has expired' });
        return;
      }

      // If the invite was scoped to an email, the registrant must match it.
      if (row.email && row.email.toLowerCase() !== data.email.toLowerCase()) {
        res.status(400).json({ error: 'Invitation email does not match' });
        return;
      }

      invite = {
        id: row.id,
        intended_role: row.intended_role,
        email: row.email ?? null,
      };
    } else if (mode === 'invite_only') {
      res.status(403).json({ error: 'An invitation is required to register' });
      return;
    }

    // Centralized password policy. Run before the existence check so
    // the generic 202 enumeration guard below always fires with the
    // same status code for both duplicate and fresh registrations
    // once the password itself is policy compliant.
    const policy = await validatePasswordPolicy(data.password, {
      username: data.username,
      email: data.email,
      displayName: data.displayName,
    });
    if (!policy.valid) {
      res.status(400).json({ error: policy.reason });
      return;
    }

    // Existence check only — we never return the row to the client, so
    // restrict the projection to id. Using selectAll here would load
    // password_hash into the handler for no reason, and any future
    // sensitive column added to app_user would silently ride along.
    const existingUser = await db
      .selectFrom('app_user')
      .where((eb) =>
        eb.or([
          eb('username', '=', data.username),
          eb('email', '=', data.email),
        ])
      )
      .select('id')
      .executeTakeFirst();

    if (existingUser) {
      // Return a generic 202 acknowledgment to prevent user and email
      // enumeration (M4 mitigation). The client cannot distinguish a
      // duplicate from a newly created account from the response body.
      // Audit the real outcome server side.
      logger.info('Registration attempt for existing identifier', {
        username: data.username,
        email: data.email,
        requestId: req.requestId,
      });
      res.status(202).json({
        message: 'If this account does not already exist, it will be created.',
      });
      return;
    }

    const passwordHash = await hashPassword(data.password);
    const userId = uuidv4();
    const role = invite?.intended_role ?? 'assessee';

    let inviteLost = false;
    await db.transaction().execute(async (trx) => {
      // Claim the invite before creating the account, re-checking every
      // validity condition in the same statement. A concurrent request
      // that already consumed it gets no row back and this one rolls
      // back: one invite, one account (security review A5).
      if (invite) {
        const claimed = await trx
          .updateTable('user_invite')
          .set({ consumed_at: new Date() })
          .where('id', '=', invite.id)
          .where('consumed_at', 'is', null)
          .where('revoked_at', 'is', null)
          .where('expires_at', '>', new Date())
          .returning('id')
          .executeTakeFirst();
        if (!claimed) {
          inviteLost = true;
          return;
        }
      }

      await trx
        .insertInto('app_user')
        .values(toSnakeCase({
          id: userId,
          username: data.username,
          email: data.email,
          passwordHash: passwordHash,
          displayName: data.displayName,
          role,
          isActive: true,
        }))
        .execute();

      // consumed_by references app_user, so it can only be set now.
      if (invite) {
        await trx
          .updateTable('user_invite')
          .set({ consumed_by: userId })
          .where('id', '=', invite.id)
          .execute();
      }
    });
    if (inviteLost) {
      res.status(400).json({ error: 'Invitation is invalid or has expired' });
      return;
    }

    logger.info('User registered', {
      userId,
      username: data.username,
      email: data.email,
      role,
      viaInvite: Boolean(invite),
      requestId: req.requestId,
    });

    res.status(202).json({
      message: 'If this account does not already exist, it will be created.',
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Extract session ID from the httpOnly cookie (same cookie used for auth).
    const cookieToken = req.cookies?.token;
    if (cookieToken) {
      try {
        const payload = jwt.verify(cookieToken, config.JWT_SECRET, { algorithms: ['HS256'] }) as { sessionId: string };
        await getDatabase()
          .deleteFrom('session')
          .where('id', '=', payload.sessionId)
          .execute();
      } catch {
        // Token already expired or invalid; clear the cookie anyway.
      }
    }

    res.clearCookie('token', buildClearCookieOptions());

    logger.info('User logged out', {
      userId: req.user.id,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

router.get('/me', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Fetch permissions for the user's role
    const permissions = await getPermissionsForRole(req.user.role);

    res.json({
      user: req.user,
      permissions,
    });
  } catch (error) {
    logger.error('Get current user error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// Schema only screens for presence and an upper bound; the full
// policy (min length, deny list, HIBP) runs inside the handler
// through validatePasswordPolicy so the error surface is identical
// to registration and setup.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(1, 'New password is required')
    .max(PASSWORD_MAX_LENGTH),
});

router.put(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const data = changePasswordSchema.parse(req.body);
      const db = getDatabase();

      const user = await checkResourceExists(db, res, 'app_user', req.user.id, 'User');
      if (!user) return;

      const passwordValid = await verifyPassword(user.password_hash, data.currentPassword);

      // 400, not 401: the session is valid; only a field is wrong. A 401
      // here reads as "session expired" and logs the user out client-side.
      if (!passwordValid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      // Enforce the centralized password policy on the new password.
      // Running this after the current-password check ensures an
      // unauthenticated attacker who guessed a session cannot probe
      // the HIBP endpoint with arbitrary strings.
      const policy = await validatePasswordPolicy(data.newPassword, {
        username: user.username,
        email: user.email,
        displayName: user.display_name,
      });
      if (!policy.valid) {
        res.status(400).json({ error: policy.reason });
        return;
      }

      // Disallow reusing the current password. Even if it satisfies
      // the policy, rotating to the same secret defeats the purpose.
      if (await verifyPassword(user.password_hash, data.newPassword)) {
        res.status(400).json({
          error: 'New password must be different from the current password',
        });
        return;
      }

      const newPasswordHash = await hashPassword(data.newPassword);

      await db
        .updateTable('app_user')
        .set(toSnakeCase({ passwordHash: newPasswordHash }))
        .where('id', '=', req.user.id)
        .execute();

      // Invalidate all existing sessions to prevent stolen session reuse.
      // This is a security requirement per OWASP ASVS 2.3.1. API keys go
      // too: a key minted from a stolen cookie must not outlive the
      // password change (security review A3).
      await db
        .deleteFrom('session')
        .where('user_id', '=', req.user.id)
        .execute();
      await db
        .deleteFrom('api_key')
        .where('user_id', '=', req.user.id)
        .execute();

      // Clear the current session cookie so the user must re-authenticate
      res.clearCookie('token', buildClearCookieOptions());

      logger.info('User changed password and all sessions invalidated', {
        userId: req.user.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated user (without password hash)
      const updatedUser = await fetchUserById(db, req.user.id);

      res.json({
        message: 'Password changed successfully. Please log in again.',
        user: updatedUser ? formatUserProfile(updatedUser) : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Change password error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

const updateProfileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
});

router.put(
  '/profile',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const data = updateProfileSchema.parse(req.body);
      const db = getDatabase();

      const user = await checkResourceExists(db, res, 'app_user', req.user.id, 'User');
      if (!user) return;

      await db
        .updateTable('app_user')
        .set(toSnakeCase({ displayName: data.displayName }))
        .where('id', '=', req.user.id)
        .execute();

      logger.info('User profile updated', {
        userId: req.user.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated user
      const updatedUser = await fetchUserById(db, req.user.id);

      res.json({
        user: updatedUser ? formatUserProfile(updatedUser) : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Update profile error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const db = getDatabase();

      // Delete all sessions and API keys for the user: "everywhere"
      // includes automation credentials (security review A3).
      await db
        .deleteFrom('session')
        .where('user_id', '=', req.user.id)
        .execute();
      await db
        .deleteFrom('api_key')
        .where('user_id', '=', req.user.id)
        .execute();

      // Clear the current session cookie
      res.clearCookie('token', buildClearCookieOptions());

      logger.info('User logged out from all sessions', {
        userId: req.user.id,
        requestId: req.requestId,
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Logout all sessions error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

router.post('/complete-onboarding', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const db = getDatabase();
    await db
      .updateTable('app_user')
      .set({ has_completed_onboarding: true })
      .where('id', '=', req.user.id)
      .execute();

    logger.info('User completed onboarding', {
      userId: req.user.id,
      requestId: req.requestId,
    });

    // Fetch and return the updated user
    const updatedUser = await fetchUserById(db, req.user.id);

    res.json({
      user: updatedUser ? formatUserProfile(updatedUser) : null,
    });
  } catch (error) {
    logger.error('Complete onboarding error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

/**
 * PATCH /me
 * Update current user's profile fields (chat identities, notification prefs)
 */
const updateUserProfileSchema = z.object({
  slackUserId: z.string().optional().nullable(),
  teamsUserId: z.string().optional().nullable(),
  mattermostUsername: z.string().optional().nullable(),
  emailNotifications: z.boolean().optional(),
});

router.patch('/me', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const data = updateUserProfileSchema.parse(req.body);
    const db = getDatabase();

    const updates: Record<string, any> = {};
    if (data.slackUserId !== undefined) {
      updates.slack_user_id = data.slackUserId;
    }
    if (data.teamsUserId !== undefined) {
      updates.teams_user_id = data.teamsUserId;
    }
    if (data.mattermostUsername !== undefined) {
      updates.mattermost_username = data.mattermostUsername;
    }
    if (data.emailNotifications !== undefined) {
      updates.email_notifications = data.emailNotifications;
    }

    if (Object.keys(updates).length === 0) {
      // No updates requested. Return the current profile stripped of
      // sensitive fields (never leak password_hash back to the client).
      const user = await fetchUserById(db, req.user.id);
      res.json({ user: user ? formatUserProfile(user) : null });
      return;
    }

    updates.updated_at = new Date();

    await db
      .updateTable('app_user')
      .set(updates)
      .where('id', '=', req.user.id)
      .execute();

    // Return the updated profile stripped of sensitive fields.
    const updatedUser = await fetchUserById(db, req.user.id);

    logger.info('Updated user profile', {
      userId: req.user.id,
    });

    res.json({ user: updatedUser ? formatUserProfile(updatedUser) : null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.issues });
      return;
    }
    logger.error('Update profile error', {
      userId: req.user?.id,
      error: error instanceof Error ? error.message : String(error),
      requestId: req.requestId,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// =====================================================================
// Password reset flow (OWASP Forgot Password Cheat Sheet + ASVS v5 V6.3)
//
// Design notes:
//   - Token plaintext is 32 bytes from CSPRNG, base64url-encoded.
//   - Only sha256(token) is stored. Token entropy is high enough that
//     a fast hash is appropriate; argon2 would buy nothing.
//   - 30-minute expiry. Single-use (consumed_at set inside the same
//     transaction that updates the password).
//   - Identical 200 response on /forgot-password whether the email
//     exists or not; constant-ish timing via always doing the hash
//     work even on the no-match path.
//   - Per-IP rate limit comes from `authLimiter` in app.ts (10 / 15m
//     on every POST under /api/v1/auth). Per-account cap of 3
//     outstanding tokens / hour enforced inline.
//   - On consume: invalidate every active session for the user (same
//     pattern as change-password) and emit an out-of-band confirmation
//     (logged + audit row).
//   - Audit log writes both request and consume. With the new
//     append-only trigger on audit_log these rows are tamper-evident.
// =====================================================================

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_PER_ACCOUNT_HOURLY_MAX = 3;

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20).max(256),
  newPassword: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});

function hashResetToken(plain: string): string {
  return hashToken(plain);
}

router.post('/forgot-password', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const startedAt = Date.now();
  const respondGeneric = async (): Promise<void> => {
    // Constant-ish timing: never return faster than ~600ms so the
    // user-exists vs user-missing branches are indistinguishable from
    // the client side. authLimiter still caps the per-IP request rate.
    const elapsed = Date.now() - startedAt;
    if (elapsed < 600) {
      await new Promise((r) => setTimeout(r, 600 - elapsed));
    }
    res.status(200).json({
      message: 'If an account exists for that email, a reset link has been sent.',
    });
  };

  let data: z.infer<typeof forgotPasswordSchema>;
  try {
    data = forgotPasswordSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
      return;
    }
    throw error;
  }

  const db = getDatabase();
  const requestIp = req.ip ?? null;

  const user = await db
    .selectFrom('app_user')
    .where('email', '=', data.email.toLowerCase())
    .where('is_active', '=', true)
    .select(['id', 'email'])
    .executeTakeFirst();

  if (!user) {
    // Audit the attempt (no user) so an enumeration sweep is visible
    // without leaking to the response. entity_id is the constant
    // sentinel because we have nothing else to bind to.
    logger.warn('Password reset requested for unknown/inactive email', {
      requestIp,
      requestId: req.requestId,
    });
    await respondGeneric();
    return;
  }

  // Per-account cap: refuse silently (still 200) if the user already
  // has too many outstanding tokens in the last hour. Prevents flooding
  // a target inbox.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const outstandingCountRow = await db
    .selectFrom('password_reset_token')
    .where('user_id', '=', user.id)
    .where('created_at', '>=', oneHourAgo)
    // Count every token issued in the window. Superseding marks older
    // tokens consumed, so counting only unconsumed ones meant the cap
    // could never trigger (security review A8).
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow();
  const outstandingCount = Number(outstandingCountRow.count);
  if (outstandingCount >= RESET_PER_ACCOUNT_HOURLY_MAX) {
    logger.warn('Password reset suppressed by per-account cap', {
      userId: user.id,
      outstandingCount,
      requestId: req.requestId,
    });
    await respondGeneric();
    return;
  }

  // Generate token, store hash, deliver out-of-band.
  // We cannot use Web Crypto's randomUUID — too predictable for this
  // purpose. Node's crypto.randomBytes is a CSPRNG.
  const crypto = await import('node:crypto');
  const tokenPlain = crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashResetToken(tokenPlain);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  // Supersede prior outstanding tokens so "send again" produces a
  // single live token. Set consumed_at instead of deleting — the row
  // is part of the audit trail.
  await db
    .updateTable('password_reset_token')
    .set({ consumed_at: new Date() })
    .where('user_id', '=', user.id)
    .where('consumed_at', 'is', null)
    .execute();

  await db
    .insertInto('password_reset_token')
    .values({
      id: uuidv4(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      requested_ip: requestIp,
    })
    .execute();

  await logAudit(db, {
    entityType: 'app_user',
    entityId: user.id,
    action: 'state_change',
    userId: null,
    changes: { event: 'password_reset_requested', requestIp },
  });

  // Delivery runs after the response so its timing (SMTP round trips)
  // cannot tell a caller whether the account exists.
  void deliverPasswordReset(user, tokenPlain, expiresAt).catch((error) => {
    logger.error('Password reset email failed', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await respondGeneric();
}));

router.post('/reset-password', asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  let data: z.infer<typeof resetPasswordSchema>;
  try {
    data = resetPasswordSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
      return;
    }
    throw error;
  }

  const db = getDatabase();
  const tokenHash = hashResetToken(data.token);

  const tokenRow = await db
    .selectFrom('password_reset_token')
    .innerJoin('app_user', 'app_user.id', 'password_reset_token.user_id')
    .where('password_reset_token.token_hash', '=', tokenHash)
    .select([
      'password_reset_token.id as token_id',
      'password_reset_token.user_id as user_id',
      'password_reset_token.expires_at as expires_at',
      'password_reset_token.consumed_at as consumed_at',
      'app_user.username as username',
      'app_user.email as email',
      'app_user.display_name as display_name',
      'app_user.password_hash as password_hash',
      'app_user.is_active as is_active',
    ])
    .executeTakeFirst();

  // Single generic error message for every failure mode so the
  // attacker cannot distinguish "no such token" from "expired" from
  // "already used".
  const genericRejection = () => {
    res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  };

  if (!tokenRow) {
    genericRejection();
    return;
  }

  if (tokenRow.consumed_at) {
    logger.warn('Password reset token replay attempt', {
      tokenId: tokenRow.token_id,
      userId: tokenRow.user_id,
      requestId: req.requestId,
    });
    genericRejection();
    return;
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    genericRejection();
    return;
  }

  if (!tokenRow.is_active) {
    genericRejection();
    return;
  }

  // New-password policy validation. Uses the same path as register
  // and change-password.
  const policy = await validatePasswordPolicy(data.newPassword, {
    username: tokenRow.username,
    email: tokenRow.email,
    displayName: tokenRow.display_name,
  });
  if (!policy.valid) {
    res.status(400).json({ error: policy.reason ?? 'Password does not meet the password policy' });
    return;
  }

  // Refuse same-password reuse.
  if (await verifyPassword(tokenRow.password_hash, data.newPassword)) {
    res.status(400).json({ error: 'New password must differ from the current password.' });
    return;
  }

  const newHash = await hashPassword(data.newPassword);

  // Atomic update: password, mark token consumed, invalidate every
  // existing session for the user. If any step fails the transaction
  // rolls back and the token remains usable.
  let consumed = false;
  await db.transaction().execute(async (trx) => {
    // Claim the token first, and only if nobody else has: two concurrent
    // resets with the same token must not both succeed (security review A8).
    const claimed = await trx
      .updateTable('password_reset_token')
      .set({ consumed_at: new Date() })
      .where('id', '=', tokenRow.token_id)
      .where('consumed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!claimed) return;
    consumed = true;

    await trx
      .updateTable('app_user')
      .set({
        password_hash: newHash,
        failed_login_count: 0,
        locked_until: null,
      })
      .where('id', '=', tokenRow.user_id)
      .execute();

    // Kill every active session for this user so an attacker who
    // already had a stolen cookie loses access at the same instant
    // the legitimate user resets.
    await trx
      .deleteFrom('session')
      .where('user_id', '=', tokenRow.user_id)
      .execute();
    await trx
      .deleteFrom('api_key')
      .where('user_id', '=', tokenRow.user_id)
      .execute();
  });

  if (!consumed) {
    genericRejection();
    return;
  }

  await logAudit(db, {
    entityType: 'app_user',
    entityId: tokenRow.user_id,
    action: 'state_change',
    userId: tokenRow.user_id,
    changes: { event: 'password_reset_consumed', requestIp: req.ip ?? null },
  });

  logger.info('Password reset consumed', {
    userId: tokenRow.user_id,
    requestId: req.requestId,
  });

  res.status(200).json({ message: 'Password has been reset. Please sign in with your new password.' });
}));

export default router;
