/**
 * Resource Checking Utilities
 *
 * Shared utilities for common resource validation patterns in route handlers.
 * Reduces duplication of existence checks, 404 handling, and ownership verification.
 */

import type { Response } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

/**
 * Generic resource existence check.
 * Returns the resource if found, sends 404 and returns null if not.
 *
 * Usage:
 *   const assessment = await checkResourceExists(db, res, 'assessment', assessmentId);
 *   if (!assessment) return;
 */
export async function checkResourceExists(
  db: Kysely<Database>,
  res: Response,
  table: string,
  id: string,
  resourceName?: string,
): Promise<any | null> {
  const resource = await (db
    .selectFrom(table as any)
    .where('id' as any, '=', id)
    .selectAll() as any)
    .executeTakeFirst();

  if (!resource) {
    const name = resourceName || table;
    res.status(404).json({ error: `${name} not found` });
    return null;
  }

  return resource;
}

