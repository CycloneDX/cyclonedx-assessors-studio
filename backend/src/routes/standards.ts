import { Router } from 'express';
import { clampPagination } from '../utils/pagination.js';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Selectable } from 'kysely';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, handleValidationError, parseBody } from '../utils/route-helpers.js';
import { AuthRequest, requireAuth, requirePermission } from '../middleware/auth.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { importStandard } from '../services/standard-import.js';
import { checkFeedForUpdates, fetchStandardBom, invalidateFeedCache } from '../services/standard-feed.js';
import { buildRequirementTree, topologicalSort } from '../services/requirement-utils.js';
import { generateStandardCycloneDX } from '../services/standard-export.js';
import type { Standard } from '../db/types.js';


// Request bodies (security review I9). Fields stay optional where the
// handlers already apply their own required-field and business rules.
const optText = (max: number) => z.string().max(max).nullable().optional();
const standardBodySchema = z.object({
  name: z.string().max(255).optional(),
  identifier: z.string().max(255).optional(),
  version: optText(50),
  owner: optText(255),
  description: optText(20_000),
});
const rejectBodySchema = z.object({ reason: optText(5_000) });
const createRequirementBodySchema = z.object({
  identifier: z.string().max(255).optional(),
  name: z.string().max(1_000).optional(),
  description: optText(100_000),
  open_cre: z.union([z.array(z.string().max(255)), z.string().max(255)]).nullable().optional(),
  parentIdentifier: optText(255),
  parentId: z.string().uuid().nullable().optional(),
});
const updateRequirementBodySchema = z.object({
  identifier: z.string().max(255).optional(),
  name: z.string().max(1_000).optional(),
  description: optText(100_000),
  openCre: z.union([z.array(z.string().max(255)), z.string().max(255)]).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});
const levelBodySchema = z.object({
  identifier: z.string().max(255).optional(),
  title: z.string().max(1_000).optional(),
  description: optText(20_000),
});
const levelRequirementsBodySchema = z.object({ requirementIds: z.array(z.string().uuid()).max(10_000) });
const reparentBodySchema = z.object({ parent_id: z.string().uuid().nullable() });

const router = Router();

/**
 * Build a filesystem-safe export filename from a standard's name and version.
 * If version is missing, falls back to a UTC timestamp (YYYYMMDD-HHmmss).
 */
function buildExportFilename(name: string, version?: string | null): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // replace non-alphanum runs with hyphen
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
  const suffix = version
    ? version.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    : new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, '');
  return `${slug}-${suffix}.cdx.json`;
}

const importStandardSchema = z.object({
  identifier: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  owner: z.string().nullish(),
  version: z.string().nullish(),
  licenseId: z.string().nullish(),
  requirements: z
    .array(
      z.object({
        identifier: z.string(),
        name: z.string(),
        description: z.string().nullish(),
        openCre: z.union([z.string(), z.array(z.string())]).nullish(),
        parentIdentifier: z.string().nullish(),
      })
    )
    .optional(),
  levels: z
    .array(
      z.object({
        identifier: z.string(),
        title: z.string().nullish(),
        description: z.string().nullish(),
        requirements: z.array(z.string()).optional(),
      })
    )
    .optional(),
  sourceJson: z.string().optional(),
});

router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  // Clamped: negative/fractional values used to reach SQL and 500 (I8).
  const { limit, offset } = clampPagination(req.query as Record<string, unknown>);
  const STATES = ['draft', 'in_review', 'published', 'retired'] as const;
  const rawState = req.query.state;
  if (rawState !== undefined && !STATES.includes(rawState as (typeof STATES)[number])) {
    res.status(400).json({ error: `state must be one of: ${STATES.join(', ')}` });
    return;
  }
  const stateFilter = rawState as (typeof STATES)[number] | undefined;

  let query = db.selectFrom('standard');
  if (stateFilter) {
    query = query.where('state', '=', stateFilter);
  }

  const total = await query
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow()
    .then(r => r.count);

  const standards = (await query
    .selectAll()
    .limit(limit)
    .offset(offset)
    .orderBy('name', 'asc')
    .execute()) as Selectable<Standard>[];

  // Fetch requirement counts per standard in one query
  const reqCounts = await db
    .selectFrom('requirement')
    .select([
      'standard_id',
      db.fn.count<number>('id').as('count'),
    ])
    .groupBy('standard_id')
    .execute();

  const reqCountMap = new Map(reqCounts.map(r => [r.standard_id, Number(r.count)]));

  // Fetch level counts per standard
  const levelCounts = await db
    .selectFrom('level')
    .select([
      'standard_id',
      db.fn.count<number>('id').as('count'),
    ])
    .groupBy('standard_id')
    .execute();

  const levelCountMap = new Map(levelCounts.map(r => [r.standard_id, Number(r.count)]));

  const data = standards.map(s => ({
    ...s,
    requirementsCount: reqCountMap.get(s.id) || 0,
    levelsCount: levelCountMap.get(s.id) || 0,
  }));

  res.json({
    data,
    pagination: {
      limit,
      offset,
      total,
    },
  });
}));

router.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const standard = await db
    .selectFrom('standard')
    .where('id', '=', req.params.id)
    .selectAll()
    .executeTakeFirst();

  if (!standard) {
    res.status(404).json({ error: 'Standard not found' });
    return;
  }

  const requirements = await db
    .selectFrom('requirement')
    .where('standard_id', '=', req.params.id as string)
    .selectAll()
    .execute();

  const requirementTree = buildRequirementTree(requirements);

  // Fetch levels with their associated requirement bom-refs
  const levels = await db
    .selectFrom('level')
    .where('standard_id', '=', req.params.id as string)
    .selectAll()
    .execute();

  const levelRequirements = await db
    .selectFrom('level_requirement')
    .innerJoin('level', 'level.id', 'level_requirement.level_id')
    .innerJoin('requirement', 'requirement.id', 'level_requirement.requirement_id')
    .where('level.standard_id', '=', req.params.id as string)
    .select([
      'level_requirement.level_id',
      'level_requirement.requirement_id',
      'requirement.identifier as requirement_identifier',
    ])
    .execute();

  const levelReqMap = new Map<string, string[]>();
  for (const lr of levelRequirements) {
    if (!levelReqMap.has(lr.level_id)) {
      levelReqMap.set(lr.level_id, []);
    }
    levelReqMap.get(lr.level_id)!.push(lr.requirement_id);
  }

  const levelsWithReqs = levels.map(l => ({
    ...l,
    requirementIds: levelReqMap.get(l.id) || [],
    requirementsCount: (levelReqMap.get(l.id) || []).length,
  }));

  res.json({
    standard,
    requirements: requirementTree,
    levels: levelsWithReqs,
  });
}));

// Export a standard as CycloneDX JSON
router.get(
  '/:id/export',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    const exportFilename = buildExportFilename(standard.name, standard.version);

    // Serve the stored blob if available (imported or published in-app standards)
    if (standard.source_json) {
      res.setHeader('Content-Type', 'application/vnd.cyclonedx+json; version=1.6');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename}"`,
      );
      res.send(standard.source_json);
      return;
    }

    // No stored blob: this standard has not been published yet or was created
    // before blob storage was added. Generate on the fly but do not persist.
    if (standard.state === 'draft' || standard.state === 'in_review') {
      const json = await generateStandardCycloneDX(req.params.id as string);
      res.setHeader('Content-Type', 'application/vnd.cyclonedx+json; version=1.6');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFilename}"`,
      );
      res.send(json);
      return;
    }

    // Published/retired without a blob (legacy data): generate and store
    const json = await generateStandardCycloneDX(req.params.id as string);
    await db
      .updateTable('standard')
      .set({ source_json: json })
      .where('id', '=', req.params.id as string)
      .execute();

    res.setHeader('Content-Type', 'application/vnd.cyclonedx+json; version=1.6');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename}"`,
    );
    res.send(json);
  }),
);

router.post(
  '/import',
  requireAuth,
  requirePermission('standards.import'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = importStandardSchema.parse(req.body);

      // Build a raw standard object compatible with the shared import service.
      // The frontend pre-normalizes fields (identifier, name, parentIdentifier)
      // so we map them back to the format importStandard expects.
      const rawStandard = {
        'bom-ref': data.identifier,
        name: data.name,
        description: data.description || undefined,
        owner: data.owner || undefined,
        version: data.version || undefined,
        requirements: data.requirements?.map((r) => ({
          'bom-ref': r.identifier,
          identifier: r.identifier,
          title: r.name,
          description: r.description || undefined,
          openCre: r.openCre || undefined,
          parent: r.parentIdentifier || undefined,
        })),
        levels: data.levels?.map((l) => ({
          'bom-ref': l.identifier,
          identifier: l.identifier,
          title: l.title || undefined,
          description: l.description || undefined,
          requirements: l.requirements || [],
        })),
      };

      const result = await importStandard(rawStandard, {
        sourceJson: data.sourceJson,
      });

      if (result.skipped) {
        res.status(409).json({
          error: 'Standard already exists',
          id: result.id,
          identifier: result.identifier,
        });
        return;
      }

      res.status(201).json({
        id: result.id,
        identifier: result.identifier,
        name: result.name,
        requirementCount: result.requirementCount,
        message: 'Standard imported successfully',
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

// Create a new draft standard
router.post(
  '/',
  requireAuth,
  requirePermission('standards.create'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const body = parseBody(standardBodySchema, req.body, res);
    if (!body) return;
    const { name, identifier, version, owner, description } = body;

    if (!name || !identifier) {
      res.status(400).json({ error: 'Missing required fields: name and identifier' });
      return;
    }

    const db = getDatabase();
    const standardId = uuidv4();

    await db
      .insertInto('standard')
      .values(toSnakeCase({
        id: standardId,
        identifier,
        name,
        description,
        owner,
        version,
        state: 'draft',
        authoredBy: req.user!.id,
        isImported: false,
      }))
      .execute();

    const created = await db
      .selectFrom('standard')
      .where('id', '=', standardId)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard created', {
      standardId,
      identifier,
      name,
      requestId: req.requestId,
    });

    res.status(201).json(created);
  })
);

// Edit a draft standard
router.put(
  '/:id',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Only draft standards can be edited' });
      return;
    }

    const body = parseBody(standardBodySchema, req.body, res);
    if (!body) return;
    const { name, identifier, version, owner, description } = body;

    try {
      await db
        .updateTable('standard')
        .set({
          ...(name && { name }),
          ...(identifier && { identifier }),
          ...(version !== undefined && { version }),
          ...(owner !== undefined && { owner }),
          ...(description !== undefined && { description }),
        })
        .where('id', '=', req.params.id as string)
        .execute();
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | null;
      const msg = err?.message as string | undefined;
      if (msg?.includes('duplicate') || msg?.includes('unique')) {
        res.status(409).json({ error: 'A standard with this identifier already exists' });
        return;
      }
      throw error;
    }

    const updated = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard updated', {
      standardId: req.params.id,
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Submit standard for approval
router.post(
  '/:id/submit',
  requireAuth,
  requirePermission('standards.submit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Only draft standards can be submitted for approval' });
      return;
    }

    await db
      .updateTable('standard')
      .set({
        state: 'in_review',
        submitted_at: new Date(),
      })
      .where('id', '=', req.params.id as string)
      .execute();

    const updated = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    logger.info('Standard submitted for approval', {
      standardId: req.params.id as string,
      userId: req.user.id,
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Approve a standard
router.post(
  '/:id/approve',
  requireAuth,
  requirePermission('standards.approve'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'in_review') {
      res.status(403).json({ error: 'Only standards in review can be approved' });
      return;
    }

    if (standard.authored_by === (req.user?.id ?? '')) {
      res.status(403).json({ error: 'Cannot approve your own standard submission' });
      return;
    }

    // Generate CycloneDX JSON blob at publish time for deterministic exports
    const sourceJson = await generateStandardCycloneDX(req.params.id as string);

    await db
      .updateTable('standard')
      .set({
        state: 'published',
        approved_by: req.user?.id ?? '',
        approved_at: new Date(),
        source_json: sourceJson,
      })
      .where('id', '=', req.params.id as string)
      .execute();

    const updated = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard approved', {
      standardId: req.params.id as string,
      approvedBy: req.user!.id,
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Reject a standard back to draft
router.post(
  '/:id/reject',
  requireAuth,
  requirePermission('standards.approve'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'in_review') {
      res.status(403).json({ error: 'Only standards in review can be rejected' });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (standard.authored_by === req.user.id) {
      res.status(403).json({ error: 'Cannot reject your own standard submission' });
      return;
    }

    const body = parseBody(rejectBodySchema, req.body, res);
    if (!body) return;
    const { reason } = body;

    await db
      .updateTable('standard')
      .set({
        state: 'draft',
        submitted_at: null,
      })
      .where('id', '=', req.params.id as string)
      .execute();

    const updated = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard rejected', {
      standardId: req.params.id as string,
      rejectedBy: req.user!.id,
      reason,
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Duplicate a standard
router.post(
  '/:id/duplicate',
  requireAuth,
  requirePermission('standards.duplicate'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const original = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!original) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    const newId = uuidv4();
    const newVersion = original.version ? `${original.version}-draft` : 'draft';

    // Build a cleaner identifier for the duplicate: strip the old version
    // suffix (if the identifier ends with it) and append the new version.
    let baseIdentifier = original.identifier;
    if (original.version) {
      const versionSuffix = `-${original.version}`;
      if (baseIdentifier.endsWith(versionSuffix)) {
        baseIdentifier = baseIdentifier.slice(0, -versionSuffix.length);
      }
    }
    // Also strip any trailing "-copy" from previous duplications
    baseIdentifier = baseIdentifier.replace(/-copy$/, '');
    const newIdentifier = `${baseIdentifier}-${newVersion}`;

    await db
      .insertInto('standard')
      .values(toSnakeCase({
        id: newId,
        identifier: newIdentifier,
        name: `${original.name} (Draft)`,
        description: original.description,
        owner: original.owner,
        version: newVersion,
        licenseId: original.license_id,
        state: 'draft',
        authoredBy: req.user!.id,
        isImported: false,
      }))
      .execute();

    // Copy all requirements from original, preserving parent/child hierarchy.
    // Topological sort ensures parents are always inserted before children.
    const rawRequirements = await db
      .selectFrom('requirement')
      .where('standard_id', '=', req.params.id as string)
      .selectAll()
      .execute();

    const sortedRequirements = topologicalSort(rawRequirements);
    const requirementMap = new Map<string, string>();

    for (const req_item of sortedRequirements) {
      const newReqId = uuidv4();

      const parentId =
        req_item.parent_id && requirementMap.has(req_item.parent_id)
          ? requirementMap.get(req_item.parent_id)
          : null;

      await db
        .insertInto('requirement')
        .values(toSnakeCase({
          id: newReqId,
          identifier: req_item.identifier,
          name: req_item.name,
          description: req_item.description,
          openCre: req_item.open_cre,
          parentId: parentId,
          standardId: newId,
        }))
        .execute();

      requirementMap.set(req_item.id, newReqId);
    }

    // Copy levels and their requirement associations
    const originalLevels = await db
      .selectFrom('level')
      .where('standard_id', '=', req.params.id as string)
      .selectAll()
      .execute();

    for (const lvl of originalLevels) {
      const newLevelId = uuidv4();

      await db
        .insertInto('level')
        .values({
          id: newLevelId,
          identifier: lvl.identifier,
          title: lvl.title,
          description: lvl.description,
          standard_id: newId,
        })
        .execute();

      // Copy level-requirement junctions, mapping old requirement IDs to new ones
      const lvlReqs = await db
        .selectFrom('level_requirement')
        .where('level_id', '=', lvl.id)
        .selectAll()
        .execute();

      for (const lr of lvlReqs) {
        const newReqId = requirementMap.get(lr.requirement_id);
        if (newReqId) {
          await db
            .insertInto('level_requirement')
            .values({
              level_id: newLevelId,
              requirement_id: newReqId,
            })
            .execute();
        }
      }
    }

    const created = await db
      .selectFrom('standard')
      .where('id', '=', newId)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard duplicated', {
      originalId: req.params.id as string,
      newId,
      duplicatedBy: req.user!.id,
      requestId: req.requestId,
    });

    res.status(201).json(created);
  })
);

// Retire a published standard
router.post(
  '/:id/retire',
  requireAuth,
  requirePermission('standards.approve'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'published') {
      res.status(403).json({ error: 'Only published standards can be retired' });
      return;
    }

    // Refuse retirement while live entities still police themselves
    // against this standard. Caller can override with ?force=true to
    // proceed anyway (e.g. when the standard is being superseded by
    // a duplicate-and-edit lineage and the policies will be migrated
    // in a follow-up). Without the override this is a 409 listing the
    // first few referencing entities so the operator can clean up.
    const force = req.query.force === 'true';
    if (!force) {
      const activePolicies = (await db
        .selectFrom('compliance_policy')
        .innerJoin('entity', 'entity.id', 'compliance_policy.entity_id')
        .where('compliance_policy.standard_id', '=', req.params.id as string)
        .where('entity.state', '!=', 'archived')
        .select([
          'entity.id as entity_id',
          'entity.name as entity_name',
        ])
        .limit(10)
        .execute()) as Array<{ entity_id: string; entity_name: string }>;

      if (activePolicies.length > 0) {
        res.status(409).json({
          error: 'Standard has active compliance policies on live entities. Remove them, or retry with ?force=true to retire anyway.',
          reason: 'active_compliance_policies',
          entities: activePolicies,
        });
        return;
      }
    }

    await db
      .updateTable('standard')
      .set({
        state: 'retired',
      })
      .where('id', '=', req.params.id as string)
      .execute();

    const updated = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    logger.info('Standard retired', {
      standardId: req.params.id as string,
      retiredBy: req.user?.id ?? '',
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Add a requirement to a draft standard
router.post(
  '/:id/requirements',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Can only add requirements to draft standards' });
      return;
    }

    const body = parseBody(createRequirementBodySchema, req.body, res);
    if (!body) return;
    const { identifier, name, description, open_cre, parentIdentifier, parentId: bodyParentId } = body;

    if (!identifier || !name) {
      res.status(400).json({ error: 'Missing required fields: identifier and name' });
      return;
    }

    let parentId: string | null = bodyParentId || null;
    if (!parentId && parentIdentifier) {
      const parent = await db
        .selectFrom('requirement')
        .where('standard_id', '=', req.params.id as string)
        .where('identifier', '=', parentIdentifier)
        .select('id')
        .executeTakeFirst();

      if (!parent) {
        res.status(400).json({ error: 'Parent requirement not found' });
        return;
      }

      parentId = parent.id;
    }

    const requirementId = uuidv4();

    await db
      .insertInto('requirement')
      .values(toSnakeCase({
        id: requirementId,
        identifier,
        name,
        description,
        openCre: open_cre,
        parentId: parentId,
        standardId: req.params.id as string,
      }))
      .execute();

    const created = await db
      .selectFrom('requirement')
      .where('id', '=', requirementId)
      .selectAll()
      .executeTakeFirst();

    logger.info('Requirement added to standard', {
      standardId: req.params.id as string,
      requirementId,
      requestId: req.requestId,
    });

    res.status(201).json(created);
  })
);

// Edit a requirement in a draft standard
router.put(
  '/:standardId/requirements/:reqId',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Can only edit requirements in draft standards' });
      return;
    }

    const requirement = await db
      .selectFrom('requirement')
      .where('id', '=', req.params.reqId)
      .where('standard_id', '=', req.params.standardId)
      .selectAll()
      .executeTakeFirst();

    if (!requirement) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }

    const body = parseBody(updateRequirementBodySchema, req.body, res);
    if (!body) return;
    const { identifier, name, description, openCre, parentId } = body;

    // Validate parentId if provided (prevent self-reference and circular references)
    if (parentId !== undefined && parentId !== null) {
      if (parentId === req.params.reqId) {
        res.status(400).json({ error: 'A requirement cannot be its own parent' });
        return;
      }
      const parent = await db
        .selectFrom('requirement')
        .where('id', '=', parentId)
        .where('standard_id', '=', req.params.standardId as string)
        .selectAll()
        .executeTakeFirst();

      if (!parent) {
        res.status(400).json({ error: 'Parent requirement not found in this standard' });
        return;
      }
    }

    try {
      await db
        .updateTable('requirement')
        .set(toSnakeCase({
          ...(identifier && { identifier }),
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(openCre !== undefined && { openCre }),
          ...(parentId !== undefined && { parentId: parentId || null }),
        }))
        .where('id', '=', req.params.reqId)
        .execute();
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | null;
      const msg = err?.message as string | undefined;
      if (msg?.includes('duplicate') || msg?.includes('unique')) {
        res.status(409).json({ error: 'A requirement with this identifier already exists in this standard' });
        return;
      }
      throw error;
    }

    const updated = await db
      .selectFrom('requirement')
      .where('id', '=', req.params.reqId)
      .selectAll()
      .executeTakeFirst();

    logger.info('Requirement updated in standard', {
      standardId: req.params.standardId,
      requirementId: req.params.reqId,
      requestId: req.requestId,
    });

    res.json(updated);
  })
);

// Delete a requirement from a draft standard
router.delete(
  '/:standardId/requirements/:reqId',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Can only delete requirements from draft standards' });
      return;
    }

    const requirement = await db
      .selectFrom('requirement')
      .where('id', '=', req.params.reqId)
      .where('standard_id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!requirement) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }

    await db
      .deleteFrom('requirement')
      .where('id', '=', req.params.reqId)
      .execute();

    logger.info('Requirement deleted from standard', {
      standardId: req.params.standardId as string,
      requirementId: req.params.reqId,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

// =====================================================================
// Level management routes
// =====================================================================

// Add a level to a draft standard
router.post(
  '/:standardId/levels',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) { res.status(404).json({ error: 'Standard not found' }); return; }
    if (standard.state !== 'draft') { res.status(403).json({ error: 'Can only add levels to draft standards' }); return; }

    const body = parseBody(levelBodySchema, req.body, res);
    if (!body) return;
    const { identifier, title, description } = body;
    if (!identifier) { res.status(400).json({ error: 'Missing required field: identifier' }); return; }

    const levelId = uuidv4();
    try {
      await db
        .insertInto('level')
        .values({ id: levelId, identifier, title: title || null, description: description || null, standard_id: req.params.standardId as string })
        .execute();
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | null;
      const msg = err?.message as string | undefined;
      if (msg?.includes('duplicate') || msg?.includes('unique')) {
        res.status(409).json({ error: 'A level with this identifier already exists in this standard' });
        return;
      }
      throw error;
    }

    const created = await db.selectFrom('level').where('id', '=', levelId).selectAll().executeTakeFirst();
    logger.info('Level added', { standardId: req.params.standardId as string, levelId, requestId: req.requestId });
    res.status(201).json(created);
  })
);

// Update a level in a draft standard
router.put(
  '/:standardId/levels/:levelId',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) { res.status(404).json({ error: 'Standard not found' }); return; }
    if (standard.state !== 'draft') { res.status(403).json({ error: 'Can only edit levels in draft standards' }); return; }

    const level = await db
      .selectFrom('level')
      .where('id', '=', req.params.levelId)
      .where('standard_id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!level) { res.status(404).json({ error: 'Level not found' }); return; }

    const body = parseBody(levelBodySchema, req.body, res);
    if (!body) return;
    const { identifier, title, description } = body;

    try {
      await db
        .updateTable('level')
        .set({
          ...(identifier !== undefined && { identifier }),
          ...(title !== undefined && { title: title || null }),
          ...(description !== undefined && { description: description || null }),
        })
        .where('id', '=', req.params.levelId)
        .execute();
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | null;
      const msg = err?.message as string | undefined;
      if (msg?.includes('duplicate') || msg?.includes('unique')) {
        res.status(409).json({ error: 'A level with this identifier already exists in this standard' });
        return;
      }
      throw error;
    }

    const updated = await db.selectFrom('level').where('id', '=', req.params.levelId).selectAll().executeTakeFirst();
    res.json(updated);
  })
);

// Delete a level from a draft standard
router.delete(
  '/:standardId/levels/:levelId',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId)
      .selectAll()
      .executeTakeFirst();

    if (!standard) { res.status(404).json({ error: 'Standard not found' }); return; }
    if (standard.state !== 'draft') { res.status(403).json({ error: 'Can only delete levels from draft standards' }); return; }

    await db.deleteFrom('level').where('id', '=', req.params.levelId).where('standard_id', '=', req.params.standardId as string).execute();
    res.status(204).send();
  })
);

// Set requirements for a level (replaces all current assignments)
router.put(
  '/:standardId/levels/:levelId/requirements',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) { res.status(404).json({ error: 'Standard not found' }); return; }
    if (standard.state !== 'draft') { res.status(403).json({ error: 'Can only modify level requirements in draft standards' }); return; }

    const level = await db
      .selectFrom('level')
      .where('id', '=', req.params.levelId)
      .where('standard_id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!level) { res.status(404).json({ error: 'Level not found' }); return; }

    const body = parseBody(levelRequirementsBodySchema, req.body, res);
    if (!body) return;
    const { requirementIds } = body;
    if (!Array.isArray(requirementIds)) { res.status(400).json({ error: 'requirementIds must be an array' }); return; }

    // Clear existing and re-insert
    await db.deleteFrom('level_requirement').where('level_id', '=', req.params.levelId).execute();

    for (const reqId of requirementIds) {
      try {
        await db
          .insertInto('level_requirement')
          .values({ level_id: req.params.levelId, requirement_id: reqId })
          .execute();
      } catch (insertErr: unknown) {
        const err = insertErr as Record<string, unknown> | null;
        const msg = err?.message as string | undefined;
        if (msg?.includes('duplicate') || msg?.includes('unique')) continue;
        throw insertErr;
      }
    }

    logger.info('Level requirements updated', { standardId: req.params.standardId, levelId: req.params.levelId, count: requirementIds.length, requestId: req.requestId });
    res.json({ success: true, count: requirementIds.length });
  })
);

// Delete a draft or retired standard (retired only if no references exist)
router.delete(
  '/:id',
  requireAuth,
  requirePermission('standards.approve'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft' && standard.state !== 'retired') {
      res.status(403).json({ error: 'Only draft or retired standards can be deleted' });
      return;
    }

    // For retired standards, verify no other objects reference it
    if (standard.state === 'retired') {
      const requirementIds = await db
        .selectFrom('requirement')
        .where('standard_id', '=', req.params.id as string)
        .select('id')
        .execute();

      const reqIdList = requirementIds.map((r) => r.id);

      // Check project_standard references
      const projectRefs = await db
        .selectFrom('project_standard')
        .where('standard_id', '=', req.params.id as string)
        .select(db.fn.count<number>('project_id').as('count'))
        .executeTakeFirstOrThrow();

      if (Number(projectRefs.count) > 0) {
        res.status(409).json({ error: 'Cannot delete: standard is still referenced by one or more projects' });
        return;
      }

      // Check entity_standard references
      const entityRefs = await db
        .selectFrom('entity_standard')
        .where('standard_id', '=', req.params.id as string)
        .select(db.fn.count<number>('entity_id').as('count'))
        .executeTakeFirstOrThrow();

      if (Number(entityRefs.count) > 0) {
        res.status(409).json({ error: 'Cannot delete: standard is still referenced by one or more entities' });
        return;
      }

      // Check compliance_policy references
      const policyRefs = await db
        .selectFrom('compliance_policy')
        .where('standard_id', '=', req.params.id as string)
        .select(db.fn.count<number>('id').as('count'))
        .executeTakeFirstOrThrow();

      if (Number(policyRefs.count) > 0) {
        res.status(409).json({ error: 'Cannot delete: standard is still referenced by one or more compliance policies' });
        return;
      }

      // Check assessment references
      const assessmentRefs = await db
        .selectFrom('assessment')
        .where('standard_id', '=', req.params.id as string)
        .select(db.fn.count<number>('id').as('count'))
        .executeTakeFirstOrThrow();

      if (Number(assessmentRefs.count) > 0) {
        res.status(409).json({ error: 'Cannot delete: standard is still referenced by one or more assessments' });
        return;
      }

      // Check if any requirements are referenced by assessment_requirement, attestation_requirement, or claims
      if (reqIdList.length > 0) {
        const assessmentReqRefs = await db
          .selectFrom('assessment_requirement')
          .where('requirement_id', 'in', reqIdList)
          .select(db.fn.count<number>('id').as('count'))
          .executeTakeFirstOrThrow();

        if (Number(assessmentReqRefs.count) > 0) {
          res.status(409).json({ error: 'Cannot delete: requirements from this standard are referenced by assessment data' });
          return;
        }

        const attestationReqRefs = await db
          .selectFrom('attestation_requirement')
          .where('requirement_id', 'in', reqIdList)
          .select(db.fn.count<number>('id').as('count'))
          .executeTakeFirstOrThrow();

        if (Number(attestationReqRefs.count) > 0) {
          res.status(409).json({ error: 'Cannot delete: requirements from this standard are referenced by attestation data' });
          return;
        }
      }
    }

    // CASCADE will remove requirements, levels, level_requirements
    await db
      .deleteFrom('standard')
      .where('id', '=', req.params.id as string)
      .execute();

    logger.info('Standard deleted', {
      standardId: req.params.id as string,
      state: standard.state,
      deletedBy: req.user!.id,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

// Reparent a requirement (move it to a different parent via drag/drop)
router.put(
  '/:standardId/requirements/:reqId/reparent',
  requireAuth,
  requirePermission('standards.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const standard = await db
      .selectFrom('standard')
      .where('id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!standard) {
      res.status(404).json({ error: 'Standard not found' });
      return;
    }

    if (standard.state !== 'draft') {
      res.status(403).json({ error: 'Can only reparent requirements in draft standards' });
      return;
    }

    const requirement = await db
      .selectFrom('requirement')
      .where('id', '=', req.params.reqId)
      .where('standard_id', '=', req.params.standardId as string)
      .selectAll()
      .executeTakeFirst();

    if (!requirement) {
      res.status(404).json({ error: 'Requirement not found' });
      return;
    }

    const body = parseBody(reparentBodySchema, req.body, res);
    if (!body) return;
    const { parent_id: newParentId } = body;

    // Prevent self-reference
    if (newParentId === req.params.reqId) {
      res.status(400).json({ error: 'A requirement cannot be its own parent' });
      return;
    }

    // Validate parent exists in this standard (if not null)
    if (newParentId) {
      const parent = await db
        .selectFrom('requirement')
        .where('id', '=', newParentId)
        .where('standard_id', '=', req.params.standardId as string)
        .selectAll()
        .executeTakeFirst();

      if (!parent) {
        res.status(400).json({ error: 'Parent requirement not found in this standard' });
        return;
      }

      // Prevent circular references: walk up from proposed parent to ensure
      // it does not eventually reach the requirement being moved
      let cursor = parent;
      while (cursor.parent_id) {
        if (cursor.parent_id === req.params.reqId) {
          res.status(400).json({ error: 'This move would create a circular reference' });
          return;
        }
        const next = await db
          .selectFrom('requirement')
          .where('id', '=', cursor.parent_id)
          .where('standard_id', '=', req.params.standardId as string)
          .selectAll()
          .executeTakeFirst();
        if (!next) break;
        cursor = next;
      }
    }

    await db
      .updateTable('requirement')
      .set({ parent_id: newParentId || null })
      .where('id', '=', req.params.reqId)
      .execute();

    logger.info('Requirement reparented', {
      standardId: req.params.standardId as string,
      requirementId: req.params.reqId,
      newParentId: newParentId || null,
      requestId: req.requestId,
    });

    res.json({ success: true });
  })
);

// ─── Feed / update-check routes ───────────────────────────────────────────────

/**
 * GET /api/v1/standards/feed/check
 * Returns standards available in the upstream CycloneDX catalogue that are
 * not yet imported into this instance.  Results are cached for 1 hour;
 * pass ?force=true to bypass the cache (admin only).
 */
router.get(
  '/feed/check',
  requireAuth,
  requirePermission('standards.import'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const force = req.query.force === 'true';
    const result = await checkFeedForUpdates(force);
    res.json(result);
  })
);

const feedImportSchema = z.object({
  downloadUrl: z.string().url().max(2048).refine((u) => u.startsWith('https://')),
  title: z.string().max(500).optional(),
});

/**
 * POST /api/v1/standards/feed/import
 * Fetch a standard BOM from the upstream URL provided in the request body
 * and import it into the local DB via the canonical importStandard() service.
 *
 * Body: { downloadUrl: string; title: string }
 */
router.post(
  '/feed/import',
  requireAuth,
  requirePermission('standards.import'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const parsedBody = feedImportSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'downloadUrl must be an https URL' });
      return;
    }
    const { downloadUrl, title } = parsedBody.data;

    let bom: Record<string, unknown>;
    try {
      bom = await fetchStandardBom(downloadUrl);
    } catch (err) {
      // Details stay in the log: the message can echo the target's
      // response or internal DNS answers (security review I2/I10).
      logger.warn('Standards feed import fetch failed', { downloadUrl, error: (err as Error).message, userId: req.user?.id });
      res.status(502).json({ error: 'Failed to fetch standard from the given URL' });
      return;
    }

    // Only a CycloneDX BOM carrying a standard is accepted. Importing any
    // JSON object (the old fallback) let a fetched internal document be
    // stored and read back through the standard export.
    const definitions = bom.definitions as Record<string, unknown> | undefined;
    const standardsArr = definitions?.standards as unknown[] | undefined;
    const rawStandard = bom.bomFormat === 'CycloneDX' ? standardsArr?.[0] : undefined;
    if (!rawStandard || typeof rawStandard !== 'object') {
      res.status(422).json({ error: 'URL did not return a CycloneDX BOM with a standard definition' });
      return;
    }

    const result = await importStandard(rawStandard as Parameters<typeof importStandard>[0], {
      fallbackName: title ?? 'Unknown Standard',
      markAsImported: true,
      sourceJson: JSON.stringify(bom),
    });

    // Invalidate cache so the check endpoint reflects the newly imported standard
    invalidateFeedCache();

    if (result.skipped) {
      res.status(409).json({ error: 'Standard is already imported', identifier: result.identifier });
      return;
    }

    logger.info('Standard imported from feed', {
      id: result.id,
      name: result.name,
      requirementCount: result.requirementCount,
      userId: req.user?.id,
    });

    res.status(201).json(result);
  })
);

export default router;
