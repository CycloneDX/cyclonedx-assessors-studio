import { Router } from 'express';
import { queryString, likeContains } from '../utils/query.js';
import { readableAssessmentIds, inList } from '../utils/access.js';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import busboy from 'busboy';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { AuthRequest, requireAuth, requirePermission } from '../middleware/auth.js';
import { syncEntityTags, fetchTagsForEntities } from '../utils/tags.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { validatePagination } from '../utils/pagination.js';
import { asyncHandler, handleValidationError, parseBody } from '../utils/route-helpers.js';

const router = Router();

const geoFields = {
  country: z.string().max(100).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  locality: z.string().max(100).nullable().optional(),
  timezone: z.string().max(60).nullable().optional(),
};

const createEntitySchema = z.object({
  name: z.string().min(1, 'Entity name is required'),
  description: z.string().nullable().optional(),
  entityType: z.enum(['organization', 'business_unit', 'team', 'product', 'product_version', 'component', 'service', 'project']),
  tags: z.array(z.string()).optional(),
  ...geoFields,
});

const updateEntitySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  state: z.enum(['active', 'inactive', 'archived']).optional(),
  tags: z.array(z.string()).optional(),
  ...geoFields,
});

const createRelationshipSchema = z.object({
  targetEntityId: z.string().uuid('Invalid entity ID'),
  relationshipType: z.enum(['owns', 'supplies', 'depends_on', 'governs', 'contains', 'consumes', 'assesses', 'produces']),
});

const createPolicySchema = z.object({
  standardId: z.string().uuid('Invalid standard ID'),
  description: z.string().optional(),
});

// GET / - List entities (filter by entity_type, state, search)
router.get('/', requireAuth, requirePermission('entities.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { limit, offset } = validatePagination(req.query);
    const entity_type = queryString(req.query.entity_type);
    const state = queryString(req.query.state);
    const search = queryString(req.query.search);

    let query = db.selectFrom('entity').selectAll();

    if (entity_type) {
      query = query.where('entity_type', '=', entity_type as 'organization' | 'business_unit' | 'team' | 'product' | 'product_version' | 'component' | 'service' | 'project');
    }

    if (state) {
      query = query.where('state', '=', state as 'active' | 'inactive' | 'archived');
    } else {
      // By default, exclude archived entities unless explicitly requested
      query = query.where('state', '!=', 'archived');
    }

    if (search) {
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', likeContains(search)),
          eb('description', 'ilike', likeContains(search)),
        ])
      );
    }

    let countQuery = db.selectFrom('entity').select(db.fn.count<number>('id').as('count'));
    if (entity_type) {
      countQuery = countQuery.where('entity_type', '=', entity_type as 'organization' | 'business_unit' | 'team' | 'product' | 'product_version' | 'component' | 'service' | 'project');
    }
    if (state) {
      countQuery = countQuery.where('state', '=', state as 'active' | 'inactive' | 'archived');
    } else {
      countQuery = countQuery.where('state', '!=', 'archived');
    }
    if (search) {
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('name', 'ilike', likeContains(search)),
          eb('description', 'ilike', likeContains(search)),
        ])
      );
    }
    const total = await countQuery.executeTakeFirstOrThrow().then(r => r.count);

    // Order newest first so admins see freshly created entities at
    // the top. Secondary sort on id guarantees stable ordering for
    // rows that share a created_at timestamp (created in the same
    // millisecond by a batch import).
    const entities = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const entityIds = entities.map((e) => e.id);
    const tagsByEntity = await fetchTagsForEntities(db, 'entity_tag', 'entity_id', entityIds);

    // Fetch parent names via 'contains' relationships (source contains target)
    const parentRows = entityIds.length
      ? await db
          .selectFrom('entity_relationship as er')
          .innerJoin('entity as parent', 'parent.id', 'er.source_entity_id')
          .where('er.target_entity_id', 'in', entityIds)
          .where('er.relationship_type', '=', 'contains')
          .select(['er.target_entity_id as child_id', 'parent.name as parent_name'])
          .execute()
      : [];
    const parentByEntity: Record<string, string> = {};
    for (const r of parentRows) parentByEntity[r.child_id] = r.parent_name;

    // Fetch standards count per entity
    const standardRows = entityIds.length
      ? await db
          .selectFrom('entity_standard as es')
          .innerJoin('standard as s', 's.id', 'es.standard_id')
          .where('es.entity_id', 'in', entityIds)
          .select(['es.entity_id', 's.id as standard_id', 's.name as standard_name', 's.version as standard_version'])
          .execute()
      : [];
    const standardsByEntity: Record<string, Array<{ id: string; name: string; version: string | null }>> = {};
    for (const r of standardRows) {
      if (!standardsByEntity[r.entity_id]) standardsByEntity[r.entity_id] = [];
      standardsByEntity[r.entity_id].push({ id: r.standard_id, name: r.standard_name, version: r.standard_version ?? null });
    }

    const entitiesWithTags = entities.map((e) => ({
      ...e,
      tags: tagsByEntity[e.id] || [],
      parentName: parentByEntity[e.id] || null,
      standards: standardsByEntity[e.id] || [],
      assessmentCount: 0,
    }));

    res.json({
      data: entitiesWithTags,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    logger.error('Get entities error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// GET /relationship-graph - Get the global relationship graph for all entities
router.get('/relationship-graph', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const perspective = queryString(req.query.perspective); // 'producer' | 'consumer' | undefined

    // Fetch all non-archived entities
    const entities = await db
      .selectFrom('entity')
      .where('state', '!=', 'archived')
      .select(['id', 'name', 'entity_type'])
      .execute();

    // Fetch all relationships. Both endpoints must be non-archived;
    // archived entities are hidden from the graph above, so showing
    // edges that point into the void would just produce dangling
    // nodes in the visualisation.
    let relQuery = db
      .selectFrom('entity_relationship')
      .innerJoin('entity as source', 'source.id', 'entity_relationship.source_entity_id')
      .innerJoin('entity as target', 'target.id', 'entity_relationship.target_entity_id')
      .where('source.state', '!=', 'archived')
      .where('target.state', '!=', 'archived')
      .select([
        'entity_relationship.id as id',
        'entity_relationship.source_entity_id as source_entity_id',
        'entity_relationship.target_entity_id as target_entity_id',
        'entity_relationship.relationship_type as relationship_type',
        'source.name as source_name',
        'target.name as target_name',
      ]);

    const relationships = await relQuery.execute() as Record<string, unknown>[];

    // Categorize relationships by type
    const producerRelTypes = new Set(['owns', 'contains', 'governs']);
    const consumerRelTypes = new Set(['supplies', 'depends_on', 'consumes']);

    // Build entity ID sets based on perspective filter
    let filteredEntityIds: Set<string> | null = null;
    let filteredRelationships = relationships;

    if (perspective === 'producer') {
      // Producer: entities connected by organizational/structural relationships
      filteredRelationships = relationships.filter((r) => producerRelTypes.has((r as Record<string, unknown>).relationship_type as string));
      filteredEntityIds = new Set<string>();
      for (const rel of filteredRelationships) {
        const relationship = rel;
        filteredEntityIds.add(relationship.source_entity_id as string);
        filteredEntityIds.add(relationship.target_entity_id as string);
      }
    } else if (perspective === 'consumer') {
      // Consumer: entities connected by supply chain relationships
      filteredRelationships = relationships.filter((r) => consumerRelTypes.has((r as Record<string, unknown>).relationship_type as string));
      filteredEntityIds = new Set<string>();
      for (const rel of filteredRelationships) {
        const relationship = rel;
        filteredEntityIds.add(relationship.source_entity_id as string);
        filteredEntityIds.add(relationship.target_entity_id as string);
      }
    }

    const filteredEntities = filteredEntityIds
      ? entities.filter((e) => filteredEntityIds!.has(e.id))
      : entities;

    const filteredEntityIdSet = new Set(filteredEntities.map((e) => e.id));
    const filteredEdges = filteredRelationships
      .filter((r) => {
        const relationship = r as Record<string, unknown>;
        return filteredEntityIdSet.has(relationship.source_entity_id as string) && filteredEntityIdSet.has(relationship.target_entity_id as string);
      })
      .map((r) => {
        const relationship = r as Record<string, unknown>;
        return {
          id: relationship.id as string,
          sourceEntityId: relationship.source_entity_id as string,
          sourceName: relationship.source_name as string,
          targetEntityId: relationship.target_entity_id as string,
          targetName: relationship.target_name as string,
          relationshipType: relationship.relationship_type as string,
        };
      });

    res.json({
      entities: filteredEntities.map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entity_type,
      })),
      edges: filteredEdges,
    });
  } catch (error) {
    logger.error('Get global relationship graph error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Types used only in the import handler ────────────────────────────────────
interface ImportRow {
  name: string;
  parentName?: string | null;
  description?: string | null;
  entityType?: string | null;
  country?: string | null;
  region?: string | null;
  locality?: string | null;
  timezone?: string | null;
  state?: string | null;
}

const VALID_ENTITY_TYPES = new Set([
  'organization','business_unit','team','product','product_version','component','service','project',
]);
const VALID_STATES = new Set(['active','inactive','archived']);

function parseCSV(text: string): ImportRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  // Normalise headers: lowercase, trim, replace spaces/hyphens with underscores
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const rows: ImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV split — handles quoted fields with commas inside
    const values: string[] = [];
    let cur = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { if (values[idx] !== undefined) obj[h] = values[idx]; });
    // Accept either entity_name / name, parent_name / parent_id (name-based)
    const name = obj.entity_name || obj.name;
    if (!name) continue;
    rows.push({
      name,
      parentName: obj.parent_name || obj.parent_entity_name || null,
      description: obj.description || null,
      entityType: obj.entity_type || obj.entitytype || null,
      country: obj.country || null,
      region: obj.region || null,
      locality: obj.locality || obj.city || null,
      timezone: obj.timezone || null,
      state: obj.state || null,
    });
  }
  return rows;
}

function parseJSON(text: string): ImportRow[] {
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed) ? parsed : parsed.entities ?? parsed.data ?? [];
  return arr.map((item: Record<string, unknown>) => ({
    name: String(item.name || item.entity_name || '').trim(),
    parentName: String(item.parentName || item.parent_name || item.parent_entity_name || '').trim() || null,
    description: item.description ? String(item.description) : null,
    entityType: item.entityType ? String(item.entityType) : (item.entity_type ? String(item.entity_type) : null),
    country: item.country ? String(item.country) : null,
    region: item.region ? String(item.region) : null,
    locality: item.locality ?? item.city ? String(item.locality ?? item.city) : null,
    timezone: item.timezone ? String(item.timezone) : null,
    state: item.state ? String(item.state) : null,
  })).filter((r: ImportRow) => r.name);
}

// POST /import - Bulk upsert entities from CSV or JSON (admin only)
router.post('/import', requireAuth, requirePermission('entities.create'), async (req: AuthRequest, res: Response): Promise<void> => {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) {
    res.status(400).json({ error: 'Request must be multipart/form-data' });
    return;
  }

  // One file, 5 MB. Respond exactly once: busboy emits 'close' after
  // 'error', and a second response from an event callback would crash
  // the process.
  const bb = busboy({ headers: req.headers, limits: { fileSize: 5 * 1024 * 1024, files: 1, parts: 5, fields: 4 } });
  const chunks: Buffer[] = [];
  let filename = '';
  let fileDone = false;
  let tooLarge = false;
  let tooMany = false;
  let responded = false;
  const respond = (status: number, body: Record<string, unknown>): void => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(body);
  };

  bb.on('file', (_field, file, info) => {
    filename = info.filename;
    file.on('data', (chunk: Buffer) => chunks.push(chunk));
    file.on('limit', () => { tooLarge = true; });
    file.on('end', () => { fileDone = true; });
    file.on('error', (err) => { logger.error('Entity import file stream error', { err }); });
  });
  bb.on('filesLimit', () => { tooMany = true; });
  bb.on('partsLimit', () => { tooMany = true; });
  bb.on('fieldsLimit', () => { tooMany = true; });

  bb.on('close', () => {
    if (responded) return;
    void importEntities().catch((err) => {
      logger.error('Entity import failed', { err, userId: req.user?.id });
      respond(500, { error: 'Import failed' });
    });
  });

  const importEntities = async (): Promise<void> => {
    if (tooLarge) {
      respond(413, { error: 'File exceeds maximum size of 5 MB' });
      return;
    }
    if (tooMany) {
      respond(413, { error: 'Upload exactly one file' });
      return;
    }
    if (!fileDone || chunks.length === 0) {
      respond(400, { error: 'No file received' });
      return;
    }

    const text = Buffer.concat(chunks).toString('utf8');
    let rows: ImportRow[];
    try {
      if (filename.endsWith('.json')) {
        rows = parseJSON(text);
      } else {
        rows = parseCSV(text);
      }
    } catch (e) {
      logger.warn('Entity import parse error', { error: (e as Error).message, userId: req.user?.id });
      respond(400, { error: 'Failed to parse file: expected CSV or a JSON array of entities' });
      return;
    }

    if (rows.length === 0) {
      respond(400, { error: 'No valid rows found in file' });
      return;
    }

    const db = getDatabase();

    // Fetch all existing entities by name for upsert logic
    const existingEntities = await db.selectFrom('entity').select(['id', 'name']).execute();
    const nameToId = new Map<string, string>(existingEntities.map(e => [e.name.toLowerCase(), e.id]));

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];
    const localNameToId = new Map<string, string>(nameToId); // grows as we insert

    for (const row of rows) {
      try {
        const entityType = VALID_ENTITY_TYPES.has(row.entityType ?? '') ? row.entityType! : 'team';
        const state = VALID_STATES.has(row.state ?? '') ? row.state! : 'active';

        const existingId = localNameToId.get(row.name.toLowerCase());
        let entityId: string;

        if (existingId) {
          // Update existing
          const updateData: Record<string, unknown> = { updated_at: new Date() };
          if (row.description !== null) updateData.description = row.description;
          if (row.country !== null) updateData.country = row.country;
          if (row.region !== null) updateData.region = row.region;
          if (row.locality !== null) updateData.locality = row.locality;
          if (row.timezone !== null) updateData.timezone = row.timezone;
          await db.updateTable('entity').set(updateData).where('id', '=', existingId).execute();
          entityId = existingId;
          updated++;
        } else {
          // Insert new
          entityId = uuidv4();
          const bomRef = `${entityType}-${entityId.substring(0, 8)}`;
          await db.insertInto('entity').values({
            id: entityId, name: row.name,
            description: row.description ?? null,
            entity_type: entityType as 'organization' | 'business_unit' | 'team' | 'product' | 'product_version' | 'component' | 'service' | 'project',
            state: state as 'active' | 'inactive' | 'archived',
            bom_ref: bomRef,
            country: row.country ?? null,
            region: row.region ?? null,
            locality: row.locality ?? null,
            timezone: row.timezone ?? null,
          }).execute();
          localNameToId.set(row.name.toLowerCase(), entityId);
          inserted++;
        }

        // Wire parent → child 'contains' relationship
        if (row.parentName) {
          const parentId = localNameToId.get(row.parentName.toLowerCase());
          if (parentId) {
            const existing = await db
              .selectFrom('entity_relationship')
              .where('source_entity_id', '=', parentId)
              .where('target_entity_id', '=', entityId)
              .where('relationship_type', '=', 'contains')
              .select('id')
              .executeTakeFirst();
            if (!existing) {
              await db.insertInto('entity_relationship').values({
                id: uuidv4(),
                source_entity_id: parentId,
                target_entity_id: entityId,
                relationship_type: 'contains',
                created_at: new Date(),
                updated_at: new Date(),
              }).execute();
            }
          } else {
            errors.push(`"${row.name}": parent "${row.parentName}" not found — relationship skipped`);
          }
        }
      } catch (e) {
        // Database errors carry constraint and column names; keep them in the log.
        logger.warn('Entity import row failed', { row: row.name, error: (e as Error).message, userId: req.user?.id });
        errors.push(`"${row.name}": could not be saved`);
      }
    }

    logger.info('Entity import complete', { inserted, updated, errors: errors.length, userId: req.user?.id });
    respond(200, { inserted, updated, total: rows.length, errors });
  };

  bb.on('error', (err) => {
    logger.error('Entity import busboy error', { err });
    respond(400, { error: 'Error processing upload' });
  });

  req.pipe(bb);
});

// GET /:id - Get entity with relationships, standards, tags, compliance policies
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // Get entity relationships (parent entities). Archived parents are
    // suppressed so a soft-deleted entity does not appear to participate
    // in the hierarchy of live entities.
    const parentRelationships = (await db
      .selectFrom('entity_relationship')
      .innerJoin('entity', 'entity.id', 'entity_relationship.source_entity_id')
      .where('entity_relationship.target_entity_id', '=', req.params.id)
      .where('entity.state', '!=', 'archived')
      .select([
        'entity_relationship.id as id',
        'entity_relationship.source_entity_id as source_entity_id',
        'entity_relationship.target_entity_id as target_entity_id',
        'entity_relationship.relationship_type as relationship_type',
        'entity.name as source_name',
      ])
      .execute()) as Record<string, unknown>[];

    // Get child entities. Same archived filter applies to children.
    const childRelationships = (await db
      .selectFrom('entity_relationship')
      .innerJoin('entity', 'entity.id', 'entity_relationship.target_entity_id')
      .where('entity_relationship.source_entity_id', '=', req.params.id as string)
      .where('entity.state', '!=', 'archived')
      .select([
        'entity_relationship.id as id',
        'entity_relationship.source_entity_id as source_entity_id',
        'entity_relationship.target_entity_id as target_entity_id',
        'entity_relationship.relationship_type as relationship_type',
        'entity.name as target_name',
      ])
      .execute()) as Record<string, unknown>[];

    // Get associated standards
    const standards = (await db
      .selectFrom('entity_standard')
      .innerJoin('standard', 'standard.id', 'entity_standard.standard_id')
      .where('entity_standard.entity_id', '=', req.params.id as string)
      .select([
        'standard.id as id',
        'standard.name as name',
        'standard.version as version',
      ])
      .execute()) as Record<string, unknown>[];

    const tagsByEntity = await fetchTagsForEntities(db, 'entity_tag', 'entity_id', [req.params.id as string]);

    // Get compliance policies
    const policies = (await db
      .selectFrom('compliance_policy')
      .innerJoin('standard', 'standard.id', 'compliance_policy.standard_id')
      .where('compliance_policy.entity_id', '=', req.params.id as string)
      .select([
        'compliance_policy.id as id',
        'compliance_policy.standard_id as standard_id',
        'compliance_policy.description as description',
        'compliance_policy.is_inherited as is_inherited',
        'standard.name as standard_name',
        'standard.version as standard_version',
        'standard.description as standard_description',
      ])
      .execute()) as Record<string, unknown>[];

    res.json({
      entity,
      parents: parentRelationships,
      children: childRelationships,
      standards,
      tags: tagsByEntity[req.params.id as string] || [],
      policies,
    });
  } catch (error) {
    logger.error('Get entity error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / - Create entity (admin only)
router.post(
  '/',
  requireAuth,
  requirePermission('entities.create'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createEntitySchema.parse(req.body);
      const db = getDatabase();
      const entityId = uuidv4();

      const bomRef = `${data.entityType}-${entityId.substring(0, 8)}`;

      await db
        .insertInto('entity')
        .values(toSnakeCase({
          id: entityId,
          name: data.name,
          description: data.description,
          entityType: data.entityType,
          state: 'active',
          bomRef,
          country: data.country ?? null,
          region: data.region ?? null,
          locality: data.locality ?? null,
          timezone: data.timezone ?? null,
        }))
        .execute();

      if (data.tags && data.tags.length > 0) {
        await syncEntityTags(db, 'entity_tag', 'entity_id', entityId, data.tags);
      }

      logger.info('Entity created', {
        entityId,
        name: data.name,
        entityType: data.entityType,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: entityId,
        name: data.name,
        description: data.description,
        entityType: data.entityType,
        state: 'active',
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Create entity error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

// PUT /:id - Update entity (admin only)
router.put(
  '/:id',
  requireAuth,
  requirePermission('entities.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateEntitySchema.parse(req.body);
      const db = getDatabase();

      const entity = await db
        .selectFrom('entity')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.state !== undefined) updateData.state = data.state;
      if (data.country !== undefined) updateData.country = data.country;
      if (data.region !== undefined) updateData.region = data.region;
      if (data.locality !== undefined) updateData.locality = data.locality;
      if (data.timezone !== undefined) updateData.timezone = data.timezone;

      if (Object.keys(updateData).length > 0) {
        await db
          .updateTable('entity')
          .set(updateData)
          .where('id', '=', req.params.id)
          .execute();
      }

      // Sync tags whenever the request body carries the field (even
      // when empty — an empty array intentionally clears the set).
      // syncEntityTags handles the delete + insert as one transaction
      // and is the same helper POST /entities calls on create.
      if (data.tags !== undefined) {
        await syncEntityTags(db, 'entity_tag', 'entity_id', req.params.id as string, data.tags);
      }

      logger.info('Entity updated', {
        entityId: req.params.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated entity
      const updatedEntity = await db
        .selectFrom('entity')
        .where('id', '=', req.params.id)
        .selectAll()
        .executeTakeFirst();

      res.json(updatedEntity);
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Update entity error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

// DELETE /:id - Soft delete (set state to 'archived')
router.delete(
  '/:id',
  requireAuth,
  requirePermission('entities.delete'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    await db
      .updateTable('entity')
      .set({ state: 'archived' })
      .where('id', '=', req.params.id as string)
      .execute();

    logger.info('Entity deleted', {
      entityId: req.params.id as string,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

// GET /:id/children - Get child entities
router.get('/:id/children', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    const children = (await db
      .selectFrom('entity_relationship')
      .innerJoin('entity', 'entity.id', 'entity_relationship.target_entity_id')
      .where('entity_relationship.source_entity_id', '=', req.params.id as string)
      .select([
        'entity.id as id',
        'entity.name as name',
        'entity.entity_type as entity_type',
        'entity.state as state',
        'entity_relationship.relationship_type as relationship_type',
      ])
      .execute()) as Record<string, unknown>[];

    res.json({ data: children });
  } catch (error) {
    logger.error('Get entity children error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/assessments - Get assessments for this entity
router.get('/:id/assessments', requireAuth, requirePermission('assessments.view'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // Only assessments the caller may read (security review Z4).
    const readable = await readableAssessmentIds(db, req.user!);
    const assessments = (await db
      .selectFrom('assessment')
      .where('entity_id', '=', req.params.id as string)
      .$if(readable !== null, (qb) => qb.where('id', 'in', inList(readable as string[])))
      .select([
        'id',
        'title',
        'description',
        'state',
        'standard_id',
        'conformance_score',
        'start_date',
        'end_date',
        'created_at',
      ])
      .execute()) as Record<string, unknown>[];

    res.json({ data: assessments });
  } catch (error) {
    logger.error('Get entity assessments error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /:id/history - Get assessment history
router.get('/:id/history', requireAuth, requirePermission('assessments.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // Get all assessments grouped by standard
    const readable = await readableAssessmentIds(db, req.user!);
    const assessments = (await db
      .selectFrom('assessment')
      .leftJoin('standard', 'standard.id', 'assessment.standard_id')
      .where('assessment.entity_id', '=', req.params.id)
      .$if(readable !== null, (qb) => qb.where('assessment.id', 'in', inList(readable as string[])))
      .select([
        'assessment.id as id',
        'assessment.title as title',
        'assessment.state as state',
        'assessment.conformance_score as conformance_score',
        'assessment.end_date as completed_at',
        'standard.name as standard_name',
        'standard.version as standard_version',
      ])
      .orderBy('assessment.created_at', 'desc')
      .execute()) as Record<string, unknown>[];

    // Group by standard
    const history: Record<string, Record<string, unknown>> = {};
    for (const assessment of assessments) {
      const assessmentRecord = assessment;
      const standardKey = (assessmentRecord.standard_name as string) || 'unknown';
      if (!history[standardKey]) {
        history[standardKey] = {
          standardName: assessmentRecord.standard_name,
          standardVersion: assessmentRecord.standard_version,
          assessments: [],
        };
      }
      (history[standardKey].assessments as Record<string, unknown>[]).push({
        id: assessmentRecord.id,
        title: assessmentRecord.title,
        state: assessmentRecord.state,
        completedAt: assessmentRecord.completed_at,
        conformanceScore: assessmentRecord.conformance_score,
      });
    }

    res.json({ data: Object.values(history) });
  } catch (error) {
    logger.error('Get entity history error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// GET /:id/relationship-graph - Get the full transitive relationship graph rooted at this entity
router.get('/:id/relationship-graph', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const rootId = req.params.id as string;
    const maxDepth = Math.min(parseInt((queryString(req.query.depth) ?? '')) || 5, 10);

    // Verify entity exists
    const rootEntity = await db
      .selectFrom('entity')
      .where('id', '=', rootId)
      .select(['id', 'name', 'entity_type'])
      .executeTakeFirst();

    if (!rootEntity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // BFS traversal to collect all reachable entities and their relationships
    const visitedEntities = new Set<string>([rootId]);
    const frontier = [rootId];
    const allEdges: Array<{
      id: string;
      sourceEntityId: string;
      sourceName: string;
      targetEntityId: string;
      targetName: string;
      relationshipType: string;
    }> = [];
    const entityMap = new Map<string, { id: string; name: string; entityType: string }>();
    entityMap.set(rootId, { id: rootEntity.id, name: rootEntity.name, entityType: rootEntity.entity_type });

    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
      const currentBatch = [...frontier];
      frontier.length = 0;

      // Fetch all outbound relationships from current frontier
      const outbound = (await db
        .selectFrom('entity_relationship')
        .innerJoin('entity as source', 'source.id', 'entity_relationship.source_entity_id')
        .innerJoin('entity as target', 'target.id', 'entity_relationship.target_entity_id')
        .where('entity_relationship.source_entity_id', 'in', currentBatch)
        .select([
          'entity_relationship.id as id',
          'entity_relationship.source_entity_id as source_entity_id',
          'entity_relationship.target_entity_id as target_entity_id',
          'entity_relationship.relationship_type as relationship_type',
          'source.name as source_name',
          'source.entity_type as source_entity_type',
          'target.name as target_name',
          'target.entity_type as target_entity_type',
        ])
        .execute()) as Record<string, unknown>[];

      // Fetch all inbound relationships to current frontier (only at depth 0 for parents)
      const inbound = depth === 0 ? (await db
        .selectFrom('entity_relationship')
        .innerJoin('entity as source', 'source.id', 'entity_relationship.source_entity_id')
        .innerJoin('entity as target', 'target.id', 'entity_relationship.target_entity_id')
        .where('entity_relationship.target_entity_id', 'in', currentBatch)
        .select([
          'entity_relationship.id as id',
          'entity_relationship.source_entity_id as source_entity_id',
          'entity_relationship.target_entity_id as target_entity_id',
          'entity_relationship.relationship_type as relationship_type',
          'source.name as source_name',
          'source.entity_type as source_entity_type',
          'target.name as target_name',
          'target.entity_type as target_entity_type',
        ])
        .execute()) as Record<string, unknown>[] : [];

      const allRels = [...outbound, ...inbound];
      for (const rel of allRels) {
        const relRecord = rel;
        const relId = relRecord.id as string;
        const sourceEntityId = relRecord.source_entity_id as string;
        const targetEntityId = relRecord.target_entity_id as string;
        // Deduplicate edges by id
        if (allEdges.some(e => e.id === relId)) continue;

        allEdges.push({
          id: relId,
          sourceEntityId: sourceEntityId,
          sourceName: relRecord.source_name as string,
          targetEntityId: targetEntityId,
          targetName: relRecord.target_name as string,
          relationshipType: relRecord.relationship_type as string,
        });

        // Track entities for the frontier
        if (!entityMap.has(sourceEntityId)) {
          entityMap.set(sourceEntityId, { id: sourceEntityId, name: relRecord.source_name as string, entityType: relRecord.source_entity_type as string });
        }
        if (!entityMap.has(targetEntityId)) {
          entityMap.set(targetEntityId, { id: targetEntityId, name: relRecord.target_name as string, entityType: relRecord.target_entity_type as string });
        }

        // Add newly discovered entities to the next frontier
        for (const neighborId of [sourceEntityId, targetEntityId]) {
          if (!visitedEntities.has(neighborId)) {
            visitedEntities.add(neighborId);
            frontier.push(neighborId);
          }
        }
      }

      depth++;
    }

    res.json({
      rootEntityId: rootId,
      entities: Array.from(entityMap.values()),
      edges: allEdges,
    });
  } catch (error) {
    logger.error('Get entity relationship graph error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/relationships - Add a relationship from this entity to another
router.post(
  '/:id/relationships',
  requireAuth,
  requirePermission('entities.edit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createRelationshipSchema.parse(req.body);
      const db = getDatabase();

      const sourceEntity = await db
        .selectFrom('entity')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!sourceEntity) {
        res.status(404).json({ error: 'Source entity not found' });
        return;
      }

      const targetEntity = await db
        .selectFrom('entity')
        .where('id', '=', data.targetEntityId)
        .selectAll()
        .executeTakeFirst();

      if (!targetEntity) {
        res.status(404).json({ error: 'Target entity not found' });
        return;
      }

      // Check for duplicate relationship
      const existing = await db
        .selectFrom('entity_relationship')
        .where('source_entity_id', '=', req.params.id as string)
        .where('target_entity_id', '=', data.targetEntityId)
        .where('relationship_type', '=', data.relationshipType)
        .selectAll()
        .executeTakeFirst();

      if (existing) {
        res.status(409).json({ error: `A "${data.relationshipType.replace(/_/g, ' ')}" relationship to "${targetEntity.name}" already exists` });
        return;
      }

      const relationshipId = uuidv4();

      await db
        .insertInto('entity_relationship')
        .values(toSnakeCase({
          id: relationshipId,
          sourceEntityId: req.params.id as string,
          targetEntityId: data.targetEntityId,
          relationshipType: data.relationshipType,
          createdAt: new Date(),
          updatedAt: new Date(),
        // biome-ignore lint/suspicious/noExplicitAny: toSnakeCase returns object incompatible with DB row type
        }) as any)
        .execute();

      logger.info('Entity relationship created', {
        relationshipId,
        sourceEntityId: req.params.id as string,
        targetEntityId: data.targetEntityId,
        relationshipType: data.relationshipType,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: relationshipId,
        sourceEntityId: req.params.id as string,
        targetEntityId: data.targetEntityId,
        relationshipType: data.relationshipType,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Create relationship error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /:id/relationships/:relId - Remove a relationship
router.delete(
  '/:id/relationships/:relId',
  requireAuth,
  requirePermission('entities.edit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();

      const relationship = await db
        .selectFrom('entity_relationship')
        .where('id', '=', req.params.relId)
        .where('source_entity_id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!relationship) {
        res.status(404).json({ error: 'Relationship not found' });
        return;
      }

      await db
        .deleteFrom('entity_relationship')
        .where('id', '=', req.params.relId)
        .execute();

      logger.info('Entity relationship deleted', {
        relationshipId: req.params.relId,
        entityId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Relationship deleted successfully' });
    } catch (error) {
      logger.error('Delete relationship error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Relationship types that confer policy inheritance from source -> target.
// Typed against the schema enum so Kysely's `.where('... in', ...)`
// accepts it without an unknown-string cast.
type InheritanceRelationship = 'owns' | 'contains' | 'governs';
const INHERITANCE_RELATIONSHIPS: ReadonlyArray<InheritanceRelationship> = [
  'owns',
  'contains',
  'governs',
];

// BFS through hierarchical parents to collect every ancestor of `entityId`.
// Cycle-safe via the `seen` set. Skips ancestors whose entity row is
// archived — soft-deleted parents must not contribute policies.
async function collectAncestorEntityIds(
  db: ReturnType<typeof getDatabase>,
  entityId: string,
): Promise<string[]> {
  const seen = new Set<string>([entityId]);
  const ancestors = new Set<string>();
  let frontier: string[] = [entityId];

  while (frontier.length > 0) {
    const rows = (await db
      .selectFrom('entity_relationship as er')
      .innerJoin('entity as parent', 'parent.id', 'er.source_entity_id')
      .where('er.target_entity_id', 'in', frontier)
      .where('er.relationship_type', 'in', INHERITANCE_RELATIONSHIPS as unknown as InheritanceRelationship[])
      .where('parent.state', '!=', 'archived')
      .select(['er.source_entity_id as parent_id'])
      .execute()) as Array<{ parent_id: string }>;

    const next: string[] = [];
    for (const row of rows) {
      if (seen.has(row.parent_id)) continue;
      seen.add(row.parent_id);
      ancestors.add(row.parent_id);
      next.push(row.parent_id);
    }
    frontier = next;
  }

  return [...ancestors];
}

// GET /:id/policies - Get compliance policies (direct + inherited from all ancestors).
// Inheritance walks the full hierarchy (parents, grandparents, ...) via
// the INHERITANCE_RELATIONSHIPS edges, with cycle protection and an
// archived-entity filter. `is_inherited` in the response reflects how
// the policy was reached on this request, not the stored column.
router.get('/:id/policies', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // Column list is duplicated rather than lifted to a variable so
    // Kysely can infer the join'd column types — a tuple bound to
    // `as const` widens to `readonly string[]` and `.select()`'s
    // overloads then reject it.
    const directPolicies = (await db
      .selectFrom('compliance_policy')
      .innerJoin('standard', 'standard.id', 'compliance_policy.standard_id')
      .where('compliance_policy.entity_id', '=', req.params.id as string)
      .select([
        'compliance_policy.id as id',
        'compliance_policy.standard_id as standard_id',
        'compliance_policy.entity_id as entity_id',
        'compliance_policy.description as description',
        'standard.name as standard_name',
        'standard.version as standard_version',
        'standard.description as standard_description',
      ])
      .execute()) as Record<string, unknown>[];

    const ancestorIds = await collectAncestorEntityIds(db, req.params.id as string);

    let inheritedPolicies: Record<string, unknown>[] = [];
    if (ancestorIds.length > 0) {
      inheritedPolicies = (await db
        .selectFrom('compliance_policy')
        .innerJoin('standard', 'standard.id', 'compliance_policy.standard_id')
        .where('compliance_policy.entity_id', 'in', ancestorIds)
        .select([
          'compliance_policy.id as id',
          'compliance_policy.standard_id as standard_id',
          'compliance_policy.entity_id as entity_id',
          'compliance_policy.description as description',
          'standard.name as standard_name',
          'standard.version as standard_version',
          'standard.description as standard_description',
        ])
        .execute()) as Record<string, unknown>[];
    }

    // Deduplicate when the same standard is policed both directly and by
    // an ancestor: direct wins.
    const directStandards = new Set(directPolicies.map(p => p.standard_id as string));
    const filteredInherited = inheritedPolicies.filter(
      p => !directStandards.has(p.standard_id as string),
    );

    const allPolicies = [
      ...directPolicies.map(p => ({ ...p, is_inherited: false })),
      ...filteredInherited.map(p => ({ ...p, is_inherited: true })),
    ];

    res.json({ data: allPolicies });
  } catch (error) {
    logger.error('Get policies error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// POST /:id/policies - Create a compliance policy
router.post(
  '/:id/policies',
  requireAuth,
  requirePermission('entities.edit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createPolicySchema.parse(req.body);
      const db = getDatabase();

      const entity = await db
        .selectFrom('entity')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      const standard = await db
        .selectFrom('standard')
        .where('id', '=', data.standardId)
        .selectAll()
        .executeTakeFirst();

      if (!standard) {
        res.status(404).json({ error: 'Standard not found' });
        return;
      }

      // App-side uniqueness check. UNIQUE(entity_id, standard_id) at
      // migrate.ts:917 covers us in the DB, but raising it from here
      // turns the failure into a clean 409 rather than a 500 leaked
      // from the driver.
      const existing = await db
        .selectFrom('compliance_policy')
        .where('entity_id', '=', req.params.id as string)
        .where('standard_id', '=', data.standardId)
        .select('id')
        .executeTakeFirst();

      if (existing) {
        res.status(409).json({
          error: 'A compliance policy for this standard already exists on this entity',
        });
        return;
      }

      const policyId = uuidv4();

      await db
        .insertInto('compliance_policy')
        .values(toSnakeCase({
          id: policyId,
          entityId: req.params.id as string,
          standardId: data.standardId,
          description: data.description,
          isInherited: false,
        }))
        .execute();

      logger.info('Compliance policy created', {
        policyId,
        entityId: req.params.id as string,
        standardId: data.standardId,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: policyId,
        entityId: req.params.id as string,
        standardId: data.standardId,
        description: data.description,
        isInherited: false,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Create compliance policy error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PUT /:id/policies/:policyId - Update a compliance policy
router.put(
  '/:id/policies/:policyId',
  requireAuth,
  requirePermission('entities.edit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();
      const body = parseBody(z.object({ description: z.string().max(20_000).nullable().optional(), standardId: z.string().uuid().optional() }), req.body, res);
      if (!body) return;
      const { description, standardId } = body;

      const policy = await db
        .selectFrom('compliance_policy')
        .where('id', '=', req.params.policyId)
        .where('entity_id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!policy) {
        res.status(404).json({ error: 'Compliance policy not found' });
        return;
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (description !== undefined) {
        updates.description = description || null;
      }

      if (standardId && standardId !== policy.standard_id) {
        // Verify the new standard exists
        const standard = await db
          .selectFrom('standard')
          .where('id', '=', standardId)
          .selectAll()
          .executeTakeFirst();

        if (!standard) {
          res.status(400).json({ error: 'Standard not found' });
          return;
        }

        // Check for duplicate: another policy on this entity already using that standard
        const duplicate = await db
          .selectFrom('compliance_policy')
          .where('entity_id', '=', req.params.id as string)
          .where('standard_id', '=', standardId)
          .where('id', '!=', req.params.policyId)
          .selectAll()
          .executeTakeFirst();

        if (duplicate) {
          res.status(409).json({ error: 'A policy for this standard already exists on this entity' });
          return;
        }

        updates.standard_id = standardId;
      }

      await db
        .updateTable('compliance_policy')
        .set(updates)
        .where('id', '=', req.params.policyId)
        .execute();

      // Return the updated policy with standard info
      const updated = await db
        .selectFrom('compliance_policy')
        .innerJoin('standard', 'standard.id', 'compliance_policy.standard_id')
        .where('compliance_policy.id', '=', req.params.policyId)
        .select([
          'compliance_policy.id as id',
          'compliance_policy.standard_id as standard_id',
          'compliance_policy.description as description',
          'compliance_policy.is_inherited as is_inherited',
          'standard.name as standard_name',
          'standard.version as standard_version',
          'standard.description as standard_description',
        ])
        .executeTakeFirst();

      logger.info('Compliance policy updated', {
        policyId: req.params.policyId,
        entityId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json(updated);
    } catch (error) {
      logger.error('Update compliance policy error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /:id/policies/:policyId - Remove a compliance policy
router.delete(
  '/:id/policies/:policyId',
  requireAuth,
  requirePermission('entities.edit'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();

      const policy = await db
        .selectFrom('compliance_policy')
        .where('id', '=', req.params.policyId)
        .where('entity_id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!policy) {
        res.status(404).json({ error: 'Compliance policy not found' });
        return;
      }

      await db
        .deleteFrom('compliance_policy')
        .where('id', '=', req.params.policyId)
        .execute();

      logger.info('Compliance policy deleted', {
        policyId: req.params.policyId,
        entityId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Compliance policy deleted successfully' });
    } catch (error) {
      logger.error('Delete compliance policy error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /:id/progress - Get progress tracking data
router.get('/:id/progress', requireAuth, requirePermission('assessments.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();

    const entity = await db
      .selectFrom('entity')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!entity) {
      res.status(404).json({ error: 'Entity not found' });
      return;
    }

    // Get completed assessments for this entity
    const readable = await readableAssessmentIds(db, req.user!);
    const assessments = (await db
      .selectFrom('assessment')
      .leftJoin('standard', 'standard.id', 'assessment.standard_id')
      .where('assessment.entity_id', '=', req.params.id as string)
      .where('assessment.state', '=', 'complete')
      .$if(readable !== null, (qb) => qb.where('assessment.id', 'in', inList(readable as string[])))
      .select([
        'assessment.id as id',
        'assessment.title as title',
        'assessment.conformance_score as conformance_score',
        'assessment.end_date as completed_at',
        'standard.name as standard_name',
        'standard.version as standard_version',
      ])
      .orderBy('assessment.end_date', 'desc')
      .execute()) as Record<string, unknown>[];

    // Group by standard
    const progress: Record<string, Record<string, unknown>> = {};
    for (const assessment of assessments) {
      const assessmentRecord = assessment as Record<string, unknown>;
      const standardKey = (assessmentRecord.standard_name as string) || 'unknown';
      if (!progress[standardKey]) {
        progress[standardKey] = {
          standardName: assessmentRecord.standard_name,
          standardVersion: assessmentRecord.standard_version,
          assessments: [],
        };
      }
      (progress[standardKey].assessments as Record<string, unknown>[]).push({
        id: assessmentRecord.id,
        title: assessmentRecord.title,
        completedAt: assessmentRecord.completed_at,
        conformanceScore: assessmentRecord.conformance_score,
      });
    }

    res.json({ data: Object.values(progress) });
  } catch (error) {
    logger.error('Get entity progress error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

export default router;
