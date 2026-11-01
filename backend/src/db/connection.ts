import { Kysely, PostgresDialect } from 'kysely';
import { pgliteDialect } from './pglite-dialect.js';
import { Pool } from 'pg';
import fs from 'node:fs';
import { getConfig } from '../config/index.js';
import type { Database } from './types.js';
import { logger } from '../utils/logger.js';
import { AuditLogAppendOnlyPlugin } from './audit-log-plugin.js';

let db: Kysely<Database> | null = null;

export async function initializeDatabase(): Promise<Kysely<Database>> {
  if (db) {
    return db;
  }

  // Read config at call time (not module load time) so that test helpers
  // can override environment variables before initialisation.
  const config = getConfig();

  try {
    if (config.DATABASE_PROVIDER === 'pglite') {
      logger.info('Initializing PGlite database', {
        dataDir: config.PGLITE_DATA_DIR,
      });

      // Ensure the data directory exists before PGlite tries to use it
      fs.mkdirSync(config.PGLITE_DATA_DIR, { recursive: true });

      const { PGlite } = await import('@electric-sql/pglite');
      const pglite = new PGlite({
        dataDir: config.PGLITE_DATA_DIR,
      });

      db = new Kysely<Database>({
        dialect: pgliteDialect(pglite),
        plugins: [new AuditLogAppendOnlyPlugin()],
      });
    } else {
      logger.info('Initializing PostgreSQL database', {
        url: config.DATABASE_URL.replace(/\/\/.*@/, '//***@'),
      });

      // Pool sizing and timeout defaults.
      //
      // The library defaults are permissive: no statement timeout, no
      // idle-in-transaction timeout, and a long connect timeout. Under
      // load (or in the face of a slow downstream like an external
      // SBOM import or a large export) that lets a single stuck query
      // hold its connection forever, which walks the pool toward
      // exhaustion. Explicit timeouts turn those failure modes into
      // loud errors the caller can recover from instead of silent
      // connection starvation. Values are deliberately conservative:
      //  - connectionTimeoutMillis: 5s to acquire a pool slot
      //  - statement_timeout: 30s to finish any single query
      //  - idle_in_transaction_session_timeout: 60s before the server
      //    aborts an idle transaction and releases its locks
      //  - application_name: surfaces the app in pg_stat_activity so
      //    operators can identify hung queries back to this service.
      const pool = new Pool({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
        idle_in_transaction_session_timeout: 60_000,
        application_name: 'cdxa-assessors-studio',
      });

      db = new Kysely<Database>({
        dialect: new PostgresDialect({
          pool,
        }),
        plugins: [new AuditLogAppendOnlyPlugin()],
      });
    }

    logger.info('Database connection established');
    return db;
  } catch (error) {
    logger.error('Failed to initialize database', { error });
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    try {
      await db.destroy();
      db = null;
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection', { error });
      throw error;
    }
  }
}

export function getDatabase(): Kysely<Database> {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}
