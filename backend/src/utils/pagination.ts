import { z } from 'zod';

/**
 * Pagination query parameters validation schema.
 * - Coerces string values to numbers
 * - Defaults limit to 20 and offset to 0
 * - Caps limit at 100
 * - Ensures both are non-negative integers
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

/**
 * Validates pagination parameters from query string.
 * Returns validated limit and offset with defaults applied.
 */
export function validatePagination(query: Record<string, unknown>): PaginationParams {
  return paginationSchema.parse(query);
}

/**
 * Lenient pagination for list endpoints: never throws. Non-numeric,
 * negative or fractional input falls back to safe values, so a bad query
 * string cannot reach the database as a negative LIMIT/OFFSET and 500
 * (security review I8).
 */
export function clampPagination(query: Record<string, unknown>, defaultLimit = 50): PaginationParams {
  const toInt = (v: unknown): number | null => {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const limit = toInt(query.limit);
  const offset = toInt(query.offset);
  return {
    limit: limit !== null && limit >= 1 ? Math.min(limit, 100) : defaultLimit,
    offset: offset !== null && offset >= 0 ? offset : 0,
  };
}
