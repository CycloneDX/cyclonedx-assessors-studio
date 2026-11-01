import { Router } from 'express';
import { readableAssessmentIds, allowsAssessment, canWriteAssessment } from '../utils/access.js';
import { clampPagination } from '../utils/pagination.js';
import type { NextFunction, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import {
  checkAttestationAssessmentReadOnly,
  fetchAttestationById,
  fetchAttestationRequirements,
  fetchAttestationClaims,
  fetchSignatory,
  checkRequirementExists,
} from '../utils/attestation-queries.js';
import { rejectIfAttestationImmutable } from '../utils/retention.js';
import {
  TargetResolver,
  attestationFromRow,
  claimFromRow,
  composeBom,
  composeDeclarations,
  isCounterClaim,
  signatoryBlock,
  isSignatoryValid,
} from '../cdxspec/index.js';
import {
  buildAffirmationForAssessment,
  buildStandardsForAttestation,
} from '../utils/export-affirmation.js';
import type {
  Assessor as CdxAssessor,
  CdxSpecVersion,
  Claim as CdxClaim,
  AttestationRequirementRowInput,
  ClaimRefMap,
  ClaimRowInput,
  SignatoryBlockInput,
} from '../cdxspec/index.js';
import { ATTESTATION_CREATED } from '../events/catalog.js';

const router = Router();

// Coerce empty strings and explicit nulls to undefined before UUID validation
// so form fields that the user leaves blank do not trip .uuid() with an
// "Invalid input" error. This is important for the Create Attestation dialog
// where Signatory and Assessor are optional.
const optionalUuid = z.preprocess(
  (val) => (val === '' || val === null ? undefined : val),
  z.string().uuid().optional(),
);

const createAttestationSchema = z.object({
  summary: z.string().optional(),
  assessmentId: z.string().uuid('Invalid assessment ID'),
  signatoryId: optionalUuid,
  assessorId: optionalUuid,
});

const updateAttestationSchema = z.object({
  summary: z.string().optional(),
  signatoryId: optionalUuid,
  assessorId: optionalUuid,
});

const addRequirementSchema = z.object({
  requirementId: z.string().uuid('Invalid requirement ID'),
  conformanceScore: z.number().min(0).max(1),
  conformanceRationale: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).optional(),
  confidenceRationale: z.string().optional(),
});

const updateRequirementSchema = z.object({
  conformanceScore: z.number().min(0).max(1),
  conformanceRationale: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).optional(),
  confidenceRationale: z.string().optional(),
});

/**
 * Write gate for an existing attestation: the caller must be able to
 * write its assessment (security review Z8). 404 when it does not exist.
 */
async function requireAttestationWrite(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const row = await db.selectFrom('attestation').select('assessment_id').where('id', '=', req.params.id as string).executeTakeFirst();
    if (!row) {
      res.status(404).json({ error: 'Attestation not found' });
      return;
    }
    if (!(await canWriteAssessment(db, req.user!, row.assessment_id as string))) {
      res.status(403).json({ error: 'Only an assessor assigned to this assessment can change its attestation' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

router.get('/', requireAuth, requirePermission('attestations.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const { limit, offset } = clampPagination(req.query as Record<string, unknown>);

  // Without assessments.view_all, only attestations on assessments the
  // caller participates in (security review Z3).
  const readable = await readableAssessmentIds(db, req.user!);
  if (readable !== null && readable.length === 0) {
    res.json({ data: [], pagination: { limit, offset, total: 0 } });
    return;
  }

  let totalQuery = db.selectFrom('attestation').select(db.fn.count<number>('id').as('count'));
  if (readable !== null) totalQuery = totalQuery.where('assessment_id', 'in', readable);
  const total = await totalQuery.executeTakeFirstOrThrow().then(r => r.count);

  const attestations = (await db
    .selectFrom('attestation')
    .leftJoin('assessment', 'assessment.id', 'attestation.assessment_id')
    .leftJoin('signatory', 'signatory.id', 'attestation.signatory_id')
    // biome-ignore lint/suspicious/noExplicitAny: Kysely cross-table join refs require type cast
    .leftJoin('assessor', (join) =>
      // biome-ignore lint/suspicious/noExplicitAny: Kysely cross-table join refs require type cast
      join.onRef('assessor.id' as any, '=',
        // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        'attestation.assessor_id' as any)
    )
    // biome-ignore lint/suspicious/noExplicitAny: Kysely cross-table join refs require type cast
    .leftJoin('entity as assessor_entity', (join) =>
      // biome-ignore lint/suspicious/noExplicitAny: Kysely cross-table join refs require type cast
      join.onRef('assessor_entity.id' as any, '=',
        // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        'assessor.entity_id' as any)
    )
    .select([
      'attestation.id',
      'attestation.summary',
      'attestation.assessment_id',
      'attestation.signatory_id',
      'attestation.assessor_id',
      'attestation.created_at',
      'attestation.updated_at',
      'assessment.title as assessment_title',
      'signatory.name as signatory_name',
      'assessor.bom_ref as assessor_bom_ref',
      'assessor.third_party as assessor_third_party',
      'assessor_entity.name as assessor_entity_name',
    ])
    // Order newest first so attestations created via the UI surface
    // at the top of the list and stay reachable on page 1. Secondary
    // id sort guarantees stable ordering for rows that share a
    // created_at timestamp.
    .$if(readable !== null, (qb) => qb.where('attestation.assessment_id', 'in', readable as string[]))
    .orderBy('attestation.created_at', 'desc')
    .orderBy('attestation.id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()) as Record<string, unknown>[];

  // Enrich with per-attestation counts in two cheap aggregation queries
  const attIds = attestations.map(a => a.id as string);

  let reqCounts: { attestation_id: unknown; count: unknown }[] = [];
  let claimCounts: { attestation_id: unknown; count: unknown }[] = [];
  let avgScores: { attestation_id: unknown; avg: unknown }[] = [];

  if (attIds.length > 0) {
    reqCounts = await db
      .selectFrom('attestation_requirement')
      .where('attestation_id', 'in', attIds)
      .select(['attestation_id', db.fn.count<number>('id').as('count')])
      .groupBy('attestation_id')
      .execute() as { attestation_id: unknown; count: unknown }[];

    claimCounts = await db
      .selectFrom('claim')
      .where('attestation_id', 'in', attIds)
      .select(['attestation_id', db.fn.count<number>('id').as('count')])
      .groupBy('attestation_id')
      .execute() as { attestation_id: unknown; count: unknown }[];

    avgScores = await db
      .selectFrom('attestation_requirement')
      .where('attestation_id', 'in', attIds)
      .select(['attestation_id', db.fn.avg<number>('conformance_score').as('avg')])
      .groupBy('attestation_id')
      .execute() as { attestation_id: unknown; avg: unknown }[];
  }

  const reqCountMap = new Map(reqCounts.map(r => [r.attestation_id, Number(r.count)]));
  const claimCountMap = new Map(claimCounts.map(r => [r.attestation_id, Number(r.count)]));
  const avgScoreMap = new Map(avgScores.map(r => [r.attestation_id, r.avg !== null ? Number(r.avg) : null]));

  const enriched = attestations.map(a => ({
    ...a,
    requirementCount: reqCountMap.get(a.id as string) ?? 0,
    claimCount: claimCountMap.get(a.id as string) ?? 0,
    avgConformanceScore: avgScoreMap.get(a.id as string) ?? null,
  }));

  res.json({
    data: enriched,
    pagination: {
      limit,
      offset,
      total,
    },
  });
}));

router.get('/:id', requireAuth, requirePermission('attestations.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const attestation = await fetchAttestationById(db, req.params.id as string);

  // Out-of-scope reads look like missing records (security review Z3).
  if (!attestation || !allowsAssessment(await readableAssessmentIds(db, req.user!), attestation.assessment_id as string)) {
    res.status(404).json({ error: 'Attestation not found' });
    return;
  }

  const requirements = await fetchAttestationRequirements(db, req.params.id as string);
  const claims = await fetchAttestationClaims(db, req.params.id as string);
  const signatory = await fetchSignatory(db, attestation.signatory_id || null);

  res.json({
    attestation,
    requirements,
    claims,
    signatory,
  });
}));

router.post(
  '/',
  requireAuth,
  requirePermission('attestations.create'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createAttestationSchema.parse(req.body);
      const db = getDatabase();
      const attestationId = uuidv4();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', data.assessmentId)
        .selectAll()
        .executeTakeFirst();

      if (assessment && !(await canWriteAssessment(db, req.user!, data.assessmentId))) {
        res.status(403).json({ error: 'Only an assessor assigned to this assessment can attest it' });
        return;
      }

      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      // Attestations can only be created on assessments that have
      // reached the `complete` state. Attesting to in-flight work
      // would lock evidence and requirements that are still being
      // edited. Archived assessments are likewise rejected — once
      // archived, nothing on the assessment is modifiable, including
      // adding new attestations.
      if (assessment.state !== 'complete') {
        res.status(409).json({
          error: 'Attestations can only be created on completed assessments. Mark the assessment complete first.',
        });
        return;
      }

      await db
        .insertInto('attestation')
        .values(toSnakeCase({
          id: attestationId,
          summary: data.summary,
          assessmentId: data.assessmentId,
          signatoryId: data.signatoryId,
        }))
        .execute();

      // Auto-populate attestation_requirement rows from assessment_requirement
      // scores recorded during the assessment. Only copies rows where
      // conformance_score and conformance_rationale are both present.
      const scoredReqs = await db
        .selectFrom('assessment_requirement')
        .where('assessment_id', '=', data.assessmentId)
        .where('conformance_score', 'is not', null)
        .where('conformance_rationale', 'is not', null)
        .select([
          'requirement_id',
          'conformance_score',
          'conformance_rationale',
          'confidence_score',
          'confidence_rationale',
        ])
        .execute();

      for (const sr of scoredReqs) {
        const existing = await db
          .selectFrom('attestation_requirement')
          .where('attestation_id', '=', attestationId)
          .where('requirement_id', '=', sr.requirement_id)
          .select('id')
          .executeTakeFirst();
        if (!existing) {
          await db.insertInto('attestation_requirement').values({
            id: uuidv4(),
            attestation_id: attestationId,
            requirement_id: sr.requirement_id,
            conformance_score: sr.conformance_score as number,
            conformance_rationale: sr.conformance_rationale as string,
            confidence_score: sr.confidence_score as number | null ?? null,
            confidence_rationale: sr.confidence_rationale as string | null ?? null,
          }).execute();
        }
      }

      logger.info('Attestation created', {
        attestationId,
        assessmentId: data.assessmentId,
        requirementsCopied: scoredReqs.length,
        requestId: req.requestId,
      });

      const project = assessment.project_id
        ? await db.selectFrom('project').select('name').where('id', '=', assessment.project_id).executeTakeFirst()
        : undefined;
      req.eventBus?.emit(
        ATTESTATION_CREATED,
        { attestationId, assessmentId: data.assessmentId, projectName: project?.name ?? null },
        { userId: req.user!.id, displayName: req.user!.displayName },
      );

      res.status(201).json({
        id: attestationId,
        summary: data.summary,
        assessmentId: data.assessmentId,
        signatoryId: data.signatoryId,
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.put(
  '/:id',
  requireAuth,
  // Sprint 6: editing an existing attestation is a distinct action from
  // creating one, even though both touch the same row. Splitting lets
  // admins grant edit to reviewers without also granting the ability to
  // spin up new attestations. The migration backfills this permission
  // onto every role that already had attestations.create so existing
  // grants keep working.
  requirePermission('attestations.edit'),
  requireAttestationWrite,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateAttestationSchema.parse(req.body);
      const db = getDatabase();

      const attestation = await fetchAttestationById(db, req.params.id as string);

      if (!attestation) {
        res.status(404).json({ error: 'Attestation not found' });
        return;
      }

      // PR3: retention lock. An attestation referenced by a sealed
      // affirmation, or living on an assessment in a terminal state, is
      // frozen for every caller including admins. Record-integrity rule,
      // so it runs before the (softer) read-only assessment check below.
      if (await rejectIfAttestationImmutable(db, req.params.id as string, res)) return;

      // Guard: reject if parent assessment is complete/archived
      const readOnlyError = await checkAttestationAssessmentReadOnly(db, attestation.assessment_id);
      if (readOnlyError) {
        res.status(403).json({ error: readOnlyError });
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.signatoryId !== undefined) updateData.signatoryId = data.signatoryId;

      if (Object.keys(updateData).length > 0) {
        await db
          .updateTable('attestation')
          .set(toSnakeCase(updateData))
          .where('id', '=', req.params.id)
          .execute();
      }

      logger.info('Attestation updated', {
        attestationId: req.params.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated attestation
      const updatedAttestation = await db
        .selectFrom('attestation')
        .where('id', '=', req.params.id)
        .selectAll()
        .executeTakeFirst();

      res.json(updatedAttestation);
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.post(
  '/:id/requirements',
  requireAuth,
  requirePermission('attestations.edit'),
  requireAttestationWrite,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = addRequirementSchema.parse(req.body);
      const db = getDatabase();

      const attestation = await fetchAttestationById(db, req.params.id as string);

      if (!attestation) {
        res.status(404).json({ error: 'Attestation not found' });
        return;
      }

      // PR3: retention lock. Adding or updating a requirement on a
      // sealed-affirmation or terminal-assessment attestation would
      // mutate the frozen record.
      if (await rejectIfAttestationImmutable(db, req.params.id as string, res)) return;

      // Guard: reject if parent assessment is complete/archived
      const readOnlyError = await checkAttestationAssessmentReadOnly(db, attestation.assessment_id);
      if (readOnlyError) {
        res.status(403).json({ error: readOnlyError });
        return;
      }

      const requirement = await db
        .selectFrom('requirement')
        .where('id', '=', data.requirementId)
        .selectAll()
        .executeTakeFirst();

      if (!requirement) {
        res.status(404).json({ error: 'Requirement not found' });
        return;
      }

      const existingReq = await checkRequirementExists(db, req.params.id as string, data.requirementId);

      if (existingReq) {
        await db
          .updateTable('attestation_requirement')
          .set(toSnakeCase({
            conformanceScore: data.conformanceScore,
            conformanceRationale: data.conformanceRationale,
            confidenceScore: data.confidenceScore ?? null,
            confidenceRationale: data.confidenceRationale ?? null,
          }))
          .where('attestation_id', '=', req.params.id)
          .where('requirement_id', '=', data.requirementId)
          .execute();
      } else {
        await db
          .insertInto('attestation_requirement')
          .values(toSnakeCase({
            id: uuidv4(),
            attestationId: req.params.id,
            requirementId: data.requirementId,
            conformanceScore: data.conformanceScore,
            conformanceRationale: data.conformanceRationale,
            confidenceScore: data.confidenceScore ?? null,
            confidenceRationale: data.confidenceRationale || null,
          }))
          .execute();
      }

      logger.info('Attestation requirement added/updated', {
        attestationId: req.params.id,
        requirementId: data.requirementId,
        requestId: req.requestId,
      });

      res.status(201).json({ message: 'Requirement added/updated successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.put(
  '/:id/requirements/:requirementId',
  requireAuth,
  requirePermission('attestations.edit'),
  requireAttestationWrite,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateRequirementSchema.parse(req.body);
      const db = getDatabase();

      const attestationReq = await db
        .selectFrom('attestation_requirement')
        .where('attestation_id', '=', req.params.id)
        .where('requirement_id', '=', req.params.requirementId)
        .selectAll()
        .executeTakeFirst();

      if (!attestationReq) {
        res.status(404).json({ error: 'Attestation requirement not found' });
        return;
      }

      // PR3: retention lock. Updating a requirement is mutating the
      // parent attestation, so we reject the same way.
      if (await rejectIfAttestationImmutable(db, req.params.id as string, res)) return;

      // Guard: look up parent attestation to check assessment state
      const parentAttestation = await db
        .selectFrom('attestation')
        .where('id', '=', req.params.id)
        .select(['assessment_id'])
        .executeTakeFirst();
      if (parentAttestation) {
        const readOnlyError = await checkAttestationAssessmentReadOnly(db, parentAttestation.assessment_id);
        if (readOnlyError) {
          res.status(403).json({ error: readOnlyError });
          return;
        }
      }

      await db
        .updateTable('attestation_requirement')
        .set(toSnakeCase({
          conformanceScore: data.conformanceScore,
          conformanceRationale: data.conformanceRationale,
          confidenceScore: data.confidenceScore ?? null,
          confidenceRationale: data.confidenceRationale || null,
        }))
        .where('attestation_id', '=', req.params.id)
        .where('requirement_id', '=', req.params.requirementId)
        .execute();

      logger.info('Attestation requirement updated', {
        attestationId: req.params.id,
        requirementId: req.params.requirementId,
        requestId: req.requestId,
      });

      res.json({ message: 'Requirement updated successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.get(
  '/:id/requirements',
  requireAuth,
  requirePermission('attestations.view'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const attestation = await fetchAttestationById(db, req.params.id as string);

    if (!attestation || !allowsAssessment(await readableAssessmentIds(db, req.user!), attestation.assessment_id as string)) {
      res.status(404).json({ error: 'Attestation not found' });
      return;
    }

    const requirements = await fetchAttestationRequirements(db, req.params.id as string);

    res.json({ data: requirements });
  })
);

// ---------------------------------------------------------------------------
// PR3.6: Per-attestation sign/verify/rescind endpoints removed.
//
// Attestation authority now flows through the assessment's affirmation
// and its signatory slots (see routes/affirmations.ts). Cascade signing
// produces a single declarations-level JSF envelope (platform-signed)
// and a document-level JSF envelope (platform-signed). Individual
// attestation rows no longer carry signature material.
//
// Removed in this PR:
//   - POST /:id/sign             (replaced by affirmation slot sign)
//   - POST /:id/sign/prepare     (replaced by affirmation slot prepare)
//   - POST /:id/verify           (replaced by affirmation-level verify)
//   - POST /:id/rescind          (replaced by affirmation rescind/reseal)
//
// The legacy signature_* / rescinded_* columns and the
// attestations.verify / attestations.rescind permission rows are
// no longer present in the bootstrap SQL or the seed file. New
// installs never see them. Any pre PR3.6 install that still
// carries them is harmless — the orphan columns and permission
// rows are unreferenced and can be cleaned up by hand if a
// future migration step is added.
// ---------------------------------------------------------------------------

/**
 * Export a single attestation as a standalone CycloneDX attestations
 * document (CDXA). Scoped down to one attestation row so a consumer can
 * be handed the requirements/claims evidence for that attestation alone.
 *
 * Spec version is selected via ?spec=1.6|1.7 (defaults to 1.7). The
 * signatory block mirrors the CycloneDX 1.6/1.7 shape (name, role,
 * organization, optional externalReference for electronic signatures).
 * Signature material is emitted only at the assessment level via the
 * affirmation flow (see routes/export.ts) — a single-attestation export
 * never carries a JSF envelope because the envelope is scoped to the
 * assessment's declarations tree, not a single attestation.
 */
router.get(
  '/:id/export',
  requireAuth,
  requirePermission('attestations.export'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const scoped = await db.selectFrom('attestation').select('assessment_id').where('id', '=', req.params.id as string).executeTakeFirst();
    if (!scoped || !allowsAssessment(await readableAssessmentIds(db, req.user!), scoped.assessment_id as string)) {
      res.status(404).json({ error: 'Attestation not found' });
      return;
    }
    const attestation = await fetchAttestationById(db, req.params.id as string);

    if (!attestation) {
      res.status(404).json({ error: 'Attestation not found' });
      return;
    }

    const rawSpec = typeof req.query.spec === 'string' ? req.query.spec.trim() : '';
    const specVersion: CdxSpecVersion = rawSpec === '1.6' ? '1.6' : '1.7';

    const requirements = (await fetchAttestationRequirements(
      db,
      req.params.id as string
    )) as unknown as AttestationRequirementRowInput[];
    const claimRows = (await fetchAttestationClaims(
      db,
      req.params.id as string
    )) as unknown as Array<ClaimRowInput & { is_counter_claim?: boolean }>;
    const signatory = await fetchSignatory(db, attestation.signatory_id || null);

    // Resolve claim.target strings to synthetic organizationalEntity
    // bom-refs. Accumulated targets go into declarations.targets.
    const resolver = new TargetResolver();
    const claims: CdxClaim[] = claimRows.map((row) => claimFromRow(row, resolver));

    // Build a claim id -> bom-ref lookup for the per-requirement
    // junction query below, plus "all claims" fallback arrays for
    // legacy attestations that have no junction rows.
    const claimRefById = new Map<string, { ref: string; counter: boolean }>();
    const attestationAllClaims: string[] = [];
    const attestationAllCounterClaims: string[] = [];
    claimRows.forEach((row, idx) => {
      const ref = claims[idx]['bom-ref'];
      const counter = isCounterClaim(row);
      claimRefById.set(row.id as string, { ref, counter });
      if (counter) {
        attestationAllCounterClaims.push(ref);
      } else {
        attestationAllClaims.push(ref);
      }
    });

    // Pull per-requirement claim linkages from the
    // attestation_requirement_claim and _counter_claim junctions so
    // each map entry only emits the claims that actually back it.
    // When any linkage exists, we also insert empty buckets for the
    // remaining requirements so the writer's all-claims fallback
    // does not reintroduce the "every claim on every requirement"
    // shape.
    const byRequirementId = new Map<
      string,
      { claims: string[]; counterClaims: string[] }
    >();
    const perReqClaimRows = await db
      .selectFrom('attestation_requirement_claim as arc')
      .innerJoin('attestation_requirement as ar', 'ar.id', 'arc.attestation_requirement_id')
      .where('ar.attestation_id', '=', attestation.id)
      .select(['ar.requirement_id', 'arc.claim_id'])
      .execute();
    for (const prc of perReqClaimRows) {
      const look = claimRefById.get(prc.claim_id as string);
      if (!look) continue;
      const requirementId = prc.requirement_id as string;
      const bucket =
        byRequirementId.get(requirementId) ?? { claims: [], counterClaims: [] };
      if (look.counter) {
        bucket.counterClaims.push(look.ref);
      } else {
        bucket.claims.push(look.ref);
      }
      byRequirementId.set(requirementId, bucket);
    }
    const perReqCounterRows = await db
      .selectFrom('attestation_requirement_counter_claim as arcc')
      .innerJoin(
        'attestation_requirement as ar',
        'ar.id',
        'arcc.attestation_requirement_id',
      )
      .where('ar.attestation_id', '=', attestation.id)
      .select(['ar.requirement_id', 'arcc.claim_id'])
      .execute();
    for (const prc of perReqCounterRows) {
      const look = claimRefById.get(prc.claim_id as string);
      if (!look) continue;
      const requirementId = prc.requirement_id as string;
      const bucket =
        byRequirementId.get(requirementId) ?? { claims: [], counterClaims: [] };
      bucket.counterClaims.push(look.ref);
      byRequirementId.set(requirementId, bucket);
    }
    if (byRequirementId.size > 0) {
      for (const ar of requirements) {
        if (!byRequirementId.has(ar.requirement_id as string)) {
          byRequirementId.set(ar.requirement_id as string, {
            claims: [],
            counterClaims: [],
          });
        }
      }
    }

    const claimRefs: ClaimRefMap = {
      byRequirementId,
      allClaims: attestationAllClaims,
      allCounterClaims: attestationAllCounterClaims,
    };

    // Resolve the attestation's assessor and materialize it as an
    // assessor block so declarations.assessors can carry the same
    // identity the attestation.assessor bom-ref references.
    let assessorBlock: CdxAssessor | undefined;
    let assessorRef: string | undefined;
    if (attestation.assessor_id) {
      const { assessorFromUserRow } = await import('../cdxspec/index.js');
      const assessorRow = await db
        .selectFrom('assessor')
        .leftJoin('entity', 'entity.id', 'assessor.entity_id')
        .where('assessor.id', '=', attestation.assessor_id)
        .select([
          'assessor.id',
          'assessor.bom_ref',
          'assessor.third_party',
          'assessor.entity_id',
          'entity.name as entity_name',
        ])
        .executeTakeFirst();
      if (assessorRow) {
        assessorBlock = assessorFromUserRow({
          user: {
            id: assessorRow.id as string,
            display_name: null,
            email: null,
            organization_name:
              (assessorRow.entity_name as string | null | undefined) ?? null,
          },
          thirdParty: Boolean(assessorRow.third_party),
        });
        // Prefer the DB-stored bom_ref verbatim when present so the
        // attestation's `assessor` field matches the assessor the
        // assessment-level export emits. Falls back to the writer's
        // synthesised value when the column is empty.
        const storedRef = (assessorRow.bom_ref as string | null) ?? '';
        if (storedRef.length > 0) {
          assessorBlock = { ...assessorBlock, 'bom-ref': storedRef };
        }
        assessorRef = assessorBlock['bom-ref'];
      }
    }

    // Pull per-attestation signature envelope when present. Stored
    // as JSONB on `attestation.signature_json` and emitted verbatim
    // as `attestation.signature` under CycloneDX 1.7.
    // Strip the canonical-payload wrapper so attestation.signature
    // emits a bare JSF signer (additionalProperties:false on the
    // CycloneDX signer type means the wrapper's extra keys would
    // fail schema validation).
    const { parseJsonbColumn, toJsfSigner } = await import(
      '../utils/export-affirmation.js'
    );
    const attestationSignature = attestation.signature_json
      ? toJsfSigner(parseJsonbColumn(attestation.signature_json)) ?? null
      : null;

    const cdxAttestation = attestationFromRow({
      row: {
        id: attestation.id,
        summary: attestation.summary ?? null,
        signature: attestationSignature,
      },
      requirements,
      claimRefs,
      assessorRef,
    });

    // Build the affirmation block. Under the PR3.6 cascade model the
    // signatures and signatories live on the assessment-level
    // affirmation, so a per-attestation export pulls the same
    // affirmation object as the assessment-level export. The shared
    // helper filters signatories that do not satisfy the CycloneDX
    // Signatory oneOf (signature OR externalReference +
    // organization) and drops the `signatories[]` array entirely if
    // none pass, keeping the statement as a pointer.
    //
    // As a fallback for attestations that still carry a legacy
    // per-attestation signatory row (attestation.signatory_id), the
    // block is synthesized and validated here so legacy rows can
    // still contribute an electronic-signature signatory if the row
    // carries an externalReference.
    const affirmationBuild = attestation.assessment_id
      ? await buildAffirmationForAssessment(db, attestation.assessment_id)
      : { affirmation: undefined, declarationsSeal: undefined, documentSeal: undefined, signedSlotCount: 0 };
    let affirmation = affirmationBuild.affirmation;

    if (!affirmation && signatory) {
      let signatoryOrgRow: Record<string, unknown> | null = null;
      if ((signatory as Record<string, unknown>).organization_id) {
        signatoryOrgRow = (await db
          .selectFrom('organization')
          .where('id', '=', (signatory as Record<string, unknown>).organization_id as string)
          .selectAll()
          .executeTakeFirst()) as Record<string, unknown> | null;
      }
      const signatoryInput: SignatoryBlockInput = {
        row: signatory as SignatoryBlockInput['row'],
        organization: signatoryOrgRow as SignatoryBlockInput['organization'],
      };
      const block = signatoryBlock(signatoryInput);
      affirmation = {
        statement:
          'This attestation identifies the signatory listed. See the assessment-level export for the sealed CycloneDX affirmation and JSF signature envelope.',
      };
      if (isSignatoryValid(block)) {
        affirmation.signatories = [block];
      }
    }

    // Assemble definitions.standards scoped to the single standard
    // this attestation covers. The standard is derived from the
    // attestation's requirements (every map entry references the
    // same standard by construction; take the first requirement's
    // standard_id and emit that standard verbatim, including all
    // of its imported requirements with their original bom-refs).
    const standards = await buildStandardsForAttestation(db, attestation.id);

    const declarations = composeDeclarations({
      assessors: assessorBlock ? [assessorBlock] : undefined,
      attestations: [cdxAttestation],
      claims,
      affirmation,
      seal: affirmationBuild.declarationsSeal,
      targetResolver: resolver,
    });

    const cdxa = composeBom({
      specVersion,
      declarations,
      definitions: standards.length > 0 ? { standards } : undefined,
      documentSeal: affirmationBuild.documentSeal,
    });

    // Build a human-readable filename: {assessment-title}-attestation-{date}.cdx.json
    const assessmentForFilename = attestation.assessment_id
      ? await db
          .selectFrom('assessment')
          .where('id', '=', attestation.assessment_id)
          .select('title')
          .executeTakeFirst()
      : null;
    const titleSlug = (assessmentForFilename?.title ?? 'assessment')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const dateStr = new Date().toISOString().slice(0, 10);
    const exportFilename = `${titleSlug}-attestation-${dateStr}.cdx.json`;

    res.setHeader('Content-Type', 'application/vnd.cyclonedx+json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename}"`
    );
    res.json(cdxa);
  })
);

export default router;
