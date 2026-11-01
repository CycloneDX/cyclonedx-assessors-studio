import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { setupHttpTests, getAgent, getApp, loginAs, testUsers } from '../helpers/http.js';

describe('Auth Routes (HTTP Integration)', () => {
  setupHttpTests();

  describe('POST /login', () => {
    it('should login with valid credentials', async () => {
      const agent = getAgent();
      const user = testUsers.admin;

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: user.password,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toMatchObject({
        id: user.id,
        username: user.username,
        email: user.email,
        role: 'admin',
      });
      expect(res.body.user).toHaveProperty('displayName');
      expect(res.body.user).toHaveProperty('hasCompletedOnboarding');

      // Verify httpOnly cookie is set
      expect(res.headers['set-cookie']).toBeDefined();
      const tokenCookie = (res.headers['set-cookie'] as unknown as string[]).find((cookie: string) =>
        cookie.startsWith('token=')
      );
      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toContain('HttpOnly');
    });

    it('should reject login with wrong password', async () => {
      const agent = getAgent();
      const user = testUsers.admin;

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject login with nonexistent user', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent_user_xyz',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject login with an empty password', async () => {
      // The login schema only enforces presence and an upper bound on
      // the password. Length validation against the current policy
      // happens on register, change password, setup, and admin
      // createUser so that accounts whose password predates a
      // tightened policy can still authenticate to rotate it.
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: testUsers.admin.username,
          password: '',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Invalid input');
      expect(res.body).toHaveProperty('details');
    });

    it('should return generic 401 for a short but nonempty password', async () => {
      // A below-policy password on login must not distinguish itself
      // from a correct-but-wrong guess. The user gets the same
      // generic 401 "Invalid credentials" response the password
      // verification path would produce.
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: testUsers.admin.username,
          password: 'short',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should reject login with username shorter than 3 chars', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: 'ab',
          password: 'Password123!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Invalid input');
    });

    it('should reject login with missing username', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          password: 'Password123!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject login with missing password', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: testUsers.admin.username,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Account lockout on repeated failed logins', () => {
    /**
     * Register a dedicated user per test so the counter/lockout state on
     * shared fixtures (admin/assessor/assessee) cannot leak between
     * cases and cause false positives.
     */
    async function registerLockoutUser(username: string, password: string) {
      const res = await getAgent()
        .post('/api/v1/auth/register')
        .send({
          username,
          email: `${username}@test.local`,
          password,
          displayName: 'Lockout Test User',
        });
      expect(res.status).toBe(202);
    }

    it('locks the account after five consecutive failed attempts', async () => {
      const username = 'lockout_threshold_user';
      const password = 'CorrectPassword123!';
      await registerLockoutUser(username, password);

      // Burn five bad attempts. Each returns 401 with the generic message.
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await getAgent()
          .post('/api/v1/auth/login')
          .send({ username, password: 'WrongPassword999!' });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid credentials');
      }

      // Now even the correct password is rejected with the same generic
      // response while the lockout window is active.
      const blockedRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username, password });
      expect(blockedRes.status).toBe(401);
      expect(blockedRes.body.error).toBe('Invalid credentials');
    });

    it('does not lock the account before the threshold is reached', async () => {
      const username = 'lockout_under_threshold_user';
      const password = 'CorrectPassword123!';
      await registerLockoutUser(username, password);

      // Four failures are allowed; the fifth correct login must still
      // succeed and reset the counter.
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await getAgent()
          .post('/api/v1/auth/login')
          .send({ username, password: 'WrongPassword999!' });
        expect(res.status).toBe(401);
      }

      const goodRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username, password });
      expect(goodRes.status).toBe(200);
      expect(goodRes.body.user.username).toBe(username);
    });

    it('resets the failed attempt counter after a successful login', async () => {
      const username = 'lockout_reset_user';
      const password = 'CorrectPassword123!';
      await registerLockoutUser(username, password);

      // Two failures, then a good login should reset the counter to zero.
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await getAgent()
          .post('/api/v1/auth/login')
          .send({ username, password: 'WrongPassword999!' });
        expect(res.status).toBe(401);
      }

      const goodRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username, password });
      expect(goodRes.status).toBe(200);

      // We can now fail four more times without triggering the lockout,
      // because the reset cleared the earlier two failures.
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await getAgent()
          .post('/api/v1/auth/login')
          .send({ username, password: 'WrongPassword999!' });
        expect(res.status).toBe(401);
      }

      // Fifth correct login still works.
      const secondGoodRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username, password });
      expect(secondGoodRes.status).toBe(200);
    });

    it('treats locked accounts exactly like bad credentials (no enumeration)', async () => {
      const username = 'lockout_silent_user';
      const password = 'CorrectPassword123!';
      await registerLockoutUser(username, password);

      // Trip the lockout.
      for (let attempt = 0; attempt < 5; attempt++) {
        await getAgent()
          .post('/api/v1/auth/login')
          .send({ username, password: 'WrongPassword999!' });
      }

      // Compare the shape of a locked-account response to the shape
      // produced by a non-existent user. Both must be indistinguishable.
      const lockedRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username, password });

      const absentRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({
          username: 'definitely_not_a_real_user_xyz',
          password: 'Anything123!',
        });

      expect(lockedRes.status).toBe(absentRes.status);
      expect(lockedRes.body).toEqual(absentRes.body);
    });
  });

  describe('GET /me', () => {
    it('should return current user when authenticated', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toMatchObject({
        id: testUsers.admin.id,
        username: testUsers.admin.username,
        email: testUsers.admin.email,
        role: 'admin',
      });
      expect(res.body.user).toHaveProperty('displayName');
      expect(res.body.user).toHaveProperty('hasCompletedOnboarding');
    });

    it('should return 401 without authentication', async () => {
      const agent = getAgent();

      const res = await agent.get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });

    it('should return different user data for different roles', async () => {
      const adminAgent = await loginAs('admin');
      const assessorAgent = await loginAs('assessor');

      const adminRes = await adminAgent.get('/api/v1/auth/me');
      const assessorRes = await assessorAgent.get('/api/v1/auth/me');

      expect(adminRes.body.user.id).toBe(testUsers.admin.id);
      expect(adminRes.body.user.role).toBe('admin');

      expect(assessorRes.body.user.id).toBe(testUsers.assessor.id);
      expect(assessorRes.body.user.role).toBe('assessor');
    });
  });

  describe('POST /logout', () => {
    it('should logout and invalidate session', async () => {
      const agent = await loginAs('admin');

      // Verify authenticated access works
      let res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);

      // Logout
      res = await agent.post('/api/v1/auth/logout');
      expect(res.status).toBe(204);

      // Verify token cookie is cleared
      expect(res.headers['set-cookie']).toBeDefined();
      const clearCookie = (res.headers['set-cookie'] as unknown as string[]).find((cookie: string) =>
        cookie.startsWith('token=')
      );
      // Cookie is cleared by setting Expires to epoch or Max-Age=0
      expect(clearCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

      // Verify subsequent /me request fails
      res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 without authentication', async () => {
      const agent = getAgent();

      const res = await agent.post('/api/v1/auth/logout');

      expect(res.status).toBe(401);
    });

    it('should allow re-login after logout', async () => {
      const user = testUsers.assessee;
      const agent = supertest.agent(getApp());

      // First login
      let res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: user.password,
        });
      expect(res.status).toBe(200);

      // Logout
      res = await agent.post('/api/v1/auth/logout');
      expect(res.status).toBe(204);

      // Create new agent and login again
      const newAgent = supertest.agent(getApp());
      res = await newAgent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: user.password,
        });
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(user.id);
    });
  });

  describe('POST /register', () => {
    it('should register new user', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'newuser123',
          email: 'newuser@example.com',
          password: 'NewPassword123!',
          displayName: 'New User',
        });

      // Generic 202 response (M4 enumeration mitigation): the server
      // never discloses whether an account was actually created.
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('message');
      expect(res.body).not.toHaveProperty('user');

      // Verify via login that the account really was created.
      const loginRes = await getAgent()
        .post('/api/v1/auth/login')
        .send({ username: 'newuser123', password: 'NewPassword123!' });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user).toMatchObject({
        username: 'newuser123',
        email: 'newuser@example.com',
        displayName: 'New User',
        role: 'assessee',
      });
    });

    it('should not reveal duplicate username via response shape', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: testUsers.admin.username,
          email: 'different@example.com',
          password: 'Password123!',
          displayName: 'Different User',
        });

      // Duplicate identifiers return the same generic 202 as a fresh
      // registration so an attacker cannot enumerate existing accounts.
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('message');
      expect(res.body).not.toHaveProperty('error');
    });

    it('should not reveal duplicate email via response shape', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'uniqueusername456',
          email: testUsers.admin.email,
          password: 'Password123!',
          displayName: 'Another User',
        });

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('message');
      expect(res.body).not.toHaveProperty('error');
    });

    it('should reject registration with a below-policy password', async () => {
      // The full password policy (min length, deny list, optional
      // HIBP) runs through validatePasswordPolicy rather than Zod so
      // the error message is a single human readable string.
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'anotheruser',
          email: 'another@example.com',
          password: 'short',
          displayName: 'Another User',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/at least/i);
    });

    it('should reject registration with username shorter than 3 chars', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'ab',
          email: 'test@example.com',
          password: 'Password123!',
          displayName: 'Test User',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject registration with invalid email', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'validuser',
          email: 'not-an-email',
          password: 'Password123!',
          displayName: 'Valid User',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject registration with missing displayName', async () => {
      const agent = getAgent();

      const res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: 'validuser',
          email: 'valid@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should allow login with newly registered user', async () => {
      const agent = getAgent();
      const newUsername = 'logintest999';
      const newPassword = 'LoginTest123!';

      // Register
      let res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: newUsername,
          email: 'logintest@example.com',
          password: newPassword,
          displayName: 'Login Test User',
        });
      expect(res.status).toBe(202);

      // Login with new credentials
      const loginAgent = getAgent();
      res = await loginAgent
        .post('/api/v1/auth/login')
        .send({
          username: newUsername,
          password: newPassword,
        });
      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(newUsername);
    });
  });

  describe('PUT /change-password', () => {
    it('should change password with correct current password', async () => {
      // Create a new user for this test to avoid modifying shared test state
      const agent = getAgent();
      const testUsername = 'changepwd_testuser';
      const testPassword = 'OldPassword123!';
      const newPassword = 'NewPassword456!';

      // First register a new user
      let res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: testUsername,
          email: `${testUsername}@test.local`,
          password: testPassword,
          displayName: 'Change Password Test User',
        });
      expect(res.status).toBe(202);

      // Login with the new user (use persistent agent for cookie)
      const loginAgent = supertest.agent(getApp());
      res = await loginAgent
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(res.status).toBe(200);
      const userId = res.body.user.id;

      // Change password
      res = await loginAgent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: testPassword,
          newPassword: newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.id).toBe(userId);

      // Verify old password no longer works
      const oldLoginAgent = getAgent();
      let loginRes = await oldLoginAgent
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(loginRes.status).toBe(401);

      // Verify new password works
      const newLoginAgent = getAgent();
      loginRes = await newLoginAgent
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: newPassword,
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.id).toBe(userId);
    });

    it('should reject password change with wrong current password', async () => {
      const agent = await loginAs('assessee');

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: 'WrongPassword123!',
          newPassword: 'NewPassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('Current password is incorrect');
    });

    it('should reject password change without authentication', async () => {
      const agent = getAgent();

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: 'Password123!',
          newPassword: 'NewPassword456!',
        });

      expect(res.status).toBe(401);
    });

    it('should reject a new password that is below the policy minimum', async () => {
      // Policy enforcement happens after the current password check
      // so validatePasswordPolicy returns a single readable error
      // string rather than a zod issue array.
      const agent = await loginAs('admin');
      const user = testUsers.admin;

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: user.password,
          newPassword: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/at least/i);
    });

    it('should reject reusing the current password as the new password', async () => {
      // OWASP ASVS 5.0 requires that rotation actually changes the
      // secret. This guard runs after the policy check so a
      // policy-compliant reused password still fails.
      const agent = await loginAs('admin');
      const user = testUsers.admin;

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: user.password,
          newPassword: user.password,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/different/i);
    });

    it('should reject password change with missing currentPassword', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          newPassword: 'NewPassword456!',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject password change with missing newPassword', async () => {
      const agent = await loginAs('admin');
      const user = testUsers.admin;

      const res = await agent
        .put('/api/v1/auth/change-password')
        .send({
          currentPassword: user.password,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /profile', () => {
    it('should update display name', async () => {
      const agent = await loginAs('admin');
      const newDisplayName = 'Updated Admin Name';

      const res = await agent
        .put('/api/v1/auth/profile')
        .send({
          displayName: newDisplayName,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.displayName).toBe(newDisplayName);
      expect(res.body.user.id).toBe(testUsers.admin.id);

      // Verify update persisted
      const meAgent = await loginAs('admin');
      const meRes = await meAgent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.displayName).toBe(newDisplayName);
    });

    it('should reject profile update without authentication', async () => {
      const agent = getAgent();

      const res = await agent
        .put('/api/v1/auth/profile')
        .send({
          displayName: 'Some Name',
        });

      expect(res.status).toBe(401);
    });

    it('should reject profile update with empty display name', async () => {
      const agent = await loginAs('assessor');

      const res = await agent
        .put('/api/v1/auth/profile')
        .send({
          displayName: '',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject profile update with missing displayName', async () => {
      const agent = await loginAs('assessor');

      const res = await agent
        .put('/api/v1/auth/profile')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should allow updating other users do not see the change until re-login', async () => {
      const agent = await loginAs('assessee');
      const _originalName = testUsers.assessee.id;

      const res = await agent
        .put('/api/v1/auth/profile')
        .send({
          displayName: 'Fresh New Name',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.displayName).toBe('Fresh New Name');
    });
  });

  describe('POST /complete-onboarding', () => {
    it('should set onboarding completion flag', async () => {
      const agent = await loginAs('assessee');

      // Check initial state
      let res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.hasCompletedOnboarding).toBe(false);

      // Complete onboarding
      res = await agent.post('/api/v1/auth/complete-onboarding');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.hasCompletedOnboarding).toBe(true);

      // Verify flag persisted
      const meAgent = await loginAs('assessee');
      res = await meAgent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.user.hasCompletedOnboarding).toBe(true);
    });

    it('should reject onboarding completion without authentication', async () => {
      const agent = getAgent();

      const res = await agent.post('/api/v1/auth/complete-onboarding');

      expect(res.status).toBe(401);
    });

    it('should be idempotent (calling multiple times)', async () => {
      const agent = await loginAs('assessee');

      // First call
      let res = await agent.post('/api/v1/auth/complete-onboarding');
      expect(res.status).toBe(200);
      expect(res.body.user.hasCompletedOnboarding).toBe(true);

      // Second call
      res = await agent.post('/api/v1/auth/complete-onboarding');
      expect(res.status).toBe(200);
      expect(res.body.user.hasCompletedOnboarding).toBe(true);
    });
  });

  describe('POST /logout-all', () => {
    it('should invalidate all sessions', async () => {
      // Create a new user specifically for this test
      const agent = getAgent();
      const testUsername = 'logoutall_testuser';
      const testPassword = 'LogoutAllTest123!';

      // Register new user
      let res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: testUsername,
          email: `${testUsername}@test.local`,
          password: testPassword,
          displayName: 'Logout All Test User',
        });
      expect(res.status).toBe(202);

      // Create two persistent agents (with cookie jar) and login with both
      const agent1 = supertest.agent(getApp());
      const agent2 = supertest.agent(getApp());

      let loginRes = await agent1
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(loginRes.status).toBe(200);

      loginRes = await agent2
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(loginRes.status).toBe(200);

      // Verify both are authenticated
      res = await agent1.get('/api/v1/auth/me');
      expect(res.status).toBe(200);

      res = await agent2.get('/api/v1/auth/me');
      expect(res.status).toBe(200);

      // Logout all from agent1
      res = await agent1.post('/api/v1/auth/logout-all');
      expect(res.status).toBe(204);

      // Verify both sessions are now invalid
      res = await agent1.get('/api/v1/auth/me');
      expect(res.status).toBe(401);

      res = await agent2.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 without authentication', async () => {
      const agent = getAgent();

      const res = await agent.post('/api/v1/auth/logout-all');

      expect(res.status).toBe(401);
    });

    it('should allow re-login after logout-all', async () => {
      // Create a new user specifically for this test
      const agent = getAgent();
      const testUsername = 'relogoutall_testuser';
      const testPassword = 'ReLoginTest123!';

      // Register new user
      let res = await agent
        .post('/api/v1/auth/register')
        .send({
          username: testUsername,
          email: `${testUsername}@test.local`,
          password: testPassword,
          displayName: 'Re-Login Test User',
        });
      expect(res.status).toBe(202);

      // Login with persistent agent
      const loginAgent = supertest.agent(getApp());
      res = await loginAgent
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(res.status).toBe(200);

      // Logout all
      res = await loginAgent.post('/api/v1/auth/logout-all');
      expect(res.status).toBe(204);

      // Verify session is invalid
      res = await loginAgent.get('/api/v1/auth/me');
      expect(res.status).toBe(401);

      // Login again with new agent
      const newAgent = supertest.agent(getApp());
      res = await newAgent
        .post('/api/v1/auth/login')
        .send({
          username: testUsername,
          password: testPassword,
        });
      expect(res.status).toBe(200);

      // Verify new session works
      res = await newAgent.get('/api/v1/auth/me');
      expect(res.status).toBe(200);
    });
  });

  describe('camelCase response transformation', () => {
    it('should transform snake_case DB columns to camelCase in login response', async () => {
      const agent = getAgent();
      const user = testUsers.admin;

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: user.password,
        });

      expect(res.status).toBe(200);
      // Verify camelCase transformation (not snake_case)
      expect(res.body.user).toHaveProperty('displayName');
      expect(res.body.user).toHaveProperty('hasCompletedOnboarding');
      expect(res.body.user).not.toHaveProperty('display_name');
      expect(res.body.user).not.toHaveProperty('has_completed_onboarding');
    });

    it('should transform snake_case DB columns to camelCase in /me response', async () => {
      const agent = await loginAs('assessee');

      const res = await agent.get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toHaveProperty('displayName');
      expect(res.body.user).toHaveProperty('hasCompletedOnboarding');
      expect(res.body.user).not.toHaveProperty('display_name');
      expect(res.body.user).not.toHaveProperty('has_completed_onboarding');
    });
  });

  describe('PATCH /me', () => {
    it('should update profile fields without leaking password_hash', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .patch('/api/v1/auth/me')
        .send({
          slackUserId: 'U123ABC456',
          emailNotifications: false,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user).toHaveProperty('username');
      // Sensitive fields must never appear in the response, regardless
      // of casing convention (camelCase or snake_case).
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should return current profile without password_hash when no updates are requested', async () => {
      const agent = await loginAs('admin');

      const res = await agent.patch('/api/v1/auth/me').send({});

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('user');
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('should reject PATCH /me without authentication', async () => {
      const agent = getAgent();

      const res = await agent.patch('/api/v1/auth/me').send({});

      expect(res.status).toBe(401);
    });
  });

  describe('Cookie security', () => {
    it('should set secure cookie attributes on login', async () => {
      const agent = getAgent();
      const user = testUsers.admin;

      const res = await agent
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: user.password,
        });

      expect(res.status).toBe(200);
      const tokenCookie = (res.headers['set-cookie'] as unknown as string[]).find((cookie: string) =>
        cookie.startsWith('token=')
      );

      expect(tokenCookie).toContain('HttpOnly');
      expect(tokenCookie).toContain('SameSite=Strict');
      expect(tokenCookie).toContain('Path=/');
      expect(tokenCookie).toContain('Max-Age=');
    });

    it('should clear cookie on logout', async () => {
      const agent = await loginAs('admin');

      const res = await agent.post('/api/v1/auth/logout');

      expect(res.status).toBe(204);
      const tokenCookie = (res.headers['set-cookie'] as unknown as string[]).find((cookie: string) =>
        cookie.startsWith('token=')
      );
      // Cookie is cleared by setting Expires to epoch or Max-Age=0
      expect(tokenCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);
    });
  });

  describe('Registration gate', () => {
    // The surrounding test helper initializes with REGISTRATION_MODE=open.
    // Each case overrides the cached config and restores it afterwards so
    // tests cannot leak state into one another.
    async function withRegistrationMode<T>(
      mode: 'disabled' | 'invite_only' | 'open',
      fn: () => Promise<T>,
    ): Promise<T> {
      const { getConfig } = await import('../../config/index.js');
      const cfg = getConfig();
      const prev = cfg.REGISTRATION_MODE;
      (cfg as { REGISTRATION_MODE: typeof mode }).REGISTRATION_MODE = mode;
      try {
        return await fn();
      } finally {
        (cfg as { REGISTRATION_MODE: typeof prev }).REGISTRATION_MODE = prev;
      }
    }

    it('should reject registration when mode=disabled', async () => {
      await withRegistrationMode('disabled', async () => {
        const res = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'gatedoff_user',
            email: 'gatedoff@example.com',
            password: 'Password123!',
            displayName: 'Gated Off',
          });
        expect(res.status).toBe(403);
      });
    });

    it('should reject registration when mode=invite_only and no token is provided', async () => {
      await withRegistrationMode('invite_only', async () => {
        const res = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'nobtoken_user',
            email: 'nobtoken@example.com',
            password: 'Password123!',
            displayName: 'No Token',
          });
        expect(res.status).toBe(403);
      });
    });

    it('should reject registration with an unknown invite token', async () => {
      await withRegistrationMode('invite_only', async () => {
        const res = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'badtoken_user',
            email: 'badtoken@example.com',
            password: 'Password123!',
            displayName: 'Bad Token',
            inviteToken: 'does-not-exist',
          });
        expect(res.status).toBe(400);
      });
    });

    it('should accept registration with a valid invite token in invite_only mode', async () => {
      await withRegistrationMode('invite_only', async () => {
        // Mint an invite via the admin API
        const adminAgent = await loginAs('admin');
        const inviteRes = await adminAgent
          .post('/api/v1/admin/invites')
          .send({
            email: 'gateduser@example.com',
            intendedRole: 'assessor',
            expiresInHours: 1,
          });
        expect(inviteRes.status).toBe(201);
        const token = inviteRes.body.token;
        expect(typeof token).toBe('string');

        // Consume the invite
        const res = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'gateduser_one',
            email: 'gateduser@example.com',
            password: 'Password123!',
            displayName: 'Gated User',
            inviteToken: token,
          });
        expect(res.status).toBe(202);

        // Verify the account was created with the intended role
        const loginRes = await getAgent()
          .post('/api/v1/auth/login')
          .send({ username: 'gateduser_one', password: 'Password123!' });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body.user.role).toBe('assessor');

        // Verify the invite has been consumed (cannot be reused)
        const replayRes = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'gateduser_two',
            email: 'someoneelse@example.com',
            password: 'Password123!',
            displayName: 'Replay',
            inviteToken: token,
          });
        expect(replayRes.status).toBe(400);
      });
    });

    it('should reject invite use when registrant email does not match scoped email', async () => {
      await withRegistrationMode('invite_only', async () => {
        const adminAgent = await loginAs('admin');
        const inviteRes = await adminAgent
          .post('/api/v1/admin/invites')
          .send({
            email: 'scoped@example.com',
            intendedRole: 'assessee',
            expiresInHours: 1,
          });
        expect(inviteRes.status).toBe(201);

        const res = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'mismatch_user',
            email: 'different@example.com',
            password: 'Password123!',
            displayName: 'Mismatch',
            inviteToken: inviteRes.body.token,
          });
        expect(res.status).toBe(400);
      });
    });

    it('should require admin.users permission to create invites', async () => {
      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent
        .post('/api/v1/admin/invites')
        .send({
          email: 'shouldfail@example.com',
          intendedRole: 'assessee',
          expiresInHours: 1,
        });
      // requirePermission returns 403 when the caller lacks the key
      expect(res.status).toBe(403);
    });

    it('should allow admins to list and revoke invites', async () => {
      await withRegistrationMode('invite_only', async () => {
        const adminAgent = await loginAs('admin');
        const createRes = await adminAgent
          .post('/api/v1/admin/invites')
          .send({
            email: 'torevoke@example.com',
            intendedRole: 'assessee',
            expiresInHours: 1,
          });
        expect(createRes.status).toBe(201);
        const inviteId = createRes.body.id;
        const token = createRes.body.token;

        const listRes = await adminAgent.get('/api/v1/admin/invites');
        expect(listRes.status).toBe(200);
        expect(Array.isArray(listRes.body.invites)).toBe(true);
        const found = listRes.body.invites.find(
          (row: { id: string }) => row.id === inviteId,
        );
        expect(found).toBeDefined();
        expect(found).not.toHaveProperty('token');
        expect(found).not.toHaveProperty('tokenHash');

        const revokeRes = await adminAgent.delete(
          `/api/v1/admin/invites/${inviteId}`,
        );
        expect(revokeRes.status).toBe(204);

        // Revoked token cannot be used
        const useRes = await getAgent()
          .post('/api/v1/auth/register')
          .send({
            username: 'revoked_user',
            email: 'torevoke@example.com',
            password: 'Password123!',
            displayName: 'Revoked User',
            inviteToken: token,
          });
        expect(useRes.status).toBe(400);
      });
    });
  });

  describe('GET /password-policy', () => {
    // This endpoint is reached before a user can log in (setup and
    // registration screens consume it), so it intentionally has no
    // auth guard. The appsec analysis that cleared exposing these
    // bounds also forbade surfacing the deny list contents and the
    // HIBP enabled flag, because either would let an attacker
    // pre-filter their guessing corpus. The tests below encode that
    // contract so a future well intentioned refactor cannot widen the
    // response silently.

    it('should return minLength and maxLength without authentication', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/auth/password-policy');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('minLength');
      expect(res.body).toHaveProperty('maxLength');
      expect(typeof res.body.minLength).toBe('number');
      expect(typeof res.body.maxLength).toBe('number');
      expect(res.body.minLength).toBeGreaterThanOrEqual(8);
      expect(res.body.maxLength).toBeGreaterThan(res.body.minLength);
    });

    it('should not expose the deny list or breach check configuration', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/auth/password-policy');

      expect(res.status).toBe(200);

      // Exact key set. If a future change adds a new field the test
      // will fail and the reviewer must confirm the new key is safe
      // to disclose.
      expect(Object.keys(res.body).sort()).toEqual(['maxLength', 'minLength']);

      // Belt and suspenders: the appsec sensitive fields that must
      // never appear under any naming variation.
      const forbidden = [
        'denyList',
        'bannedPasswords',
        'banned',
        'hibp',
        'hibpEnabled',
        'hibpCheckEnabled',
        'breachCheckEnabled',
      ];
      for (const key of forbidden) {
        expect(res.body).not.toHaveProperty(key);
      }
    });

    it('should reflect a runtime change to PASSWORD_MIN_LENGTH', async () => {
      const originalMin = process.env.PASSWORD_MIN_LENGTH;
      try {
        const { resetConfig } = await import('../../config/index.js');
        process.env.PASSWORD_MIN_LENGTH = '20';
        resetConfig();

        const agent = getAgent();
        const res = await agent.get('/api/v1/auth/password-policy');
        expect(res.status).toBe(200);
        expect(res.body.minLength).toBe(20);
      } finally {
        if (originalMin === undefined) {
          delete process.env.PASSWORD_MIN_LENGTH;
        } else {
          process.env.PASSWORD_MIN_LENGTH = originalMin;
        }
        const { resetConfig } = await import('../../config/index.js');
        resetConfig();
      }
    });
  });
});
