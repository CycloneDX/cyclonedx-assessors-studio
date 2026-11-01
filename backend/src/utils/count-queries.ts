/**
 * Database Count Query Utilities
 *
 * Shared helper to reduce duplication in count queries across route handlers.
 */

import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

/**
 * Generic count helper: counts all rows in a table that match optional conditions.
 * Returns the count as a number.
 *
 * Usage:
 *   const total = await countWhere(db, 'assessment');
 *   const active = await countWhere(db, 'assessment', (eb) =>
 *     eb('state', '=', 'in_progress')
 *   );
 */
export async function countWhere(
  db: Kysely<Database>,
  table: keyof Database,
  whereCallback?: (
    eb: any,
  ) => any,
): Promise<number> {
  let query = db
    .selectFrom(table as any)
    .select(db.fn.count<number>('id').as('count'));

  if (whereCallback) {
    query = query.where(whereCallback as any);
  }

  const result = await query.executeTakeFirstOrThrow();
  return Number(result.count);
}

/**
 * Count all rows in a table.
 *
 * Usage:
 *   const total = await countAll(db, 'project');
 */
export async function countAll(
  db: Kysely<Database>,
  table: keyof Database,
): Promise<number> {
  return countWhere(db, table);
}

