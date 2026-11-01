/**
 * Assessment report model.
 *
 * Gathers everything the assessment report shows into one plain,
 * render-ready structure: requirement results merged with their
 * attested scores, claims, the affirmation and its verified seal
 * status, and evidence listed once each with what it supports. The
 * PDF renderer (render-pdf.ts) only draws this model, so other output
 * formats can reuse it.
 */
import type { getDatabase } from '../../db/connection.js';
import {
  extractIdentityFromSignatureEnvelope,
  verifyAffirmation,
  type AffirmationRow,
  type SlotRow,
} from '../../routes/affirmations.js';

type Db = ReturnType<typeof getDatabase>;

export type RequirementResult = 'yes' | 'no' | 'partial' | 'not_applicable' | 'not_assessed';

export const RESULT_ORDER: RequirementResult[] = ['yes', 'partial', 'no', 'not_applicable', 'not_assessed'];

export interface ReportRequirement {
  id: string;
  identifier: string;
  name: string;
  result: RequirementResult;
  rationale: string | null;
  /** 0..1 from the attestation, null when not attested. */
  conformance: number | null;
  confidence: number | null;
  attestedRationale: string | null;
  evidenceRefs: string[];
  claimRefs: string[];
}

export interface ReportRequirementGroup {
  /** Null when the standard has no hierarchy to group by. */
  title: string | null;
  /** Long group names (SSDF uses sentences) move here from the title. */
  description: string | null;
  requirements: ReportRequirement[];
}

interface GroupHeading {
  title: string;
  description: string | null;
}

const MAX_GROUP_TITLE = 70;

export interface ReportClaim {
  ref: string;
  name: string;
  predicate: string;
  target: string;
  reasoning: string | null;
  isCounterClaim: boolean;
  evidenceRefs: string[];
  counterEvidenceRefs: string[];
}

export interface ReportEvidence {
  ref: string;
  name: string;
  description: string | null;
  state: string;
  author: string | null;
  expiresOn: Date | null;
  isCounterEvidence: boolean;
  /** Requirement identifiers and claim refs this item backs. */
  supports: string[];
}

export interface ReportSignatory {
  title: string;
  name: string | null;
  role: string | null;
  organization: string | null;
  signatureType: 'digital' | 'electronic' | null;
  signedAt: Date | null;
}

export type SealStatus = 'verified' | 'failed' | 'rescinded' | 'unsealed';

export interface ReportAffirmation {
  statement: string;
  signatories: ReportSignatory[];
  sealStatus: SealStatus;
  sealedAt: Date | null;
  platformKeyFingerprint: string | null;
  issues: string[];
}

export interface ReportSummary {
  requirementCount: number;
  assessedCount: number;
  resultCounts: Record<RequirementResult, number>;
  attestedCount: number;
  meanConformance: number | null;
  meanConfidence: number | null;
  evidenceCount: number;
  claimCount: number;
  counterClaimCount: number;
}

export interface AssessmentReportModel {
  generatedAt: Date;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    state: string;
    startDate: Date | null;
    dueDate: Date | null;
    endDate: Date | null;
  };
  project: string | null;
  standard: string | null;
  target: string | null;
  assessors: string[];
  assessees: string[];
  attestationSummaries: string[];
  summary: ReportSummary;
  groups: ReportRequirementGroup[];
  claims: ReportClaim[];
  evidence: ReportEvidence[];
  affirmation: ReportAffirmation | null;
}

const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function standardLabel(name: string | null | undefined, version: string | null | undefined): string | null {
  if (!name) return null;
  // Some imported names already end with their version.
  return version && !name.includes(version) ? `${name} ${version}` : name;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function fetchPeople(db: Db, table: 'assessment_assessor' | 'assessment_assessee', assessmentId: string) {
  const rows = await db
    .selectFrom(table)
    .innerJoin('app_user', 'app_user.id', `${table}.user_id`)
    .where(`${table}.assessment_id`, '=', assessmentId)
    .select('app_user.display_name')
    .execute();
  return rows.map((r) => r.display_name).sort(naturalCompare);
}

/**
 * Walk each requirement up to its top-level ancestor so rows can be
 * grouped by practice or chapter (e.g. SSDF "PO", ASVS "V1").
 */
async function fetchRootTitles(db: Db, requirementIds: string[]): Promise<Map<string, GroupHeading | null>> {
  const roots = new Map<string, GroupHeading | null>();
  if (requirementIds.length === 0) return roots;

  const standardIds = await db
    .selectFrom('requirement')
    .where('id', 'in', requirementIds)
    .select('standard_id')
    .distinct()
    .execute();
  const all = await db
    .selectFrom('requirement')
    .where('standard_id', 'in', standardIds.map((s) => s.standard_id))
    .select(['id', 'identifier', 'name', 'parent_id'])
    .execute();
  const byId = new Map(all.map((r) => [r.id, r]));

  for (const id of requirementIds) {
    let node = byId.get(id);
    const seen = new Set<string>();
    while (node?.parent_id && byId.has(node.parent_id) && !seen.has(node.id)) {
      seen.add(node.id);
      node = byId.get(node.parent_id);
    }
    if (!node || node.id === id) {
      roots.set(id, null);
    } else if (node.name.length <= MAX_GROUP_TITLE) {
      roots.set(id, { title: `${node.identifier} ${node.name}`.trim(), description: null });
    } else {
      roots.set(id, { title: node.identifier, description: node.name });
    }
  }
  return roots;
}

/**
 * The assessment's requirements, plus any attested requirement that has
 * no assessment row (it is reported as not assessed rather than lost).
 */
async function fetchRequirements(db: Db, assessmentId: string, attestedIds: string[]) {
  const rows: Array<{
    requirement_id: string;
    identifier: string;
    name: string;
    result: 'yes' | 'no' | 'partial' | 'not_applicable' | null | undefined;
    rationale: string | null | undefined;
  }> = await db
    .selectFrom('assessment_requirement')
    .innerJoin('requirement', 'requirement.id', 'assessment_requirement.requirement_id')
    .where('assessment_requirement.assessment_id', '=', assessmentId)
    .select([
      'requirement.id as requirement_id',
      'requirement.identifier',
      'requirement.name',
      'assessment_requirement.result',
      'assessment_requirement.rationale',
    ])
    .execute();

  const present = new Set(rows.map((r) => r.requirement_id));
  const missing = [...new Set(attestedIds)].filter((id) => !present.has(id));
  if (missing.length > 0) {
    const extra = await db
      .selectFrom('requirement')
      .where('id', 'in', missing)
      .select(['id as requirement_id', 'identifier', 'name'])
      .execute();
    rows.push(...extra.map((r) => ({ ...r, result: null, rationale: null })));
  }
  return rows.sort((a, b) => naturalCompare(a.identifier, b.identifier));
}

async function fetchAttestations(db: Db, assessmentId: string) {
  const attestations = await db
    .selectFrom('attestation')
    .where('assessment_id', '=', assessmentId)
    .select(['id', 'summary'])
    .orderBy('created_at', 'asc')
    .execute();
  const ids = attestations.map((a) => a.id);
  if (ids.length === 0) {
    return { attestations, scores: [], claims: [], requirementClaims: [] };
  }

  const scores = await db
    .selectFrom('attestation_requirement')
    .where('attestation_id', 'in', ids)
    .select(['requirement_id', 'conformance_score', 'confidence_score', 'conformance_rationale'])
    .execute();
  const claims = await db
    .selectFrom('claim')
    .leftJoin('entity', 'entity.id', 'claim.target_entity_id')
    .where('claim.attestation_id', 'in', ids)
    .where('claim.deleted_at', 'is', null)
    .select([
      'claim.id',
      'claim.name',
      'claim.predicate',
      'claim.target',
      'claim.reasoning',
      'claim.is_counter_claim',
      'claim.display_id',
      'entity.name as target_entity_name',
    ])
    .orderBy('claim.display_id', 'asc')
    .execute();
  const requirementClaims = await db
    .selectFrom('attestation_requirement_claim as arc')
    .innerJoin('attestation_requirement as ar', 'ar.id', 'arc.attestation_requirement_id')
    .where('ar.attestation_id', 'in', ids)
    .select(['ar.requirement_id', 'arc.claim_id'])
    .execute();
  return { attestations, scores, claims, requirementClaims };
}

async function fetchEvidenceLinks(db: Db, assessmentId: string, claimIds: string[]) {
  const requirementLinks = await db
    .selectFrom('assessment_requirement_evidence as are')
    .innerJoin('assessment_requirement as ar', 'ar.id', 'are.assessment_requirement_id')
    .where('ar.assessment_id', '=', assessmentId)
    .select(['ar.requirement_id', 'are.evidence_id'])
    .execute();
  const claimLinks = claimIds.length === 0 ? [] : await db
    .selectFrom('claim_evidence')
    .where('claim_id', 'in', claimIds)
    .select(['claim_id', 'evidence_id'])
    .execute();
  const counterLinks = claimIds.length === 0 ? [] : await db
    .selectFrom('claim_counter_evidence')
    .where('claim_id', 'in', claimIds)
    .select(['claim_id', 'evidence_id'])
    .execute();
  return { requirementLinks, claimLinks, counterLinks };
}

async function fetchEvidenceRows(db: Db, evidenceIds: string[]) {
  if (evidenceIds.length === 0) return [];
  return db
    .selectFrom('evidence')
    .leftJoin('app_user', 'app_user.id', 'evidence.author_id')
    .where('evidence.id', 'in', evidenceIds)
    .where('evidence.deleted_at', 'is', null)
    .select([
      'evidence.id',
      'evidence.name',
      'evidence.description',
      'evidence.state',
      'evidence.expires_on',
      'evidence.is_counter_evidence',
      'app_user.display_name as author',
    ])
    .execute();
}

/** A JSF envelope with a signature value is digital; electronic ones carry none. */
function signatureTypeOf(signatureJson: unknown): ReportSignatory['signatureType'] {
  if (!signatureJson) return null;
  const value = (signatureJson as { signature?: { value?: unknown } }).signature?.value;
  return typeof value === 'string' && value.length > 0 ? 'digital' : 'electronic';
}

function toReportSignatory(slot: SlotRow): ReportSignatory {
  const identity = extractIdentityFromSignatureEnvelope(slot.signature_json);
  return {
    title: slot.required_title,
    name: identity?.name ?? null,
    role: identity?.role ?? null,
    organization: identity?.organization.name || null,
    signatureType: signatureTypeOf(slot.signature_json),
    signedAt: asDate(slot.signed_at),
  };
}

async function buildAffirmation(db: Db, assessmentId: string): Promise<ReportAffirmation | null> {
  const affirmation = (await db
    .selectFrom('affirmation')
    .where('assessment_id', '=', assessmentId)
    .selectAll()
    .executeTakeFirst()) as AffirmationRow | undefined;
  if (!affirmation) return null;

  const slots = (await db
    .selectFrom('affirmation_signatory')
    .where('affirmation_id', '=', affirmation.id)
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute()) as SlotRow[];

  const signatories = slots.map(toReportSignatory);

  let sealStatus: SealStatus = 'unsealed';
  let issues: string[] = [];
  if (affirmation.rescinded_at) {
    sealStatus = 'rescinded';
  } else if (affirmation.sealed_at) {
    const result = await verifyAffirmation(db, affirmation);
    sealStatus = result.verified ? 'verified' : 'failed';
    issues = result.issues;
  }

  return {
    statement: affirmation.statement,
    signatories,
    sealStatus,
    sealedAt: asDate(affirmation.sealed_at),
    platformKeyFingerprint: affirmation.platform_key_fingerprint,
    issues,
  };
}

/** Assign E1, E2, … in the order evidence is first cited. */
function labelEvidence(citationOrder: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const id of citationOrder) {
    if (!labels.has(id)) labels.set(id, `E${labels.size + 1}`);
  }
  return labels;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
}

function groupRequirements(
  requirements: ReportRequirement[],
  roots: Map<string, GroupHeading | null>,
): ReportRequirementGroup[] {
  const groups = new Map<string, ReportRequirementGroup>();
  for (const req of requirements) {
    const heading = roots.get(req.id) ?? null;
    const key = heading?.title ?? '';
    const group = groups.get(key) ?? {
      title: heading?.title ?? null,
      description: heading?.description ?? null,
      requirements: [],
    };
    group.requirements.push(req);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => naturalCompare(a.title ?? '', b.title ?? ''));
}

async function fetchAssessmentHeader(db: Db, assessmentId: string) {
  const row = await db
    .selectFrom('assessment')
    .leftJoin('project', 'project.id', 'assessment.project_id')
    .leftJoin('standard', 'standard.id', 'assessment.standard_id')
    .leftJoin('entity', 'entity.id', 'assessment.entity_id')
    .where('assessment.id', '=', assessmentId)
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.description',
      'assessment.state',
      'assessment.start_date',
      'assessment.due_date',
      'assessment.end_date',
      'project.name as project_name',
      'standard.name as standard_name',
      'standard.version as standard_version',
      'entity.name as entity_name',
    ])
    .executeTakeFirst();
  if (!row) {
    throw new Error('Assessment not found');
  }
  return {
    assessment: {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      state: row.state,
      startDate: asDate(row.start_date),
      dueDate: asDate(row.due_date),
      endDate: asDate(row.end_date),
    },
    project: row.project_name ?? null,
    standard: standardLabel(row.standard_name, row.standard_version),
    target: row.entity_name ?? null,
  };
}

type ScoreRow = Awaited<ReturnType<typeof fetchAttestations>>['scores'][number];
type RequirementRow = Awaited<ReturnType<typeof fetchRequirements>>[number];

function toReportRequirement(
  row: RequirementRow,
  score: ScoreRow | undefined,
  refs: { evidence: string[]; claims: string[] },
): ReportRequirement {
  const confidence = score?.confidence_score;
  return {
    id: row.requirement_id,
    identifier: row.identifier,
    name: row.name,
    result: (row.result ?? 'not_assessed') as RequirementResult,
    rationale: row.rationale ?? null,
    conformance: score ? Number(score.conformance_score) : null,
    confidence: confidence === null || confidence === undefined ? null : Number(confidence),
    attestedRationale: score?.conformance_rationale ?? null,
    evidenceRefs: refs.evidence,
    claimRefs: refs.claims,
  };
}

export async function buildAssessmentReportModel(db: Db, assessmentId: string): Promise<AssessmentReportModel> {
  const header = await fetchAssessmentHeader(db, assessmentId);

  const { attestations, scores, claims: claimRows, requirementClaims } = await fetchAttestations(db, assessmentId);
  const reqRows = await fetchRequirements(db, assessmentId, scores.map((s) => s.requirement_id));
  const { requirementLinks, claimLinks, counterLinks } = await fetchEvidenceLinks(
    db,
    assessmentId,
    claimRows.map((c) => c.id),
  );

  // Claims are labelled in display order; evidence in order of first
  // citation, requirements first, then claims.
  const claimRef = new Map(claimRows.map((c, i) => [c.id, `C${i + 1}`]));
  const reqEvidence = new Map<string, string[]>();
  for (const link of requirementLinks) pushTo(reqEvidence, link.requirement_id, link.evidence_id);
  const citationOrder = [
    ...reqRows.flatMap((r) => reqEvidence.get(r.requirement_id) ?? []),
    ...claimRows.flatMap((c) => [
      ...claimLinks.filter((l) => l.claim_id === c.id).map((l) => l.evidence_id),
      ...counterLinks.filter((l) => l.claim_id === c.id).map((l) => l.evidence_id),
    ]),
  ];
  const evidenceRows = await fetchEvidenceRows(db, [...new Set(citationOrder)]);
  const liveEvidence = new Set(evidenceRows.map((e) => e.id));
  const evidenceRef = labelEvidence(citationOrder.filter((id) => liveEvidence.has(id)));
  const refsOf = (ids: string[]) =>
    [...new Set(ids.filter((id) => evidenceRef.has(id)).map((id) => evidenceRef.get(id)!))].sort(naturalCompare);

  const scoreByReq = new Map(scores.map((s) => [s.requirement_id, s]));
  const reqClaims = new Map<string, string[]>();
  for (const link of requirementClaims) {
    const ref = claimRef.get(link.claim_id);
    if (ref) pushTo(reqClaims, link.requirement_id, ref);
  }

  const requirements = reqRows.map((r) =>
    toReportRequirement(r, scoreByReq.get(r.requirement_id), {
      evidence: refsOf(reqEvidence.get(r.requirement_id) ?? []),
      claims: reqClaims.get(r.requirement_id) ?? [],
    }),
  );

  const claims: ReportClaim[] = claimRows.map((c) => ({
    ref: claimRef.get(c.id)!,
    name: c.name,
    predicate: c.predicate,
    target: c.target_entity_name ?? c.target,
    reasoning: c.reasoning ?? null,
    isCounterClaim: Boolean(c.is_counter_claim),
    evidenceRefs: refsOf(claimLinks.filter((l) => l.claim_id === c.id).map((l) => l.evidence_id)),
    counterEvidenceRefs: refsOf(counterLinks.filter((l) => l.claim_id === c.id).map((l) => l.evidence_id)),
  }));

  const supports = new Map<string, string[]>();
  for (const req of requirements) {
    for (const ref of req.evidenceRefs) pushTo(supports, ref, req.identifier);
  }
  for (const claim of claims) {
    for (const ref of [...claim.evidenceRefs, ...claim.counterEvidenceRefs]) pushTo(supports, ref, claim.ref);
  }
  const evidenceById = new Map(evidenceRows.map((e) => [e.id, e]));
  const evidence: ReportEvidence[] = [...evidenceRef.entries()].map(([id, ref]) => {
    const e = evidenceById.get(id)!;
    return {
      ref,
      name: e.name,
      description: e.description ?? null,
      state: e.state,
      author: e.author ?? null,
      expiresOn: asDate(e.expires_on),
      isCounterEvidence: Boolean(e.is_counter_evidence),
      supports: supports.get(ref) ?? [],
    };
  });

  const resultCounts = Object.fromEntries(RESULT_ORDER.map((r) => [r, 0])) as Record<RequirementResult, number>;
  for (const req of requirements) resultCounts[req.result] += 1;
  const attested = requirements.filter((r) => r.conformance !== null);

  return {
    generatedAt: new Date(),
    ...header,
    assessors: await fetchPeople(db, 'assessment_assessor', assessmentId),
    assessees: await fetchPeople(db, 'assessment_assessee', assessmentId),
    attestationSummaries: attestations.map((a) => a.summary).filter((s): s is string => Boolean(s && s.trim())),
    summary: {
      requirementCount: requirements.length,
      assessedCount: requirements.length - resultCounts.not_assessed,
      resultCounts,
      attestedCount: attested.length,
      meanConformance: mean(attested.map((r) => r.conformance!)),
      meanConfidence: mean(attested.filter((r) => r.confidence !== null).map((r) => r.confidence!)),
      evidenceCount: evidence.length,
      claimCount: claims.filter((c) => !c.isCounterClaim).length,
      counterClaimCount: claims.filter((c) => c.isCounterClaim).length,
    },
    groups: groupRequirements(requirements, await fetchRootTitles(db, requirements.map((r) => r.id))),
    claims,
    evidence,
    affirmation: await buildAffirmation(db, assessmentId),
  };
}
