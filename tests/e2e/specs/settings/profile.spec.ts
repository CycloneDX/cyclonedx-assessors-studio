import { test, expect, request } from '@playwright/test';
import { test as authedTest } from '../../fixtures/index.js';

/**
 * User profile and password change settings.
 *
 * Reference (backend/src/routes/auth.ts):
 *   - GET  /auth/me               -> current user profile.
 *   - PATCH /auth/me              -> update slackUserId, teamsUserId,
 *                                   mattermostUsername, emailNotifications.
 *   - PUT  /auth/change-password  -> currentPassword + newPassword.
 *     Server enforces password policy, rejects reuse of the current
 *     password, invalidates all sessions on success.
 *
 * The change-password tests provision a fresh user via POST /users so
 * that the password change does not invalidate the shared admin/role
 * storage states between tests.
 */

const PASSWORD_OK = 'CorrectHorseBatteryStaple9!';
const PASSWORD_NEW = 'DifferentCorrectHorseBatteryStaple9!';

authedTest.describe('Profile + password settings @regression', () => {
  authedTest('GET /auth/me returns the current user profile', async ({ apiAs }) => {
    const api = await apiAs('admin');
    const r = await api.get('/api/v1/auth/me');
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.user).toBeTruthy();
    expect(body.user.username).toBeTruthy();
    // Sensitive fields must never escape /auth/me.
    expect(body.user.password_hash).toBeUndefined();
    expect(body.user.passwordHash).toBeUndefined();
  });

  authedTest('PATCH /auth/me updates chat IDs and email-notifications flag', async ({ apiAs }) => {
    const api = await apiAs('assessor');
    const r = await api.patch('/api/v1/auth/me', {
      data: {
        slackUserId: 'U12345TEST',
        emailNotifications: false,
      },
    });
    expect(r.ok(), `patch failed: ${await r.text()}`).toBeTruthy();
    const body = await r.json();
    expect(body.user.slackUserId ?? body.user.slack_user_id).toBe('U12345TEST');
    expect(body.user.emailNotifications ?? body.user.email_notifications).toBe(false);

    // Reset.
    await api.patch('/api/v1/auth/me', {
      data: { slackUserId: null, emailNotifications: true },
    });
  });

  authedTest('PATCH /auth/me with empty body is a no-op', async ({ apiAs }) => {
    const api = await apiAs('admin');
    const r = await api.patch('/api/v1/auth/me', { data: {} });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.user).toBeTruthy();
  });
});

/**
 * Password change tests use a dedicated, freshly created user so the
 * change does not affect the storage states used by other tests.
 */
authedTest.describe('Password change @regression', () => {
  authedTest('rejects wrong current password (400)', async ({ apiAs }, testInfo) => {
    const adminApi = await apiAs('admin');
    const username = `pwd_wrong_${Date.now().toString(36)}`;
    await adminApi.post('/api/v1/users', {
      data: {
        username,
        email: `${username}@example.test`,
        displayName: 'Pwd Wrong',
        password: PASSWORD_OK,
        role: 'assessee',
      },
    });

    const ctx = await request.newContext({ baseURL: testInfo.project.use.baseURL });
    await ctx.post('/api/v1/auth/login', {
      data: { username, password: PASSWORD_OK },
    });
    const r = await ctx.put('/api/v1/auth/change-password', {
      data: { currentPassword: 'WrongPassword123!', newPassword: PASSWORD_NEW },
    });
    expect(r.status()).toBe(400);
    await ctx.dispose();
  });

  authedTest('rejects reusing the current password (400)', async ({ apiAs }, testInfo) => {
    const adminApi = await apiAs('admin');
    const username = `pwd_reuse_${Date.now().toString(36)}`;
    await adminApi.post('/api/v1/users', {
      data: {
        username,
        email: `${username}@example.test`,
        displayName: 'Pwd Reuse',
        password: PASSWORD_OK,
        role: 'assessee',
      },
    });

    const ctx = await request.newContext({ baseURL: testInfo.project.use.baseURL });
    await ctx.post('/api/v1/auth/login', {
      data: { username, password: PASSWORD_OK },
    });
    const r = await ctx.put('/api/v1/auth/change-password', {
      data: { currentPassword: PASSWORD_OK, newPassword: PASSWORD_OK },
    });
    expect(r.status()).toBe(400);
    await ctx.dispose();
  });

  authedTest('rejects new password that violates policy (400)', async ({ apiAs }, testInfo) => {
    const adminApi = await apiAs('admin');
    const username = `pwd_policy_${Date.now().toString(36)}`;
    await adminApi.post('/api/v1/users', {
      data: {
        username,
        email: `${username}@example.test`,
        displayName: 'Pwd Policy',
        password: PASSWORD_OK,
        role: 'assessee',
      },
    });

    const ctx = await request.newContext({ baseURL: testInfo.project.use.baseURL });
    await ctx.post('/api/v1/auth/login', {
      data: { username, password: PASSWORD_OK },
    });
    const r = await ctx.put('/api/v1/auth/change-password', {
      data: { currentPassword: PASSWORD_OK, newPassword: 'short' },
    });
    expect(r.status()).toBe(400);
    await ctx.dispose();
  });

  authedTest('accepts a valid password change and invalidates the session', async ({ apiAs }, testInfo) => {
    const adminApi = await apiAs('admin');
    const username = `pwd_change_${Date.now().toString(36)}`;
    await adminApi.post('/api/v1/users', {
      data: {
        username,
        email: `${username}@example.test`,
        displayName: 'Pwd Change',
        password: PASSWORD_OK,
        role: 'assessee',
      },
    });

    const ctx = await request.newContext({ baseURL: testInfo.project.use.baseURL });
    await ctx.post('/api/v1/auth/login', {
      data: { username, password: PASSWORD_OK },
    });
    const r = await ctx.put('/api/v1/auth/change-password', {
      data: { currentPassword: PASSWORD_OK, newPassword: PASSWORD_NEW },
    });
    expect(r.ok(), `change failed: ${await r.text()}`).toBeTruthy();

    // Existing session is now invalidated. /auth/me should fail.
    const meAfter = await ctx.get('/api/v1/auth/me');
    expect(meAfter.ok()).toBeFalsy();
    await ctx.dispose();

    // New password works for a fresh login.
    const ctx2 = await request.newContext({ baseURL: testInfo.project.use.baseURL });
    const login2 = await ctx2.post('/api/v1/auth/login', {
      data: { username, password: PASSWORD_NEW },
    });
    expect(login2.ok()).toBeTruthy();
    await ctx2.dispose();
  });
});

// Re-export the @playwright/test entry so the test file remains lintable
// even when no plain `test` calls remain.
void test;
