/**
 * PR3 update to the Sprint 5.7 retention lock. Record-integrity lock for
 * claims and attestations.
 *
 * The evidence-side helper (`isEvidenceImmutable` in routes/evidence.ts)
 * already stops mutations on evidence once it has been used. This module
 * mirrors that stance one level up: if an evidence row is locked, the
 * claim that cites it should be locked too, and if a claim is locked,
 * the attestation that cites that claim should be locked too. Otherwise
 * the record-integrity guarantee we added for evidence is defeated by
 * editing the containing claim or attestation.
 *
 * PR3.6 replaces the legacy per-attestation `signed_at` key with the
 * affirmation seal. Attestation signing is now cascade-driven through
 * the assessment-scoped affirmation (see routes/affirmations.ts), so the
 * "this record is frozen" signal moved off the attestation row and onto
 * `affirmation.sealed_at`. Terminal-assessment lock is unchanged.
 *
 * Rules enforced here:
 *
 *   Attestation is immutable when:
 *     1. Any affirmation on the same assessment is sealed
 *        (`affirmation.sealed_at IS NOT NULL`).
 *     2. Its parent assessment is in a terminal state
 *        (`complete`, `archived`, or `cancelled`).
 *
 *   Claim is immutable when:
 *     1. It is cited (directly via `claim.attestation_id`, or through
 *        `attestation_requirement_claim` /
 *        `attestation_requirement_counter_claim`) by any attestation on
 *        an assessment that has a sealed affirmation.
 *     2. Its parent assessment (via its linked attestation) is in a
 *        terminal state.
 *
 * Like the evidence rule, these are record-integrity policies, not
 * authorization policies. Admins are bound by them. Callers must not
 * consult `req.user.role` or permissions to short-circuit.
 *
 * Enforcement layer returns 409 Conflict with a machine-readable
 * `reason` so the client can distinguish retention from 403 (no
 * permission) and 404 (not found / not authorized).
 */

import type { Kysely } from 'kysely';
import type { Response } from 'express';
import type { Database } from '../db/types.js';

export type AttestationImmutableReason =
  | 'affirmation_sealed'
  | 'assessment_terminal';

export type ClaimImmutableReason =
  | 'cited_in_sealed_affirmation'
  | 'assessment_terminal';

type AttestationImmutableResult =
  | { immutable: true; reason: AttestationImmutableReason }
  | { immutable: false };

type ClaimImmutableResult =
  | { immutable: true; reason: ClaimImmutableReason }
  | { immutable: false };

// The states that lock attestations and claims against modification.
// Historically `complete` was included here because attestations used
// to be authored during in-progress work and locked when the
// assessment transitioned to complete. The workflow now *requires*
// the assessment to be `complete` before an attestation can be
// created at all (see POST /api/v1/attestations), so `complete`
// cannot be the lock point — it is the working state for attestation
// authoring. The real lock point is the affirmation seal, handled
// separately. Only `archived` and `cancelled` remain as retention
// terminals.
const TERMINAL_ASSESSMENT_STATES = ['archived', 'cancelled'] as const;

/**
 * Return true when the assessment has any sealed affirmation. We lock
 * the attestations on a sealed assessment because the JSF envelope
 * bound at seal time hashed the entire declarations subtree, including
 * attestation summary, requirement map, and claim citations. Editing
 * any of that downstream of the seal would silently invalidate the
 * envelope.
 */
async function assessmentHasSealedAffirmation(
  db: Kysely<Database>,
  assessmentId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('affirmation')
    .where('assessment_id', '=', assessmentId)
    .where('sealed_at', 'is not', null)
    .select('id')
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

async function assessmentIsTerminal(
  db: Kysely<Database>,
  assessmentId: string,
): Promise<boolean> {
  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', assessmentId)
    .select(['state'])
    .executeTakeFirst();
  return Boolean(
    assessment && (TERMINAL_ASSESSMENT_STATES as readonly string[]).includes(assessment.state),
  );
}

/**
 * Determine whether an attestation is retention-locked.
 *
 * Returns `{ immutable: false }` when the attestation does not exist so
 * the caller can fall through to the regular 404 path; there is no
 * benefit to a 409 on a phantom id.
 */
async function isAttestationImmutable(
  db: Kysely<Database>,
  attestationId: string,
): Promise<AttestationImmutableResult> {
  const attestation = await db
    .selectFrom('attestation')
    .where('id', '=', attestationId)
    .select(['assessment_id'])
    .executeTakeFirst();

  if (!attestation) return { immutable: false };

  if (attestation.assessment_id) {
    if (await assessmentHasSealedAffirmation(db, attestation.assessment_id)) {
      return { immutable: true, reason: 'affirmation_sealed' };
    }
    if (await assessmentIsTerminal(db, attestation.assessment_id)) {
      return { immutable: true, reason: 'assessment_terminal' };
    }
  }

  return { immutable: false };
}

/**
 * Determine whether a claim is retention-locked.
 */
async function isClaimImmutable(
  db: Kysely<Database>,
  claimId: string,
): Promise<ClaimImmutableResult> {
  const claim = await db
    .selectFrom('claim')
    .where('id', '=', claimId)
    .select(['attestation_id'])
    .executeTakeFirst();

  if (!claim) return { immutable: false };

  // Case 1: direct FK. A claim attached to an attestation inherits the
  // assessment-scoped lock via that attestation's assessment_id.
  if (claim.attestation_id) {
    const direct = await db
      .selectFrom('attestation')
      .where('id', '=', claim.attestation_id)
      .select(['assessment_id'])
      .executeTakeFirst();

    if (direct?.assessment_id) {
      if (await assessmentHasSealedAffirmation(db, direct.assessment_id)) {
        return { immutable: true, reason: 'cited_in_sealed_affirmation' };
      }
      if (await assessmentIsTerminal(db, direct.assessment_id)) {
        return { immutable: true, reason: 'assessment_terminal' };
      }
    }
  }

  // Case 2: the claim is cited via the attestation_requirement_claim
  // junction (map[].claims[] in CycloneDX declarations) by an
  // attestation on a sealed-affirmation assessment. The attestation FK
  // alone is not enough: CycloneDX lets a claim live free-floating and
  // still be referenced from an attestation's requirement map.
  const citedByClaim = await db
    .selectFrom('attestation_requirement_claim as arc')
    .innerJoin('attestation_requirement as ar', 'ar.id', 'arc.attestation_requirement_id')
    .innerJoin('attestation as a', 'a.id', 'ar.attestation_id')
    .innerJoin('affirmation as af', 'af.assessment_id', 'a.assessment_id')
    .where('arc.claim_id', '=', claimId)
    .where('af.sealed_at', 'is not', null)
    .select('a.id')
    .limit(1)
    .executeTakeFirst();
  if (citedByClaim) {
    return { immutable: true, reason: 'cited_in_sealed_affirmation' };
  }

  // Case 3: same check for counter-claims (map[].counterClaims[]).
  const citedByCounterClaim = await db
    .selectFrom('attestation_requirement_counter_claim as arcc')
    .innerJoin('attestation_requirement as ar', 'ar.id', 'arcc.attestation_requirement_id')
    .innerJoin('attestation as a', 'a.id', 'ar.attestation_id')
    .innerJoin('affirmation as af', 'af.assessment_id', 'a.assessment_id')
    .where('arcc.claim_id', '=', claimId)
    .where('af.sealed_at', 'is not', null)
    .select('a.id')
    .limit(1)
    .executeTakeFirst();
  if (citedByCounterClaim) {
    return { immutable: true, reason: 'cited_in_sealed_affirmation' };
  }

  return { immutable: false };
}

const ATTESTATION_REASON_MESSAGES: Record<AttestationImmutableReason, string> = {
  affirmation_sealed:
    'Attestation is immutable once an affirmation on this assessment has been sealed',
  assessment_terminal:
    'Attestation is immutable once its assessment is archived or cancelled',
};

const CLAIM_REASON_MESSAGES: Record<ClaimImmutableReason, string> = {
  cited_in_sealed_affirmation:
    'Claim is immutable once cited on an attestation whose assessment has a sealed affirmation',
  assessment_terminal:
    'Claim is immutable once its assessment is archived or cancelled',
};

/**
 * Convenience helper: if the attestation is retention-locked, write a
 * 409 Conflict response and return true so the caller can early-return.
 * Otherwise returns false and writes nothing.
 */
export async function rejectIfAttestationImmutable(
  db: Kysely<Database>,
  attestationId: string,
  res: Response,
): Promise<boolean> {
  const result = await isAttestationImmutable(db, attestationId);
  if (!result.immutable) return false;

  res.status(409).json({
    error: ATTESTATION_REASON_MESSAGES[result.reason],
    reason: result.reason,
  });
  return true;
}

/**
 * Convenience helper: if the claim is retention-locked, write a 409
 * Conflict response and return true so the caller can early-return.
 * Otherwise returns false and writes nothing.
 */
export async function rejectIfClaimImmutable(
  db: Kysely<Database>,
  claimId: string,
  res: Response,
): Promise<boolean> {
  const result = await isClaimImmutable(db, claimId);
  if (!result.immutable) return false;

  res.status(409).json({
    error: CLAIM_REASON_MESSAGES[result.reason],
    reason: result.reason,
  });
  return true;
}
