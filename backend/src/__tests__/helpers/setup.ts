import { Kysely } from 'kysely';
import { pgliteDialect } from '../../db/pglite-dialect.js';
import { hashPassword } from '../../utils/crypto.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Database } from '../../db/types.js';
import { SQL as MIGRATION_SQL, installSoftDeleteViews } from '../../db/migrate.js';
import { seedDefaultRolesAndPermissions } from '../../db/seed.js';
import { AuditLogAppendOnlyPlugin } from '../../db/audit-log-plugin.js';
import { logger } from '../../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let testDb: Kysely<Database> | null = null;
let testDbDir: string | null = null;

export async function setupTestDb() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PROVIDER = 'pglite';
  // Test JWT secret for test environment only
  process.env.JWT_SECRET = 'test-secret-key-for-testing-32-chars-min';

  // Ensure the parent `data/` directory exists explicitly first.
  // PGlite's worker thread occasionally races the directory check —
  // mkdirSync with recursive:true *should* create missing parents,
  // but on macOS we've seen ENOENT come back for a known-good path
  // when the parent was removed between resolve and write by another
  // test's teardown. Pre-creating the parent in its own mkdir call
  // is cheap and serialises against the writer.
  const dataParent = path.join(__dirname, '../../../..', 'data');
  fs.mkdirSync(dataParent, { recursive: true });

  testDbDir = path.join(dataParent, `pglite-test-${uuidv4().slice(0, 8)}`);
  process.env.PGLITE_DATA_DIR = testDbDir;

  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite({
    dataDir: testDbDir,
  });

  testDb = new Kysely<Database>({
    dialect: pgliteDialect(pglite),
    plugins: [new AuditLogAppendOnlyPlugin()],
  });

  await runMigrationsWithDb(testDb);
  await seedDefaultRolesAndPermissions(testDb);
}

// Tests share the production migration SQL imported from db/migrate.ts so
// the test schema cannot drift from production. The previous inline
// snapshot was the source of the `relation "assessor" does not exist`
// regression when migrate.ts added tables that the snapshot never caught
// up on.
async function runMigrationsWithDb(db: Kysely<Database>): Promise<void> {
  logger.info('Running database migrations (shared SQL from db/migrate.ts)...');

  const statements = MIGRATION_SQL.split(';').filter((stmt) => stmt.trim());

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.executeQuery({
          sql: `${statement};`,
          parameters: [],
        } as any);
      } catch (error: unknown) {
        const msg =
          error instanceof Error && typeof error.message === 'string'
            ? error.message
            : '';
        if (msg.includes('already exists')) {
          continue;
        }
        // Mirror migrate.ts's tolerance for re-running the TEXT->BYTEA
        // migration against an already-converted column.
        if (msg.includes('cannot cast') || msg.includes('function decode(bytea')) {
          continue;
        }
        // Mirror migrate.ts's soft-delete idempotency tolerance: additive DDL
        // that targets a view (post rename-to-*_raw) on a re-run.
        if (
          msg.includes('cannot create index on relation') ||
          msg.includes('ADD COLUMN cannot be performed on relation')
        ) {
          continue;
        }
        const stmtPreview = statement.trim().slice(0, 400);
        throw new Error(
          `Test migration failed on statement: ${stmtPreview}\n\nOriginal error: ${msg}`,
        );
      }
    }
  }

  // Install the soft-delete view layer so tests exercise the same schema as
  // production (deleted_at columns, *_raw tables, and filtered views). Without
  // this, selectFrom('assessment') would hit a plain base table and soft-delete
  // writes would fail on the missing deleted_at column.
  await installSoftDeleteViews(db);

  logger.info('Database migrations completed');
}

export async function teardownTestDb() {
  if (testDb) {
    await testDb.destroy();
    testDb = null;
  }
  if (testDbDir && fs.existsSync(testDbDir)) {
    try {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    } catch {
      // Ignore EPERM errors in sandboxed environments
    }
  }
}

export function getTestDatabase(): Kysely<Database> {
  if (!testDb) {
    throw new Error('Test database not initialized. Call setupTestDb() first.');
  }
  return testDb;
}

export async function createTestUser(overrides: Partial<{
  username: string;
  email: string;
  displayName: string;
  role: string;
  password: string;
}> = {}) {
  const db = getTestDatabase();
  const userId = uuidv4();
  const passwordHash = await hashPassword(overrides.password || 'testpassword123');

  await db.insertInto('app_user').values({
    id: userId,
    username: overrides.username || `testuser_${userId.slice(0, 8)}`,
    email: overrides.email || `test_${userId.slice(0, 8)}@example.com`,
    password_hash: passwordHash,
    display_name: overrides.displayName || 'Test User',
    role: (overrides.role || 'assessee') as any,
    is_active: true,
  }).execute();

  return {
    id: userId,
    username: overrides.username || `testuser_${userId.slice(0, 8)}`,
    email: overrides.email || `test_${userId.slice(0, 8)}@example.com`,
  };
}

export async function createTestProject(overrides: Partial<{
  name: string;
  description: string;
  state: string;
}> = {}) {
  const db = getTestDatabase();
  const projectId = uuidv4();

  await db.insertInto('project').values({
    id: projectId,
    name: overrides.name || 'Test Project',
    description: overrides.description || 'A test project',
    state: (overrides.state || 'new') as any,
  }).execute();

  return {
    id: projectId,
    name: overrides.name || 'Test Project',
  };
}

export async function createTestStandard(overrides: Partial<{
  identifier: string;
  name: string;
  description: string | null;
  owner: string | null;
  version: string | null;
}> = {}) {
  const db = getTestDatabase();
  const standardId = uuidv4();
  const identifier = overrides.identifier || `STD-${uuidv4().slice(0, 8)}`;

  await db.insertInto('standard').values({
    id: standardId,
    identifier,
    name: overrides.name || 'Test Standard',
    description: 'description' in overrides ? overrides.description : 'A test standard',
    owner: 'owner' in overrides ? overrides.owner : 'Test Owner',
    version: 'version' in overrides ? overrides.version : '1.0.0',
  }).execute();

  return {
    id: standardId,
    identifier,
    name: overrides.name || 'Test Standard',
  };
}

export async function createTestRequirement(standardId: string, overrides: Partial<{
  identifier: string;
  name: string;
  description: string;
  parentId: string;
  open_cre: string;
}> = {}) {
  const db = getTestDatabase();
  const requirementId = uuidv4();
  const identifier = overrides.identifier || `REQ-${uuidv4().slice(0, 8)}`;

  await db.insertInto('requirement').values({
    id: requirementId,
    identifier,
    name: overrides.name || 'Test Requirement',
    description: overrides.description || 'A test requirement',
    standard_id: standardId,
    parent_id: overrides.parentId || null,
    open_cre: overrides.open_cre || null,
  }).execute();

  return {
    id: requirementId,
    identifier,
    name: overrides.name || 'Test Requirement',
  };
}

export async function createTestLevel(standardId: string, overrides: Partial<{
  identifier: string;
  title: string;
  description: string;
}> = {}) {
  const db = getTestDatabase();
  const levelId = uuidv4();
  const identifier = overrides.identifier || `LEVEL-${uuidv4().slice(0, 8)}`;

  await db.insertInto('level').values({
    id: levelId,
    identifier,
    title: overrides.title ?? 'Test Level',
    description: overrides.description ?? 'A test level',
    standard_id: standardId,
  }).execute();

  return {
    id: levelId,
    identifier,
    title: overrides.title || 'Test Level',
  };
}

export async function createTestAssessment(projectId: string, overrides: Partial<{
  title: string;
  description: string;
  state: string;
}> = {}) {
  const db = getTestDatabase();
  const assessmentId = uuidv4();

  await db.insertInto('assessment').values({
    id: assessmentId,
    title: overrides.title || 'Test Assessment',
    description: overrides.description || 'A test assessment',
    project_id: projectId,
    state: (overrides.state || 'new') as any,
  }).execute();

  return {
    id: assessmentId,
    title: overrides.title || 'Test Assessment',
  };
}

export async function createTestEvidence(authorId: string, overrides: Partial<{
  name: string;
  description: string;
  state: string;
}> = {}) {
  const db = getTestDatabase();
  const evidenceId = uuidv4();

  await db.insertInto('evidence').values({
    id: evidenceId,
    name: overrides.name || 'Test Evidence',
    description: overrides.description || 'A test evidence item',
    state: (overrides.state || 'in_progress') as any,
    author_id: authorId,
  }).execute();

  return {
    id: evidenceId,
    name: overrides.name || 'Test Evidence',
  };
}

export async function createTestTag(overrides: Partial<{
  name: string;
  color: string;
}> = {}) {
  const db = getTestDatabase();
  const tagId = uuidv4();
  const name = overrides.name ?? `tag-${uuidv4().slice(0, 8)}`.toLowerCase();
  const color = overrides.color ?? '#6366f1';

  await db.insertInto('tag').values({
    id: tagId,
    name,
    color,
    created_at: new Date(),
  }).execute();

  return {
    id: tagId,
    name,
    color,
  };
}

export async function createTestAttestationRequirement(
  attestationId: string,
  requirementId: string,
  overrides: Partial<{
    conformanceScore: number;
    conformanceRationale: string;
    confidenceScore: number;
    confidenceRationale: string;
  }> = {}
) {
  const db = getTestDatabase();
  const attestReqId = uuidv4();

  await db.insertInto('attestation_requirement').values({
    id: attestReqId,
    attestation_id: attestationId,
    requirement_id: requirementId,
    conformance_score: (overrides.conformanceScore ?? 0.5) as any,
    conformance_rationale: overrides.conformanceRationale || 'Test rationale',
    confidence_score: (overrides.confidenceScore ?? 0.75) as any,
    confidence_rationale: overrides.confidenceRationale || 'Test confidence',
    created_at: new Date(),
    updated_at: new Date(),
  }).execute();

  return {
    id: attestReqId,
    attestation_id: attestationId,
    requirement_id: requirementId,
  };
}
