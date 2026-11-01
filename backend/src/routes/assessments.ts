import { Router } from 'express';
import { queryString } from '../utils/query.js';
import { hasPermission, requireAssessmentWrite, requireAssessmentParticipant, visibleEvidenceIds } from '../utils/access.js';
import type { Response } from 'express';
import { Kysely } from 'kysely';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import type { Database } from '../db/types.js';
import { logger } from '../utils/logger.js';
import { AuthRequest, requireAuth, requireSession, requirePermission, getPermissionsForRole } from '../middleware/auth.js';
import { syncEntityTags, fetchTagsForEntities } from '../utils/tags.js';
import { ASSESSMENT_CREATED, ASSESSMENT_STATE_CHANGED } from '../events/catalog.js';
import { createNotification } from '../utils/notifications.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { validatePagination } from '../utils/pagination.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

const createAssessmentSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  projectId: z.string().uuid('Invalid project ID').nullable().optional(),
  entityId: z.string().uuid('Invalid entity ID').nullable().optional(),
  standardId: z.string().uuid('Invalid standard ID').nullable().optional(),
  // Compatibility alias: the create form sends `standardIds` as an
  // array in some legacy code paths. The `assessment` table stores at
  // most one standard_id (see migrate.ts), so we accept an array of
  // length one and collapse it onto standardId in the handler. We
  // intentionally reject arrays > 1 with a clear 400 rather than
  // silently dropping the extra entries, which was the original bug
  // surface in issue #19. When a true many-to-many assessment_standard
  // junction lands, lift the .max(1) constraint and switch storage.
  standardIds: z
    .array(z.string().uuid('Invalid standard ID'))
    .max(1, 'Only one standard per assessment is supported')
    .optional(),
  dueDate: z.string().nullable().optional(),
  assessorIds: z.array(z.string().uuid()).optional(),
  assesseeIds: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string()).optional(),
  assessmentType: z.enum(['standards', 'targeted', 'tasks']).optional().default('standards'),
  taskLabel: z.string().max(25).optional(),
});

// PUT /assessments/:id accepts `state` ONLY as a thin alias for
// POST /assessments/:id/transition. The handler enforces the same
// transition matrix and the same `assessments.manage` permission as
// the unified route — the old back door (any caller with
// `assessments.edit` could jump the state machine, bypassing both
// from-state guards and the affirmation-seal check) is closed by
// routing every state write through the matrix.
const updateAssessmentSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  state: z
    .enum(['new', 'pending', 'in_progress', 'on_hold', 'cancelled', 'complete', 'archived'])
    .optional(),
  tags: z.array(z.string()).optional(),
  assessorIds: z.array(z.string().uuid()).optional(),
  assesseeIds: z.array(z.string().uuid()).optional(),
});

/**
 * Check if an assessment is in a read-only state (complete or archived).
 * Returns an error message string if read-only, or null if mutable.
 * Used by requireMutableAssessment for child-resource writes (work
 * notes, requirement scoring). State transitions out of read-only
 * states use the /transition route, not the data-mutation routes.
 */
function getReadOnlyError(state: string): string | null {
  if (state === 'archived') return 'Archived assessments cannot be modified';
  if (state === 'complete') return 'Completed assessments are read-only. Reopen the assessment to make changes.';
  return null;
}

/**
 * Authorize a read against a specific assessment.
 *
 * `assessments.view_all` always passes. Without it, the caller must be
 * a participant on this assessment — assessor, assessee, or the author/
 * reviewer of any evidence linked to one of its requirements. If the
 * caller is neither, return 403 (not 404) so the user gets a clear
 * "you don't have access" message rather than an ambiguous "not found"
 * that leaks resource existence.
 *
 * Returns true if access is granted; otherwise writes the response and
 * returns false so the caller can early-return.
 */
async function authorizeAssessmentRead(
  req: AuthRequest,
  res: Response,
  assessmentId: string,
): Promise<boolean> {
  if (!req.user?.id) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  const userPerms = await getPermissionsForRole(req.user.role);
  if (!userPerms.includes('assessments.view')) {
    res.status(403).json({ error: 'Missing required permission: assessments.view' });
    return false;
  }
  if (userPerms.includes('assessments.view_all')) return true;

  const db = getDatabase();
  const userId = req.user.id;

  const participant = await db
    .selectFrom('assessment')
    .where('assessment.id', '=', assessmentId)
    .where((eb) =>
      eb.or([
        eb('assessment.id', 'in',
          eb.selectFrom('assessment_assessor')
            .select('assessment_id')
            .where('user_id', '=', userId)
        ),
        eb('assessment.id', 'in',
          eb.selectFrom('assessment_assessee')
            .select('assessment_id')
            .where('user_id', '=', userId)
        ),
        eb('assessment.id', 'in',
          eb.selectFrom('assessment_requirement_evidence as are')
            .innerJoin('assessment_requirement as ar', 'ar.id', 'are.assessment_requirement_id')
            .innerJoin('evidence as e', 'e.id', 'are.evidence_id')
            .select('ar.assessment_id')
            .where((inner) =>
              inner.or([
                inner('e.author_id', '=', userId),
                inner('e.reviewer_id', '=', userId),
              ])
            )
        ),
      ])
    )
    .select('id')
    .executeTakeFirst();

  if (!participant) {
    res.status(403).json({
      error: 'You do not have access to this assessment',
      reason: 'not_a_participant',
    });
    return false;
  }
  return true;
}

/**
 * Build assessment update data from request payload.
 */
function buildAssessmentUpdateData(data: Record<string, unknown>): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.dueDate !== undefined && data.dueDate !== null) {
    updateData.due_date = new Date(data.dueDate as string | number | Date);
  }
  return updateData;
}

/**
 * Sync assessor assignments for an assessment.
 *
 * De-duplicates the incoming assessorIds before insert. The
 * assessment_assessor table has a composite PK on (assessment_id,
 * user_id); a caller that sends the same user twice would otherwise
 * trigger a unique constraint violation surfaced as a 500. Treating
 * the input as a set matches the documented "assignment" semantics.
 */
async function syncAssessors(
  db: Kysely<Database>,
  assessmentId: string,
  assessorIds: string[] | undefined
): Promise<void> {
  if (assessorIds === undefined) return;

  await db
    .deleteFrom('assessment_assessor')
    .where('assessment_id', '=', assessmentId)
    .execute();

  const uniqueIds = Array.from(new Set(assessorIds));
  if (uniqueIds.length > 0) {
    await db
      .insertInto('assessment_assessor')
      .values(
        uniqueIds.map(userId => ({
          assessment_id: assessmentId,
          user_id: userId,
          created_at: new Date(),
        }))
      )
      .execute();
  }
}

/**
 * Sync assessee assignments for an assessment.
 *
 * De-duplicates the incoming assesseeIds before insert to avoid a
 * composite PK violation on (assessment_id, user_id). Same rationale
 * as syncAssessors.
 */
async function syncAssessees(
  db: Kysely<Database>,
  assessmentId: string,
  assesseeIds: string[] | undefined
): Promise<void> {
  if (assesseeIds === undefined) return;

  await db
    .deleteFrom('assessment_assessee')
    .where('assessment_id', '=', assessmentId)
    .execute();

  const uniqueIds = Array.from(new Set(assesseeIds));
  if (uniqueIds.length > 0) {
    await db
      .insertInto('assessment_assessee')
      .values(
        uniqueIds.map(userId => ({
          assessment_id: assessmentId,
          user_id: userId,
          created_at: new Date(),
        }))
      )
      .execute();
  }
}

/**
 * Shape of an assessment requirement row used for completion and scoring.
 */
interface AssessmentRequirementRow {
  result?: string | null;
  rationale?: string | null;
}

/**
 * Count requirements that are missing results or rationale.
 */
function countIncompleteRequirements(
  requirements: AssessmentRequirementRow[],
): { unassessedCount: number; missingRationaleCount: number } {
  let unassessedCount = 0;
  let missingRationaleCount = 0;
  for (const req of requirements) {
    if (req.result === null || req.result === undefined) {
      unassessedCount++;
    }
    if (req.rationale === null || req.rationale === undefined || req.rationale.trim() === '') {
      missingRationaleCount++;
    }
  }
  return { unassessedCount, missingRationaleCount };
}

const CLAIM_CLOSED_STATUSES = ['Accepted', 'Rejected'];
const MITIGATION_CLOSED_STATUSES = ['Verified', 'Closed'];

/**
 * Returns any open claims and mitigations that must be resolved before the
 * assessment can be closed. Claims are linked to an assessment via the
 * attestation that belongs to the assessment. Mitigations are linked via
 * the mitigation_claim join table.
 */
async function findOpenClaimsAndMitigations(
  db: Kysely<Database>,
  assessmentId: string,
): Promise<{ openClaims: string[]; openMitigations: string[] }> {
  // Claims linked to this assessment through their attestation
  const claims = await db
    .selectFrom('claim')
    .innerJoin('attestation', 'attestation.id', 'claim.attestation_id')
    .where('attestation.assessment_id', '=', assessmentId)
    .select(['claim.id', 'claim.name', 'claim.status'])
    .execute();

  const openClaims = claims
    .filter(c => !CLAIM_CLOSED_STATUSES.includes(c.status))
    .map(c => c.name);

  if (claims.length === 0) {
    return { openClaims: [], openMitigations: [] };
  }

  const claimIds = claims.map(c => c.id);
  const mitigations = await db
    .selectFrom('mitigation')
    .innerJoin('mitigation_claim', 'mitigation_claim.mitigation_id', 'mitigation.id')
    .where('mitigation_claim.claim_id', 'in', claimIds)
    .select(['mitigation.id', 'mitigation.title', 'mitigation.status'])
    .distinct()
    .execute();

  const openMitigations = mitigations
    .filter(m => !MITIGATION_CLOSED_STATUSES.includes(m.status ?? ''))
    .map(m => m.title);

  return { openClaims, openMitigations };
}

/**
 * Validate completion prerequisites for an assessment.
 */
async function validateCompletionPrerequisites(
  db: Kysely<Database>,
  assessmentId: string,
  requirements: AssessmentRequirementRow[],
  res: Response
): Promise<boolean> {
  const { unassessedCount, missingRationaleCount } = countIncompleteRequirements(requirements);

  if (unassessedCount > 0 || missingRationaleCount > 0) {
    res.status(400).json({
      error: 'Cannot complete assessment',
      unassessedCount,
      missingRationaleCount,
    });
    return false;
  }

  // Check that at least one evidence item is linked
  const evidenceLinks = await db
    .selectFrom('assessment_requirement_evidence')
    .innerJoin('assessment_requirement', 'assessment_requirement.id', 'assessment_requirement_evidence.assessment_requirement_id')
    .where('assessment_requirement.assessment_id', '=', assessmentId)
    .selectAll()
    .execute();

  if (evidenceLinks.length === 0) {
    res.status(400).json({
      error: 'Cannot complete assessment without any evidence. At least one evidence item must be linked to a requirement.',
    });
    return false;
  }

  const { openClaims, openMitigations } = await findOpenClaimsAndMitigations(db, assessmentId);
  if (openClaims.length > 0 || openMitigations.length > 0) {
    res.status(400).json({
      error: 'Cannot complete assessment: all linked claims must be Accepted or Rejected, and all linked mitigations must be Verified or Closed.',
      openClaims,
      openMitigations,
    });
    return false;
  }

  return true;
}

/**
 * Calculate conformance score from assessment requirements.
 */
function calculateConformanceScore(requirements: AssessmentRequirementRow[]): number | null {
  const applicableRequirements = requirements.filter(r => r.result !== 'not_applicable');
  if (applicableRequirements.length === 0) return null;

  const scoreMap = {
    'yes': 1.0,
    'partial': 0.5,
    'no': 0.0,
  };
  let totalScore = 0;
  for (const req of applicableRequirements) {
    totalScore += scoreMap[req.result as keyof typeof scoreMap] || 0;
  }
  return Math.round((totalScore / applicableRequirements.length) * 100);
}

/**
 * Fetch assessment state by ID and return 403 if read-only.
 * Returns the assessment if mutable, or null if response was already sent.
 */
async function requireMutableAssessment(
  db: Kysely<Database>,
  assessmentId: string,
  res: Response
): Promise<Record<string, unknown> | null> {
  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', assessmentId)
    .select(['id', 'state', 'title'])
    .executeTakeFirst();

  if (!assessment) {
    res.status(404).json({ error: 'Assessment not found' });
    return null;
  }

  const readOnlyError = getReadOnlyError(assessment.state);
  if (readOnlyError) {
    res.status(403).json({ error: readOnlyError });
    return null;
  }

  return assessment;
}

router.get('/', requireAuth, requirePermission('assessments.view'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const db = getDatabase();
    const { limit, offset } = validatePagination(req.query);
    const state = queryString(req.query.state);
    const projectId = queryString(req.query.projectId);
    const myOnly = req.query.myOnly === 'true';

    // assessments.view alone restricts the caller to assessments they
    // participate in (assessor, assessee, evidence author, or evidence
    // reviewer). assessments.view_all unlocks the global list. The
    // myOnly query param is kept as an opt-in narrowing filter for
    // callers that *have* view_all but want only their own work.
    const userPerms = req.user?.id
      ? await getPermissionsForRole(req.user.role)
      : [];
    const hasViewAll = userPerms.includes('assessments.view_all');
    const userId = req.user?.id ?? '';

    let query = db
      .selectFrom('assessment')
      .leftJoin('project', 'project.id', 'assessment.project_id')
      .leftJoin('entity', 'entity.id', 'assessment.entity_id')
      .leftJoin('standard', 'standard.id', 'assessment.standard_id')
      .select([
        'assessment.id',
        'assessment.title',
        'assessment.description',
        'assessment.state',
        'assessment.assessment_type',
        'assessment.task_label',
        'assessment.project_id',
        'project.name as project_name',
        'assessment.entity_id',
        'entity.name as entity_name',
        'assessment.standard_id',
        'standard.name as standard_name',
        'standard.version as standard_version',
        'assessment.due_date',
        'assessment.start_date',
        'assessment.end_date',
        'assessment.created_at',
        'assessment.updated_at',
      ]);

    if (state) {
      query = query.where('assessment.state', '=', state as 'new' | 'pending' | 'in_progress' | 'on_hold' | 'cancelled' | 'complete' | 'archived');
    }

    if (projectId) {
      query = query.where('assessment.project_id', '=', projectId);
    }

    const restrictToParticipating = !hasViewAll || myOnly;
    if (restrictToParticipating && userId) {
      query = query.where((eb) =>
        eb.or([
          eb('assessment.id', 'in',
            eb.selectFrom('assessment_assessor')
              .select('assessment_id')
              .where('user_id', '=', userId)
          ),
          eb('assessment.id', 'in',
            eb.selectFrom('assessment_assessee')
              .select('assessment_id')
              .where('user_id', '=', userId)
          ),
        ])
      );
    }

    // Total must mirror the row-scope filter so paginators don't
    // promise more rows than the user can actually fetch.
    let totalQuery = db
      .selectFrom('assessment')
      .select(db.fn.count<number>('id').as('count'));
    if (state) {
      totalQuery = totalQuery.where('state', '=', state as 'new' | 'pending' | 'in_progress' | 'on_hold' | 'cancelled' | 'complete' | 'archived');
    }
    if (projectId) {
      totalQuery = totalQuery.where('project_id', '=', projectId);
    }
    if (restrictToParticipating && userId) {
      totalQuery = totalQuery.where((eb) =>
        eb.or([
          eb('id', 'in',
            eb.selectFrom('assessment_assessor')
              .select('assessment_id')
              .where('user_id', '=', userId)
          ),
          eb('id', 'in',
            eb.selectFrom('assessment_assessee')
              .select('assessment_id')
              .where('user_id', '=', userId)
          ),
        ])
      );
    }
    const total = await totalQuery.executeTakeFirstOrThrow().then(r => r.count);

    // Order newest first. The assessment list view paginates by 20
    // and tests that create a new assessment must be able to find
    // it on page 1 without scanning the entire table.
    const assessments = await query
      .orderBy('assessment.created_at', 'desc')
      .orderBy('assessment.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    const assessmentIds = assessments.map((a) => (a as Record<string, unknown>).id as string);
    const tagsByAssessment = await fetchTagsForEntities(db, 'assessment_tag', 'assessment_id', assessmentIds);
    const assessmentsWithTags = assessments.map((a) => ({
      ...a,
      tags: tagsByAssessment[(a as Record<string, unknown>).id as string] || [],
    }));

    res.json({
      data: assessmentsWithTags,
      pagination: {
        limit,
        offset,
        total,
      },
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;
    logger.error('Get assessments error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
    const db = getDatabase();

    const assessment = await db
      .selectFrom('assessment')
      .leftJoin('entity', 'entity.id', 'assessment.entity_id')
      .leftJoin('standard', 'standard.id', 'assessment.standard_id')
      .leftJoin('project', 'project.id', 'assessment.project_id')
      .where('assessment.id', '=', req.params.id as string)
      .select([
        'assessment.id',
        'assessment.title',
        'assessment.description',
        'assessment.project_id',
        'assessment.entity_id',
        'assessment.standard_id',
        'assessment.conformance_score',
        'assessment.due_date',
        'assessment.start_date',
        'assessment.end_date',
        'assessment.state',
        'assessment.assessment_type',
        'assessment.task_label',
        'assessment.created_at',
        'assessment.updated_at',
        'entity.name as entity_name',
        'entity.entity_type as entity_type',
        'standard.name as standard_name',
        'standard.version as standard_version',
        'project.name as project_name',
      ])
      .executeTakeFirst();

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }

    // Explicit column list. selectAll() on a join produces a column
    // collision on `id` (assessment_requirement.id vs requirement.id),
    // and the second one silently overwrites the first. Callers then
    // lose the junction PK with no warning, which breaks evidence
    // linking (POST /evidence/:id/link wants assessment_requirement.id)
    // and any other code that needs to address a junction row. Naming
    // each column explicitly prevents the collision class entirely.
    //
    // `id` stays as the junction PK. The catalog requirement id is
    // already available via `requirement_id` (the junction FK), so the
    // requirement.id column is intentionally omitted.
    const assessmentRequirements = (await db
      .selectFrom('assessment_requirement')
      .innerJoin(
        'requirement',
        (join) =>
          join.onRef(
            'requirement.id',
            '=',
            'assessment_requirement.requirement_id'
          )
      )
      .where('assessment_requirement.assessment_id', '=', req.params.id)
      .select([
        'assessment_requirement.id',
        'assessment_requirement.assessment_id',
        'assessment_requirement.requirement_id',
        'assessment_requirement.result',
        'assessment_requirement.rationale',
        'assessment_requirement.conformance_score',
        'assessment_requirement.conformance_rationale',
        'assessment_requirement.confidence_score',
        'assessment_requirement.confidence_rationale',
        'assessment_requirement.created_at',
        'assessment_requirement.updated_at',
        'requirement.identifier',
        'requirement.name',
        'requirement.description',
        'requirement.parent_id',
        'requirement.standard_id',
        'requirement.open_cre',
        'requirement.imported_bom_ref',
      ])
      .execute()) as Record<string, unknown>[];

    // Targeted assessments have standard_id = null on the assessment row but
    // their requirements carry standard_id. Derive the standard name from the
    // requirements so the Framework / Standard field is always populated.
    if (!assessment.standard_name && assessmentRequirements.length > 0) {
      const reqStandardId = (assessmentRequirements[0] as Record<string, unknown>).standard_id as string | undefined;
      if (reqStandardId) {
        const std = await db
          .selectFrom('standard')
          .select(['name', 'version'])
          .where('id', '=', reqStandardId)
          .executeTakeFirst();
        if (std) {
          (assessment as Record<string, unknown>).standard_name = std.name;
          (assessment as Record<string, unknown>).standard_version = std.version;
        }
      }
    }

    const assessors = (await db
      .selectFrom('assessment_assessor')
      .innerJoin(
        'app_user',
        (join) =>
          join.onRef(
            'app_user.id',
            '=',
            'assessment_assessor.user_id'
          )
      )
      .where('assessment_assessor.assessment_id', '=', req.params.id)
      .selectAll()
      .execute()) as Record<string, unknown>[];

    const assessees = (await db
      .selectFrom('assessment_assessee')
      .innerJoin(
        'app_user',
        (join) =>
          join.onRef(
            'app_user.id',
            '=',
            'assessment_assessee.user_id'
          )
      )
      .where('assessment_assessee.assessment_id', '=', req.params.id)
      .selectAll()
      .execute()) as Record<string, unknown>[];

    res.json({
      assessment,
      requirements: assessmentRequirements,
      assessors,
      assessees,
    });
  } catch (error) {
    logger.error('Get assessment error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/',
  requireAuth,
  requirePermission('assessments.create'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createAssessmentSchema.parse(req.body);
      const db = getDatabase();
      const assessmentId = uuidv4();

      // Collapse the standardIds compatibility alias onto the singular
      // standard_id column. Explicit singular wins when both are sent.
      // See createAssessmentSchema for the rationale and the migration
      // path when a many-to-many junction is added.
      const effectiveStandardId = data.standardId ?? data.standardIds?.[0] ?? null;

      let projectName: string | null = null;
      if (data.projectId) {
        const project = await db
          .selectFrom('project')
          .where('id', '=', data.projectId)
          .selectAll()
          .executeTakeFirst();

        if (!project) {
          res.status(404).json({ error: 'Project not found' });
          return;
        }
        projectName = project.name;
      }

      await db
        .insertInto('assessment')
        .values(
          toSnakeCase({
            id: assessmentId,
            title: data.title,
            description: data.description,
            projectId: data.projectId || undefined,
            entityId: data.entityId || undefined,
            standardId: effectiveStandardId ?? undefined,
            dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
            state: 'new',
            assessmentType: data.assessmentType,
            taskLabel: data.taskLabel || undefined,
          })
        )
        .execute();

      // Dedup before insert. The junction tables have composite PKs
      // on (assessment_id, user_id); duplicate ids in the request body
      // would otherwise crash with a constraint violation.
      // Writes are limited to assigned assessors (security review Z8), so a
      // non-admin creator is always assigned, or they could not edit what
      // they just created.
      const creatorIsAdmin = req.user ? await hasPermission(req.user.role, 'admin.settings') : true;
      const assessorIdsToAssign = creatorIsAdmin || !req.user
        ? (data.assessorIds ?? [])
        : [...(data.assessorIds ?? []), req.user.id];
      if (assessorIdsToAssign.length > 0) {
        const uniqueAssessorIds = Array.from(new Set(assessorIdsToAssign));
        await db
          .insertInto('assessment_assessor')
          .values(
            uniqueAssessorIds.map(userId => ({
              assessment_id: assessmentId,
              user_id: userId,
              created_at: new Date(),
            }))
          )
          .execute();
      }

      if (data.assesseeIds && data.assesseeIds.length > 0) {
        const uniqueAssesseeIds = Array.from(new Set(data.assesseeIds));
        await db
          .insertInto('assessment_assessee')
          .values(
            uniqueAssesseeIds.map(userId => ({
              assessment_id: assessmentId,
              user_id: userId,
              created_at: new Date(),
            }))
          )
          .execute();
      }

      if (data.tags && data.tags.length > 0) {
        await syncEntityTags(db, 'assessment_tag', 'assessment_id', assessmentId, data.tags);
      }

      await logAudit(db, {
        entityType: 'assessment',
        entityId: assessmentId,
        action: 'create',
        userId: req.user?.id ?? null,
        changes: { title: data.title, project_id: data.projectId ?? null },
      });

      logger.info('Assessment created', {
        assessmentId,
        title: data.title,
        projectId: data.projectId,
        requestId: req.requestId,
      });

      // Webhooks, chat, notification rules and the assigned users' email
      // subscribe to this; it used to be declared but never emitted.
      if (req.user) {
        req.eventBus?.emit(
          ASSESSMENT_CREATED,
          { assessmentId, assessmentTitle: data.title, projectId: data.projectId ?? null, projectName, actorName: req.user.displayName },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      res.status(201).json({
        id: assessmentId,
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        state: 'new',
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Create assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

router.put('/:id', requireAuth, requirePermission('assessments.edit'), requireAssessmentWrite(), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateAssessmentSchema.parse(req.body);
    const db = getDatabase();

    const assessment = await db
      .selectFrom('assessment')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }

    // A state change via PUT is routed through the same transition
    // matrix the unified /transition endpoint uses. We also require
    // `assessments.manage` for any state change — the data-edit perm
    // (`assessments.edit`) is no longer sufficient. This closes the
    // back-door behaviour without breaking clients that use PUT to
    // drive state.
    if (data.state !== undefined && data.state !== assessment.state) {
      const callerPerms = req.user?.id ? await getPermissionsForRole(req.user.role) : [];
      if (!callerPerms.includes('assessments.manage')) {
        res.status(403).json({ error: 'State transitions require assessments.manage permission' });
        return;
      }
      const transitionResult = await applyAssessmentTransition(
        db,
        req,
        assessment as Record<string, unknown> & { id: string; state: string; title: string },
        data.state as AssessmentState,
      );
      if (!transitionResult.ok) {
        res.status(transitionResult.status).json(transitionResult.body);
        return;
      }
    }

    // Non-state mutations cannot land on archived or completed rows.
    const nonStateFieldsPresent = ['title', 'description', 'dueDate', 'tags', 'assessorIds', 'assesseeIds']
      .some((k) => (data as Record<string, unknown>)[k] !== undefined);
    if (nonStateFieldsPresent) {
      // Re-fetch state after a possible transition above so we evaluate
      // against the post-transition row, not the original.
      const refreshed = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .select(['state'])
        .executeTakeFirstOrThrow();
      if (refreshed.state === 'archived') {
        res.status(403).json({ error: 'Archived assessments cannot be modified' });
        return;
      }
      if (refreshed.state === 'complete') {
        res.status(403).json({ error: 'Completed assessments are read-only. Reopen to make changes.' });
        return;
      }
    }

    const updateData = buildAssessmentUpdateData(data);
    if (Object.keys(updateData).length > 0) {
      await db
        .updateTable('assessment')
        .set(updateData)
        .where('id', '=', req.params.id as string)
        .execute();
    }

    // Sync tags and assignments
    if (data.tags !== undefined) {
      await syncEntityTags(db, 'assessment_tag', 'assessment_id', req.params.id as string, data.tags);
    }

    await syncAssessors(db, req.params.id as string, data.assessorIds);
    await syncAssessees(db, req.params.id as string, data.assesseeIds);

    // State transitions are logged as state_change inside
    // applyAssessmentTransition; only log an update when data fields
    // actually changed so a pure PUT-driven transition yields one row.
    if (Object.keys(updateData).length > 0) {
      await logAudit(db, {
        entityType: 'assessment',
        entityId: req.params.id as string,
        action: 'update',
        userId: req.user?.id ?? null,
        changes: updateData,
      });
    }

    logger.info('Assessment updated', {
      assessmentId: req.params.id as string,
      requestId: req.requestId,
    });

    // Fetch and return the updated assessment
    const updatedAssessment = await db
      .selectFrom('assessment')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    const tagsByAssessment = await fetchTagsForEntities(db, 'assessment_tag', 'assessment_id', [req.params.id as string]);

    res.json({
      ...updatedAssessment,
      tags: tagsByAssessment[req.params.id as string] || [],
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;

    logger.error('Update assessment error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

router.post(
  '/:id/start',
  requireAuth,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // The /start endpoint accepts an optional body carrying standardIds
      // for ad hoc assessments. The common path (entity- or project-linked
      // assessments) sends no body, in which case Express leaves
      // req.body as undefined because no Content-Type was set. Coerce to
      // an empty object so the schema's optional fields apply cleanly
      // rather than the parser rejecting the missing root with a 400.
      const bodyData = startAssessmentSchema.parse(req.body ?? {});
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      if (assessment.state !== 'new') {
        res.status(409).json({ error: 'Assessment can only be started from the new state' });
        return;
      }

      // If the setup screen linked a standard or set a task label, persist those before starting
      const startUpdates: Record<string, unknown> = {
        state: 'in_progress',
        start_date: new Date(),
      };
      if (bodyData.standardId) startUpdates.standard_id = bodyData.standardId;
      if (bodyData.taskLabel) startUpdates.task_label = bodyData.taskLabel;
      if (bodyData.assessmentType) startUpdates.assessment_type = bodyData.assessmentType;

      await db
        .updateTable('assessment')
        .set(startUpdates)
        .where('id', '=', req.params.id as string)
        .execute();

      // Re-fetch so standard_id / type / task_label are current for the requirement-loading logic below
      const effectiveAssessment = {
        ...assessment,
        ...(bodyData.standardId ? { standard_id: bodyData.standardId } : {}),
        ...(bodyData.assessmentType ? { assessment_type: bodyData.assessmentType } : {}),
      };

      // Task assessments have no requirements — they are freeform work items
      if (effectiveAssessment.assessment_type === 'tasks') {
        if (req.user) {
          req.eventBus?.emit(
            ASSESSMENT_STATE_CHANGED,
            {
              assessmentId: req.params.id as string,
              assessmentTitle: assessment.title,
              previousState: assessment.state,
              newState: 'in_progress',
            },
            { userId: req.user.id, displayName: req.user.displayName },
          );
        }
        res.json({ message: 'Assessment started successfully' });
        return;
      }

      let requirements;

      // Targeted assessments: use caller-supplied requirement IDs directly
      if (effectiveAssessment.assessment_type === 'targeted') {
        if (!bodyData.requirementIds || bodyData.requirementIds.length === 0) {
          res.status(400).json({ error: 'requirementIds required for targeted assessments' });
          return;
        }
        requirements = (await db
          .selectFrom('requirement')
          .where('id', 'in', bodyData.requirementIds)
          .selectAll()
          .execute()) as Record<string, unknown>[];
      } else if (effectiveAssessment.standard_id) {
        // Load all requirements from the specific standard
        requirements = (await db
          .selectFrom('requirement')
          .where('requirement.standard_id', '=', effectiveAssessment.standard_id!)
          .selectAll()
          .execute()) as Record<string, unknown>[];
      } else if (effectiveAssessment.entity_id) {
        // Load requirements from entity's associated standards
        requirements = (await db
          .selectFrom('requirement')
          .innerJoin(
            'entity_standard',
            (join) =>
              join.onRef(
                'entity_standard.standard_id',
                '=',
                'requirement.standard_id'
              )
          )
          .where('entity_standard.entity_id', '=', effectiveAssessment.entity_id)
          .selectAll()
          .execute()) as Record<string, unknown>[];
      } else if (effectiveAssessment.project_id && effectiveAssessment.project_id.trim() !== '') {
        // Load requirements from project's associated standards
        requirements = (await db
          .selectFrom('requirement')
          .innerJoin(
            'project_standard',
            (join) =>
              join.onRef(
                'project_standard.standard_id',
                '=',
                'requirement.standard_id'
              )
          )
          .where('project_standard.project_id', '=', effectiveAssessment.project_id)
          .selectAll()
          .execute()) as Record<string, unknown>[];
      } else {
        // Fallback to body data
        if (!bodyData.standardIds || bodyData.standardIds.length === 0) {
          res.status(400).json({ error: 'standardIds required for ad hoc assessments' });
          return;
        }

        requirements = (await db
          .selectFrom('requirement')
          .where('requirement.standard_id', 'in', bodyData.standardIds)
          .selectAll()
          .execute()) as Record<string, unknown>[];
      }

      for (const requirement of requirements) {
        await db
          .insertInto('assessment_requirement')
          .values({
            id: uuidv4(),
            assessment_id: req.params.id as string,
            requirement_id: requirement.id,
          })
          .onConflict(oc => oc.column('assessment_id').column('requirement_id').doNothing())
          .execute();
      }

      if (req.user) {
        req.eventBus?.emit(
          ASSESSMENT_STATE_CHANGED,
          {
            assessmentId: req.params.id as string,
            assessmentTitle: assessment.title,
            previousState: assessment.state,
            newState: 'in_progress',
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      logger.info('Assessment started', {
        assessmentId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment started successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Start assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/:id/complete',
  requireSession,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      if (assessment.state !== 'in_progress') {
        res.status(409).json({ error: 'Assessment can only be completed from the in_progress state' });
        return;
      }

      const requirements = await db
        .selectFrom('assessment_requirement')
        .where('assessment_id', '=', req.params.id as string)
        .selectAll()
        .execute();

      if (assessment.assessment_type === 'tasks') {
        // Task assessments have no requirements — just verify at least one directly-linked evidence item exists
        const directEvidence = await db
          .selectFrom('assessment_evidence')
          .where('assessment_id', '=', req.params.id as string)
          .selectAll()
          .execute();
        if (directEvidence.length === 0) {
          res.status(400).json({ error: 'Cannot complete task assessment without any evidence. Link at least one evidence item before completing.' });
          return;
        }
        const { openClaims: taskOpenClaims, openMitigations: taskOpenMitigations } =
          await findOpenClaimsAndMitigations(db, req.params.id as string);
        if (taskOpenClaims.length > 0 || taskOpenMitigations.length > 0) {
          res.status(400).json({
            error: 'Cannot complete assessment: all linked claims must be Accepted or Rejected, and all linked mitigations must be Verified or Closed.',
            openClaims: taskOpenClaims,
            openMitigations: taskOpenMitigations,
          });
          return;
        }
      } else {
        // Validate all prerequisites for completion
        if (!await validateCompletionPrerequisites(db, req.params.id as string, requirements, res)) {
          return;
        }
      }

      // Calculate conformance score
      const conformanceScore = calculateConformanceScore(requirements);

      await db
        .updateTable('assessment')
        .set({
          state: 'complete',
          end_date: new Date(),
          conformance_score: conformanceScore,
        })
        .where('id', '=', req.params.id as string)
        .execute();

      req.eventBus?.emit(
        ASSESSMENT_STATE_CHANGED,
        {
          assessmentId: req.params.id as string,
          assessmentTitle: assessment.title,
          previousState: assessment.state,
          // The real state name; the email and in-app builders accept it.
          newState: 'complete',
        },
        { userId: req.user!.id, displayName: req.user!.displayName },
      );

      logger.info('Assessment completed', {
        assessmentId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment completed successfully' });
    } catch (error) {
      logger.error('Complete assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Archive an assessment (irreversible)
router.post(
  '/:id/archive',
  requireSession,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      if (assessment.state === 'archived') {
        res.status(409).json({ error: 'Assessment is already archived' });
        return;
      }

      if (assessment.state !== 'complete') {
        res.status(409).json({ error: 'Only completed assessments can be archived' });
        return;
      }

      await db
        .updateTable('assessment')
        .set({ state: 'archived' })
        .where('id', '=', req.params.id as string)
        .execute();

      logger.info('Assessment archived', {
        assessmentId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment archived successfully' });
    } catch (error) {
      logger.error('Archive assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Reopen a completed assessment (returns to in_progress)
router.post(
  '/:id/reopen',
  requireAuth,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      if (assessment.state === 'archived') {
        res.status(403).json({ error: 'Archived assessments cannot be reopened' });
        return;
      }

      if (assessment.state !== 'complete') {
        res.status(409).json({ error: 'Only completed assessments can be reopened' });
        return;
      }

      // A sealed (and not-yet-rescinded) affirmation cryptographically
      // attests to the completed state. Reopening would mutate the
      // assessment underneath that seal, leaving the on-disk JSF
      // signature pointing at a snapshot that no longer exists.
      // Operator must explicitly rescind first.
      const liveAffirmation = await db
        .selectFrom('affirmation')
        .where('assessment_id', '=', req.params.id as string)
        .where('sealed_at', 'is not', null)
        .where('rescinded_at', 'is', null)
        .select(['id', 'sealed_at'])
        .executeTakeFirst();

      if (liveAffirmation) {
        res.status(409).json({
          error: 'Cannot reopen: a sealed affirmation attests to this assessment\'s completed state. Rescind the affirmation first.',
          reason: 'affirmation_sealed',
          affirmationId: liveAffirmation.id,
          sealedAt: liveAffirmation.sealed_at,
        });
        return;
      }

      await db
        .updateTable('assessment')
        .set({
          state: 'in_progress',
          end_date: null,
        })
        .where('id', '=', req.params.id as string)
        .execute();

      logger.info('Assessment reopened', {
        assessmentId: req.params.id as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment reopened successfully' });
    } catch (error) {
      logger.error('Reopen assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Update a specific assessment requirement result
const updateRequirementSchema = z.object({
  result: z.enum(['yes', 'no', 'partial', 'not_applicable']).nullable().optional(),
  rationale: z.string().nullable().optional(),
  owner: z.string().max(255).nullable().optional(),
  owner_email: z.string().max(255).nullable().optional(),
  owner_role: z.string().max(255).nullable().optional(),
  oe_entity: z.string().max(255).nullable().optional(),
  business_unit: z.string().max(255).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  assessed_by: z.string().max(255).nullable().optional(),
  assessment_date: z.string().nullable().optional(),
  next_review_date: z.string().nullable().optional(),
  conformance_score: z.number().min(0).max(1).nullable().optional(),
  conformance_rationale: z.string().nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional(),
  confidence_rationale: z.string().nullable().optional(),
});

const addWorkNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

const startAssessmentSchema = z.object({
  standardIds: z.array(z.string().uuid()).optional(),
  requirementIds: z.array(z.string().uuid()).optional(),
  // For setup-screen promotions: allow linking a standard, changing type, or setting task label at start time
  standardId: z.string().uuid().optional(),
  taskLabel: z.string().max(25).optional(),
  assessmentType: z.enum(['standards', 'targeted', 'tasks']).optional(),
});

// =====================================================================
// Unified state-transition route.
//
// POST /api/v1/assessments/:id/transition  { to: <state>, reason?: string }
//
// This is the canonical entry point for every state change. The legacy
// dedicated routes (/start, /complete, /archive, /reopen) remain for
// backward compatibility and call the same internal helpers via the
// same router; new clients should use /transition exclusively.
//
// The transition matrix below encodes every allowed (from -> to). Any
// (from, to) pair not in the matrix is rejected with 409 — there is no
// silent acceptance. Permission is `assessments.manage`, matching the
// dedicated routes; the data-edit permission `assessments.edit` is
// deliberately not enough.
//
// Transitions with rich preconditions (complete, reopen) delegate to
// the same validators the dedicated routes use, so the unified route
// cannot bypass them.
// =====================================================================

type AssessmentState =
  | 'new'
  | 'pending'
  | 'in_progress'
  | 'on_hold'
  | 'cancelled'
  | 'complete'
  | 'archived';

const ALLOWED_TRANSITIONS: Record<AssessmentState, AssessmentState[]> = {
  new: ['in_progress', 'pending', 'cancelled'],
  pending: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['on_hold', 'complete', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  complete: ['in_progress', 'archived'],
  archived: [], // terminal
  cancelled: [], // terminal
};

const transitionSchema = z.object({
  to: z.enum(['new', 'pending', 'in_progress', 'on_hold', 'cancelled', 'complete', 'archived']),
  reason: z.string().max(1000).optional(),
});

/**
 * Apply a state transition for the given assessment.
 *
 * Shared by POST /:id/transition (the canonical entry point) and the
 * legacy PUT /:id when the request body carries a `state` field. Both
 * paths run through this function so the matrix, the completion
 * preconditions, and the affirmation-seal check cannot be bypassed.
 *
 * Returns `{ ok: true, from, to }` on success or `{ ok: false, status, body }`
 * describing the error to surface. Caller is responsible for writing
 * the response.
 */
async function applyAssessmentTransition(
  db: ReturnType<typeof getDatabase>,
  req: AuthRequest,
  assessment: Record<string, unknown> & { id: string; state: string; title: string },
  to: AssessmentState,
): Promise<
  | { ok: true; from: AssessmentState; to: AssessmentState }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const from = assessment.state as AssessmentState;

  // Final, high-consequence states seal the assessment (completion locks
  // it read-only, archive/cancel are terminal). These must not be driven
  // programmatically: an API key that reaches this point can move an
  // assessment through working states, but sealing it requires an
  // interactive session so a human is accountable for the transition.
  const FINAL_STATES: AssessmentState[] = ['complete', 'archived', 'cancelled'];
  if (FINAL_STATES.includes(to) && req.authMethod === 'apikey') {
    return {
      ok: false,
      status: 403,
      body: {
        error: `Transitioning to '${to}' requires an interactive session and cannot be performed with an API key.`,
        reason: 'session_required',
      },
    };
  }

  if (from === to) {
    return {
      ok: false,
      status: 409,
      body: { error: `Assessment is already in state '${to}'`, reason: 'no_op_transition' },
    };
  }

  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      status: 409,
      body: {
        error: `Transition not allowed: '${from}' -> '${to}'`,
        reason: 'invalid_transition',
        from,
        to,
        allowedFromHere: allowed,
      },
    };
  }

  const updateData: Record<string, unknown> = { state: to };

  if (to === 'in_progress' && from === 'new') {
    const existingReqs = await db
      .selectFrom('assessment_requirement')
      .where('assessment_id', '=', assessment.id)
      .select('id')
      .limit(1)
      .executeTakeFirst();
    if (!existingReqs) {
      return {
        ok: false,
        status: 409,
        body: {
          error:
            'Use POST /:id/start to start an assessment for the first time (requirements must be hydrated from the assigned standard).',
          reason: 'requirements_not_hydrated',
        },
      };
    }
    updateData.start_date = new Date();
  }

  if (to === 'complete' && from === 'in_progress') {
    const requirements = await db
      .selectFrom('assessment_requirement')
      .where('assessment_id', '=', assessment.id)
      .selectAll()
      .execute();
    // validateCompletionPrerequisites needs a Response to write 400s
    // into. We have to lift it: synthesise a minimal collector that
    // captures the prerequisite failure body so we can return it.
    // The local is typed `Record<string, unknown> | null` from the
    // outset (not narrowed to `null`) so the inner closures can both
    // assign and read it.
    const captured: { status: number; body: Record<string, unknown> } = { status: 400, body: {} };
    const capture: Pick<Response, 'status' | 'json'> = {
      status(code: number) {
        captured.status = code;
        return capture as Response;
      },
      json(body: unknown) {
        captured.body = { ...captured.body, ...(body as Record<string, unknown>) };
        return capture as Response;
      },
    } as unknown as Response;
    const ok = await validateCompletionPrerequisites(db, assessment.id, requirements, capture as Response);
    if (!ok) {
      return { ok: false, status: captured.status, body: captured.body };
    }
    updateData.end_date = new Date();
    updateData.conformance_score = calculateConformanceScore(requirements);
  }

  if (to === 'in_progress' && from === 'complete') {
    const liveAffirmation = await db
      .selectFrom('affirmation')
      .where('assessment_id', '=', assessment.id)
      .where('sealed_at', 'is not', null)
      .where('rescinded_at', 'is', null)
      .select(['id', 'sealed_at'])
      .executeTakeFirst();
    if (liveAffirmation) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "Cannot reopen: a sealed affirmation attests to this assessment's completed state. Rescind the affirmation first.",
          reason: 'affirmation_sealed',
          affirmationId: liveAffirmation.id,
          sealedAt: liveAffirmation.sealed_at,
        },
      };
    }
    updateData.end_date = null;
  }

  if (to === 'cancelled') {
    updateData.end_date = new Date();
  }

  await db
    .updateTable('assessment')
    .set(updateData)
    .where('id', '=', assessment.id)
    .execute();

  await logAudit(db, {
    entityType: 'assessment',
    entityId: assessment.id,
    action: 'state_change',
    userId: req.user?.id ?? null,
    changes: { from, to },
  });

  req.eventBus?.emit(
    ASSESSMENT_STATE_CHANGED,
    {
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      previousState: from,
      newState: to,
    },
    { userId: req.user!.id, displayName: req.user!.displayName },
  );

  logger.info('Assessment state transitioned', {
    assessmentId: assessment.id,
    from,
    to,
    requestId: req.requestId,
  });

  return { ok: true, from, to };
}

router.post(
  '/:id/transition',
  requireAuth,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    let data: z.infer<typeof transitionSchema>;
    try {
      data = transitionSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }
      throw error;
    }

    const db = getDatabase();
    const assessment = await db
      .selectFrom('assessment')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }

    const result = await applyAssessmentTransition(
      db,
      req,
      assessment as Record<string, unknown> & { id: string; state: string; title: string },
      data.to,
    );
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }

    res.json({
      message: `Assessment transitioned from '${result.from}' to '${result.to}'`,
      from: result.from,
      to: result.to,
    });
  }),
);

// Update assessment requirement result and rationale on the assessment_requirement junction table.
// Note: This endpoint updates the ASSESSMENT-SPECIFIC result and rationale, NOT the standard requirement definition.
router.put(
  '/:id/requirements/:requirementId',
  requireAuth,
  requirePermission('assessments.edit'),
  requireAssessmentWrite(),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateRequirementSchema.parse(req.body);
      const db = getDatabase();

      // Guard: reject mutations on complete/archived assessments
      const mutableCheck = await requireMutableAssessment(db, req.params.id as string, res);
      if (!mutableCheck) return;

      const assessmentReq = await db
        .selectFrom('assessment_requirement')
        .where('assessment_id', '=', req.params.id)
        .where('requirement_id', '=', req.params.requirementId as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessmentReq) {
        res.status(404).json({ error: 'Assessment requirement not found' });
        return;
      }

      if (data.rationale !== undefined && data.rationale !== null) {
        const wordCount = data.rationale.split(/\s+/).filter(word => word.length > 0).length;
        if (wordCount < 15) {
          res.status(400).json({ error: 'Rationale must be at least 15 words' });
          return;
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.result !== undefined) updateData.result = data.result;
      if (data.rationale !== undefined) updateData.rationale = data.rationale;
      if (data.owner !== undefined) updateData.owner = data.owner;
      if (data.owner_email !== undefined) updateData.owner_email = data.owner_email;
      if (data.owner_role !== undefined) updateData.owner_role = data.owner_role;
      if (data.oe_entity !== undefined) updateData.oe_entity = data.oe_entity;
      if (data.business_unit !== undefined) updateData.business_unit = data.business_unit;
      if (data.region !== undefined) updateData.region = data.region;
      if (data.assessed_by !== undefined) updateData.assessed_by = data.assessed_by;
      if (data.assessment_date !== undefined) updateData.assessment_date = data.assessment_date || null;
      if (data.next_review_date !== undefined) updateData.next_review_date = data.next_review_date || null;
      if (data.conformance_score !== undefined) updateData.conformance_score = data.conformance_score;
      if (data.conformance_rationale !== undefined) updateData.conformance_rationale = data.conformance_rationale;
      if (data.confidence_score !== undefined) updateData.confidence_score = data.confidence_score;
      if (data.confidence_rationale !== undefined) updateData.confidence_rationale = data.confidence_rationale;

      if (Object.keys(updateData).length > 0) {
        await db
          .updateTable('assessment_requirement')
          .set(updateData)
          .where('assessment_id', '=', req.params.id as string)
          .where('requirement_id', '=', req.params.requirementId as string)
          .execute();
      }

      logger.info('Assessment requirement updated', {
        assessmentId: req.params.id as string,
        requirementId: req.params.requirementId as string,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment requirement updated successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Update assessment requirement error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get(
  '/:id/requirements/:requirementId/evidence',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const assessmentReq = await db
        .selectFrom('assessment_requirement')
        .where('assessment_id', '=', req.params.id as string)
        .where('requirement_id', '=', req.params.requirementId as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessmentReq) {
        res.status(404).json({ error: 'Assessment requirement not found' });
        return;
      }

      // Explicit columns. selectAll() on this join would overwrite
      // evidence.id with app_user.id (both tables expose `id`) and the
      // caller would see the author user id where it expected the
      // evidence id. The collision was a real bug; the explicit list
      // below prevents the entire class.
      const evidence = (await db
        .selectFrom('assessment_requirement_evidence')
        .innerJoin(
          'evidence',
          (join) =>
            join.onRef(
              'evidence.id',
              '=',
              'assessment_requirement_evidence.evidence_id'
            )
        )
        .innerJoin(
          'app_user as author_user',
          (join) =>
            join.onRef(
              'author_user.id',
              '=',
              'evidence.author_id'
            )
        )
        .leftJoin(
          'app_user as reviewer_user',
          (join) =>
            join.onRef(
              'reviewer_user.id',
              '=',
              'evidence.reviewer_id'
            )
        )
        .where('assessment_requirement_evidence.assessment_requirement_id', '=', assessmentReq.id)
        .select([
          'evidence.id',
          'evidence.name',
          'evidence.description',
          'evidence.state',
          'evidence.author_id',
          'evidence.reviewer_id',
          'evidence.is_counter_evidence',
          'evidence.classification',
          'evidence.created_at',
          'evidence.expires_on',
          'author_user.display_name as author_name',
          'reviewer_user.display_name as reviewer_name',
        ])
        .execute()) as Record<string, unknown>[];

      const evidenceIds = evidence.map((e: Record<string, unknown>) => e.id as string);
      const tagsByEvidence = await fetchTagsForEntities(db, 'evidence_tag', 'evidence_id', evidenceIds);
      const visible = await visibleEvidenceIds(db, req.user!, evidence.map((e: Record<string, unknown>) => e.id as string));
      const evidenceWithTags = evidence
        .filter((e: Record<string, unknown>) => visible === null || visible.has(e.id as string))
        .map((e: Record<string, unknown>) => ({
          ...e,
          tags: tagsByEvidence[e.id as string] || [],
        }));

      res.json({
        data: evidenceWithTags,
      });
    } catch (error) {
      logger.error('Get requirement evidence error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Returns requirements for a standard, optionally filtered by level.
// Used by the Targeted assessment setup screen to populate the picker.
router.get(
  '/:id/requirements-available',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
    const db = getDatabase();

    const assessment = await db
      .selectFrom('assessment')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }

    if (!assessment.standard_id) {
      res.json({ levels: [], requirements: [], noStandard: true });
      return;
    }

    const { levelId } = req.query as { levelId?: string };

    // Fetch all levels for the standard so the UI can show filter chips
    const levels = await db
      .selectFrom('level')
      .where('standard_id', '=', assessment.standard_id)
      .selectAll()
      .execute();

    let query = db
      .selectFrom('requirement')
      .where('requirement.standard_id', '=', assessment.standard_id);

    if (levelId) {
      query = query
        .innerJoin('level_requirement', 'level_requirement.requirement_id', 'requirement.id')
        .where('level_requirement.level_id', '=', levelId) as typeof query;
    }

    const requirements = await query.selectAll('requirement').execute();

    // Attach level membership to each requirement so the UI can group them
    const levelRequirements = await db
      .selectFrom('level_requirement')
      .innerJoin('level', 'level.id', 'level_requirement.level_id')
      .where('level.standard_id', '=', assessment.standard_id)
      .select(['level_requirement.requirement_id', 'level_requirement.level_id', 'level.identifier as level_identifier', 'level.title as level_title'])
      .execute();

    const levelsByReqId: Record<string, { id: string; identifier: string; title: string }[]> = {};
    for (const lr of levelRequirements) {
      if (!levelsByReqId[lr.requirement_id]) levelsByReqId[lr.requirement_id] = [];
      levelsByReqId[lr.requirement_id].push({
        id: lr.level_id,
        identifier: lr.level_identifier ?? '',
        title: lr.level_title ?? '',
      });
    }

    res.json({
      levels,
      requirements: requirements.map(r => ({
        ...r,
        levels: levelsByReqId[(r as { id: string }).id] || [],
      })),
    });
  })
);

router.get(
  '/:id/evidence',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const evidence = (await db
        .selectFrom('assessment_requirement_evidence')
        .innerJoin('evidence', (join) =>
          join.onRef('evidence.id', '=', 'assessment_requirement_evidence.evidence_id')
        )
        .innerJoin('assessment_requirement', (join) =>
          join.onRef('assessment_requirement.id', '=', 'assessment_requirement_evidence.assessment_requirement_id')
        )
        .leftJoin('app_user as author', (join) =>
          join.onRef('author.id', '=', 'evidence.author_id')
        )
        .where('assessment_requirement.assessment_id', '=', req.params.id as string)
        .select([
          'evidence.id',
          'evidence.name',
          'evidence.description',
          'evidence.state',
          'evidence.author_id',
          'evidence.is_counter_evidence',
          'evidence.classification',
          'evidence.created_at',
          'evidence.expires_on',
          'author.display_name as author_name',
          'assessment_requirement.requirement_id',
        ] as const)
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic query result requires type assertion
        .execute()) as Record<string, unknown>[];

      // Deduplicate evidence (one item can be linked to multiple requirements)
      const evidenceMap = new Map<string, Record<string, unknown>>();
      for (const e of evidence) {
        const eId = e.id as string;
        if (!evidenceMap.has(eId)) {
          evidenceMap.set(eId, { ...e, requirement_ids: [e.requirement_id], direct_link: false });
        } else {
          const eRecord = evidenceMap.get(eId);
          if (eRecord) {
            (eRecord.requirement_ids as unknown[]).push(e.requirement_id);
          }
        }
      }

      // Also include evidence directly linked to the assessment (task assessments)
      const directEvidence = (await db
        .selectFrom('assessment_evidence')
        .innerJoin('evidence', 'evidence.id', 'assessment_evidence.evidence_id')
        .leftJoin('app_user as author', 'author.id', 'evidence.author_id')
        .where('assessment_evidence.assessment_id', '=', req.params.id as string)
        .select([
          'evidence.id',
          'evidence.name',
          'evidence.description',
          'evidence.state',
          'evidence.author_id',
          'evidence.is_counter_evidence',
          'evidence.classification',
          'evidence.created_at',
          'evidence.expires_on',
          'author.display_name as author_name',
        ] as const)
        .execute()) as Record<string, unknown>[];

      for (const e of directEvidence) {
        const eId = e.id as string;
        if (!evidenceMap.has(eId)) {
          evidenceMap.set(eId, { ...e, requirement_ids: [], direct_link: true });
        }
      }

      const visible = await visibleEvidenceIds(db, req.user!, Array.from(evidenceMap.keys()));
      const uniqueEvidence = Array.from(evidenceMap.values())
        .filter((e) => visible === null || visible.has(e.id as string));

      const evidenceIds = uniqueEvidence.map((e: Record<string, unknown>) => (e.id as string));
      const tagsByEvidence = await fetchTagsForEntities(db, 'evidence_tag', 'evidence_id', evidenceIds);
      const evidenceWithTags = uniqueEvidence.map((e: Record<string, unknown>) => ({
        ...e,
        tags: tagsByEvidence[e.id as string] || [],
      }));

      res.json({
        data: evidenceWithTags,
      });
    } catch (error) {
      logger.error('Get assessment evidence error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Link an existing evidence item directly to an assessment (task assessments)
router.post(
  '/:id/evidence/link',
  requireAuth,
  requirePermission('assessments.edit'),
  requireAssessmentWrite(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
    const db = getDatabase();

    const { evidenceId } = z.object({ evidenceId: z.string().uuid() }).parse(req.body);

    const assessment = await db
      .selectFrom('assessment')
      .where('id', '=', req.params.id as string)
      .select(['id', 'state'])
      .executeTakeFirst();

    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found' });
      return;
    }
    if (getReadOnlyError(assessment.state)) {
      res.status(409).json({ error: getReadOnlyError(assessment.state) });
      return;
    }

    const ev = await db.selectFrom('evidence').where('id', '=', evidenceId).select('id').executeTakeFirst();
    if (!ev) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    await db
      .insertInto('assessment_evidence')
      .values({ assessment_id: req.params.id as string, evidence_id: evidenceId, created_at: new Date() })
      .onConflict(oc => oc.columns(['assessment_id', 'evidence_id']).doNothing())
      .execute();

    res.json({ message: 'Evidence linked successfully' });
  })
);

// Unlink a directly-linked evidence item from an assessment
router.delete(
  '/:id/evidence/:evidenceId/unlink',
  requireAuth,
  requirePermission('assessments.edit'),
  requireAssessmentWrite(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
    const db = getDatabase();

    await db
      .deleteFrom('assessment_evidence')
      .where('assessment_id', '=', req.params.id as string)
      .where('evidence_id', '=', req.params.evidenceId as string)
      .execute();

    res.json({ message: 'Evidence unlinked successfully' });
  })
);

// Get all claims for an assessment (via its attestation(s))
router.get(
  '/:id/claims',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      // Find all attestations for this assessment
      const attestations = await db
        .selectFrom('attestation')
        .where('assessment_id', '=', req.params.id as string)
        .select(['id'])
        .execute();

      if (attestations.length === 0) {
        res.json({ data: [] });
        return;
      }

      const attestationIds = attestations.map(a => a.id);

      // Fetch claims linked to these attestations
      const claims = (await db
        .selectFrom('claim')
        .where('attestation_id', 'in', attestationIds)
        .selectAll()
        .orderBy('created_at', 'asc')
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic query result requires type assertion
        .execute()) as Record<string, unknown>[];

      // For each claim, get evidence counts
      const claimIds = claims.map(c => c.id as string);

      const evidenceCounts = new Map<string, number>();
      const counterEvidenceCounts = new Map<string, number>();
      const mitigationCounts = new Map<string, number>();

      if (claimIds.length > 0) {
        const evCounts = await db
          .selectFrom('claim_evidence')
          .where('claim_id', 'in', claimIds)
          .select((eb) => [
            'claim_id',
            eb.fn.countAll().as('count'),
          ])
          .groupBy('claim_id')
          .execute();
        for (const row of evCounts) {
          evidenceCounts.set(row.claim_id, Number(row.count));
        }

        const ceCounts = await db
          .selectFrom('claim_counter_evidence')
          .where('claim_id', 'in', claimIds)
          .select((eb) => [
            'claim_id',
            eb.fn.countAll().as('count'),
          ])
          .groupBy('claim_id')
          .execute();
        for (const row of ceCounts) {
          counterEvidenceCounts.set(row.claim_id, Number(row.count));
        }

        const mitCounts = await db
          .selectFrom('claim_mitigation_strategy')
          .where('claim_id', 'in', claimIds)
          .select((eb) => [
            'claim_id',
            eb.fn.countAll().as('count'),
          ])
          .groupBy('claim_id')
          .execute();
        for (const row of mitCounts) {
          mitigationCounts.set(row.claim_id, Number(row.count));
        }
      }

      // Fetch target entity names for claims that have target_entity_id
      const targetEntityNames = new Map<string, { name: string; entity_type: string }>();
      const targetEntityIds = claims
        .map(c => c.target_entity_id)
        .filter((id): id is string => id != null);
      if (targetEntityIds.length > 0) {
        const entities = await db
          .selectFrom('entity')
          .where('id', 'in', [...new Set(targetEntityIds)])
          .select(['id', 'name', 'entity_type'])
          .execute();
        for (const e of entities) {
          targetEntityNames.set(e.id, { name: e.name, entity_type: e.entity_type });
        }
      }

      // Fetch external references for all claims
      const externalRefsByClaimId = new Map<string, Record<string, unknown>[]>();
      if (claimIds.length > 0) {
        const extRefs = (await db
          .selectFrom('claim_external_reference')
          .where('claim_id', 'in', claimIds)
          .selectAll()
          .orderBy('created_at', 'asc')
          .execute()) as Record<string, unknown>[];
        for (const ref of extRefs) {
          const refRecord = ref as Record<string, unknown>;
          const claimId = refRecord.claim_id as string;
          if (!externalRefsByClaimId.has(claimId)) {
            externalRefsByClaimId.set(claimId, []);
          }
          const refs = externalRefsByClaimId.get(claimId);
          if (refs) {
            refs.push(ref);
          }
        }
      }

      const claimsWithCounts = claims.map(c => {
        const cId = c.id as string;
        const cTargetEntityId = c.target_entity_id as string | null;
        const targetEntity = cTargetEntityId
          ? targetEntityNames.get(cTargetEntityId)
          : null;
        return {
          ...c,
          target_entity_name: targetEntity?.name ?? null,
          target_entity_type: targetEntity?.entity_type ?? null,
          evidence_count: evidenceCounts.get(cId) ?? 0,
          counter_evidence_count: counterEvidenceCounts.get(cId) ?? 0,
          mitigation_count: mitigationCounts.get(cId) ?? 0,
          external_references: externalRefsByClaimId.get(cId) ?? [],
        };
      });

      res.json({ data: claimsWithCounts });
    } catch (error) {
      logger.error('Get assessment claims error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Assessment participants (for @mention autocomplete)
router.get(
  '/:id/participants',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .select('id')
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const assessors = (await db
        .selectFrom('assessment_assessor')
        .innerJoin('app_user', (join) =>
          join.onRef('app_user.id', '=', 'assessment_assessor.user_id')
        )
        .where('assessment_assessor.assessment_id', '=', req.params.id as string)
        .select([
          'app_user.id',
          'app_user.username',
          'app_user.display_name',
          'app_user.role',
        ])
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic query result requires type assertion
        .execute()) as Record<string, unknown>[];

      // biome-ignore lint/suspicious/noExplicitAny: Dynamic query result requires type assertion
      const assessees = (await db
        .selectFrom('assessment_assessee')
        .innerJoin('app_user', (join) =>
          join.onRef('app_user.id', '=', 'assessment_assessee.user_id')
        )
        .where('assessment_assessee.assessment_id', '=', req.params.id as string)
        .select([
          'app_user.id',
          'app_user.username',
          'app_user.display_name',
          'app_user.role',
        ])
        .execute()) as Record<string, unknown>[];

      // Deduplicate (a user could be both assessor and assessee)
      const seen = new Set<string>();
      const participants: Record<string, unknown>[] = [];
      for (const u of [...assessors, ...assessees]) {
        const uId = u.id as string;
        if (!seen.has(uId)) {
          seen.add(uId);
          participants.push(u);
        }
      }

      res.json({ data: participants });
    } catch (error) {
      logger.error('Get assessment participants error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Work Notes - assessment-level notes with author and comment
router.get(
  '/:id/notes',
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!(await authorizeAssessmentRead(req, res, req.params.id as string))) return;
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const notes = (await db
        .selectFrom('work_note')
        .innerJoin(
          'app_user',
          (join) =>
            join.onRef(
              'app_user.id',
              '=',
              'work_note.user_id'
            )
        )
        .where('work_note.assessment_id', '=', req.params.id)
        .select([
          'work_note.id',
          'work_note.content',
          'work_note.created_at',
          'app_user.display_name as author_display_name',
          'app_user.username as author_username',
        ])
        .orderBy('work_note.created_at', 'desc')
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic query result requires type assertion
        .execute()) as Record<string, unknown>[];

      res.json({ data: notes });
    } catch (error) {
      logger.error('Get assessment notes error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/:id/notes',
  requireAuth,
  requirePermission('assessments.notes'),
  requireAssessmentParticipant(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = addWorkNoteSchema.parse(req.body);
      const db = getDatabase();

      // Guard: reject mutations on complete/archived assessments
      const mutableCheck = await requireMutableAssessment(db, req.params.id as string, res);
      if (!mutableCheck) return;

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const noteId = uuidv4();

      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await db
        .insertInto('work_note')
        .values({
          id: noteId,
          assessment_id: req.params.id as string,
          user_id: req.user.id,
          content: data.content,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute();

      // Parse @mentions from content and send targeted notifications
      // eslint-disable-next-line security/detect-unsafe-regex
      const mentionPattern = /@(\w+(?:\.\w+)*)/g;
      const mentionedUsernames = new Set<string>();
      const matches = data.content.matchAll(mentionPattern);
      for (const match of matches) {
        mentionedUsernames.add(match[1].toLowerCase());
      }

      if (mentionedUsernames.size > 0) {
        // Look up mentioned users by username (case insensitive)
        const allUsers = await db
          .selectFrom('app_user')
          .select(['id', 'username'])
          .execute();

        const authorDisplayName = req.user!.displayName || req.user!.username || 'Someone';

        for (const user of allUsers) {
          if (mentionedUsernames.has(user.username.toLowerCase()) && user.id !== req.user!.id) {
            await createNotification(db, {
              userId: user.id,
              type: 'work_note_mention',
              title: 'You were mentioned in a work note',
              message: `${authorDisplayName} mentioned you in a work note on assessment "${assessment.title}"`,
              link: `/assessments/${req.params.id}`,
            });
          }
        }
      }

      logger.info('Work note created', {
        noteId,
        assessmentId: req.params.id as string,
        mentions: Array.from(mentionedUsernames),
        requestId: req.requestId,
      });

      res.status(201).json({ id: noteId, message: 'Work note added successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }

      logger.error('Add work note error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();
      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', req.params.id as string)
        .select(['id', 'title', 'state'])
        .executeTakeFirst();

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      if (assessment.state === 'archived') {
        res.status(403).json({ error: 'Archived assessments cannot be deleted' });
        return;
      }

      // Soft delete: mark the row deleted (the public `assessment` name is a
      // view that hides deleted_at IS NOT NULL rows) and leave all child rows
      // — work_note, requirements, assessor/assessee assignments, tags —
      // intact so a restore is faithful. The child rows only surface through
      // the assessment, which is now hidden. Permanent removal (and the
      // dependent-row cleanup that RESTRICT foreign keys require) happens in
      // the scheduled purge job.
      await db.updateTable('assessment')
        .set({ deleted_at: new Date() })
        .where('id', '=', req.params.id as string)
        .execute();

      logger.info('Assessment deleted', {
        assessmentId: req.params.id as string,
        title: assessment.title,
        requestId: req.requestId,
      });

      res.json({ message: 'Assessment deleted' });
    } catch (error) {
      logger.error('Delete assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

// Restore a soft-deleted assessment. Targets the physical table (assessment_raw)
// because the assessment view hides deleted rows, so a plain updateTable through
// the view could not see the row to clear its deleted_at.
router.post(
  '/:id/restore',
  requireAuth,
  requirePermission('assessments.manage'),
  requireAssessmentWrite(),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const db = getDatabase();
      const row = await db
        .selectFrom('assessment_raw')
        .select(['id', 'deleted_at'])
        .where('id', '=', req.params.id as string)
        .executeTakeFirst();

      if (!row) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }
      if (!row.deleted_at) {
        res.status(409).json({ error: 'Assessment is not deleted' });
        return;
      }

      await db
        .updateTable('assessment_raw')
        .set({ deleted_at: null })
        .where('id', '=', req.params.id as string)
        .execute();

      logger.info('Assessment restored', { assessmentId: req.params.id as string, requestId: req.requestId });
      res.json({ message: 'Assessment restored' });
    } catch (error) {
      logger.error('Restore assessment error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

export default router;
