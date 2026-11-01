/**
 * Security regression tests: authentication and sessions (security review
 * A3, A4, A5, A7, A8, A9, A10, A11, X8).
 */
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupHttpTests, loginAs, createPersona, getBaseUrl, testUsers } from '../helpers/http.js';

async function db() {
  const { getDatabase } = await import('../../db/connection.js');
  return getDatabase();
}

async function mintKey(agent: Awaited<ReturnType<typeof loginAs>>, body: Record<string, unknown> = { name: 'k' }) {
  const res = await agent.post('/api/v1/apikeys').send(body);
  return res;
}

function keyWorks(key: string) {
  return supertest(getBaseUrl()).get('/api/v1/auth/me').set('X-Api-Key', key);
}

describe('Authentication hardening (security review)', () => {
  setupHttpTests();

  describe('API keys (A3)', () => {
    it('always expire: 90 days by default', async () => {
      const p = await createPersona('assessee', 'keyexp');
      const res = await mintKey(p.agent);
      expect(res.status).toBe(201);
      const created = await (await db()).selectFrom('api_key').select('expires_at').where('user_id', '=', p.id).executeTakeFirstOrThrow();
      const days = (new Date(created.expires_at as unknown as string).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(89);
      expect(days).toBeLessThan(91);
    });

    it.each([0, -1, 366, 1.5, 'x'])('rejects expiresInDays=%s', async (expiresInDays) => {
      const p = await createPersona('assessee', 'keybad');
      const res = await mintKey(p.agent, { name: 'k', expiresInDays });
      expect(res.status).toBe(400);
    });

    it('are revoked when the password changes', async () => {
      const p = await createPersona('assessee', 'keypw');
      const key = (await mintKey(p.agent)).body.key as string;
      expect((await keyWorks(key)).status).toBe(200);
      const changed = await p.agent.put('/api/v1/auth/change-password').send({
        currentPassword: p.password,
        newPassword: 'An0ther-Long-Passw0rd!',
      });
      expect(changed.status).toBe(200);
      expect((await keyWorks(key)).status).toBe(401);
    });

    it('are revoked by logout-all', async () => {
      const p = await createPersona('assessee', 'keyall');
      const key = (await mintKey(p.agent)).body.key as string;
      expect((await keyWorks(key)).status).toBe(200);
      expect([200, 204]).toContain((await p.agent.post('/api/v1/auth/logout-all')).status);
      expect((await keyWorks(key)).status).toBe(401);
    });
  });

  describe('session-only admin routes (A4, X8)', () => {
    it('refuses user creation with an admin API key but allows it in a session', async () => {
      const admin = await loginAs('admin');
      const key = (await mintKey(admin)).body.key as string;
      const body = (u: string) => ({ username: u, email: `${u}@test.local`, displayName: u, password: 'Str0ng-Passw0rd!x', role: 'admin' });
      const viaKey = await supertest(getBaseUrl()).post('/api/v1/users').set('X-Api-Key', key).send(body(`viakey_${Date.now()}`));
      expect(viaKey.status).toBe(403);
      const viaSession = await admin.post('/api/v1/users').send(body(`viasess_${Date.now()}`));
      expect(viaSession.status).toBe(201);
    });

    it('refuses webhook creation with an admin API key', async () => {
      const admin = await loginAs('admin');
      const key = (await mintKey(admin)).body.key as string;
      const res = await supertest(getBaseUrl()).post('/api/v1/webhooks').set('X-Api-Key', key)
        .send({ name: 'x', url: 'https://ci.example.com/hook', eventTypes: ['evidence.state_changed'] });
      expect(res.status).toBe(403);
    });

    it('records an audit row for an admin webhook change', async () => {
      const admin = await loginAs('admin');
      const created = await admin.post('/api/v1/webhooks')
        .send({ name: 'audited', url: 'https://ci.example.com/hook', eventTypes: ['evidence.state_changed'] });
      expect(created.status).toBe(201);
      const id = created.body.id ?? created.body.webhook?.id;
      await new Promise((r) => setTimeout(r, 50));
      const rows = await (await db()).selectFrom('audit_log').select(['action', 'changes'])
        .where('entity_type', '=', 'webhook').where('entity_id', '=', id).execute();
      expect(rows.length).toBe(1);
      expect(JSON.stringify(rows[0].changes)).not.toContain('ci.example.com');
    });
  });

  describe('invites (A5)', () => {
    it('create exactly one account under concurrent use', async () => {
      const admin = await loginAs('admin');
      const invite = await admin.post('/api/v1/admin/invites').send({ role: 'assessee' });
      expect([200, 201]).toContain(invite.status);
      const token = invite.body.token ?? invite.body.inviteToken ?? invite.body.data?.token;
      expect(typeof token).toBe('string');
      const results = await Promise.all([0, 1, 2, 3].map((i) =>
        supertest(getBaseUrl()).post('/api/v1/auth/register').send({
          inviteToken: token,
          username: `race_inv_${i}_${Date.now()}`,
          email: `race_inv_${i}_${Date.now()}@test.local`,
          displayName: `Race ${i}`,
          password: 'Str0ng-Passw0rd!x',
        })));
      const created = results.filter((r) => r.status === 201 || r.status === 202);
      expect(created).toHaveLength(1);
    });
  });

  describe('login lockout (A7)', () => {
    it('counts concurrent failures individually', async () => {
      const p = await createPersona('assessee', 'lockrace');
      await Promise.all([0, 1, 2].map(() =>
        supertest(getBaseUrl()).post('/api/v1/auth/login').send({ username: p.username, password: 'wrong-password-1' })));
      const row = await (await db()).selectFrom('app_user').select('failed_login_count').where('id', '=', p.id).executeTakeFirstOrThrow();
      expect(row.failed_login_count).toBe(3);
    });

    it('starts a fresh count once a lock has expired', async () => {
      const p = await createPersona('assessee', 'lockdecay');
      await (await db()).updateTable('app_user')
        .set({ failed_login_count: 5, locked_until: new Date(Date.now() - 60_000) })
        .where('id', '=', p.id).execute();
      const res = await supertest(getBaseUrl()).post('/api/v1/auth/login').send({ username: p.username, password: 'wrong-password-1' });
      expect(res.status).toBe(401);
      const row = await (await db()).selectFrom('app_user').select(['failed_login_count', 'locked_until']).where('id', '=', p.id).executeTakeFirstOrThrow();
      expect(row.failed_login_count).toBe(1);
      expect(row.locked_until).toBeNull();
      // And the correct password works again.
      const ok = await supertest(getBaseUrl()).post('/api/v1/auth/login').send({ username: p.username, password: p.password });
      expect(ok.status).toBe(200);
    });
  });

  describe('password reset (A8)', () => {
    async function issueToken(userId: string): Promise<string> {
      const { hashToken } = await import('../../utils/crypto.js');
      const plain = `reset-${uuidv4()}-${uuidv4()}`;
      await (await db()).insertInto('password_reset_token').values({
        id: uuidv4(),
        user_id: userId,
        token_hash: hashToken(plain),
        expires_at: new Date(Date.now() + 30 * 60_000),
      }).execute();
      return plain;
    }

    it('resets the password with a valid token and the new password works', async () => {
      const p = await createPersona('assessee', 'reset');
      const token = await issueToken(p.id);
      const res = await supertest(getBaseUrl()).post('/api/v1/auth/reset-password').send({ token, newPassword: 'Brand-New-Passw0rd!' });
      expect(res.status).toBe(200);
      const login = await supertest(getBaseUrl()).post('/api/v1/auth/login').send({ username: p.username, password: 'Brand-New-Passw0rd!' });
      expect(login.status).toBe(200);
    });

    it('rejects reusing the current password', async () => {
      const p = await createPersona('assessee', 'resetsame');
      const token = await issueToken(p.id);
      const res = await supertest(getBaseUrl()).post('/api/v1/auth/reset-password').send({ token, newPassword: p.password });
      expect(res.status).toBe(400);
    });

    it('lets a token succeed only once under concurrent use', async () => {
      const p = await createPersona('assessee', 'resetrace');
      const token = await issueToken(p.id);
      const results = await Promise.all([0, 1, 2].map((i) =>
        supertest(getBaseUrl()).post('/api/v1/auth/reset-password').send({ token, newPassword: `Concurrent-Passw0rd-${i}!` })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    });
  });

  describe('user profiles (A9)', () => {
    it("hides another user's email from a non-admin session", async () => {
      const assessee = await loginAs('assessee');
      const res = await assessee.get(`/api/v1/users/${testUsers.admin.id}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBeUndefined();
    });

    it('shows full profiles to admins and to the user themself', async () => {
      const admin = await loginAs('admin');
      expect((await admin.get(`/api/v1/users/${testUsers.assessee.id}`)).body.email).toBeDefined();
      const assessee = await loginAs('assessee');
      expect((await assessee.get(`/api/v1/users/${testUsers.assessee.id}`)).body.email).toBeDefined();
    });
  });

  describe('cross-site requests (A10)', () => {
    it('refuses a state change marked cross-site by the browser', async () => {
      const assessee = await loginAs('assessee');
      const res = await assessee.post('/api/v1/evidence').set('Sec-Fetch-Site', 'cross-site').send({ name: 'csrf' });
      expect(res.status).toBe(403);
    });

    it('refuses a foreign Origin', async () => {
      const assessee = await loginAs('assessee');
      const res = await assessee.post('/api/v1/evidence').set('Origin', 'https://evil.example').send({ name: 'csrf' });
      expect(res.status).toBe(403);
    });

    it('allows same-origin requests', async () => {
      const assessor = await loginAs('assessor');
      const res = await assessor.post('/api/v1/evidence').set('Origin', getBaseUrl()).set('Sec-Fetch-Site', 'same-origin').send({ name: 'same origin' });
      expect(res.status).toBe(201);
    });
  });

  describe('JWT (A11)', () => {
    it('rejects an unsigned (alg: none) token', async () => {
      const assessee = await loginAs('assessee');
      const me = await assessee.get('/api/v1/auth/me');
      expect(me.status).toBe(200);
      const { getDatabase } = await import('../../db/connection.js');
      const session = await getDatabase().selectFrom('session').select('id').where('user_id', '=', testUsers.assessee.id).executeTakeFirstOrThrow();
      const forged = jwt.sign({ sessionId: session.id }, '', { algorithm: 'none' });
      const res = await supertest(getBaseUrl()).get('/api/v1/auth/me').set('Cookie', `token=${forged}`);
      expect(res.status).toBe(401);
    });
  });
});
