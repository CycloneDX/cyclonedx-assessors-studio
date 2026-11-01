import { Router } from 'express';
import { queryString } from '../utils/query.js';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();

// Tag names are normalized to lowercase before any persistence. The database
// enforces this at the column level with CHECK(name = LOWER(name)), but we
// normalize here so the value we write, the value we return, and any duplicate
// check all see the same canonical form. The backend is the single source of
// truth for normalization; the UI can mirror it for the preview, but must not
// be relied on for correctness.
const createTagSchema = z.object({
  name: z.string().min(1, 'Tag name is required').max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a valid hex color').default('#6366f1'),
});

const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase();
}

// List all tags with usage counts across all junction tables
router.get('/', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const tags = await db.selectFrom('tag').selectAll().orderBy('name', 'asc').execute();
  if (tags.length === 0) {
    res.json({ data: [] });
    return;
  }

  const tagIds = tags.map(t => t.id);
  // Each junction is counted through an inner join to its parent. The parent
  // names (assessment, evidence, entity) are soft-delete views, so tags on a
  // soft-deleted parent are excluded from the usage count automatically; a
  // trashed assessment no longer inflates its tags' counts. project is not
  // soft-deletable, so the join there is a plain existence check.
  const junctions = [
    { table: 'assessment_tag', col: 'assessment_id', parent: 'assessment' },
    { table: 'evidence_tag', col: 'evidence_id', parent: 'evidence' },
    { table: 'project_tag', col: 'project_id', parent: 'project' },
    { table: 'entity_tag', col: 'entity_id', parent: 'entity' },
  ] as const;

  const usageMap = new Map<string, number>(tagIds.map(id => [id, 0]));
  for (const { table, col, parent } of junctions) {
    const rows = await (db
      // biome-ignore lint/suspicious/noExplicitAny: dynamic junction table
      .selectFrom(table as any) as any)
      .innerJoin(parent, `${parent}.id`, `${table}.${col}`)
      .where(`${table}.tag_id`, 'in', tagIds)
      .select([`${table}.tag_id as tag_id`, db.fn.count<number>(`${table}.tag_id`).as('cnt')])
      .groupBy(`${table}.tag_id`)
      .execute() as { tag_id: string; cnt: number }[];
    for (const row of rows) {
      usageMap.set(row.tag_id, (usageMap.get(row.tag_id) ?? 0) + Number(row.cnt));
    }
  }

  const enriched = tags.map(t => ({ ...t, usageCount: usageMap.get(t.id) ?? 0 }));
  res.json({ data: enriched });
}));

// Tag autocomplete
router.get('/autocomplete', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const query = ((queryString(req.query.q) ?? '')) || '';
  const db = getDatabase();

  const tags = await db
    .selectFrom('tag')
    .where('name', 'ilike', `%${query}%`)
    .selectAll()
    .orderBy('name', 'asc')
    .limit(10)
    .execute();

  res.json({ data: tags });
}));

// Create tag
router.post(
  '/',
  requireAuth,
  requirePermission('admin.tags'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createTagSchema.parse(req.body);
      const name = normalizeTagName(data.name);
      if (name.length < 1) {
        res.status(400).json({ error: 'Tag name is required' });
        return;
      }
      const db = getDatabase();
      const tagId = uuidv4();

      try {
        await db
          .insertInto('tag')
          .values({ id: tagId, name, color: data.color, created_at: new Date() })
          .execute();
      } catch (insertError: unknown) {
        const err = insertError as Record<string, unknown> | null;
        const msg = (err?.message as string | undefined)?.toLowerCase();
        if (msg?.includes('duplicate') || msg?.includes('unique')) {
          res.status(409).json({ error: 'A tag with this name already exists' });
          return;
        }
        throw insertError;
      }

      logger.info('Tag created', { tagId, name, requestId: req.requestId });
      res.status(201).json({ id: tagId, name, color: data.color });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

// Update tag
router.put(
  '/:id',
  requireAuth,
  requirePermission('admin.tags'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateTagSchema.parse(req.body);
      const db = getDatabase();

      const tag = await db.selectFrom('tag').where('id', '=', req.params.id).selectAll().executeTakeFirst();
      if (!tag) {
        res.status(404).json({ error: 'Tag not found' });
        return;
      }

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) {
        const name = normalizeTagName(data.name);
        if (name.length < 1) {
          res.status(400).json({ error: 'Tag name is required' });
          return;
        }
        updateData.name = name;
      }
      if (data.color !== undefined) updateData.color = data.color;

      if (Object.keys(updateData).length > 0) {
        try {
          await db.updateTable('tag').set(updateData).where('id', '=', req.params.id).execute();
        } catch (updateError: unknown) {
          const err = updateError as Record<string, unknown> | null;
          const msg = (err?.message as string | undefined)?.toLowerCase();
          if (msg?.includes('duplicate') || msg?.includes('unique')) {
            res.status(409).json({ error: 'A tag with this name already exists' });
            return;
          }
          throw updateError;
        }
      }

      // Fetch and return the updated tag
      const updatedTag = await db.selectFrom('tag').where('id', '=', req.params.id).selectAll().executeTakeFirst();

      res.json(updatedTag);
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

// Delete tag
router.delete(
  '/:id',
  requireAuth,
  requirePermission('admin.tags'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const tag = await db.selectFrom('tag').where('id', '=', req.params.id).selectAll().executeTakeFirst();

    // Idempotent: return 204 whether resource exists or not
    if (!tag) {
      res.status(204).send();
      return;
    }

    await db.deleteFrom('tag').where('id', '=', req.params.id).execute();
    logger.info('Tag deleted', { tagId: req.params.id, requestId: req.requestId });
    res.status(204).send();
  })
);

export default router;
