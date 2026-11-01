/**
 * HTTP integration test helper.
 *
 * Bootstraps a real Express app backed by PGlite so that supertest can
 * exercise every route through the full middleware stack (auth, camelCase
 * transform, rate limiting bypass, setup gate, etc.).
 *
 * A single HTTP server is created once and shared across all test files.
 * This avoids the repeated listen/close cycle that causes "Parse Error:
 * Expected HTTP/" when supertest creates ephemeral servers per request.
 *
 * Usage:
 *   import { setupHttpTests, getAgent, loginAs, getApp } from '../helpers/http.js';
 *
 *   describe('My route', () => {
 *     setupHttpTests();                       // beforeAll / afterAll wiring
 *     it('works', async () => {
 *       const agent = await loginAs('admin'); // authenticated supertest agent
 *       const res = await agent.get('/api/v1/tags');
 *       expect(res.status).toBe(200);
 *     });
 *   });
 */

import { beforeAll } from 'vitest';
import supertest, { SuperAgentTest } from 'supertest';
import http from 'http';
import { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let app: Express | null = null;
let server: http.Server | null = null;
let baseUrl: string = '';
let initialized = false;

// Pre-created users available for tests (populated on first init)
export const testUsers: Record<string, { id: string; username: string; email: string; password: string }> = {};

/**
 * Call inside a describe() block. Wires beforeAll to stand up the
 * Express app with a PGlite database (initializes once, reuses across files).
 */
export function setupHttpTests() {
  beforeAll(async () => {
    if (initialized) return;

    // Set environment BEFORE any app/config module is loaded.
    // Use a unique suffix to avoid conflicts with stale directories
    // that the sandbox may not allow us to delete.
    // Pre-create the parent `data/` directory explicitly. mkdir
    // with recursive:true *should* create missing parents, but on
    // macOS the worker thread occasionally races a sibling teardown
    // and returns ENOENT for a known-good target. The extra mkdir
    // is cheap and serialises us against the rare race.
    const dataParent = path.join(__dirname, '../../../..', 'data');
    fs.mkdirSync(dataParent, { recursive: true });
    const dbDirBase = path.join(dataParent, 'pglite-http-test');
    const dbDir = `${dbDirBase}-${Date.now()}`;
    try {
      if (fs.existsSync(dbDirBase)) {
        fs.rmSync(dbDirBase, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors in sandboxed environments
    }
    fs.mkdirSync(dbDir, { recursive: true });

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PROVIDER = 'pglite';
    process.env.PGLITE_DATA_DIR = dbDir;
    process.env.JWT_SECRET = 'http-test-secret-key-must-be-32-chars-min!!';
    process.env.JWT_EXPIRY = '24h';
    process.env.PORT = '3001';
    process.env.LOG_LEVEL = 'error';
    process.env.CORS_ORIGIN = '*';
    process.env.METRICS_ENABLED = 'true';
    // Default to open registration for legacy tests that exercise the
    // register + login flow. Tests that specifically verify gate
    // behavior override this per case via the config reset helpers.
    process.env.REGISTRATION_MODE = 'open';

    // Invalidate the cached config so the env-var overrides above are
    // picked up.  The config module may already have been loaded (and
    // cached) via static imports in the test file.
    const { resetConfig } = await import('../../config/index.js');
    resetConfig();

    // Dynamic imports so env vars are picked up by config on first access
    const { initializeDatabase } = await import('../../db/connection.js');
    const { runMigrations } = await import('../../db/migrate.js');
    const { seedDefaultRolesAndPermissions } = await import('../../db/seed.js');
    const { initializeStorage } = await import('../../storage/index.js');
    const { createApp } = await import('../../app.js');
    const { hashPassword } = await import('../../utils/crypto.js');

    await initializeDatabase();
    await runMigrations();
    await seedDefaultRolesAndPermissions();
    initializeStorage();

    const { initializeEventSystem } = await import('../../events/index.js');
    await initializeEventSystem();

    app = createApp();

    // Create ONE persistent HTTP server for all tests. This avoids the
    // repeated listen/close cycle that causes "Parse Error: Expected HTTP/"
    // when supertest creates ephemeral servers per request.
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Seed test users (admin, assessor, assessee)
    const { getDatabase } = await import('../../db/connection.js');
    const db = getDatabase();

    for (const role of ['admin', 'assessor', 'assessee'] as const) {
      const userId = uuidv4();
      const username = `test_${role}`;
      // Test password for integration tests - never used in production
      const password = `Password123!`;
      const passwordHash = await hashPassword(password);

      // Upsert so the test is idempotent even when a previous run left
      // stale data in the PGlite directory.
      await db.insertInto('app_user').values({
        id: userId,
        username,
        email: `${username}@test.local`,
        password_hash: passwordHash,
        display_name: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
        role: role as 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver',
        is_active: true,
      })
        .onConflict((oc) => oc.column('username').doUpdateSet({
          password_hash: passwordHash,
          is_active: true,
        }))
        .execute();

      // Fetch the actual user id (may differ from userId if the row
      // already existed from a previous run).
      const existing = await db.selectFrom('app_user')
        .select(['id', 'email'])
        .where('username', '=', username)
        .executeTakeFirstOrThrow();

      testUsers[role] = { id: existing.id, username, email: existing.email, password };
    }

    // Mark setup complete so the setup gate passes
    const { markSetupComplete } = await import('../../middleware/setup.js');
    markSetupComplete();

    initialized = true;
  }, 120_000);

  // No afterAll cleanup: the database and app are shared across all HTTP
  // test files. Vitest process cleanup handles the PGlite resources.
}

/** Returns the Express app (throws if setupHttpTests hasn't run). */
export function getApp(): Express {
  if (!app) throw new Error('Call setupHttpTests() in your describe block first.');
  return app;
}

/** Returns the base URL of the persistent test server. */
export function getBaseUrl(): string {
  if (!baseUrl) throw new Error('Call setupHttpTests() in your describe block first.');
  return baseUrl;
}

/** Returns an unauthenticated supertest request builder. */
export function getAgent(): supertest.SuperTest<supertest.Test> {
  return supertest(baseUrl) as any;
}

/**
 * Test-only helper that pokes an assessment directly into a target
 * state via the DB, skipping the transition matrix and completion
 * preconditions. Tests use this when they need a "complete" or
 * "archived" assessment as a fixture for unrelated logic (export,
 * claims, attestations, retention) and don't care about exercising
 * the legitimate state-machine path.
 *
 * The production API enforces the matrix; this helper is the explicit
 * "I know this is a back door, I'm using it for fixture setup" hatch.
 * Never use it outside __tests__.
 */
export async function forceAssessmentStateForTests(
  assessmentId: string,
  state: 'new' | 'pending' | 'in_progress' | 'on_hold' | 'cancelled' | 'complete' | 'archived',
): Promise<void> {
  const { getDatabase } = await import('../../db/connection.js');
  const db = getDatabase();
  await db
    .updateTable('assessment')
    .set({
      state,
      // Stamp end_date on terminal/complete states so any downstream
      // logic that reads it sees a consistent fixture.
      ...((['complete', 'archived', 'cancelled'].includes(state)) ? { end_date: new Date() } : {}),
    })
    .where('id', '=', assessmentId)
    .execute();
}

/**
 * Returns a supertest agent that carries the session cookie for the
 * requested role. Each call logs in fresh so tests are isolated.
 */
export async function loginAs(role: 'admin' | 'assessor' | 'assessee'): Promise<ReturnType<typeof supertest.agent>> {
  const user = testUsers[role];
  if (!user) throw new Error(`No test user for role "${role}". Did setupHttpTests() run?`);

  const agent = supertest.agent(baseUrl);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ username: user.username, password: user.password });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return agent;
}

export type PersonaRole = 'admin' | 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver';

/**
 * Creates an extra user with the given role and returns a logged-in agent.
 * Use for authorization tests that need more personas than the shared
 * admin/assessor/assessee trio (outsiders, standards roles, etc.).
 */
export async function createPersona(role: PersonaRole, label = role): Promise<{
  id: string;
  username: string;
  password: string;
  agent: ReturnType<typeof supertest.agent>;
}> {
  const { getDatabase } = await import('../../db/connection.js');
  const { hashPassword } = await import('../../utils/crypto.js');
  const db = getDatabase();
  const id = uuidv4();
  const username = `${label}_${id.slice(0, 8)}`;
  const password = 'Password123!';
  const roleRow = await db.selectFrom('role').select('id').where('key', '=', role).executeTakeFirst();
  await db.insertInto('app_user').values({
    id,
    username,
    email: `${username}@test.local`,
    password_hash: await hashPassword(password),
    display_name: label,
    role,
    role_id: roleRow?.id ?? null,
    is_active: true,
  }).execute();
  const agent = supertest.agent(baseUrl);
  const res = await agent.post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Login failed for persona ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { id, username, password, agent };
}
