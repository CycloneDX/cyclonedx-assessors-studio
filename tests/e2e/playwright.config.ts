import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// State reset (the E2E PGlite data dir and per-role storage states)
// is intentionally NOT done here. Playwright workers re-import this
// config file in each child process, which would race-wipe the
// backend's data dir mid-run. The reset lives in the `pretest` npm
// hook (see tests/e2e/package.json) so it runs exactly once, before
// any worker or webServer starts. Set E2E_PRESERVE_STATE=1 or CI=1
// to skip the reset.

/**
 * Playwright configuration for CycloneDX Assessors Studio E2E suite.
 *
 * Test environment shape:
 *   - Backend boots with PGlite on a fresh test data dir, port 3001.
 *   - Frontend boots in vite preview mode on port 5173. Browser tests
 *     hit 5173; the dev proxy forwards API calls to 3001.
 *   - Global setup creates an admin via the setup wizard, seeds demo
 *     data, and writes per-role storage states to auth/storage-states/.
 *   - Each spec picks the role it needs via the typed `auth` fixture.
 *
 * CI tuning notes:
 *   - Workers default to 50% of CPU locally and 1 in CI to keep test
 *     output deterministic and to stay within the GitHub-hosted
 *     runner's 7-GB memory budget under PGlite + Chromium.
 *   - retries: 2 in CI, 0 locally so flakes surface immediately.
 *   - Trace + screenshot + video are captured only on first-failure
 *     retries to keep artifact size manageable.
 */

// Allow overriding the base URL when running against a remote stack
// (for example, against a Docker compose image during release smoke).
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3001';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',

  // Match Playwright's default but make it explicit so a misconfigured
  // CI runner cannot silently truncate output.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : '50%',

  reporter: IS_CI
    ? [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
        ['github'],
        ['list'],
      ]
    : [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['list'],
      ],

  globalSetup: path.resolve(__dirname, './auth/global-setup.ts'),

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pin viewport to a mid-size desktop so layout-dependent locators
    // do not flake when run on different CI runners.
    viewport: { width: 1440, height: 900 },
    // The app sets credentials-bearing cookies; default fetch context
    // must include them so api fixtures see the auth cookie.
    extraHTTPHeaders: { 'x-e2e': 'true' },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox and WebKit run only the @smoke-tagged subset to keep CI
    // wall time bounded. Bulk coverage lives on chromium.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /@smoke/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@smoke/,
    },
  ],

  // Reuse the existing dev stack only when the developer has opted
  // to preserve state. Default local runs wipe the data dir via the
  // pretest hook, and a stale backend with in-memory data from the
  // pre-wipe state would silently bypass that reset. CI always boots
  // fresh anyway. The trade-off: cold-boot adds ~10s per local run,
  // but tests are reproducible.
  webServer: process.env.E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          // Backend: PGlite-backed, fresh data dir per CI run via the
          // E2E_PGLITE_DIR env var that global-setup also reads.
          //
          // Health is probed at /api/health (unversioned) because the
          // setup middleware gates everything under /api/v1/* behind
          // setup completion. The wizard runs inside global-setup, so
          // the pre-setup probe must use the unversioned alias.
          command: 'npm --prefix ../../backend run dev',
          url: `${API_URL}/api/health`,
          timeout: 120_000,
          reuseExistingServer: !IS_CI && !!process.env.E2E_PRESERVE_STATE,
          env: {
            NODE_ENV: 'test',
            PORT: '3001',
            DATABASE_PROVIDER: 'pglite',
            PGLITE_DATA_DIR: process.env.E2E_PGLITE_DIR || './data/pglite-e2e',
            JWT_SECRET: 'e2e-testing-secret-that-is-at-least-32-characters-long-please',
            JWT_EXPIRY: '24h',
            CORS_ORIGIN: BASE_URL,
            LOG_LEVEL: 'warn',
            REGISTRATION_MODE: 'disabled',
            // First-run setup token; global-setup sends the same value.
            SETUP_TOKEN: 'e2e-setup-token-0123456789abcdef',
          },
        },
        {
          command: 'npm --prefix ../../frontend run dev -- --port 5173 --strictPort',
          url: BASE_URL,
          timeout: 120_000,
          reuseExistingServer: !IS_CI,
          env: {
            // The Vite dev server proxies /api to localhost:3001 by
            // default; no extra config required.
          },
        },
      ],
});

export const e2eEnv = {
  BASE_URL,
  API_URL,
  IS_CI,
};
