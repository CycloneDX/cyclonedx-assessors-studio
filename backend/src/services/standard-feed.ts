/**
 * CycloneDX Standards Feed service.
 *
 * Fetches the public catalogue feed, compares it against the local DB,
 * and returns a list of standards that are available upstream but not
 * yet imported.  Results are cached for one hour so repeated calls
 * (e.g. page refreshes) do not hammer the upstream server.
 */

import { safeFetch } from '../utils/safe-fetch.js';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';

const FEED_URL = 'https://cyclonedx.org/standards/feed.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface FeedEntry {
  feedId: string;
  title: string;
  version: string;
  owner: string;
  summary: string | null;
  bomLink: string;
  /** Fragment extracted from bomLink — matches standard.identifier in DB */
  bomRef: string;
  downloadUrl: string;
  dateModified: string;
}

interface FeedCheckResult {
  available: FeedEntry[];
  lastChecked: Date;
  error?: string;
}

// Module-level cache
let cache: FeedCheckResult | null = null;
let cacheTime = 0;

/**
 * Parse the raw feed JSON into typed FeedEntry objects.
 */
function parseFeed(raw: unknown[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const item of raw) {
    const i = item as Record<string, unknown>;
    const meta = (i._metadata ?? {}) as Record<string, unknown>;
    const attachments = (i.attachments as { url: string; mime_type: string }[] | undefined) ?? [];
    const cdxAttachment = attachments.find(a => a.mime_type?.includes('cyclonedx')) ?? attachments[0];
    if (!cdxAttachment?.url) continue;

    const bomLink = String(meta.bomLink ?? '');
    // Extract the fragment after '#' — this matches the bom-ref inside the BOM file
    // which is what importStandard stores as standard.identifier
    const bomRef = bomLink.includes('#') ? bomLink.split('#')[1] : bomLink;

    entries.push({
      feedId: String(i.id ?? ''),
      title: String(i.title ?? ''),
      version: String(meta.version ?? ''),
      owner: String(meta.owner ?? ''),
      summary: i.summary ? String(i.summary) : null,
      bomLink,
      bomRef,
      downloadUrl: cdxAttachment.url,
      dateModified: String(i.date_modified ?? ''),
    });
  }
  return entries;
}

/**
 * Fetch the upstream feed and return all entries.
 */
async function fetchFeed(): Promise<FeedEntry[]> {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
  const json = await res.json() as { items?: unknown[]; standards?: unknown[] } | unknown[];
  const raw = Array.isArray(json)
    ? json
    : ((json as Record<string, unknown>).items ?? (json as Record<string, unknown>).standards ?? []) as unknown[];
  return parseFeed(raw);
}

/**
 * Compare feed entries against the local DB and return those not yet imported.
 * Matching is done by bomRef (the bom-ref fragment) against standard.identifier,
 * with a fallback name+version match.
 */
async function filterNew(entries: FeedEntry[]): Promise<FeedEntry[]> {
  const db = getDatabase();
  const existing = await db
    .selectFrom('standard')
    .select(['identifier', 'name', 'version'])
    .execute();

  const identifierSet = new Set(existing.map(s => s.identifier));
  const nameVersionSet = new Set(
    existing.map(s => `${(s.name ?? '').toLowerCase()}||${(s.version ?? '').toLowerCase()}`)
  );

  return entries.filter(e => {
    if (identifierSet.has(e.bomRef)) return false;
    const nv = `${e.title.toLowerCase()}||${e.version.toLowerCase()}`;
    if (nameVersionSet.has(nv)) return false;
    return true;
  });
}

/**
 * Check the feed for standards not yet in the local DB.
 * Results are cached for CACHE_TTL_MS.
 */
export async function checkFeedForUpdates(force = false): Promise<FeedCheckResult> {
  const now = Date.now();
  if (!force && cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const result: FeedCheckResult = { available: [], lastChecked: new Date() };
  try {
    const all = await fetchFeed();
    result.available = await filterNew(all);
    logger.info('Standards feed checked', { total: all.length, new: result.available.length });
  } catch (err) {
    result.error = (err as Error).message;
    logger.warn('Standards feed check failed', { error: result.error });
  }

  cache = result;
  cacheTime = now;
  return result;
}

/**
 * Fetch and parse a single standard BOM JSON from a download URL.
 * Returns the raw parsed object ready for importStandard().
 */
export async function fetchStandardBom(url: string): Promise<Record<string, unknown>> {
  // The URL comes from the request body, so it gets the outbound SSRF
  // guard: public HTTPS only, pinned address, no redirects, size cap
  // (security review I2).
  const res = await safeFetch(url, { timeoutMs: 30_000, maxResponseBytes: MAX_STANDARD_BOM_BYTES });
  if (!res.ok) throw new Error(`Failed to fetch standard BOM: HTTP ${res.status}`);
  if (res.truncated) throw new Error('Standard BOM exceeds the size limit');
  const parsed: unknown = JSON.parse(res.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Standard BOM is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

const MAX_STANDARD_BOM_BYTES = 20 * 1024 * 1024;

/**
 * Invalidate the cache so the next call to checkFeedForUpdates re-fetches.
 */
export function invalidateFeedCache(): void {
  cache = null;
  cacheTime = 0;
}
