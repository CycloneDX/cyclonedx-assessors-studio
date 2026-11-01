import { Router } from 'express';
import { visibleEvidenceIds } from '../utils/access.js';
import type { Response } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { type AuthRequest, requireAuth, requirePermission, getPermissionsForRole } from '../middleware/auth.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { rejectIfClaimImmutable } from '../utils/retention.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

/**
 * Check if the user is a participant in the assessment linked via an attestation.
 * Admins always pass. Returns true if the user is allowed, false otherwise.
 */
// biome-ignore lint/suspicious/noExplicitAny: Kysely Database type is not imported here
async function isAttestationParticipant(
  db: Kysely<any>,
  userId: string,
  userRole: string,
  attestationId: string | null | undefined
): Promise<boolean> {
  if (userRole === 'admin') return true;
  if (!attestationId) return true; // Unlinked claims are accessible to all authenticated users

  const attestation = await db
    .selectFrom('attestation')
    .where('id', '=', attestationId)
    .select(['assessment_id'])
    .executeTakeFirst();

  if (!attestation) return true; // Attestation doesn't exist; let other validation catch it

  const assessor = await db
    .selectFrom('assessment_assessor')
    .where('assessment_id', '=', attestation.assessment_id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
  if (assessor) return true;

  const assessee = await db
    .selectFrom('assessment_assessee')
    .where('assessment_id', '=', attestation.assessment_id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
  return !!assessee;
}

/**
 * Check if a claim's parent assessment is read-only (complete or archived).
 * Claims linked via attestation -> assessment inherit the assessment's read-only state.
 * Returns an error message if read-only, or null if mutable.
 */
async function checkClaimAssessmentReadOnly(
  db: ReturnType<typeof getDatabase>,
  attestationId: string | null | undefined,
): Promise<string | null> {
  if (!attestationId) return null; // Unlinked claims are always mutable

  const attestation = await db
    .selectFrom('attestation')
    .where('id', '=', attestationId)
    .select(['assessment_id'])
    .executeTakeFirst();

  if (!attestation) return null;

  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', attestation.assessment_id)
    .select(['state'])
    .executeTakeFirst();

  if (!assessment) return null;

  if (assessment.state === 'archived') return 'This claim belongs to an archived assessment and cannot be modified';
  // `complete` is NOT a read-only state for claims under PR3.6.
  // Claims attached to attestations on completed assessments remain
  // mutable until the affirmation is sealed (see retention.ts).
  return null;
}

/**
 * Validate attestation change and check read-only status of target attestation.
 */
async function validateAttestationChange(
  db: ReturnType<typeof getDatabase>,
  newAttestationId: string,
  res: Response
): Promise<boolean> {
  const newAttestation = await db
    .selectFrom('attestation')
    .where('id', '=', newAttestationId)
    .selectAll()
    .executeTakeFirst();

  if (!newAttestation) {
    res.status(404).json({ error: 'Target attestation not found' });
    return false;
  }

  const targetReadOnlyError = await checkClaimAssessmentReadOnly(db, newAttestationId);
  if (targetReadOnlyError) {
    res.status(403).json({ error: targetReadOnlyError });
    return false;
  }

  return true;
}

/**
 * Build claim update data from request payload.
 */
function buildClaimUpdateData(data: Record<string, unknown>): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.target !== undefined) updateData.target = data.target;
  if (data.predicate !== undefined) updateData.predicate = data.predicate;
  if (data.reasoning !== undefined) updateData.reasoning = data.reasoning;
  if (data.isCounterClaim !== undefined) updateData.isCounterClaim = data.isCounterClaim;
  if (data.attestationId !== undefined) updateData.attestationId = data.attestationId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.claimType !== undefined) updateData.claimType = data.claimType;
  if (data.confidence !== undefined) updateData.confidence = data.confidence;
  if (data.projectName !== undefined) updateData.projectName = data.projectName;
  if (data.projectRequirement !== undefined) updateData.projectRequirement = data.projectRequirement;
  if (data.framework !== undefined) updateData.framework = data.framework;
  if (data.assessor !== undefined) updateData.assessor = data.assessor;
  if (data.claimDate !== undefined) updateData.claimDate = data.claimDate;
  if (data.workNotes !== undefined) updateData.workNotes = data.workNotes;
  return updateData;
}

/**
 * Sync evidence associations for a claim.
 *
 * De-duplicates the incoming evidenceIds before insert because
 * claim_evidence has a composite PK on (claim_id, evidence_id) and a
 * caller that sends `['a', 'a']` would otherwise produce a unique
 * constraint violation surfaced as a 500. Dedup mirrors the
 * "set semantics" the API documents.
 */
async function syncClaimEvidence(
  db: ReturnType<typeof getDatabase>,
  claimId: string,
  evidenceIds: string[] | undefined
): Promise<void> {
  if (evidenceIds === undefined) return;

  await db.deleteFrom('claim_evidence').where('claim_id', '=', claimId).execute();

  const uniqueIds = Array.from(new Set(evidenceIds));
  if (uniqueIds.length > 0) {
    await db
      .insertInto('claim_evidence')
      .values(
        uniqueIds.map(evidenceId => toSnakeCase({
          claimId,
          evidenceId,
          createdAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        })) as any
      )
      .execute();
  }
}

/**
 * Sync counter-evidence associations for a claim.
 *
 * De-duplicates the incoming counterEvidenceIds before insert so a
 * caller passing the same id twice does not crash the route with a
 * constraint violation on the composite PK.
 */
async function syncClaimCounterEvidence(
  db: ReturnType<typeof getDatabase>,
  claimId: string,
  counterEvidenceIds: string[] | undefined
): Promise<void> {
  if (counterEvidenceIds === undefined) return;

  await db.deleteFrom('claim_counter_evidence').where('claim_id', '=', claimId).execute();

  const uniqueIds = Array.from(new Set(counterEvidenceIds));
  if (uniqueIds.length > 0) {
    await db
      .insertInto('claim_counter_evidence')
      .values(
        uniqueIds.map(evidenceId => toSnakeCase({
          claimId,
          evidenceId,
          createdAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        })) as any
      )
      .execute();
  }
}

const createClaimSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  target: z.string().min(1, 'Target is required'),
  targetEntityId: z.string().uuid().nullable().optional(),
  predicate: z.string().min(1, 'Predicate is required'),
  reasoning: z.string().optional(),
  isCounterClaim: z.boolean().default(false),
  attestationId: z.string().uuid().optional(),
  evidenceIds: z.array(z.string().uuid()).optional(),
  counterEvidenceIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['Draft', 'Under Review', 'Accepted', 'Rejected']).optional().default('Draft'),
  claimType: z.enum(['Conformance', 'Non-Conformance', 'Exemption', 'Compensating Control']).optional().nullable(),
  confidence: z.enum(['High', 'Medium', 'Low']).optional().nullable(),
  projectName: z.string().max(255).optional().nullable(),
  projectRequirement: z.string().max(100).optional().nullable(),
  framework: z.string().max(255).optional().nullable(),
  assessor: z.string().max(255).optional().nullable(),
  claimDate: z.string().optional().nullable(),
  workNotes: z.string().optional().nullable(),
});

const updateClaimSchema = z.object({
  name: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  targetEntityId: z.string().uuid().nullable().optional(),
  predicate: z.string().min(1).optional(),
  reasoning: z.string().optional(),
  isCounterClaim: z.boolean().optional(),
  attestationId: z.string().uuid().optional(),
  evidenceIds: z.array(z.string().uuid()).optional(),
  counterEvidenceIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['Draft', 'Under Review', 'Accepted', 'Rejected']).optional(),
  claimType: z.enum(['Conformance', 'Non-Conformance', 'Exemption', 'Compensating Control']).optional().nullable(),
  confidence: z.enum(['High', 'Medium', 'Low']).optional().nullable(),
  projectName: z.string().max(255).optional().nullable(),
  projectRequirement: z.string().max(100).optional().nullable(),
  framework: z.string().max(255).optional().nullable(),
  assessor: z.string().max(255).optional().nullable(),
  claimDate: z.string().optional().nullable(),
  workNotes: z.string().optional().nullable(),
});

// GET /api/v1/claims
// Row-visibility scope for claims. Without claims.view_all (i.e. an assessee), a
// caller only sees claims whose attestation resolves to an assessment they
// participate in. Standalone (unlinked) claims have no assessment and are hidden
// from scoped callers. Assessors and admins hold claims.view_all.
// biome-ignore lint/suspicious/noExplicitAny: Kysely expression-builder callback
const claimsInScope = (userId: string) => (eb: any) =>
  eb('attestation_id', 'in',
    eb.selectFrom('attestation')
      .select('attestation.id')
      .where((inner: any) =>
        inner.or([
          inner('attestation.assessment_id', 'in', inner.selectFrom('assessment_assessor').select('assessment_id').where('user_id', '=', userId)),
          inner('attestation.assessment_id', 'in', inner.selectFrom('assessment_assessee').select('assessment_id').where('user_id', '=', userId)),
        ]),
      ),
  );

/**
 * Write gate shared by every claim mutation (security review Z2, Z8): the
 * claim exists, is not frozen by a signed attestation, its assessment is
 * not read-only, and the caller participates in that assessment. Responds
 * and returns null when the caller may not write.
 */
export async function authorizeClaimWrite(
  db: ReturnType<typeof getDatabase>,
  req: AuthRequest,
  res: Response,
  claimId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const claim = includeDeleted
    ? await db.selectFrom('claim_raw').select(['id', 'attestation_id', 'deleted_at', 'name']).where('id', '=', claimId).executeTakeFirst()
    : await db.selectFrom('claim').selectAll().where('id', '=', claimId).executeTakeFirst();
  if (!claim) {
    res.status(404).json({ error: 'Claim not found' });
    return null;
  }
  if (await rejectIfClaimImmutable(db, claimId, res)) return null;
  const attestationId = (claim as Record<string, unknown>).attestation_id as string;
  const readOnlyError = await checkClaimAssessmentReadOnly(db, attestationId);
  if (readOnlyError) {
    res.status(403).json({ error: readOnlyError });
    return null;
  }
  if (!(await isAttestationParticipant(db, req.user!.id, req.user!.role, attestationId))) {
    res.status(403).json({ error: 'You are not a participant in this assessment' });
    return null;
  }
  return claim as Record<string, unknown>;
}

router.get('/', requireAuth, requirePermission('claims.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const userPerms = req.user?.id ? await getPermissionsForRole(req.user.role) : [];
  const claimsViewAll = userPerms.includes('claims.view_all');
  const scopeUserId = req.user?.id ?? '';

  let listQuery = db
    .selectFrom('claim')
    .selectAll()
    .orderBy('created_at', 'desc');
  if (!claimsViewAll) {
    listQuery = listQuery.where(claimsInScope(scopeUserId));
  }
  const rows = await listQuery.execute();

  const enriched = await Promise.all(rows.map(async (row) => {
    const [evidenceRes, mitigationRes] = await Promise.all([
      db.selectFrom('claim_evidence').where('claim_id', '=', row.id).select(db.fn.count('claim_id').as('cnt')).executeTakeFirst(),
      db.selectFrom('mitigation_claim').where('claim_id', '=', row.id).select(db.fn.count('claim_id').as('cnt')).executeTakeFirst(),
    ]);
    return {
      ...row,
      evidenceCount: Number(evidenceRes?.cnt ?? 0),
      mitigationCount: Number(mitigationRes?.cnt ?? 0),
    };
  }));

  res.json({ data: enriched, total: enriched.length });
}));

router.get('/:id', requireAuth, requirePermission('claims.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const claim = await db
    .selectFrom('claim')
    .where('id', '=', req.params.id)
    .selectAll()
    .executeTakeFirst();

  if (!claim) {
    res.status(404).json({ error: 'Claim not found' });
    return;
  }

  // Object-level scope: a caller without claims.view_all may only read a claim
  // whose attestation resolves to an assessment they participate in. 404 (not
  // 403) so out-of-scope claim existence is not leaked.
  const detailPerms = req.user?.id ? await getPermissionsForRole(req.user.role) : [];
  if (!detailPerms.includes('claims.view_all')) {
    const uid = req.user?.id ?? '';
    let allowed = false;
    if (claim.attestation_id) {
      const row = await db
        .selectFrom('attestation')
        .where('attestation.id', '=', claim.attestation_id as string)
        .where((inner) =>
          inner.or([
            inner('attestation.assessment_id', 'in', inner.selectFrom('assessment_assessor').select('assessment_id').where('user_id', '=', uid)),
            inner('attestation.assessment_id', 'in', inner.selectFrom('assessment_assessee').select('assessment_id').where('user_id', '=', uid)),
          ]),
        )
        .select('attestation.id')
        .executeTakeFirst();
      allowed = !!row;
    }
    if (!allowed) {
      res.status(404).json({ error: 'Claim not found' });
      return;
    }
  }

  const evidence = await db
    .selectFrom('claim_evidence')
    .innerJoin('evidence', 'evidence.id', 'claim_evidence.evidence_id')
    .where('claim_evidence.claim_id', '=', req.params.id)
    .select(['evidence.id', 'evidence.display_id', 'evidence.name', 'evidence.description', 'evidence.state'])
    .execute();

  const counterEvidence = await db
    .selectFrom('claim_counter_evidence')
    .innerJoin('evidence', 'evidence.id', 'claim_counter_evidence.evidence_id')
    .where('claim_counter_evidence.claim_id', '=', req.params.id)
    .select(['evidence.id', 'evidence.display_id', 'evidence.name', 'evidence.description', 'evidence.state'])
    .execute();

  const mitigationStrategies = await db
    .selectFrom('claim_mitigation_strategy')
    .innerJoin('evidence', 'evidence.id', 'claim_mitigation_strategy.evidence_id')
    .where('claim_mitigation_strategy.claim_id', '=', req.params.id)
    .select(['evidence.id', 'evidence.display_id', 'evidence.name', 'evidence.description', 'evidence.state'])
    .execute();

  // Fetch target entity details if linked
  let targetEntity = null;
  const claimRecord = claim as Record<string, unknown>;
  if (claimRecord.target_entity_id) {
    targetEntity = await db
      .selectFrom('entity')
      .where('id', '=', claimRecord.target_entity_id as string)
      .select(['id', 'name', 'entity_type', 'bom_ref'])
      .executeTakeFirst() || null;
  }

  // Fetch external references
  const externalReferences = await db
    .selectFrom('claim_external_reference')
    .where('claim_id', '=', req.params.id)
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute();

  const linkedMitigations = await db
    .selectFrom('mitigation_claim')
    .innerJoin('mitigation', 'mitigation.id', 'mitigation_claim.mitigation_id')
    .select(['mitigation.id', 'mitigation.title', 'mitigation.status', 'mitigation.priority', 'mitigation.type', 'mitigation.owner'])
    .where('mitigation_claim.claim_id', '=', req.params.id)
    .execute();

  res.json({
    claim,
    evidence,
    counterEvidence,
    mitigationStrategies,
    targetEntity,
    externalReferences,
    linkedMitigations,
  });
}));

router.post(
  '/',
  requireAuth,
  requirePermission('claims.create'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createClaimSchema.parse(req.body);
      const db = getDatabase();

      // Guard: reject if parent assessment is complete/archived
      const readOnlyError = await checkClaimAssessmentReadOnly(db, data.attestationId);
      if (readOnlyError) {
        res.status(403).json({ error: readOnlyError });
        return;
      }

      // Validate attestation exists if provided
      if (data.attestationId) {
        const attestation = await db
          .selectFrom('attestation')
          .where('id', '=', data.attestationId)
          .selectAll()
          .executeTakeFirst();

        if (!attestation) {
          res.status(404).json({ error: 'Attestation not found' });
          return;
        }

        // Authorization: user must be a participant in the assessment
        const allowed = await isAttestationParticipant(db, req.user!.id, req.user!.role, data.attestationId);
        if (!allowed) {
          res.status(403).json({ error: 'You are not a participant in this assessment' });
          return;
        }
      }

      const claimId = uuidv4();

      await db
        .insertInto('claim')
        .values(toSnakeCase({
          id: claimId,
          name: data.name,
          target: data.target,
          targetEntityId: data.targetEntityId || null,
          predicate: data.predicate,
          reasoning: data.reasoning,
          isCounterClaim: data.isCounterClaim,
          attestationId: data.attestationId,
        }))
        .execute();

      // Dedup before insert. The junction tables carry composite PKs
      // on (claim_id, evidence_id); a caller that submits duplicate
      // ids would otherwise trigger a unique constraint violation that
      // the asyncHandler turns into a 500. Treating the input as a set
      // matches the API's documented "linked evidence" semantics.
      if (data.evidenceIds && data.evidenceIds.length > 0) {
        const uniqueEvidenceIds = Array.from(new Set(data.evidenceIds));
        await db
          .insertInto('claim_evidence')
          .values(
            uniqueEvidenceIds.map(evidenceId => toSnakeCase({
              claimId,
              evidenceId,
              createdAt: new Date(),
              // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
            })) as any
          )
          .execute();
      }

      if (data.counterEvidenceIds && data.counterEvidenceIds.length > 0) {
        const uniqueCounterIds = Array.from(new Set(data.counterEvidenceIds));
        await db
          .insertInto('claim_counter_evidence')
          .values(
            uniqueCounterIds.map(evidenceId => toSnakeCase({
              claimId,
              evidenceId,
              createdAt: new Date(),
              // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
            })) as any
          )
          .execute();
      }

      await logAudit(db, {
        entityType: 'claim',
        entityId: claimId,
        action: 'create',
        userId: req.user?.id ?? null,
        changes: { name: data.name, is_counter_claim: data.isCounterClaim },
      });

      logger.info('Claim created', {
        claimId,
        name: data.name,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: claimId,
        name: data.name,
        target: data.target,
        predicate: data.predicate,
        reasoning: data.reasoning,
        isCounterClaim: data.isCounterClaim,
        attestationId: data.attestationId,
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
  requirePermission('claims.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateClaimSchema.parse(req.body);
      const db = getDatabase();

      const claim = await db
        .selectFrom('claim')
        .where('id', '=', req.params.id)
        .selectAll()
        .executeTakeFirst();

      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }

      // Sprint 5.7: retention lock. A claim cited in a signed
      // attestation (directly, or via the requirement map junctions) is
      // frozen for every caller including admins.
      if (await rejectIfClaimImmutable(db, req.params.id as string, res)) return;

      // Guard: reject if parent assessment is complete/archived
      const readOnlyError = await checkClaimAssessmentReadOnly(db, (claim as any).attestation_id);
      if (readOnlyError) {
        res.status(403).json({ error: readOnlyError });
        return;
      }

      // Authorization: user must be a participant in the current assessment
      const allowed = await isAttestationParticipant(db, req.user!.id, req.user!.role, (claim as Record<string, unknown>).attestation_id as string);
      if (!allowed) {
        res.status(403).json({ error: 'You are not a participant in this assessment' });
        return;
      }

      // If changing attestation, validate the new one exists and check its read-only status
      if (data.attestationId !== undefined && data.attestationId !== (claim as Record<string, unknown>).attestation_id) {
        if (data.attestationId && !await validateAttestationChange(db, data.attestationId, res)) {
          return;
        }
        // Moving a claim also writes into the target assessment.
        if (data.attestationId && !(await isAttestationParticipant(db, req.user!.id, req.user!.role, data.attestationId))) {
          res.status(403).json({ error: 'You are not a participant in the target assessment' });
          return;
        }
      }

      // Update main claim fields
      const updateData = buildClaimUpdateData(data);
      if (Object.keys(updateData).length > 0) {
        await db
          .updateTable('claim')
          .set(toSnakeCase(updateData))
          .where('id', '=', req.params.id)
          .execute();
      }

      // Sync evidence associations
      await syncClaimEvidence(db, req.params.id as string, data.evidenceIds);
      await syncClaimCounterEvidence(db, req.params.id as string, data.counterEvidenceIds);

      await logAudit(db, {
        entityType: 'claim',
        entityId: req.params.id as string,
        action: 'update',
        userId: req.user?.id ?? null,
        changes: toSnakeCase(updateData),
      });

      logger.info('Claim updated', {
        claimId: req.params.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated claim
      const updatedClaim = await db
        .selectFrom('claim')
        .where('id', '=', req.params.id)
        .selectAll()
        .executeTakeFirst();

      res.json(updatedClaim);
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission('claims.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    // Retention lock (signed claims are frozen for every caller), read-only
    // assessment, and participation (security review Z8).
    const claim = await authorizeClaimWrite(db, req, res, req.params.id as string);
    if (!claim) return;

    // Soft delete: `claim` is a view hiding deleted rows; the physical row
    // stays in claim_raw for restore. Purge removes it permanently.
    await db.updateTable('claim').set({ deleted_at: new Date() }).where('id', '=', req.params.id).execute();

    await logAudit(db, {
      entityType: 'claim',
      entityId: req.params.id as string,
      action: 'delete',
      userId: req.user?.id ?? null,
      changes: { name: (claim as Record<string, unknown>).name },
    });

    logger.info('Claim deleted', {
      claimId: req.params.id,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

// Restore a soft-deleted claim. Targets claim_raw because the claim view hides
// deleted rows.
router.post(
  '/:id/restore',
  requireAuth,
  requirePermission('claims.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const row = await authorizeClaimWrite(db, req, res, req.params.id as string, { includeDeleted: true });
    if (!row) return;
    if (!row.deleted_at) {
      res.status(409).json({ error: 'Claim is not deleted' });
      return;
    }

    await db
      .updateTable('claim_raw')
      .set({ deleted_at: null })
      .where('id', '=', req.params.id as string)
      .execute();

    logger.info('Claim restored', { claimId: req.params.id, requestId: req.requestId });
    res.json({ message: 'Claim restored' });
  })
);

// Link routes: same permission and write gate as PUT /claims/:id
// (security review Z2). They used to need only a login, so any user could
// detach evidence from a signed claim.

// POST /api/v1/claims/:id/mitigations/:mitigationId
router.post('/:id/mitigations/:mitigationId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  if (!(await authorizeClaimWrite(db, req, res, req.params.id as string))) return;
  const mitigation = await db.selectFrom('mitigation').select('id').where('id', '=', req.params.mitigationId as string).executeTakeFirst();
  if (!mitigation) {
    res.status(404).json({ error: 'Mitigation not found' });
    return;
  }
  await db
    .insertInto('mitigation_claim')
    .values({ mitigation_id: req.params.mitigationId as string, claim_id: req.params.id as string, created_at: new Date() })
    .onConflict(oc => oc.doNothing())
    .execute();
  res.status(204).send();
}));

// DELETE /api/v1/claims/:id/mitigations/:mitigationId
router.delete('/:id/mitigations/:mitigationId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  if (!(await authorizeClaimWrite(db, req, res, req.params.id as string))) return;
  await db
    .deleteFrom('mitigation_claim')
    .where('claim_id', '=', req.params.id as string)
    .where('mitigation_id', '=', req.params.mitigationId as string)
    .execute();
  res.status(204).send();
}));

// POST /api/v1/claims/:id/evidence/:evidenceId
router.post('/:id/evidence/:evidenceId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  if (!(await authorizeClaimWrite(db, req, res, req.params.id as string))) return;
  // The caller must be able to see the evidence they cite.
  const visible = await visibleEvidenceIds(db, req.user!, [req.params.evidenceId as string]);
  const exists = await db.selectFrom('evidence').select('id').where('id', '=', req.params.evidenceId as string).executeTakeFirst();
  if (!exists || (visible !== null && !visible.has(req.params.evidenceId as string))) {
    res.status(404).json({ error: 'Evidence not found' });
    return;
  }
  await db
    .insertInto('claim_evidence')
    .values(toSnakeCase({ claimId: req.params.id as string, evidenceId: req.params.evidenceId as string, createdAt: new Date() }) as any)
    .onConflict(oc => oc.doNothing())
    .execute();
  res.status(204).send();
}));

// DELETE /api/v1/claims/:id/evidence/:evidenceId
router.delete('/:id/evidence/:evidenceId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  if (!(await authorizeClaimWrite(db, req, res, req.params.id as string))) return;
  await db
    .deleteFrom('claim_evidence')
    .where('claim_id', '=', req.params.id as string)
    .where('evidence_id', '=', req.params.evidenceId as string)
    .execute();
  res.status(204).send();
}));

export default router;
