/**
 * Query-string helpers (security review I9).
 *
 * Express parses `?search=a&search=b` into an array, so `as string` casts
 * were wrong: string methods on the array threw and returned 500.
 */

/** One string from a query parameter: first element of an array, capped in length. */
export function queryString(value: unknown, max = 200): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' ? v.slice(0, max) : undefined;
}

/**
 * ILIKE "contains" pattern with the wildcard characters escaped, so a
 * search for "%" or "_" matches those characters literally instead of
 * matching everything (Postgres' default LIKE escape is backslash).
 */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
