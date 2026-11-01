// Quick sanity check for the shared-schema fix. Exercises the same path
// that tests use (import migrate.SQL and seed.seedDefaultRolesAndPermissions
// and drive them against a fresh PGlite instance) and then confirms the
// regressed `assessor` table exists and that attestation.assessor_id is
// wired through. Run with: npx tsx scripts/sanity-shared-schema.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { Kysely } from 'kysely';
import { pgliteDialect } from '../src/db/pglite-dialect.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PROVIDER = 'pglite';
process.env.JWT_SECRET = 'test-secret-key-for-testing-32-chars-min';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data', `pglite-sanity-${uuidv4().slice(0, 8)}`);
process.env.PGLITE_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const { SQL } = await import('../src/db/migrate.js');
const { seedDefaultRolesAndPermissions } = await import('../src/db/seed.js');

const { PGlite } = await import('@electric-sql/pglite');
const pglite = new PGlite({ dataDir });
const db = new Kysely<any>({ dialect: pgliteDialect(pglite) });

const statements = SQL.split(';').filter((s: string) => s.trim());
let applied = 0;
let tolerated = 0;
for (const stmt of statements) {
  if (!stmt.trim()) continue;
  try {
    await db.executeQuery({ sql: `${stmt};`, parameters: [] } as any);
    applied += 1;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('already exists') || msg.includes('cannot cast') || msg.includes('function decode(bytea')) {
      tolerated += 1;
      continue;
    }
    console.error('FAIL statement:', stmt.trim().slice(0, 200));
    console.error('ERROR:', msg);
    process.exit(1);
  }
}

await seedDefaultRolesAndPermissions(db);

const assessorTable = await db.executeQuery({
  sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assessor';",
  parameters: [],
} as any);
const attestationCol = await db.executeQuery({
  sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'attestation' AND column_name = 'assessor_id';",
  parameters: [],
} as any);

const roleCount = await db
  .selectFrom('role')
  .select(db.fn.count('id').as('c'))
  .executeTakeFirstOrThrow();
const permCount = await db
  .selectFrom('permission')
  .select(db.fn.count('id').as('c'))
  .executeTakeFirstOrThrow();

console.log(JSON.stringify({
  applied,
  tolerated,
  hasAssessorTable: (assessorTable.rows as any[]).length === 1,
  hasAttestationAssessorIdCol: (attestationCol.rows as any[]).length === 1,
  roleCount: Number((roleCount as any).c),
  permCount: Number((permCount as any).c),
}, null, 2));

await db.destroy();
fs.rmSync(dataDir, { recursive: true, force: true });
