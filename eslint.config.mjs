// ─────────────────────────────────────────────────────────────────────────
// cyclomatic-complexity rule (ESLint flat config, root-level).
//
// Enables ONE rule — `complexity` — on application source only. Severity is
// "error" so a scoped run exits non-zero on a function over V(G) 10 (new code
// ≤ 10; existing code ratchets — not above baseline).
//
// Deliberately placed at the repo ROOT. CI runs `eslint .` only inside each
// workspace working-dir (and only "if configured"), so a root config is NOT
// auto-detected by CI and does not change CI behaviour. Do not move this into
// backend/ or frontend/ without accounting for that CI hook.
// ─────────────────────────────────────────────────────────────────────────
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

const complexity = ['error', 10]

export default [
  {
    ignores: [
      '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/data/**',
      '**/*.d.ts', '**/__tests__/**', '**/*.test.*', '**/*.spec.*',
      '**/__mocks__/**', 'tests/**', 'docs/**', 'deploy/**', 'scripts/**',
      'reports/**',
      '**/vite.config.*', '**/vitest.config.*', '**/stryker.conf.*',
      'eslint.config.mjs',
    ],
  },
  {
    // TypeScript sources — complexity is syntactic, so no type-aware project
    // wiring is needed (fast; no tsconfig project references).
    files: ['backend/src/**/*.{ts,mts,cts}', 'frontend/src/**/*.{ts,mts,cts}'],
    languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
    rules: { complexity },
  },
  {
    // Vue SFCs — vue-eslint-parser extracts <script>, delegating TS to the
    // same parser above.
    files: ['frontend/src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: { complexity },
  },
  {
    // Frontend HTTP goes through the shared client (src/api/client.ts), which
    // owns the 401 -> /login and 503 -> /setup handling. Bare axios bypasses
    // it. Exempt: the client itself, and the router, which client.ts imports
    // (circular) and whose auth/setup probes expect raw 401/503 responses.
    files: ['frontend/src/**/*.{ts,mts,cts,vue}'],
    ignores: ['frontend/src/api/client.ts', 'frontend/src/router/index.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'axios', message: "Use the shared client: import client from '@/api/client'." }],
      }],
    },
  },
]
