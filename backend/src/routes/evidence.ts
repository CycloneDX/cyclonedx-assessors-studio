import { Router } from 'express';
import { queryString, likeContains } from '../utils/query.js';
import { contentDisposition } from '../utils/content-disposition.js';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import busboy from 'busboy';
import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import { AuthRequest, requireAuth, requirePermission, getPermissionsForRole } from '../middleware/auth.js';
import { syncEntityTags, fetchTagsForEntities } from '../utils/tags.js';
import { logAudit } from '../utils/audit.js';
import { EVIDENCE_CREATED, EVIDENCE_STATE_CHANGED } from '../events/catalog.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { validatePagination } from '../utils/pagination.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import {
  getStorageProvider,
  getStorageProviderName,
  getMaxFileSize,
  resolveProvider,
} from '../storage/index.js';
import type { StorageProviderName } from '../storage/types.js';
import type { Database } from '../db/types.js';
import { verifyAttachmentMimeType } from '../utils/attachment-mime.js';

const router = Router();

/**
 * Check if a user is a participant (assessor or assessee) in an assessment,
 * or bears a permission that grants assessment-wide visibility.
 *
 * This is a WRITE-path gate (attachment create/delete). Access is granted when:
 *   1. The caller holds `admin.settings` (administrative override).
 *   2. The caller is listed on assessment_assessor for the assessment.
 *   3. The caller is listed on assessment_assessee for the assessment.
 *
 * It deliberately does NOT grant on the `*.view_all` read scopes. Assessors
 * hold view_all so they can SEE all data, but their writes stay scoped to the
 * assessments they participate in — "read all" must not imply "write all". Only
 * a genuine administrator (admin.settings) gets a blanket write override.
 *
 * Prior revisions short-circuited on a literal role-name check for `admin`;
 * this consults the DB-driven permission set instead, per the permission-only
 * access-control rule.
 */
async function isAssessmentParticipant(db: Kysely<Database>, userId: string, userRole: string, assessmentId: string): Promise<boolean> {
  const perms = await getPermissionsForRole(userRole);
  if (perms.includes('admin.settings')) return true;

  const assessor = await db
    .selectFrom('assessment_assessor')
    .where('assessment_id', '=', assessmentId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
  if (assessor) return true;

  const assessee = await db
    .selectFrom('assessment_assessee')
    .where('assessment_id', '=', assessmentId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
  return !!assessee;
}

/**
 * Fetch evidence by ID with validation
 */
async function fetchEvidence(db: Kysely<Database>, evidenceId: string): Promise<Record<string, unknown> | undefined> {
  return db
    .selectFrom('evidence')
    .where('id', '=', evidenceId)
    .selectAll()
    .executeTakeFirst();
}

/**
 * Check whether a user may read or act on a specific evidence record.
 *
 * Access is granted when any of the following holds:
 *   1. The caller holds `evidence.view_all` or `assessments.view_all`.
 *   2. The caller authored the evidence (authors always retain access
 *      to their own uploads, including orphan evidence not yet linked
 *      to an assessment).
 *   3. The caller is listed as the reviewer of the evidence.
 *   4. The evidence is linked (via assessment_requirement_evidence)
 *      to at least one assessment where the caller is an assessor or
 *      assessee.
 *
 * Returns the evidence row on success for caller reuse, or null when
 * the evidence does not exist or the caller is not authorized.
 */
async function getEvidenceIfAccessible(
  db: Kysely<Database>,
  userId: string,
  userRole: string,
  evidenceId: string,
): Promise<Record<string, unknown> | null> {
  const evidence = await fetchEvidence(db, evidenceId);
  if (!evidence) return null;

  const perms = await getPermissionsForRole(userRole);
  if (perms.includes('evidence.view_all') || perms.includes('assessments.view_all')) {
    return evidence;
  }

  // Least-privilege (author-or-reviewer): a caller without a view_all scope
  // may only see evidence they authored or were assigned to review. Assessors
  // and admins hold a view_all permission and are handled above; assessees are
  // the only remaining role with evidence.view, so this restricts them to
  // their own (and to-review) evidence. Participation in an assessment no
  // longer grants visibility of another user's evidence.
  if (evidence.author_id === userId) return evidence;
  if (evidence.reviewer_id === userId) return evidence;

  return null;
}

/**
 * Check whether a user may WRITE a specific evidence record's attachments
 * (create/delete). The write analogue of getEvidenceIfAccessible, it
 * deliberately does NOT grant on the `*.view_all` read scopes — "read all must
 * not imply write all" (see isAssessmentParticipant). This closes the F02 BOLA
 * write path where a bare view-all holder (e.g. an assessor with no link to the
 * evidence) could create/delete attachments on records they have no
 * relationship to.
 *
 * Write access is granted when any of the following holds:
 *   1. The caller holds `admin.settings` (administrative override).
 *   2. The caller authored the evidence.
 *   3. The caller is the assigned reviewer of the evidence.
 *   4. The caller is an assessor/assessee on an assessment this evidence is
 *      linked to (via assessment_requirement_evidence).
 *
 * Returns the evidence row on success for caller reuse, or null when the
 * evidence does not exist or the caller is not authorized (callers map null to
 * a 404 so existence is not leaked).
 */
async function getEvidenceIfWritable(
  db: Kysely<Database>,
  userId: string,
  userRole: string,
  evidenceId: string,
): Promise<Record<string, unknown> | null> {
  const evidence = await fetchEvidence(db, evidenceId);
  if (!evidence) return null;

  const perms = await getPermissionsForRole(userRole);
  if (perms.includes('admin.settings')) return evidence;
  if (evidence.author_id === userId) return evidence;
  if (evidence.reviewer_id === userId) return evidence;

  // Participant on a linked assessment. view_all is intentionally NOT
  // sufficient here (F02 BOLA): read-all does not imply write-all.
  const participant = await db
    .selectFrom('assessment_requirement_evidence as are')
    .innerJoin('assessment_requirement as ar', 'ar.id', 'are.assessment_requirement_id')
    .where('are.evidence_id', '=', evidenceId)
    .where((eb) =>
      eb.or([
        eb('ar.assessment_id', 'in',
          eb.selectFrom('assessment_assessor').select('assessment_id').where('user_id', '=', userId)),
        eb('ar.assessment_id', 'in',
          eb.selectFrom('assessment_assessee').select('assessment_id').where('user_id', '=', userId)),
      ])
    )
    .select('are.evidence_id')
    .executeTakeFirst();
  if (participant) return evidence;

  return null;
}

/**
 * Retention/immutability check for an evidence record.
 *
 * Evidence is considered "used" and therefore retention-locked once any
 * of the following is true. Used evidence is both write-protected and
 * delete-protected across its attachments, notes, and link rows. This
 * binds every caller equally; there is no admin override and no
 * permission that bypasses the lock. The rule is a record-integrity
 * policy, not an authorization policy, so callers must not consult
 * `req.user.role` or permissions here.
 *
 *   1. `evidence.state === 'claimed'`. This mirrors the legacy rule
 *      already enforced on PUT /:id and predates the retention policy.
 *   2. The evidence is cited in any claim via `claim_evidence`,
 *      `claim_counter_evidence`, or `claim_mitigation_strategy`.
 *   3. The evidence is linked (via assessment_requirement_evidence) to
 *      an assessment in a terminal state: `complete`, `archived`, or
 *      `cancelled`. Cancelled assessments still left a business record
 *      and therefore count as terminal for retention purposes.
 *
 * Expiration (`evidence.state === 'expired'`) does not, on its own,
 * unlock retention. Expired evidence that has never been used may still
 * be freely edited or unlinked; expired evidence that has been used
 * stays locked.
 *
 * Callers should return 409 Conflict with the `reason` so the client
 * can distinguish retention from 403 (no permission) and 404 (not
 * found / not authorized).
 */
async function isEvidenceImmutable(
  db: Kysely<Database>,
  evidenceId: string,
): Promise<{ immutable: true; reason: 'claimed' | 'linked_to_claim' | 'assessment_terminal' } | { immutable: false }> {
  const evidence = await db
    .selectFrom('evidence')
    .where('id', '=', evidenceId)
    .select(['state'])
    .executeTakeFirst();

  if (!evidence) return { immutable: false };

  if (evidence.state === 'claimed') {
    return { immutable: true, reason: 'claimed' };
  }

  const inClaimEvidence = await db
    .selectFrom('claim_evidence')
    .where('evidence_id', '=', evidenceId)
    .select('claim_id')
    .limit(1)
    .executeTakeFirst();
  if (inClaimEvidence) return { immutable: true, reason: 'linked_to_claim' };

  const inCounter = await db
    .selectFrom('claim_counter_evidence')
    .where('evidence_id', '=', evidenceId)
    .select('claim_id')
    .limit(1)
    .executeTakeFirst();
  if (inCounter) return { immutable: true, reason: 'linked_to_claim' };

  const inMitigation = await db
    .selectFrom('claim_mitigation_strategy')
    .where('evidence_id', '=', evidenceId)
    .select('claim_id')
    .limit(1)
    .executeTakeFirst();
  if (inMitigation) return { immutable: true, reason: 'linked_to_claim' };

  const terminalLink = await db
    .selectFrom('assessment_requirement_evidence as are')
    .innerJoin('assessment_requirement as ar', 'ar.id', 'are.assessment_requirement_id')
    .innerJoin('assessment as a', 'a.id', 'ar.assessment_id')
    .where('are.evidence_id', '=', evidenceId)
    .where('a.state', 'in', ['complete', 'archived', 'cancelled'])
    .select('a.id')
    .limit(1)
    .executeTakeFirst();
  if (terminalLink) return { immutable: true, reason: 'assessment_terminal' };

  return { immutable: false };
}

/**
 * Convenience helper: if evidence is retention-locked, write a 409
 * Conflict response and return true so the caller can early-return.
 * Otherwise returns false and writes nothing.
 */
async function rejectIfImmutable(
  db: Kysely<Database>,
  evidenceId: string,
  res: Response,
): Promise<boolean> {
  const result = await isEvidenceImmutable(db, evidenceId);
  if (!result.immutable) return false;

  const messages: Record<typeof result.reason, string> = {
    claimed: 'Evidence is immutable once claimed',
    linked_to_claim: 'Evidence is immutable once cited in a claim',
    assessment_terminal: 'Evidence is immutable once used in a completed, archived, or cancelled assessment',
  };

  res.status(409).json({
    error: messages[result.reason],
    reason: result.reason,
  });
  return true;
}

/**
 * Fetch assessment requirement by ID with validation
 */
async function fetchAssessmentRequirement(db: Kysely<Database>, assessmentRequirementId: string): Promise<Record<string, unknown> | undefined> {
  return db
    .selectFrom('assessment_requirement')
    .where('id', '=', assessmentRequirementId)
    .selectAll()
    .executeTakeFirst();
}

/**
 * Validate evidence submission for review
 */
async function validateEvidenceSubmission(
  evidence: Record<string, unknown> | undefined,
  reviewerId: string,
  authorId: string,
  userId: string,
): Promise<{ valid: boolean; error?: string }> {
  if (!evidence) {
    return { valid: false, error: 'Evidence not found' };
  }
  if (evidence.state !== 'in_progress') {
    return { valid: false, error: 'Evidence can only be submitted for review from the in_progress state' };
  }
  if (reviewerId === userId) {
    return { valid: false, error: 'You cannot assign yourself as the reviewer' };
  }
  if (authorId === reviewerId) {
    return { valid: false, error: 'Reviewer cannot be the same as the author' };
  }
  return { valid: true };
}

/**
 * Validate evidence approval. Returns `status` so the caller can map
 * each failure to the right HTTP semantic:
 *   - 404 when the row does not exist
 *   - 409 when the row exists but is in the wrong state (a conflict
 *     between request and current resource state)
 *   - 403 for authorization gates (not the assigned reviewer; or the
 *     author approving their own work, which is a separation-of-duties
 *     guard rather than a state conflict)
 */
function validateEvidenceApproval(
  evidence: Record<string, unknown> | undefined,
  userId: string,
  isAdmin: boolean,
): { valid: boolean; error?: string; status?: 404 | 409 | 403 } {
  if (!evidence) {
    return { valid: false, error: 'Evidence not found', status: 404 };
  }
  if (evidence.state !== 'in_review') {
    return { valid: false, error: 'Evidence must be in review status to approve', status: 409 };
  }
  // The route already requires evidence.review, which every assessor holds,
  // so that permission cannot stand in for the assignment: only the
  // assigned reviewer or an administrator may decide.
  if (!isAdmin && evidence.reviewer_id !== userId) {
    return { valid: false, error: 'Only the assigned reviewer or an admin can approve evidence', status: 403 };
  }
  if (evidence.author_id === userId) {
    return { valid: false, error: 'Evidence authors cannot approve their own evidence', status: 403 };
  }
  return { valid: true };
}


const createEvidenceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  evidenceNotes: z.string().nullable().optional(),
  // 'claimed' (approved) is only reachable through POST /:id/approve, which
  // enforces review and "authors cannot approve their own evidence"
  // (security review Z11). 'in_review' only through POST /:id/submit-for-review,
  // which validates the reviewer and notifies them.
  state: z.enum(['in_progress', 'expired']).default('in_progress'),
  expiresOn: z.string().nullable().optional(),
  isCounterEvidence: z.boolean().default(false),
  type: z.enum(['proof', 'counter_evidence', 'mitigation_strategy']).nullable().optional(),
  owner: z.string().nullable().optional(),
  reviewerId: z.string().uuid('Invalid reviewer ID').nullable().optional(),
  classification: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  geoLatitude: z.number().nullable().optional(),
  geoLongitude: z.number().nullable().optional(),
  geoLabel: z.string().nullable().optional(),
});

const addNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

router.get('/', requireAuth, requirePermission('evidence.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const { limit, offset } = validatePagination(req.query);
  const state = queryString(req.query.state);
  const assessmentId = queryString(req.query.assessmentId);
  const requirementId = queryString(req.query.requirementId);
  const search = queryString(req.query.search);

  // Row-visibility scope. A caller without a view_all permission (i.e. an
  // assessee) sees only evidence they authored or were assigned to review;
  // assessors and admins hold view_all and see everything. The same predicate
  // is mirrored into the count query below so pagination totals match.
  const userPerms = req.user?.id ? await getPermissionsForRole(req.user.role) : [];
  const evidenceViewAll = userPerms.includes('evidence.view_all') || userPerms.includes('assessments.view_all');
  const scopeUserId = req.user?.id ?? '';

  let query = db.selectFrom('evidence')
    .leftJoin('app_user as author', (join) => join.onRef('author.id', '=', 'evidence.author_id'))
    .leftJoin('app_user as reviewer', (join) => join.onRef('reviewer.id', '=', 'evidence.reviewer_id'))
    .select((eb) => [
      'evidence.id',
      'evidence.display_id',
      'evidence.bom_ref',
      'evidence.name',
      'evidence.property_name',
      'evidence.description',
      'evidence.state',
      'evidence.author_id',
      'evidence.reviewer_id',
      'evidence.expires_on',
      'evidence.is_counter_evidence',
      'evidence.classification',
      'evidence.owner',
      'evidence.type',
      'evidence.geo_latitude',
      'evidence.geo_longitude',
      'evidence.geo_label',
      'evidence.created_at',
      'evidence.updated_at',
      'author.display_name as author_name',
      'reviewer.display_name as reviewer_name',
      eb.selectFrom('assessment_requirement_evidence')
        .whereRef('assessment_requirement_evidence.evidence_id', '=', 'evidence.id')
        .select(eb.fn.countAll().as('count'))
        .as('assessment_count'),
      sql<number>`(SELECT COUNT(*) FROM (
        SELECT claim_id FROM claim_evidence WHERE evidence_id = evidence.id
        UNION
        SELECT claim_id FROM claim_counter_evidence WHERE evidence_id = evidence.id
        UNION
        SELECT claim_id FROM claim_mitigation_strategy WHERE evidence_id = evidence.id
      ) AS _claims)`.as('claims_count'),
    ]);

  if (state) {
    query = query.where('evidence.state', '=', state as 'in_review' | 'in_progress' | 'claimed' | 'expired');
  }

  // Case-insensitive substring match on name or description. Mirrors
  // /api/v1/entities so callers get a uniform filter contract across
  // list endpoints; the empty-states spec also leans on this.
  if (search) {
    query = query.where((eb) =>
      eb.or([
        eb('evidence.name', 'ilike', likeContains(search)),
        eb('evidence.description', 'ilike', likeContains(search)),
        sql<boolean>`evidence.display_id::text ilike ${likeContains(search.replace(/^EVD-?/i, ''))}`,
      ]),
    );
  }

  if (!evidenceViewAll) {
    query = query.where((eb) =>
      eb.or([
        eb('evidence.author_id', '=', scopeUserId),
        eb('evidence.reviewer_id', '=', scopeUserId),
      ]),
    );
  }

  if (assessmentId) {
    query = query
      .innerJoin('assessment_requirement_evidence', (join) =>
        join.onRef('assessment_requirement_evidence.evidence_id', '=', 'evidence.id')
      )
      .innerJoin('assessment_requirement', (join) =>
        join.onRef('assessment_requirement.id', '=', 'assessment_requirement_evidence.assessment_requirement_id')
      )
      .where(sql`assessment_requirement.assessment_id`, '=', assessmentId);

    if (requirementId) {
      query = query.where(sql`assessment_requirement.requirement_id`, '=', requirementId);
    }
  }

  const countQuery = db.selectFrom('evidence')
    .select(db.fn.count<number>('id').as('count'));

  let countWithFilters = countQuery;
  if (state) {
    countWithFilters = countWithFilters.where('state', '=', state as 'in_review' | 'in_progress' | 'claimed' | 'expired');
  }

  if (search) {
    countWithFilters = countWithFilters.where((eb) =>
      eb.or([
        eb('name', 'ilike', likeContains(search)),
        eb('description', 'ilike', likeContains(search)),
      ]),
    );
  }

  if (assessmentId) {
    countWithFilters = countWithFilters
      .innerJoin('assessment_requirement_evidence', (join) =>
        join.onRef('assessment_requirement_evidence.evidence_id', '=', 'evidence.id')
      )
      .innerJoin('assessment_requirement', (join) =>
        join.onRef('assessment_requirement.id', '=', 'assessment_requirement_evidence.assessment_requirement_id')
      )
      .where(sql`assessment_requirement.assessment_id`, '=', assessmentId);

    if (requirementId) {
      countWithFilters = countWithFilters.where(sql`assessment_requirement.requirement_id`, '=', requirementId);
    }
  }

  if (!evidenceViewAll) {
    countWithFilters = countWithFilters.where((eb) =>
      eb.or([
        eb('author_id', '=', scopeUserId),
        eb('reviewer_id', '=', scopeUserId),
      ]),
    );
  }

  const total = await countWithFilters.executeTakeFirstOrThrow().then(r => r.count);
  // Order newest first so freshly created evidence appears at the
  // top of the list and stays reachable on page 1.
  const evidence = await query
    .orderBy('evidence.created_at', 'desc')
    .orderBy('evidence.id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const evidenceIds = evidence.map((e: Record<string, unknown>) => e.id as string);
  const tagsByEvidence = await fetchTagsForEntities(db, 'evidence_tag', 'evidence_id', evidenceIds);
  const evidenceWithTags = evidence.map((e: Record<string, unknown>) => ({
    ...e,
    tags: tagsByEvidence[e.id as string] ?? [],
  }));

  res.json({
    data: evidenceWithTags,
    pagination: {
      limit,
      offset,
      total,
    },
  });
}));

router.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const db = getDatabase();
  const includeContent = req.query.include_content === 'true';

  // Authorization gate: only return evidence the caller can see. We
  // reuse the accessibility helper to decide visibility, then fetch
  // the display projection once authorization is confirmed. A 404 is
  // returned for both not-found and not-authorized to avoid leaking
  // existence to callers with no right to know.
  const accessible = await getEvidenceIfAccessible(db, req.user.id, req.user.role, req.params.id as string);
  if (!accessible) {
    res.status(404).json({ error: 'Evidence not found' });
    return;
  }

  const evidence = await db
    .selectFrom('evidence')
    .leftJoin('app_user as author', (join) => join.onRef('author.id', '=', 'evidence.author_id'))
    .leftJoin('app_user as reviewer', (join) => join.onRef('reviewer.id', '=', 'evidence.reviewer_id'))
    .where('evidence.id', '=', req.params.id)
    .select([
      'evidence.id',
      'evidence.display_id',
      'evidence.bom_ref',
      'evidence.name',
      'evidence.property_name',
      'evidence.description',
      'evidence.state',
      'evidence.author_id',
      'evidence.reviewer_id',
      'evidence.expires_on',
      'evidence.is_counter_evidence',
      'evidence.classification',
      'evidence.owner',
      'evidence.type',
      'evidence.evidence_notes',
      'evidence.geo_latitude',
      'evidence.geo_longitude',
      'evidence.geo_label',
      'evidence.created_at',
      'evidence.updated_at',
      'author.display_name as author_name',
      'reviewer.display_name as reviewer_name',
    ])
    .executeTakeFirst();

  if (!evidence) {
    res.status(404).json({ error: 'Evidence not found' });
    return;
  }

  // Explicit columns. selectAll() on this join would overwrite
  // evidence_note.id with app_user.id (both tables expose `id`) and
  // any caller that wanted to address a specific note for edit or
  // delete would silently target the author user record instead.
  const notes = (await db
    .selectFrom('evidence_note')
    .innerJoin(
      'app_user',
      (join) =>
        join.onRef(
          'app_user.id',
          '=',
          'evidence_note.user_id'
        )
    )
    .where('evidence_note.evidence_id', '=', req.params.id)
    .select([
      'evidence_note.id',
      'evidence_note.evidence_id',
      'evidence_note.user_id',
      'evidence_note.content',
      'evidence_note.created_at',
      'evidence_note.updated_at',
      'app_user.display_name as author_display_name',
      'app_user.username as author_username',
    ])
    .orderBy('evidence_note.created_at', 'desc')
    .execute()) as unknown[];

  const attachmentsQuery = db
    .selectFrom('evidence_attachment')
    .where('evidence_attachment.evidence_id', '=', req.params.id);

  const attachments = await (includeContent
    ? attachmentsQuery.selectAll().execute()
    : attachmentsQuery.select([
        'id',
        'evidence_id',
        'filename',
        'content_type',
        'size_bytes',
        'storage_path',
        'content_hash',
        'created_at',
        'updated_at',
      ]).execute());

  const tagsByEvidence = await fetchTagsForEntities(db, 'evidence_tag', 'evidence_id', [req.params.id as string]);

  res.json({
    evidence,
    notes,
    attachments,
    tags: tagsByEvidence[req.params.id as string] ?? [],
  });
}));

interface ClaimRecord {
  id: string;
  name: string;
  target: string;
  predicate: string;
  is_counter_claim: boolean;
}

// Get claims referencing a specific evidence item
router.get('/:id/claims', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const db = getDatabase();
  const evidenceId = req.params.id as string;

  // Authorization gate: evidence claim links can disclose which assessments
  // and products an organization is assessing, so they must be readable
  // only by evidence participants or holders of the view-all permissions.
  const accessible = await getEvidenceIfAccessible(db, req.user.id, req.user.role, evidenceId);
  if (!accessible) {
    res.status(404).json({ error: 'Evidence not found' });
    return;
  }

  // Find claims where this evidence is supporting, counter, or mitigation
  const supportingClaims = (await db
    .selectFrom('claim_evidence')
    .innerJoin('claim', (join) =>
      join.onRef('claim.id', '=', 'claim_evidence.claim_id')
    )
    .where('claim_evidence.evidence_id', '=', evidenceId)
    .select([
      'claim.id',
      'claim.name',
      'claim.target',
      'claim.predicate',
      'claim.is_counter_claim',
    ])
    .execute()) as ClaimRecord[];

  const counterClaims = (await db
    .selectFrom('claim_counter_evidence')
    .innerJoin('claim', (join) =>
      join.onRef('claim.id', '=', 'claim_counter_evidence.claim_id')
    )
    .where('claim_counter_evidence.evidence_id', '=', evidenceId)
    .select([
      'claim.id',
      'claim.name',
      'claim.target',
      'claim.predicate',
      'claim.is_counter_claim',
    ])
    .execute()) as ClaimRecord[];

  const mitigationClaims = (await db
    .selectFrom('claim_mitigation_strategy')
    .innerJoin('claim', (join) =>
      join.onRef('claim.id', '=', 'claim_mitigation_strategy.claim_id')
    )
    .where('claim_mitigation_strategy.evidence_id', '=', evidenceId)
    .select([
      'claim.id',
      'claim.name',
      'claim.target',
      'claim.predicate',
      'claim.is_counter_claim',
    ])
    .execute()) as ClaimRecord[];

  const allClaims = [
    ...supportingClaims.map((c: ClaimRecord) => ({ ...c, is_counter: false, is_mitigation: false })),
    ...counterClaims.map((c: ClaimRecord) => ({ ...c, is_counter: true, is_mitigation: false })),
    ...mitigationClaims.map((c: ClaimRecord) => ({ ...c, is_counter: false, is_mitigation: true })),
  ];

  // Deduplicate by claim ID
  const seen = new Set<string>();
  const uniqueClaims = allClaims.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  res.json({ data: uniqueClaims });
}));

router.post('/', requireAuth, requirePermission('evidence.create'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const data = createEvidenceSchema.parse(req.body);
    const db = getDatabase();
    const evidenceId = uuidv4();

    await db
      .insertInto('evidence')
      .values(toSnakeCase({
        id: evidenceId,
        name: data.name,
        description: data.description,
        evidenceNotes: data.evidenceNotes,
        state: data.state,
        authorId: req.user.id,
        reviewerId: data.reviewerId,
        expiresOn: data.expiresOn ? new Date(data.expiresOn) : undefined,
        isCounterEvidence: data.isCounterEvidence,
        type: data.type,
        owner: data.owner,
        classification: data.classification,
        geoLatitude: data.geoLatitude ?? undefined,
        geoLongitude: data.geoLongitude ?? undefined,
        geoLabel: data.geoLabel ?? undefined,
      }))
      .execute();

    await logAudit(db, {
      entityType: 'evidence',
      entityId: evidenceId,
      action: 'create',
      userId: req.user.id,
      changes: {
        name: data.name,
        description: data.description,
        state: data.state,
      },
    });

    if (data.tags && data.tags.length > 0) {
      await syncEntityTags(db, 'evidence_tag', 'evidence_id', evidenceId, data.tags);
    }

    logger.info('Evidence created', {
      evidenceId,
      name: data.name,
      authorId: req.user.id,
      requestId: req.requestId,
    });

    req.eventBus?.emit(
      EVIDENCE_CREATED,
      { evidenceId, evidenceName: data.name, authorId: req.user.id, submittedBy: req.user.displayName },
      { userId: req.user.id, displayName: req.user.displayName },
    );

    res.status(201).json({
      id: evidenceId,
      name: data.name,
      description: data.description,
      state: data.state,
      authorId: req.user.id,
      expiresOn: data.expiresOn ? new Date(data.expiresOn) : undefined,
      isCounterEvidence: data.isCounterEvidence,
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;

    logger.error('Create evidence error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// Update evidence
const updateEvidenceSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  evidenceNotes: z.string().nullable().optional(),
  // No 'claimed'/'approved' here: approval goes through POST /:id/approve (Z11).
  // No 'in_review' either: review starts with POST /:id/submit-for-review.
  state: z.enum(['in_progress', 'expired']).optional(),
  expiresOn: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  reviewerId: z.string().uuid().nullable().optional(),
  type: z.enum(['proof', 'counter_evidence', 'mitigation_strategy']).nullable().optional(),
  owner: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  geoLatitude: z.number().nullable().optional(),
  geoLongitude: z.number().nullable().optional(),
  geoLabel: z.string().nullable().optional(),
});

router.put('/:id', requireAuth, requirePermission('evidence.edit'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateEvidenceSchema.parse(req.body);
    const db = getDatabase();

    // Write gate, not the read gate: view_all lets an assessor see any
    // evidence, not edit it (security review Z11, same rule as F02).
    const writable = await getEvidenceIfWritable(db, req.user!.id, req.user!.role, req.params.id as string);
    const evidence = writable
      ? await db.selectFrom('evidence').where('id', '=', req.params.id as string).selectAll().executeTakeFirst()
      : undefined;

    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    // Retention/immutability check. Covers the legacy `state === 'claimed'`
    // rule plus the newer conditions: cited in a claim, or linked to an
    // assessment whose state is complete/archived/cancelled. Admins are
    // bound equally; this is a record-integrity policy, not an authz
    // policy, so 409 is returned instead of 403.
    if (await rejectIfImmutable(db, req.params.id as string, res)) return;

    // Evidence under review leaves review only through approve or reject,
    // so the reviewer's decision (and the rejection note) is never skipped.
    if (evidence.state === 'in_review' && data.state !== undefined) {
      res.status(409).json({ error: 'Evidence is in review: the reviewer approves or rejects it' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.evidenceNotes !== undefined) updateData.evidenceNotes = data.evidenceNotes;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.expiresOn !== undefined) updateData.expiresOn = data.expiresOn ? new Date(data.expiresOn) : null;
    if (data.classification !== undefined) updateData.classification = data.classification;
    if (data.reviewerId !== undefined) updateData.reviewerId = data.reviewerId;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.owner !== undefined) updateData.owner = data.owner;
    if (data.geoLatitude !== undefined) updateData.geoLatitude = data.geoLatitude;
    if (data.geoLongitude !== undefined) updateData.geoLongitude = data.geoLongitude;
    if (data.geoLabel !== undefined) updateData.geoLabel = data.geoLabel;

    if (Object.keys(updateData).length > 0) {
      await db
        .updateTable('evidence')
        .set(toSnakeCase(updateData))
        .where('id', '=', req.params.id)
        .execute();

      await logAudit(db, {
        entityType: 'evidence',
        entityId: req.params.id as string,
        action: 'update',
        userId: req.user?.id ?? '',
        changes: toSnakeCase(updateData),
      });
    }

    if (data.tags !== undefined) {
      await syncEntityTags(db, 'evidence_tag', 'evidence_id', req.params.id as string, data.tags);
    }

    logger.info('Evidence updated', {
      evidenceId: req.params.id,
      requestId: req.requestId,
    });

    // Fetch and return the updated evidence
    const updatedEvidence = await db
      .selectFrom('evidence')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    const tagsByEvidence = await fetchTagsForEntities(db, 'evidence_tag', 'evidence_id', [req.params.id as string]);

    res.json({
      ...updatedEvidence,
      tags: tagsByEvidence[req.params.id as string] || [],
    });
  } catch (error) {
    if (handleValidationError(res, error)) return;

    logger.error('Update evidence error', { error, requestId: req.requestId });
    res.status(500).json({ error: 'Internal server error' });
  }
}));

// Hard-delete an evidence row that is still in a mutable state. Used
// for cleanup of mistaken or aborted captures before they are cited.
// The retention rules (claimed, cited in a claim, linked to a terminal
// assessment) trump the delete permission — admins included — and the
// 409 carries a `reason` so the UI can distinguish retention from a
// missing record or a permission gap.
//
// FK cascades on evidence_note, evidence_attachment, evidence_tag, and
// assessment_requirement_evidence handle the dependent rows; the
// evidence row delete is the only statement needed here.
router.delete(
  '/:id',
  requireAuth,
  requirePermission('evidence.delete'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const evidence = await db
      .selectFrom('evidence')
      .where('id', '=', req.params.id as string)
      .select(['id'])
      .executeTakeFirst();

    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    if (await rejectIfImmutable(db, req.params.id as string, res)) return;

    // Soft delete: `evidence` is a view hiding deleted rows; the physical row
    // stays in evidence_raw for restore. Purge removes it permanently.
    await db
      .updateTable('evidence')
      .set({ deleted_at: new Date() })
      .where('id', '=', req.params.id as string)
      .execute();

    await logAudit(db, {
      entityType: 'evidence',
      entityId: req.params.id as string,
      action: 'delete',
      userId: req.user?.id ?? '',
    });

    logger.info('Evidence deleted', {
      evidenceId: req.params.id,
      userId: req.user?.id,
      requestId: req.requestId,
    });

    res.status(204).send();
  }),
);

// Restore a soft-deleted evidence record. Targets evidence_raw because the
// evidence view hides deleted rows.
router.post(
  '/:id/restore',
  requireAuth,
  requirePermission('evidence.delete'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const row = await db
      .selectFrom('evidence_raw')
      .select(['id', 'deleted_at'])
      .where('id', '=', req.params.id as string)
      .executeTakeFirst();

    if (!row) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }
    if (!row.deleted_at) {
      res.status(409).json({ error: 'Evidence is not deleted' });
      return;
    }

    await db
      .updateTable('evidence_raw')
      .set({ deleted_at: null })
      .where('id', '=', req.params.id as string)
      .execute();

    logger.info('Evidence restored', { evidenceId: req.params.id, requestId: req.requestId });
    res.json({ message: 'Evidence restored' });
  }),
);

router.post(
  '/:id/notes',
  requireAuth,
  requirePermission('evidence.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const data = addNoteSchema.parse(req.body);
      const db = getDatabase();

      // Notes change the record: write gate, not view_all (security review Z11).
      const evidence = await getEvidenceIfWritable(db, req.user.id, req.user.role, req.params.id as string);

      if (!evidence) {
        res.status(404).json({ error: 'Evidence not found' });
        return;
      }

      // Notes are part of the evidence record for retention purposes, so
      // they cannot be added to a used/locked evidence row.
      if (await rejectIfImmutable(db, req.params.id as string, res)) return;

      const noteId = uuidv4();

      await db
        .insertInto('evidence_note')
        .values(toSnakeCase({
          id: noteId,
          evidenceId: req.params.id as string,
          userId: req.user.id,
          content: data.content,
          createdAt: new Date(),
          updatedAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        }) as any)
        .execute();

      logger.info('Evidence note added', {
        evidenceId: req.params.id as string,
        noteId,
        userId: req.user.id,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: noteId,
        content: data.content,
        userId: req.user.id,
        createdAt: new Date(),
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Add evidence note error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

const linkEvidenceSchema = z.object({
  assessmentRequirementId: z.string().uuid('Invalid assessment requirement ID'),
});

router.post(
  '/:id/link',
  requireAuth,
  requirePermission('evidence.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = linkEvidenceSchema.parse(req.body);
      const db = getDatabase();

      const evidence = await fetchEvidence(db, req.params.id as string);
      if (!evidence) {
        res.status(404).json({ error: 'Evidence not found' });
        return;
      }

      const assessmentReq = await fetchAssessmentRequirement(db, data.assessmentRequirementId);
      if (!assessmentReq) {
        res.status(404).json({ error: 'Assessment requirement not found' });
        return;
      }

      const assessmentId = (assessmentReq.assessment_id as unknown) as string;
      const userId = req.user?.id ?? '';
      const userRole = req.user?.role ?? '';
      const isParticipant = await isAssessmentParticipant(db, userId, userRole, assessmentId);
      if (!isParticipant) {
        res.status(403).json({ error: 'You are not a participant in this assessment' });
        return;
      }

      const existing = await db
        .selectFrom('assessment_requirement_evidence')
        .where('assessment_requirement_id', '=', data.assessmentRequirementId)
        .where('evidence_id', '=', req.params.id)
        .selectAll()
        .executeTakeFirst();

      if (existing) {
        res.status(409).json({ error: 'Evidence is already linked to this requirement' });
        return;
      }

      await db
        .insertInto('assessment_requirement_evidence')
        .values(toSnakeCase({
          assessmentRequirementId: data.assessmentRequirementId,
          evidenceId: req.params.id as string,
          createdAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        }) as any)
        .execute();

      logger.info('Evidence linked to requirement', {
        evidenceId: req.params.id as string,
        assessmentRequirementId: data.assessmentRequirementId,
        userId: req.user?.id,
        requestId: req.requestId,
      });

      res.status(201).json({ message: 'Evidence linked successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Link evidence error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

const unlinkEvidenceSchema = z.object({
  assessmentRequirementId: z.string().uuid('Invalid assessment requirement ID'),
});

router.delete(
  '/:id/unlink',
  requireAuth,
  requirePermission('evidence.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = unlinkEvidenceSchema.parse(req.body);
      const db = getDatabase();

      const evidence = await fetchEvidence(db, req.params.id as string);
      if (!evidence) {
        res.status(404).json({ error: 'Evidence not found' });
        return;
      }

      const assessmentReq = await fetchAssessmentRequirement(db, data.assessmentRequirementId);
      if (!assessmentReq) {
        res.status(404).json({ error: 'Assessment requirement not found' });
        return;
      }

      const assessmentId = (assessmentReq.assessment_id as unknown) as string;
      const userId = req.user?.id ?? '';
      const userRole = req.user?.role ?? '';
      const isParticipant = await isAssessmentParticipant(db, userId, userRole, assessmentId);
      if (!isParticipant) {
        res.status(403).json({ error: 'You are not a participant in this assessment' });
        return;
      }

      // Links are part of the evidence record for retention purposes. If
      // the evidence is used (claimed, cited in a claim, or linked to a
      // terminal assessment) then no link row may be removed, even the
      // one currently being asked for.
      if (await rejectIfImmutable(db, req.params.id as string, res)) return;

      const result = await db
        .deleteFrom('assessment_requirement_evidence')
        .where('evidence_id', '=', req.params.id as string)
        .where('assessment_requirement_id', '=', data.assessmentRequirementId)
        .execute();

      if (Number(result[0].numDeletedRows) === 0) {
        res.status(404).json({ error: 'Link not found' });
        return;
      }

      logger.info('Evidence unlinked from requirement', {
        evidenceId: req.params.id as string,
        assessmentRequirementId: data.assessmentRequirementId,
        userId: req.user?.id,
        requestId: req.requestId,
      });

      res.json({ message: 'Evidence unlinked successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Unlink evidence error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

const submitForReviewSchema = z.object({
  reviewerId: z.string().uuid('Invalid reviewer ID'),
});

router.post(
  '/:id/submit-for-review',
  requireAuth,
  // Permission is checked inside the handler so the documented
  // "author can submit even without evidence.submit" carve-out
  // actually fires. With requirePermission at the route level, the
  // middleware 403'd every caller who lacked evidence.submit and the
  // author check below was dead code. The assessor role intentionally
  // does not carry evidence.submit (assessee owns submission), but an
  // assessor who created a piece of evidence still needs to send it
  // for review themselves — otherwise the create→submit→approve flow
  // is unreachable for them.
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = submitForReviewSchema.parse(req.body);
      const db = getDatabase();

      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const evidence = await fetchEvidence(db, req.params.id as string);

      if (!evidence) {
        res.status(404).json({ error: 'Evidence not found' });
        return;
      }

      // Only the author (or an admin) submits evidence; holding
      // evidence.submit used to let any assessee submit anyone's evidence
      // and pick its reviewer (security review Z11).
      const userPermissions = await getPermissionsForRole(req.user.role);
      const isAdmin = userPermissions.includes('admin.settings');
      if (evidence.author_id !== req.user.id && !isAdmin) {
        res.status(403).json({ error: 'Only the evidence author or an admin can submit evidence for review' });
        return;
      }

      const authorId = (evidence as Record<string, unknown>).author_id as string;
      const validation = await validateEvidenceSubmission(
        evidence,
        data.reviewerId,
        authorId,
        req.user.id,
      );
      if (!validation.valid) {
        const statusCode = validation.error?.includes('not found') ? 404 : 409;
        res.status(statusCode).json({ error: validation.error });
        return;
      }

      // State transitions mutate the evidence record and must respect
      // retention. The validation above covers `state === 'claimed'`
      // indirectly (by requiring `in_progress`), but the retention
      // helper also blocks evidence already cited in a claim or linked
      // to a terminal assessment, which can in theory coexist with
      // other non-terminal states.
      if (await rejectIfImmutable(db, req.params.id as string, res)) return;

      // Existence check only; we never return this row to the client.
      const reviewer = await db
        .selectFrom('app_user')
        .where('id', '=', data.reviewerId)
        .select('id')
        .executeTakeFirst();

      if (!reviewer) {
        res.status(404).json({ error: 'Reviewer not found' });
        return;
      }

      await db
        .updateTable('evidence')
        .set(toSnakeCase({
          state: 'in_review',
          reviewerId: data.reviewerId,
        }))
        .where('id', '=', req.params.id as string)
        .execute();

      await logAudit(db, {
        entityType: 'evidence',
        entityId: req.params.id as string,
        action: 'state_change',
        userId: req.user.id,
        changes: toSnakeCase({ state: 'in_review', reviewerId: data.reviewerId }),
      });

      if (evidence) {
        req.eventBus?.emit(
          EVIDENCE_STATE_CHANGED,
          {
            evidenceId: req.params.id as string,
            evidenceName: (evidence as Record<string, unknown>).name as string,
            previousState: 'in_progress',
            newState: 'in_review',
            reviewerId: data.reviewerId,
            authorId: (evidence as Record<string, unknown>).author_id as string,
            assessmentId: null,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      logger.info('Evidence submitted for review', {
        evidenceId: req.params.id as string,
        reviewerId: data.reviewerId,
        userId: req.user.id,
        requestId: req.requestId,
      });

      res.json({ message: 'Evidence submitted for review successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Submit for review error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

router.post(
  '/:id/approve',
  requireAuth,
  requirePermission('evidence.review'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const evidence = await fetchEvidence(db, req.params.id as string);
    const userPermissions = await getPermissionsForRole(req.user.role);
    const isAdmin = userPermissions.includes('admin.settings');

    const validation = validateEvidenceApproval(evidence, req.user.id, isAdmin);
    if (!validation.valid) {
      res.status(validation.status ?? 409).json({ error: validation.error });
      return;
    }

    // Approval is a state transition that both the retention rule and
    // the business invariants care about. If the evidence is already
    // retention-locked (for example because it is linked to a terminal
    // assessment) the caller should not be able to move it to claimed
    // through this path.
    if (await rejectIfImmutable(db, req.params.id as string, res)) return;

    // RETURNING is portable across PGlite (which does not populate
    // numUpdatedRows reliably) and PostgreSQL. The optimistic-locking
    // check below relies on the returned row, not the driver's count.
    const updated = await db
      .updateTable('evidence')
      .set({ state: 'claimed' })
      .where('id', '=', req.params.id as string)
      .where('state', '=', 'in_review')
      .returning('id')
      .execute();

    if (updated.length === 0) {
      res.status(409).json({ error: 'Evidence state has changed. Please refresh and try again.' });
      return;
    }

    await logAudit(db, {
      entityType: 'evidence',
      entityId: req.params.id as string,
      action: 'state_change',
      userId: req.user.id,
      changes: { state: 'claimed' },
    });

    if (evidence) {
      req.eventBus?.emit(
        EVIDENCE_STATE_CHANGED,
        {
          evidenceId: req.params.id as string,
          evidenceName: (evidence as Record<string, unknown>).name as string,
          previousState: 'in_review',
          newState: 'claimed',
          authorId: (evidence as Record<string, unknown>).author_id as string,
          reviewerId: (evidence as Record<string, unknown>).reviewer_id as string | undefined,
          assessmentId: null,
        },
        { userId: req.user.id, displayName: req.user.displayName },
      );
    }

    logger.info('Evidence approved', {
      evidenceId: req.params.id as string,
      reviewerId: req.user.id,
      requestId: req.requestId,
    });

    res.json({ message: 'Evidence approved successfully' });
  })
);

const rejectEvidenceSchema = z.object({
  note: z.string().min(1, 'Rejection note is required'),
});

router.post(
  '/:id/reject',
  requireAuth,
  requirePermission('evidence.review'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = rejectEvidenceSchema.parse(req.body);
      const db = getDatabase();

      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const evidence = await fetchEvidence(db, req.params.id as string);
      if (!evidence) {
        res.status(404).json({ error: 'Evidence not found' });
        return;
      }

      const userPermissions = await getPermissionsForRole(req.user.role);
      // evidence.review is required by the route itself, so it cannot be
      // what lets a caller reject someone else's assignment.
      const isAdmin = userPermissions.includes('admin.settings');

      if (evidence.state !== 'in_review') {
        res.status(409).json({ error: 'Evidence must be in review status to reject' });
        return;
      }

      if (!isAdmin && evidence.reviewer_id !== req.user.id) {
        res.status(403).json({ error: 'Only the assigned reviewer or an admin can reject evidence' });
        return;
      }

      if (evidence.author_id === req.user.id) {
        res.status(403).json({ error: 'Evidence authors cannot reject their own evidence' });
        return;
      }

      // Reject is a state transition and a note-insert. Both are
      // blocked once the evidence is retention-locked.
      if (await rejectIfImmutable(db, req.params.id as string, res)) return;

      // RETURNING is portable across PGlite (which does not populate
      // numUpdatedRows reliably) and PostgreSQL; see the matching
      // change in the approve handler above.
      const updated = await db
        .updateTable('evidence')
        .set(toSnakeCase({ state: 'in_progress' }))
        .where('id', '=', req.params.id as string)
        .where('state', '=', 'in_review')
        .returning('id')
        .execute();

      if (updated.length === 0) {
        res.status(409).json({ error: 'Evidence state has changed. Please refresh and try again.' });
        return;
      }

      await logAudit(db, {
        entityType: 'evidence',
        entityId: req.params.id as string,
        action: 'state_change',
        userId: req.user.id,
        changes: toSnakeCase({ state: 'in_progress', rejectionReason: data.note }),
      });

      const noteId = uuidv4();
      // biome-ignore lint/suspicious/noExplicitAny: toSnakeCase returns object incompatible with DB row type
      await db
        .insertInto('evidence_note')
        .values(toSnakeCase({
          id: noteId,
          evidenceId: req.params.id as string,
          userId: req.user.id,
          content: `REJECTED: ${data.note}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          // biome-ignore lint/suspicious/noExplicitAny: Kysely dynamic query requires type cast
        }) as any)
        .execute();

      req.eventBus?.emit(
        EVIDENCE_STATE_CHANGED,
        {
          evidenceId: req.params.id as string,
          evidenceName: evidence.name,
          previousState: 'in_review',
          newState: 'in_progress',
          rejectionReason: data.note,
          authorId: evidence.author_id,
          reviewerId: evidence.reviewer_id,
          assessmentId: null,
        },
        { userId: req.user.id, displayName: req.user.displayName },
      );

      logger.info('Evidence rejected', {
        evidenceId: req.params.id as string,
        reviewerId: req.user.id,
        noteId,
        requestId: req.requestId,
      });

      res.json({ message: 'Evidence rejected successfully' });
    } catch (error) {
      if (handleValidationError(res, error)) return;

      logger.error('Reject evidence error', { error, requestId: req.requestId });
      res.status(500).json({ error: 'Internal server error' });
    }
  })
);

// evidence_attachment.filename is VARCHAR(255)
const MAX_ATTACHMENT_FILENAME = 255;
// Upper bound on files in one multipart request; each file is buffered.
const MAX_ATTACHMENTS_PER_UPLOAD = 10;

const createAttachmentSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(MAX_ATTACHMENT_FILENAME),
  contentType: z.string().min(1, 'Content type is required'),
  binaryContent: z.string().min(1, 'Binary content is required'),
});

// Helper function to compute SHA-256 hash of buffer
function computeContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

interface AttachmentInput {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

/**
 * Stores one attachment. The storage key is built from ids only (the
 * client filename lives in the row), and the row is inserted before the
 * object-store write so a failed write never leaves an orphaned object:
 * on failure the row is removed and the error rethrown.
 */
async function persistAttachment(
  db: Kysely<Database>,
  storageProvider: ReturnType<typeof getStorageProvider>,
  storageProviderName: StorageProviderName,
  evidenceId: string,
  input: AttachmentInput,
): Promise<Record<string, unknown>> {
  const attachmentId = uuidv4();
  const storageKey = `evidence/${evidenceId}/${attachmentId}`;
  const contentHash = computeContentHash(input.buffer);
  const row: Record<string, unknown> = {
    id: attachmentId,
    evidenceId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.buffer.length,
    contentHash,
    storageProvider: storageProviderName,
    storagePath: storageKey,
    binaryContent: storageProviderName === 'database' ? input.buffer : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insertInto('evidence_attachment').values(toSnakeCase(row)).execute();
  if (storageProviderName !== 'database') {
    try {
      await storageProvider.put(storageKey, input.buffer, { contentType: input.contentType });
    } catch (error) {
      await db.deleteFrom('evidence_attachment').where('id', '=', attachmentId).execute();
      throw error;
    }
  }
  return {
    id: attachmentId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.buffer.length,
    storagePath: storageKey,
    contentHash,
  };
}

router.post(
  '/:id/attachments',
  requireAuth,
  requirePermission('evidence.edit'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const db = getDatabase();

    // Authorization gate (WRITE): the caller must be the author, the
    // assigned reviewer, a participant (assessor/assessee) on an
    // assessment this evidence is linked to, or an administrator.
    // `requirePermission('evidence.edit')` only asserts the caller could
    // edit *some* evidence; it does not scope the edit to this record. A
    // bare `*.view_all` read scope does NOT grant write here — "read all"
    // must not imply "write all" (F02 BOLA). 404 on the negative case
    // avoids leaking evidence existence.
    const evidence = await getEvidenceIfWritable(db, req.user.id, req.user.role, req.params.id as string);
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    // Attachments are part of the evidence record for retention
    // purposes and cannot be added to a used/locked evidence row.
    if (await rejectIfImmutable(db, req.params.id as string, res)) return;

    const maxFileSize = getMaxFileSize();
    const storageProviderName = getStorageProviderName();
    const storageProvider = getStorageProvider();

    // Check if this is JSON body upload or multipart upload
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      // JSON body upload (for demo data seeding)
      try {
        const data = createAttachmentSchema.parse(req.body);

        // Decode base64 content
        const buffer = Buffer.from(data.binaryContent, 'base64');

        if (buffer.length > maxFileSize) {
          res.status(413).json({ error: `File exceeds maximum size of ${maxFileSize} bytes` });
          return;
        }

        const mimeDecision = verifyAttachmentMimeType(buffer, data.filename, data.contentType);
        if (!mimeDecision.allowed) {
          logger.warn('Attachment rejected by MIME allowlist', {
            evidenceId: req.params.id as string,
            filename: data.filename,
            claimedType: data.contentType,
            detectedType: mimeDecision.resolvedType,
            reason: mimeDecision.reason,
            userId: req.user?.id,
            requestId: req.requestId,
          });
          res.status(415).json({
            error: mimeDecision.reason ?? 'Unsupported media type',
            detectedType: mimeDecision.resolvedType,
          });
          return;
        }

        const saved = await persistAttachment(db, storageProvider, storageProviderName, req.params.id as string, {
          filename: data.filename,
          contentType: mimeDecision.resolvedType,
          buffer,
        });

        logger.info('Attachment created from JSON body', {
          evidenceId: req.params.id as string,
          attachmentId: saved.id,
          filename: data.filename,
          storageProvider: storageProviderName,
          userId: req.user?.id,
          requestId: req.requestId,
        });

        res.status(201).json({
          message: 'Attachment created successfully',
          attachments: [saved],
        });
        return;
      } catch (error) {
        if (handleValidationError(res, error)) return;
        throw error;
      }
    }

      // Multipart form upload. Files are buffered (bounded by size and
      // count limits), then validated as a set, then persisted. The
      // response is sent exactly once: busboy emits 'close' after
      // 'error', and a second res.json() from an event callback would
      // throw ERR_HTTP_HEADERS_SENT outside any handler and kill the process.
      const bb = busboy({
        headers: req.headers,
        limits: {
          fileSize: maxFileSize,
          files: MAX_ATTACHMENTS_PER_UPLOAD,
          parts: MAX_ATTACHMENTS_PER_UPLOAD + 20,
          fields: 20,
        },
      });

      const received: { filename: string; claimedType: string; chunks: Buffer[] }[] = [];
      let fileSizeLimitHit = false;
      let countLimitHit = false;
      let filenameTooLong = false;
      let responded = false;
      const respond = (status: number, body: Record<string, unknown>): void => {
        if (responded || res.headersSent) return;
        responded = true;
        res.status(status).json(body);
      };

      bb.on('file', (_fieldname, file, info) => {
        const entry = { filename: info.filename, claimedType: info.mimeType, chunks: [] as Buffer[] };
        if (!entry.filename || entry.filename.length > MAX_ATTACHMENT_FILENAME) filenameTooLong = true;
        received.push(entry);
        file.on('data', (chunk: Buffer) => {
          if (!fileSizeLimitHit) entry.chunks.push(chunk);
        });
        file.on('limit', () => {
          fileSizeLimitHit = true;
          entry.chunks = [];
          logger.warn('File size limit exceeded', { filename: entry.filename, limit: maxFileSize, requestId: req.requestId });
        });
        file.on('error', (error) => {
          logger.error('File upload error', { error, requestId: req.requestId });
        });
      });
      bb.on('filesLimit', () => { countLimitHit = true; });
      bb.on('partsLimit', () => { countLimitHit = true; });
      bb.on('fieldsLimit', () => { countLimitHit = true; });

      bb.on('error', (error) => {
        logger.error('Busboy error', { error, requestId: req.requestId });
        respond(400, { error: 'Error processing upload' });
      });

      bb.on('close', () => {
        if (responded) return;
        if (fileSizeLimitHit) {
          respond(413, { error: `File exceeds maximum size of ${maxFileSize} bytes` });
          return;
        }
        if (countLimitHit) {
          respond(413, { error: `At most ${MAX_ATTACHMENTS_PER_UPLOAD} files per upload` });
          return;
        }
        if (received.length === 0) {
          respond(400, { error: 'No file in upload' });
          return;
        }
        if (filenameTooLong) {
          respond(400, { error: `Filename must be 1 to ${MAX_ATTACHMENT_FILENAME} characters` });
          return;
        }

        // Validate every file before persisting any, so a rejected file
        // never leaves its siblings half-saved.
        const accepted: AttachmentInput[] = [];
        for (const entry of received) {
          const buffer = Buffer.concat(entry.chunks);
          const mimeDecision = verifyAttachmentMimeType(buffer, entry.filename, entry.claimedType);
          if (!mimeDecision.allowed) {
            logger.warn('Attachment rejected by MIME allowlist', {
              evidenceId: req.params.id as string,
              filename: entry.filename,
              claimedType: entry.claimedType,
              detectedType: mimeDecision.resolvedType,
              reason: mimeDecision.reason,
              userId: req.user?.id,
              requestId: req.requestId,
            });
            respond(415, {
              error: mimeDecision.reason ?? 'Unsupported media type',
              filename: entry.filename,
              detectedType: mimeDecision.resolvedType,
            });
            return;
          }
          accepted.push({ filename: entry.filename, contentType: mimeDecision.resolvedType, buffer });
        }

        void (async () => {
          const saved: Record<string, unknown>[] = [];
          try {
            for (const input of accepted) {
              const attachment = await persistAttachment(db, storageProvider, storageProviderName, req.params.id as string, input);
              saved.push(attachment);
              logger.info('Attachment uploaded', {
                evidenceId: req.params.id as string,
                attachmentId: attachment.id,
                filename: input.filename,
                storageProvider: storageProviderName,
                userId: req.user?.id,
                requestId: req.requestId,
              });
            }
            respond(201, { message: 'Attachments uploaded successfully', attachments: saved });
          } catch (error) {
            logger.error('Error saving attachment', { error, requestId: req.requestId });
            respond(500, { error: 'Failed to save attachment', saved: saved.length });
          }
        })();
      });

    req.pipe(bb);
  })
);

router.get(
  '/:id/attachments/:attachmentId/download',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const db = getDatabase();

    // Authorization gate: binary content can contain proprietary or
    // regulated material, so the download must be restricted to evidence
    // participants or holders of the view-all permissions. The check
    // runs before the attachment lookup to avoid leaking its existence.
    const accessible = await getEvidenceIfAccessible(db, req.user.id, req.user.role, req.params.id as string);
    if (!accessible) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const attachment = await db
      .selectFrom('evidence_attachment')
      .where('evidence_attachment.id', '=', req.params.attachmentId)
      .where('evidence_attachment.evidence_id', '=', req.params.id)
      .selectAll()
      .executeTakeFirst();

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.setHeader('Content-Type', attachment.content_type);
    // X-Content-Type-Options: nosniff prevents browsers from
    // MIME-sniffing a user-uploaded file as something more dangerous
    // than its stored Content-Type (for example, rendering a
    // "text/plain" upload as HTML). Paired with the allowlist and
    // magic-number check at upload time this closes the common
    // same-origin stored XSS path for uploaded attachments.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Defense in depth: belt-and-braces guard against legacy clients
    // that ignore the SPA-wide CSP. sandbox on the response CSP
    // tells browsers to treat the body as an opaque origin so any
    // scripted content (HTML, SVG, and so on) runs without cookies
    // or same-origin privileges even when served with a rich MIME
    // type.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Content-Disposition', contentDisposition('attachment', attachment.filename));

    // Resolve the provider that was used to store this particular attachment,
    // not the currently configured provider. This ensures mixed-storage
    // deployments can still serve all files.
    const recordProvider = (attachment.storage_provider || 'database') as StorageProviderName;

    try {
      if (recordProvider === 'database') {
        // For database provider, content is already in the row
        if (attachment.binary_content) {
          const data = Buffer.isBuffer(attachment.binary_content)
            ? attachment.binary_content
            // biome-ignore lint/suspicious/noExplicitAny: BYTEA column type varies by driver
            : Buffer.from(attachment.binary_content as any, 'base64');
          // eslint-disable-next-line security/direct-response-write
          res.send(data);
        } else {
          res.status(404).json({ error: 'File content not found in database' });
        }
      } else {
        // S3: use the provider abstraction
        const provider = resolveProvider(recordProvider);
        const storageKey = attachment.storage_path || `evidence/${attachment.evidence_id}/${attachment.id}-${attachment.filename}`;
        const result = await provider.get(storageKey);
        // eslint-disable-next-line security/direct-response-write
        res.send(result.data);
      }

      logger.info('Attachment downloaded', {
        evidenceId: req.params.id as string,
        attachmentId: req.params.attachmentId,
        storageProvider: recordProvider,
        userId: req.user?.id,
        requestId: req.requestId,
      });
    } catch (error) {
      logger.error('Error retrieving attachment content', { error, provider: recordProvider, requestId: req.requestId });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading file' });
      }
    }
  })
);

router.delete(
  '/:id/attachments/:attachmentId',
  requireAuth,
  requirePermission('evidence.delete'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const db = getDatabase();

    // Authorization gate (WRITE): author, assigned reviewer, a participant
    // on a linked assessment, or administrator. Same rationale as the POST
    // route: a global `evidence.delete` permission does not imply
    // record-level authority, and a bare `*.view_all` read scope does NOT
    // grant write (F02 BOLA). 404 avoids leaking existence.
    const accessible = await getEvidenceIfWritable(db, req.user.id, req.user.role, req.params.id as string);
    if (!accessible) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const attachment = await db
      .selectFrom('evidence_attachment')
      .where('evidence_attachment.id', '=', req.params.attachmentId)
      .where('evidence_attachment.evidence_id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    // Attachments on used/locked evidence cannot be deleted. This is
    // the primary retention vector: once the evidence has been cited
    // or closed out, its binary payload must survive any caller's
    // decision, including admins. Return 409 so the client can
    // distinguish retention from authorization.
    if (await rejectIfImmutable(db, req.params.id as string, res)) return;

    // Delete from external storage if applicable (S3)
    const recordProvider = (attachment.storage_provider || 'database') as StorageProviderName;
    if (recordProvider !== 'database' && attachment.storage_path) {
      try {
        const provider = resolveProvider(recordProvider);
        await provider.delete(attachment.storage_path);
      } catch (error) {
        logger.error('Error deleting from storage provider', {
          error,
          provider: recordProvider,
          requestId: req.requestId,
        });
      }
    }

    await db
      .deleteFrom('evidence_attachment')
      .where('id', '=', req.params.attachmentId)
      .execute();

    logger.info('Attachment deleted', {
      evidenceId: req.params.id as string,
      attachmentId: req.params.attachmentId,
      storageProvider: recordProvider,
      userId: req.user?.id,
      requestId: req.requestId,
    });

    res.json({ message: 'Attachment deleted successfully' });
  })
);

export default router;
