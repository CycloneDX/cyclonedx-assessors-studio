import { chromium, request, type FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_DISPLAY_NAME,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  ALL_ROLES,
  DEMO_PASSWORD,
  DEMO_USERS,
  demoUserForRole,
  type RoleKey,
} from './credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, 'storage-states');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3001';

/**
 * Global setup runs once before any spec.
 *
 *   1. Wait for backend + frontend to be reachable (Playwright's
 *      webServer block already does this, but we double-check the
 *      /api/v1/health endpoint to avoid racing the database
 *      migrations).
 *   2. If the setup wizard is still active (no admin exists),
 *      complete it via the API to create the E2E admin.
 *   3. Seed demo data via /api/v1/setup/seed-demo. Idempotent.
 *   4. For each role, log in once and persist the browser storage
 *      state (cookies + localStorage) to `auth/storage-states/<role>.json`.
 *      Tests pick a state via the typed `auth` fixture.
 *
 * Setup logs nothing on success and throws with a useful message on
 * failure so CI surfaces the cause without hunting through logs.
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const apiContext = await request.newContext({ baseURL: API_URL });

  // 1. Wait for /api/v1/health to be 200.
  await waitForHealth(apiContext);

  // 2. Create the admin via the setup endpoint. If setup is already
  //    complete (re-running against an existing data dir), the endpoint
  //    returns 403 and we skip; subsequent login proves the credential
  //    still works.
  await ensureAdmin(apiContext);

  // 3. Import a synthetic standard with requirements before seeding
  //    demo data. The setup wizard normally fetches a standard from a
  //    CycloneDX feed URL (GitHub-hosted), but that needs network
  //    access we cannot assume in CI. Posting a small inline standard
  //    via the standards API gives every test a known starting point
  //    where /api/v1/standards is non-empty and at least one standard
  //    has requirements.
  await ensureSeedStandard(apiContext);

  // 4. Seed demo data so the standards_manager, standards_approver,
  //    assessor and assessee storage states have working credentials.
  await seedDemoData(apiContext);

  // 5. Pre-create one E2E project linked to the baseline standard.
  //    Per-test project creation pushes the project off the first
  //    page of /api/v1/projects when accumulated state grows past
  //    the default 20-row limit, which makes the project select
  //    dropdown unable to find it. A stable per-run project gives
  //    the project-linked assessment test a deterministic reference.
  await ensureSeedProject(apiContext);

  await apiContext.dispose();

  // 4. Capture per-role browser storage state. We use a headless
  //    browser rather than an API token because the application reads
  //    auth from an HttpOnly cookie; storage-state captures cookies
  //    plus any client-side auth hints in localStorage.
  const browser = await chromium.launch();
  try {
    for (const role of ALL_ROLES) {
      await captureStorageState(browser, role);
    }
  } finally {
    await browser.close();
  }
}

async function waitForHealth(api: Awaited<ReturnType<typeof request.newContext>>): Promise<void> {
  // Unversioned alias /api/health is always reachable, even before
  // the setup middleware allows /api/v1/* to respond. We must probe
  // here too because setup-required mode would return 503 on the
  // versioned route.
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await api.get('/api/health');
      if (r.ok()) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(
    `Backend health check did not return 200 within 60s at ${API_URL}/api/health. ` +
      `Last error: ${String(lastErr)}`,
  );
}

const E2E_SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';

async function ensureAdmin(api: Awaited<ReturnType<typeof request.newContext>>): Promise<void> {
  // Probe: if a user already exists, /api/v1/setup returns 403.
  const probe = await api.post('/api/v1/setup', {
    data: {
      // Matches SETUP_TOKEN in the backend webServer env (playwright.config.ts).
      setupToken: E2E_SETUP_TOKEN,
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      displayName: ADMIN_DISPLAY_NAME,
      password: ADMIN_PASSWORD,
    },
  });
  if (probe.status() === 201) return;
  if (probe.status() === 403) {
    // Already set up; verify the E2E admin credentials still work.
    const login = await api.post('/api/v1/auth/login', {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    if (!login.ok()) {
      throw new Error(
        `Setup is complete but the E2E admin (${ADMIN_USERNAME}) cannot log in. ` +
          `Reset the test database (rm -rf data/pglite-e2e) or set E2E_PGLITE_DIR ` +
          `to a fresh path. Login status: ${login.status()}`,
      );
    }
    return;
  }
  throw new Error(
    `Unexpected status ${probe.status()} from POST /api/v1/setup: ${await probe.text()}`,
  );
}

async function ensureSeedStandard(
  api: Awaited<ReturnType<typeof request.newContext>>,
): Promise<void> {
  // Log in as admin (idempotent — repeats are fine).
  const login = await api.post('/api/v1/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!login.ok()) {
    throw new Error(`ensureSeedStandard: admin login failed ${login.status()}`);
  }

  // Pick a unique identifier per global-setup invocation. The
  // importStandard service is "idempotent by identifier" — if a
  // standard with the same identifier exists, the import is silently
  // skipped and zero requirements are inserted. That left previous
  // runs of this suite stuck with a stale standard whose requirement
  // count was 0, even after the data dir was wiped (residual state
  // can come from a kept-alive backend or a half-finished prior run).
  //
  // Using a fresh identifier guarantees a real import every time.
  const stamp = Date.now().toString(36);
  const identifier = `E2E-BASELINE-${stamp}`;

  const r = await api.post('/api/v1/standards/import', {
    data: {
      identifier,
      name: 'E2E Baseline Standard',
      version: `1.0.0-${stamp}`,
      description: 'Synthetic standard seeded by Playwright global-setup',
      requirements: [
        { identifier: `${identifier}-REQ-1`, name: 'Has access control', description: 'Stub' },
        { identifier: `${identifier}-REQ-2`, name: 'Has audit logging', description: 'Stub' },
        { identifier: `${identifier}-REQ-3`, name: 'Has encryption', description: 'Stub' },
      ],
    },
  });
  if (r.status() !== 201 && r.status() !== 200) {
    throw new Error(
      `Failed to import E2E baseline standard: ${r.status()} ${await r.text()}`,
    );
  }

  // Verify the import actually created requirements. importStandard is
  // permissive and returns success even on partial inserts; the only
  // way to know for sure is to read the standard back. If this fails,
  // global-setup throws and the suite is unrunnable — which is the
  // correct failure mode, since every assessment test depends on a
  // standard with requirements.
  const created: { id: string } = await r.json();
  const detail = await api.get(`/api/v1/standards/${created.id}`);
  if (!detail.ok()) {
    throw new Error(`Could not read back imported standard ${created.id}: ${detail.status()}`);
  }
  const detailBody = await detail.json();
  // The detail endpoint returns requirements as a tree; count nodes
  // recursively. A flat .length is wrong if the tree was nested.
  const countNodes = (
    nodes: Array<{ children?: unknown[] }> | undefined,
  ): number => {
    if (!Array.isArray(nodes)) return 0;
    let n = nodes.length;
    for (const node of nodes) {
      if (Array.isArray(node.children)) n += countNodes(node.children as Array<{ children?: unknown[] }>);
    }
    return n;
  };
  const total = countNodes(detailBody.requirements);
  if (total < 1) {
    throw new Error(
      `E2E baseline standard imported but has 0 requirements. ` +
        `Import response: ${JSON.stringify(await r.json().catch(() => null))}. ` +
        `Detail body keys: ${Object.keys(detailBody).join(', ')}.`,
    );
  }
}

async function ensureSeedProject(
  api: Awaited<ReturnType<typeof request.newContext>>,
): Promise<void> {
  // Log in idempotently.
  await api.post('/api/v1/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });

  // Find the baseline standard (unique per global-setup run) so we
  // can link it to the project. Use the most recently created one
  // that has requirements, mirroring how tests select it.
  const standardsRes = await api.get('/api/v1/standards?limit=100');
  const standardsBody = await standardsRes.json();
  const baselineStandards = (standardsBody.data as Array<{
    id: string;
    name: string;
    requirementsCount?: number;
    createdAt?: string;
  }>)
    .filter((s) => (s.requirementsCount ?? 0) > 0)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  if (baselineStandards.length === 0) {
    throw new Error(
      'ensureSeedProject: no baseline standard with requirements found. ' +
        'ensureSeedStandard should have run first.',
    );
  }
  const baselineId = baselineStandards[0].id;

  // Make the project name unique per global-setup invocation, same
  // as the standard, so prior-run leftovers do not collide.
  const stamp = Date.now().toString(36);
  const r = await api.post('/api/v1/projects', {
    data: {
      name: `E2E Baseline Project ${stamp}`,
      standardIds: [baselineId],
    },
  });
  if (r.status() !== 201 && r.status() !== 200) {
    throw new Error(`Failed to create E2E baseline project: ${r.status()} ${await r.text()}`);
  }
}

async function seedDemoData(api: Awaited<ReturnType<typeof request.newContext>>): Promise<void> {
  // Log in as admin to get a session cookie for the seed endpoint.
  const login = await api.post('/api/v1/auth/login', {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!login.ok()) {
    throw new Error(`Cannot log in as E2E admin to seed demo data: ${login.status()}`);
  }
  // Demo users can only sign in when a password is supplied here; the one
  // in demo-data.json is never used (security review A1).
  const seed = await api.post('/api/v1/setup/seed-demo', { data: { demoUserPassword: DEMO_PASSWORD } });
  // 201 = newly seeded, 200 = already seeded.
  if (seed.status() !== 201 && seed.status() !== 200) {
    throw new Error(
      `seed-demo returned ${seed.status()}: ${await seed.text()}. Standards must be imported ` +
        `before demo data can be seeded. Hint: run /api/v1/setup/import-standard for at least ` +
        `one standard, or pre-import via the setup wizard.`,
    );
  }
  // Logout so the API context is not carrying admin cookies into the
  // browser storage capture step.
  await api.post('/api/v1/auth/logout');
}

async function captureStorageState(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  role: RoleKey,
): Promise<void> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const creds =
    role === 'admin'
      ? { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
      : { username: demoUserForRole(role).username, password: DEMO_PASSWORD };

  await page.goto('/login');
  await page.getByLabel(/username/i).fill(creds.username);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 15_000 });

  const file = path.join(STORAGE_DIR, `${role}.json`);
  await context.storageState({ path: file });
  await context.close();
}

export default globalSetup;
