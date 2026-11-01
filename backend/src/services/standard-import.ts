import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';

/**
 * Represents a raw requirement object from CycloneDX standards.
 */
export interface RawRequirement {
  'bom-ref'?: string;
  bomRef?: string;
  identifier?: string;
  title?: string;
  text?: string;
  name?: string;
  description?: string;
  parent?: string | null;
  parentIdentifier?: string | null;
  openCre?: string | string[] | null;
  'open-cre'?: string | string[] | null;
}

/**
 * Represents a raw level object from CycloneDX standards.
 */
export interface RawLevel {
  'bom-ref'?: string;
  bomRef?: string;
  identifier?: string;
  title?: string | null;
  description?: string | null;
  requirements?: string[];
}

/**
 * Represents a raw CycloneDX standard object (from definitions.standards[]).
 * Accepts both CycloneDX native field names (bom-ref, title, text) and
 * pre-normalized camelCase names (identifier, name, description).
 */
export interface RawStandardInput {
  'bom-ref'?: string;
  bomRef?: string;
  identifier?: string;
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  owner?: string;
  requirements?: RawRequirement[];
  levels?: RawLevel[];
}

export interface ImportedStandardResult {
  id: string;
  identifier: string;
  name: string;
  requirementCount: number;
  levelCount: number;
  skipped: boolean;
}

// ---- Helper functions (not exported) ----

/**
 * Pick the first non-empty string from a list of candidates, or null if none found.
 */
function firstNonEmpty(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c !== null && c !== undefined && c !== '') return c;
  }
  return null;
}

/**
 * Extract the reference ID from a requirement using multiple fallback formats.
 */
function getRequirementRef(req: RawRequirement): string {
  return firstNonEmpty(req['bom-ref'], req.bomRef, req.identifier) ?? '';
}

/**
 * Extract the parent reference from a requirement using multiple fallback formats.
 */
function getRequirementParentRef(req: RawRequirement): string | null {
  return req.parent ?? req.parentIdentifier ?? null;
}

/**
 * Build parent-child relationships from requirements.
 */
function buildRelationshipMaps(requirements: RawRequirement[]): {
  childrenOf: Map<string, RawRequirement[]>;
  roots: RawRequirement[];
} {
  const childrenOf = new Map<string, RawRequirement[]>();
  const roots: RawRequirement[] = [];

  for (const req of requirements) {
    const parentRef = getRequirementParentRef(req);
    if (!parentRef) {
      roots.push(req);
    } else {
      if (!childrenOf.has(parentRef)) {
        childrenOf.set(parentRef, []);
      }
      childrenOf.get(parentRef)?.push(req);
    }
  }

  return { childrenOf, roots };
}

/**
 * Visit a node and its descendants in DFS pre-order (parents first).
 * Iterative with a visited set: a requirement whose parent is itself, or a
 * parent cycle, used to recurse until the stack overflowed, failing the
 * import and leaving the standard row behind (security review I12).
 */
function visitRequirementNode(
  node: RawRequirement,
  childrenOf: Map<string, RawRequirement[]>,
  sorted: RawRequirement[]
): void {
  const seen = new Set<RawRequirement>(sorted);
  const stack: RawRequirement[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as RawRequirement;
    if (seen.has(current)) continue;
    seen.add(current);
    sorted.push(current);
    const children = childrenOf.get(getRequirementRef(current)) ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i] as RawRequirement);
    }
  }
}

/**
 * Normalize standard metadata fields from various input formats.
 */
function normalizeStandardMetadata(standard: RawStandardInput, fallbackName: string) {
  const bomRef = firstNonEmpty(standard['bom-ref'], standard.bomRef, standard.identifier) ?? uuidv4();
  return {
    identifier: bomRef,
    name: firstNonEmpty(standard.name, standard.title) ?? fallbackName,
    description: standard.description ?? null,
    version: standard.version ?? null,
    owner: standard.owner ?? null,
  };
}

/**
 * Build a topologically sorted list of requirements (parents before children).
 */
function topologicalSortRequirements(requirements: RawRequirement[]): RawRequirement[] {
  const { childrenOf, roots } = buildRelationshipMaps(requirements);

  const sorted: RawRequirement[] = [];
  for (const root of roots) {
    visitRequirementNode(root, childrenOf, sorted);
  }

  // Append any orphans whose parent ref doesn't match
  const visited = new Set(sorted);
  for (const req of requirements) {
    if (!visited.has(req)) {
      sorted.push(req);
    }
  }

  return sorted;
}

/**
 * Normalize openCre from various formats (array, string, or null).
 */
function normalizeOpenCre(openCreRaw: string | string[] | null): string | null {
  if (Array.isArray(openCreRaw)) {
    return openCreRaw.length > 0 ? openCreRaw.join(', ') : null;
  }
  return openCreRaw ?? null;
}

/**
 * Normalize a single requirement from various input formats.
 */
function normalizeRequirement(req: RawRequirement) {
  const reqBomRef = getRequirementRef(req);
  const reqIdentifier = firstNonEmpty(req.identifier, reqBomRef) ?? '';
  const reqTitle = firstNonEmpty(req.title, req.text, req.name, reqIdentifier) ?? '';
  const reqDescription = firstNonEmpty(req.description, req.text);
  const reqParent = getRequirementParentRef(req);

  const openCreRaw = req.openCre ?? req['open-cre'] ?? null;
  const openCre = normalizeOpenCre(openCreRaw);

  return {
    bomRef: reqBomRef,
    identifier: reqIdentifier,
    title: reqTitle,
    description: reqDescription,
    parent: reqParent,
    openCre,
  };
}

/**
 * Test whether a database error represents a uniqueness/duplicate violation.
 * Works with both Postgres and SQLite driver error messages.
 */
function isDuplicateError(err: unknown): boolean {
  const error = err as Record<string, unknown>;
  const message = error?.message ?? '';
  if (typeof message !== 'string') return false;
  return message.includes('duplicate') || message.includes('unique');
}

/**
 * Resolve the parent UUID for a requirement, given its external parent ref.
 */
function resolveParentId(
  parentRef: string | null,
  requirementMap: Map<string, string>,
): string | null {
  if (parentRef === null || parentRef === '') return null;
  return requirementMap.get(parentRef) ?? null;
}

/**
 * Insert a single requirement into the database.
 * Returns the requirement ID or null if duplicate and skipped.
 */
async function insertRequirement(
  db: ReturnType<typeof getDatabase>,
  req: RawRequirement,
  standardId: string,
  requirementMap: Map<string, string>,
): Promise<string | null> {
  const normalized = normalizeRequirement(req);
  const requirementId = uuidv4();
  const parentId = resolveParentId(normalized.parent, requirementMap);

  try {
    await db
      .insertInto('requirement')
      .values({
        id: requirementId,
        identifier: normalized.identifier,
        name: normalized.title,
        description: normalized.description,
        open_cre: normalized.openCre,
        parent_id: parentId,
        standard_id: standardId,
        // Preserve the source bom-ref so exports can round trip the
        // original identifier. Falls back to null when the upstream
        // feed only carried an `identifier` and no explicit bom-ref;
        // the writer treats null as "synthesize a fallback".
        imported_bom_ref: normalized.bomRef !== '' ? normalized.bomRef : null,
        // biome-ignore lint/suspicious/noExplicitAny: Kysely Insertable lags the migration
      } as any)
      // Duplicates are skipped in SQL, not by catching the error: inside the
      // import transaction a failed statement aborts the transaction.
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst()
      .then((row) => {
        if (!row) throw Object.assign(new Error('duplicate requirement'), { code: '23505' });
      });

    const mapKey = normalized.bomRef !== '' ? normalized.bomRef : normalized.identifier;
    requirementMap.set(mapKey, requirementId);
    return requirementId;
  } catch (insertError: unknown) {
    if (isDuplicateError(insertError)) {
      logger.debug('Skipping duplicate requirement', { identifier: normalized.identifier });
      return null;
    }
    throw insertError;
  }
}

/**
 * Import all requirements for a standard.
 * Returns count of successfully imported requirements.
 */
async function importRequirements(
  db: ReturnType<typeof getDatabase>,
  standard: RawStandardInput,
  standardId: string,
): Promise<{ count: number; map: Map<string, string> }> {
  const requirements = standard.requirements ?? [];
  const requirementMap = new Map<string, string>();
  let count = 0;

  const sortedRequirements = topologicalSortRequirements(requirements);

  for (const req of sortedRequirements) {
    const id = await insertRequirement(db, req, standardId, requirementMap);
    if (id) {
      count++;
    }
  }

  return { count, map: requirementMap };
}

/**
 * Normalize a single level from various input formats.
 */
function normalizeLevel(lvl: RawLevel) {
  const lvlBomRef = firstNonEmpty(lvl['bom-ref'], lvl.bomRef);
  return {
    bomRef: lvlBomRef,
    identifier: firstNonEmpty(lvl.identifier, lvlBomRef),
    title: lvl.title ?? null,
    description: lvl.description ?? null,
    requirements: lvl.requirements ?? [],
  };
}

/**
 * Insert a single level_requirement junction row, swallowing duplicate errors.
 */
async function insertLevelRequirementLink(
  db: ReturnType<typeof getDatabase>,
  levelId: string,
  requirementId: string,
): Promise<void> {
  try {
    await db
      .insertInto('level_requirement')
      .values({ level_id: levelId, requirement_id: requirementId })
      .onConflict((oc) => oc.doNothing())
      .execute();
  } catch (junctionError: unknown) {
    if (isDuplicateError(junctionError)) {
      logger.debug('Skipping duplicate level_requirement', { levelId, requirementId });
      return;
    }
    throw junctionError;
  }
}

/**
 * Link a level to its requirements via junction table.
 */
async function linkLevelRequirements(
  db: ReturnType<typeof getDatabase>,
  levelId: string,
  lvlRequirements: string[],
  requirementMap: Map<string, string>,
): Promise<void> {
  for (const reqRef of lvlRequirements) {
    const reqUuid = requirementMap.get(reqRef);
    if (reqUuid !== undefined) {
      await insertLevelRequirementLink(db, levelId, reqUuid);
    }
  }
}

/**
 * Insert a single level into the database.
 * Returns the level ID or null if duplicate and skipped.
 */
async function insertLevel(
  db: ReturnType<typeof getDatabase>,
  lvl: RawLevel,
  standardId: string,
  requirementMap: Map<string, string>,
): Promise<string | null> {
  const normalized = normalizeLevel(lvl);
  const levelId = uuidv4();

  try {
    await db
      .insertInto('level')
      .values({
        id: levelId,
        identifier: normalized.identifier,
        title: normalized.title,
        description: normalized.description,
        standard_id: standardId,
      })
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst()
      .then((row) => {
        if (!row) throw Object.assign(new Error('duplicate level'), { code: '23505' });
      });

    // Link requirements to this level
    await linkLevelRequirements(db, levelId, normalized.requirements, requirementMap);

    return levelId;
  } catch (insertError: unknown) {
    if (isDuplicateError(insertError)) {
      logger.debug('Skipping duplicate level', { identifier: normalized.identifier });
      return null;
    }
    throw insertError;
  }
}

/**
 * Import all levels for a standard.
 * Returns count of successfully imported levels.
 */
async function importLevels(
  db: ReturnType<typeof getDatabase>,
  standard: RawStandardInput,
  standardId: string,
  requirementMap: Map<string, string>,
): Promise<number> {
  const levels = standard.levels ?? [];
  let count = 0;

  for (const lvl of levels) {
    const id = await insertLevel(db, lvl, standardId, requirementMap);
    if (id) {
      count++;
    }
  }

  return count;
}

/**
 * Import a single standard (with requirements and levels) into the database.
 *
 * This is the canonical import logic used by both:
 *  - POST /api/v1/setup/standard  (setup wizard)
 *  - POST /api/v1/standards/import (standards management)
 *
 * The function is idempotent: if a standard with the same identifier already
 * exists, it returns the existing record without modification.
 *
 * @param standard  Raw standard object (CycloneDX native or pre-normalized)
 * @param options   Optional overrides (fallbackName, markAsImported)
 */
export async function importStandard(
  standard: RawStandardInput,
  options: { fallbackName?: string; markAsImported?: boolean; sourceJson?: string } = {},
): Promise<ImportedStandardResult> {
  const db = getDatabase();
  const { fallbackName = 'Unknown Standard', markAsImported = true, sourceJson } = options;

  const meta = normalizeStandardMetadata(standard, fallbackName);

  // Check if already imported (idempotent)
  const existing = await db
    .selectFrom('standard')
    .where('identifier', '=', meta.identifier)
    .select(['id', 'name'])
    .executeTakeFirst();

  if (existing) {
    return {
      id: existing.id,
      identifier: meta.identifier,
      name: existing.name,
      requirementCount: 0,
      levelCount: 0,
      skipped: true,
    };
  }

  const standardId = uuidv4();

  // Standard, requirements and levels in one transaction, so a failure
  // part-way cannot leave an orphan standard row (security review I12).
  const { requirementCount, levelCount } = await db.transaction().execute(async (trx) => {
  await trx
    .insertInto('standard')
    .values({
      id: standardId,
      identifier: meta.identifier,
      name: meta.name,
      description: meta.description,
      owner: meta.owner,
      version: meta.version,
      license_id: null,
      state: 'published',
      is_imported: markAsImported,
      source_json: sourceJson ?? null,
    })
    .execute();

  // Import requirements and levels
  const { count: reqCount, map: requirementMap } = await importRequirements(trx, standard, standardId);
  const lvlCount = await importLevels(trx, standard, standardId, requirementMap);
  return { requirementCount: reqCount, levelCount: lvlCount };
  });

  logger.info('Standard imported', {
    standardId,
    identifier: meta.identifier,
    name: meta.name,
    requirementCount,
    levelCount,
  });

  return {
    id: standardId,
    identifier: meta.identifier,
    name: meta.name,
    requirementCount,
    levelCount,
    skipped: false,
  };
}
