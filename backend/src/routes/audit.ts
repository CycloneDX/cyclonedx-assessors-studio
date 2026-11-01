import { Router } from 'express';
import { queryString } from '../utils/query.js';
import type { Response } from 'express';
import { getDatabase } from '../db/connection.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { type AuthRequest, requireSession, requirePermission } from '../middleware/auth.js';
import { validatePagination } from '../utils/pagination.js';

const router = Router();

/**
 * The set of action values logAudit accepts. Duplicated from
 * utils/audit.ts intentionally so the options endpoint does not depend on
 * a runtime type introspection trick; when a new action is added, both
 * places must be updated. See utils/audit.ts AuditEvent.action.
 */
const ALL_AUDIT_ACTIONS = [
  'create',
  'create_for_other',
  'update',
  'delete',
  'state_change',
  'link',
  'unlink',
  'authz_denied',
  'config_change',
] as const;

/**
 * Known mappings between audit entity_type values and the table column
 * that holds a user-facing name for that entity. Kept as a literal map
 * (not reflection) so that the frontend typeahead and the server side
 * resolver agree on which types are supported and what "name" means for
 * each. If an entity_type is not in this map the audit row still renders
 * with its raw ID, no name, and the toggle falls back to ID only.
 *
 * The `auth` entity_type is a special case: entity_id there is the
 * acting user's id, so the name is sourced from app_user just like
 * app_user itself.
 */
const ENTITY_NAME_MAP: Record<string, { table: string; nameColumn: string }> = {
  project: { table: 'project', nameColumn: 'name' },
  assessment: { table: 'assessment', nameColumn: 'title' },
  evidence: { table: 'evidence', nameColumn: 'name' },
  claim: { table: 'claim', nameColumn: 'name' },
  standard: { table: 'standard', nameColumn: 'name' },
  entity: { table: 'entity', nameColumn: 'name' },
  app_user: { table: 'app_user', nameColumn: 'display_name' },
  auth: { table: 'app_user', nameColumn: 'display_name' },
  api_key: { table: 'api_key', nameColumn: 'name' },
  attestation: { table: 'attestation', nameColumn: 'summary' },
  mitigation: { table: 'mitigation', nameColumn: 'title' },
};

interface AuditRowWithNames {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: Date;
  user_display_name: string | null;
  entity_name: string | null;
}

/**
 * Given a batch of raw audit rows, look up the display name for each
 * (entity_type, entity_id) and (user_id) pair and merge them onto the
 * rows. We do at most one query per entity_type plus one for users, so
 * the per-page cost is O(#distinct entity types) regardless of page
 * size. Missing rows surface as `null` on the enriched fields and the
 * UI falls back to showing the ID.
 */
export async function enrichWithNames(
  // biome-ignore lint/suspicious/noExplicitAny: Kysely's selectAll rows are the DB shape; we re-type at the boundary
  rows: any[],
): Promise<AuditRowWithNames[]> {
  if (rows.length === 0) return [];

  const db = getDatabase();

  const userIds = Array.from(
    new Set(rows.map(r => r.user_id).filter((id: unknown): id is string => typeof id === 'string')),
  );
  const userNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await db
      .selectFrom('app_user')
      .select(['id', 'display_name'])
      .where('id', 'in', userIds)
      .execute();
    for (const u of users) {
      userNameById.set(u.id, u.display_name);
    }
  }

  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entity_id) continue;
    const mapping = ENTITY_NAME_MAP[r.entity_type];
    if (!mapping) continue;
    let set = byType.get(r.entity_type);
    if (!set) {
      set = new Set<string>();
      byType.set(r.entity_type, set);
    }
    set.add(r.entity_id);
  }

  const entityNameByKey = new Map<string, string>();
  await Promise.all(
    Array.from(byType.entries()).map(async ([entityType, ids]) => {
      const mapping = ENTITY_NAME_MAP[entityType];
      if (!mapping) return;
      const idList = Array.from(ids);
      if (idList.length === 0) return;
      // biome-ignore lint/suspicious/noExplicitAny: dynamic table/column via Kysely is intentional
      const results = await (db as any)
        .selectFrom(mapping.table)
        .select(['id', mapping.nameColumn])
        .where('id', 'in', idList)
        .execute();
      for (const row of results) {
        const name = row[mapping.nameColumn];
        entityNameByKey.set(`${entityType}:${row.id}`, typeof name === 'string' ? name : '');
      }
    }),
  );

  return rows.map(r => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    action: r.action,
    user_id: r.user_id,
    changes: r.changes,
    created_at: r.created_at,
    user_display_name: r.user_id ? (userNameById.get(r.user_id) ?? null) : null,
    entity_name: r.entity_id ? (entityNameByKey.get(`${r.entity_type}:${r.entity_id}`) ?? null) : null,
  }));
}

router.get('/', requireSession, requirePermission('admin.audit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const { limit, offset } = validatePagination(req.query);
  const entityType = queryString(req.query.entityType);
  const entityId = queryString(req.query.entityId);
  const userId = queryString(req.query.userId);
  const action = queryString(req.query.action);
  // Date range bounds. Parsed server side so the time zone conversion
  // happens in one place; invalid inputs are ignored rather than
  // rejected so a typo in the URL does not 400 the whole page.
  const fromRaw = queryString(req.query.from);
  const toRaw = queryString(req.query.to);
  const fromDate = fromRaw ? new Date(fromRaw) : undefined;
  const toDate = toRaw ? new Date(toRaw) : undefined;
  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined;

  // Build the filter predicates once and apply them to both the count
  // and the data query so pagination never overruns the real result
  // set. Previously the count was unfiltered, which made client side
  // pagination drive past the filtered rows and show empty pages.
  let dataQuery = db.selectFrom('audit_log').selectAll();
  let countQuery = db
    .selectFrom('audit_log')
    .select(db.fn.count<number>('id').as('count'));

  if (entityType) {
    dataQuery = dataQuery.where('entity_type', '=', entityType);
    countQuery = countQuery.where('entity_type', '=', entityType);
  }

  if (entityId) {
    dataQuery = dataQuery.where('entity_id', '=', entityId);
    countQuery = countQuery.where('entity_id', '=', entityId);
  }

  if (userId) {
    dataQuery = dataQuery.where('user_id', '=', userId);
    countQuery = countQuery.where('user_id', '=', userId);
  }

  if (action) {
    // biome-ignore lint/suspicious/noExplicitAny: action is a runtime string that matches union type
    dataQuery = dataQuery.where('action', '=', action as any);
    // biome-ignore lint/suspicious/noExplicitAny: action is a runtime string that matches union type
    countQuery = countQuery.where('action', '=', action as any);
  }

  if (validFrom) {
    dataQuery = dataQuery.where('created_at', '>=', validFrom);
    countQuery = countQuery.where('created_at', '>=', validFrom);
  }

  if (validTo) {
    dataQuery = dataQuery.where('created_at', '<=', validTo);
    countQuery = countQuery.where('created_at', '<=', validTo);
  }

  const total = await countQuery
    .executeTakeFirstOrThrow()
    .then(r => r.count);

  const logs = await dataQuery
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const enriched = await enrichWithNames(logs);

  res.json({
    data: enriched,
    pagination: {
      limit,
      offset,
      total,
    },
  });
}));

/**
 * Returns the filter options that populate the typeahead controls in
 * the Admin Audit view. Entity types are the distinct values currently
 * present in the log so users do not see options that would produce
 * zero results. Actions come from the closed union in utils/audit.ts
 * (so even an action no one has triggered yet remains discoverable).
 */
router.get(
  '/options',
  requireSession,
  requirePermission('admin.audit'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const rows = await db
      .selectFrom('audit_log')
      .select('entity_type')
      .distinct()
      .orderBy('entity_type')
      .execute();

    res.json({
      entityTypes: rows.map(r => r.entity_type),
      actions: [...ALL_AUDIT_ACTIONS],
    });
  }),
);

router.get(
  '/entity/:entityType/:entityId',
  requireSession,
  requirePermission('admin.audit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const { limit, offset } = validatePagination(req.query);

    const total = await db
      .selectFrom('audit_log')
      .select(db.fn.count<number>('id').as('count'))
      .where('entity_type', '=', req.params.entityType)
      .where('entity_id', '=', req.params.entityId)
      .executeTakeFirstOrThrow()
      .then(r => r.count);

    const logs = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_type', '=', req.params.entityType)
      .where('entity_id', '=', req.params.entityId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const enriched = await enrichWithNames(logs);

    res.json({
      data: enriched,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  })
);

export default router;
