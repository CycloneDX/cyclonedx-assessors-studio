import { Router } from 'express';
// Exports are object-scoped as well: today every role with an export
// permission also has view_all, but that should not be the only control
// (security review Z13).
import { requireAssessmentRead, requireProjectRead } from '../utils/access.js';
import type { Response } from 'express';
import { getDatabase } from '../db/connection.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireSession, requirePermission } from '../middleware/auth.js';
import {
  assessorFromUserRow,
  attestationFromRow,
  claimFromRow,
  composeBom,
  composeDeclarations,
  isCounterClaim,
  refFor,
  standardFromRow,
  TargetResolver,
  type Affirmation as CdxAffirmation,
  type Assessor as CdxAssessor,
  type Attestation as CdxAttestation,
  type Bom,
  type CdxSpecVersion,
  type Claim as CdxClaim,
  type ClaimRefMap,
  type Evidence as CdxEvidence,
  type Signature as CdxSignature,
  type Standard as CdxStandard,
} from '../cdxspec/index.js';
import {
  buildAffirmationForAssessment,
  parseJsonbColumn as parseJsonbColumnLocal,
  toJsfSigner,
} from '../utils/export-affirmation.js';
import { validateBom } from '../cdxspec/validator/validate.js';
import { fetchProjectStandards } from '../utils/project-queries.js';
import { buildAssessmentReportModel } from '../services/assessment-report/model.js';
import { renderAssessmentReportPdf } from '../services/assessment-report/render-pdf.js';
import {
  createReportDocument,
  drawTable,
  formatPercent,
  renderToBuffer,
  sectionHeading,
  stampFooters,
  type PdfDoc,
} from '../utils/pdf-report.js';

const router = Router();

// Refuse to ship a malformed BOM rather than letting a writer drift
// silently. Validation is fast in-process (cached AJV); failures are
// always logged with the first few errors so they're triagable.
function assertBomValid(
  bom: Bom,
  specVersion: CdxSpecVersion,
  context: Record<string, unknown>,
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  const result = validateBom(bom, specVersion);
  if (result.valid) return { ok: true };
  logger.error('CycloneDX export failed schema validation', {
    ...context,
    specVersion,
    errorCount: result.errors.length,
    firstErrors: result.errors.slice(0, 5),
  });
  return {
    ok: false,
    status: 500,
    body: {
      error: 'Internal error: generated BOM failed schema validation',
      specVersion,
      validationErrors: result.errors.slice(0, 5),
    },
  };
}

// Supported CycloneDX schema versions. 1.7 (ECMA-424 2nd Edition) is
// the default for new work per the cyclonedx-spec guidance; 1.6
// (ECMA-424 1st Edition) is offered as a fallback for consumers that
// have not yet adopted the 2nd Edition. The `?spec=` query parameter
// on every export route selects between them.
export type CycloneDxSpecVersion = CdxSpecVersion;

/**
 * Resolve the CycloneDX spec version from the query string. Defaults
 * to 1.7. Unknown values fall through to the default rather than
 * throwing so callers cannot trip on a typo in a hand-crafted URL:
 * the returned value is always something the serializer can handle.
 */
function parseSpecVersion(req: AuthRequest): CycloneDxSpecVersion {
  const raw = typeof req.query.spec === 'string' ? req.query.spec.trim() : '';
  if (raw === '1.6') return '1.6';
  return '1.7';
}

async function buildAssessmentBOM(
  assessmentId: string,
  specVersion: CycloneDxSpecVersion = '1.7'
): Promise<Bom> {
  const db = getDatabase();

  // Fetch assessment
  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', assessmentId)
    .selectAll()
    .executeTakeFirst();

  if (!assessment) {
    throw new Error('Assessment not found');
  }

  // Fetch assessors
  const assessorRows = await db
    .selectFrom('assessment_assessor')
    .innerJoin('app_user', 'app_user.id', 'assessment_assessor.user_id')
    .where('assessment_assessor.assessment_id', '=', assessmentId)
    .select(['app_user.id', 'app_user.display_name', 'app_user.email'])
    .execute();

  const assessors: CdxAssessor[] = assessorRows.map((a) =>
    assessorFromUserRow({ user: { id: a.id, display_name: a.display_name, email: a.email } })
  );

  // Fetch attestation(s) for this assessment
  const attestations = await db
    .selectFrom('attestation')
    .where('assessment_id', '=', assessmentId)
    .selectAll()
    .execute();

  // The target resolver is shared across every attestation so that
  // claims pointing at the same target resolve to one synthetic
  // organizationalEntity record. Emitted under
  // declarations.targets.organizations by composeDeclarations.
  const targetResolver = new TargetResolver();

  // Claim serialization is centralized: the DB rows are filtered
  // down to the schema-legal keys and the counter-claim flag is
  // translated into the attestation.map[] split by
  // attestationFromRow.
  const claimRowsAll: Record<string, unknown>[] = [];
  const allClaimsOut: CdxClaim[] = [];

  if (attestations.length > 0) {
    const raw = await db
      .selectFrom('claim')
      .where('attestation_id', 'in', attestations.map((a) => a.id))
      .selectAll()
      .execute();
    claimRowsAll.push(...(raw as Record<string, unknown>[]));
  }

  for (const row of claimRowsAll) {
    allClaimsOut.push(
      claimFromRow(
        {
          id: row.id as string,
          bom_ref: (row.bom_ref as string | null | undefined) ?? null,
          target: String(row.target ?? ''),
          target_entity_id: (row.target_entity_id as string | null | undefined) ?? null,
          predicate: (row.predicate as string | null | undefined) ?? null,
          reasoning: (row.reasoning as string | null | undefined) ?? null,
          is_counter_claim: Boolean(row.is_counter_claim),
        },
        targetResolver
      )
    );
  }

  // Build per-attestation map entries. Each attestation references
  // all of its own claims; counter claims are split into the
  // counterClaims array. When the upstream DB does not carry a
  // per-requirement claim join, every claim on the attestation is
  // projected onto every requirement in its map, matching prior
  // behavior.
  const declarationAttestations: CdxAttestation[] = [];

  for (const attestation of attestations) {
    const attestationRequirements = await db
      .selectFrom('attestation_requirement')
      .innerJoin('requirement', 'requirement.id', 'attestation_requirement.requirement_id')
      .where('attestation_requirement.attestation_id', '=', attestation.id)
      .select([
        'attestation_requirement.requirement_id',
        'attestation_requirement.conformance_score',
        'attestation_requirement.conformance_rationale',
        'attestation_requirement.confidence_score',
        'attestation_requirement.confidence_rationale',
        'requirement.imported_bom_ref as requirement_imported_bom_ref',
      ])
      .execute();

    // Collect claim bom-refs belonging to this attestation. The
    // bom-ref on each claim is either a custom value from the DB
    // column or the default refFor('claim', id).
    const attestationAllClaims: string[] = [];
    const attestationAllCounterClaims: string[] = [];
    // Build a claim id → bom-ref lookup for the per-requirement
    // junction reads below.
    const claimRefById = new Map<string, { ref: string; counter: boolean }>();

    for (const row of claimRowsAll) {
      if (row.attestation_id !== attestation.id) continue;
      const ref =
        (row.bom_ref as string | null | undefined) && (row.bom_ref as string).trim().length > 0
          ? (row.bom_ref as string)
          : refFor('claim', row.id as string);
      const counter = isCounterClaim(row as { is_counter_claim?: boolean });
      claimRefById.set(row.id as string, { ref, counter });
      if (counter) {
        attestationAllCounterClaims.push(ref);
      } else {
        attestationAllClaims.push(ref);
      }
    }

    // Build per-requirement claim maps from the
    // attestation_requirement_claim / _counter_claim junction tables
    // so the exported map[].claims and map[].counterClaims arrays
    // reflect the structured linkage rather than falling back to
    // "every claim on every map entry". The fallback below stays
    // active for attestations that have no junction rows yet.
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

    // When any per-requirement linkage exists, the writer's fallback
    // to allClaims/allCounterClaims should NOT fire for map entries
    // that have an empty per-requirement bucket. Represent the
    // "explicitly no claims for this requirement" case by inserting
    // an empty bucket for every requirement on the attestation so
    // buildMapEntry uses the bucket value (empty array) instead of
    // the `all` fallback.
    if (byRequirementId.size > 0) {
      for (const ar of attestationRequirements) {
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

    const assessorRef = assessors.length > 0 ? assessors[0]['bom-ref'] : undefined;

    // Pull the per-attestation signature envelope, if any, so the
    // writer can attach it as `attestation.signature` in the CDX
    // output. Stored as JSONB on `attestation.signature_json`.
    const attestationSignatureRow = await db
      .selectFrom('attestation')
      .where('id', '=', attestation.id)
      .select(['signature_json'])
      .executeTakeFirst();
    // Strip the canonical-payload wrapper so attestation.signature
    // emits a bare JSF signer object (the CycloneDX schema enforces
    // additionalProperties:false on signer).
    const attestationSignature = attestationSignatureRow?.signature_json
      ? toJsfSigner(parseJsonbColumnLocal(attestationSignatureRow.signature_json)) ?? null
      : null;

    const attestationObj = attestationFromRow({
      row: {
        id: attestation.id,
        summary: attestation.summary ?? null,
        signature: attestationSignature,
      },
      requirements: attestationRequirements.map((ar) => ({
        requirement_id: ar.requirement_id,
        requirement_imported_bom_ref: ar.requirement_imported_bom_ref ?? null,
        conformance_score: ar.conformance_score,
        conformance_rationale: ar.conformance_rationale ?? null,
        confidence_score: ar.confidence_score ?? null,
        confidence_rationale: ar.confidence_rationale ?? null,
      })),
      claimRefs,
      assessorRef,
    });

    declarationAttestations.push(attestationObj);
  }

  // Fetch evidence linked to the claims and emit one entry per
  // distinct evidence row. The DB column `evidence.name` maps to
  // `propertyName` in the CycloneDX schema; there is no `name` field
  // on the Evidence object.
  let evidenceOut: CdxEvidence[] = [];
  if (claimRowsAll.length > 0) {
    const evidenceRows = await db
      .selectFrom('evidence')
      .where(
        'evidence.id',
        'in',
        db.selectFrom('claim_evidence')
          .select('evidence_id')
          .where(
            'claim_id',
            'in',
            claimRowsAll.map((c) => c.id as string)
          )
      )
      .selectAll()
      .execute();

    evidenceOut = evidenceRows.map((e) => {
      const ev: CdxEvidence = { 'bom-ref': refFor('evidence', String(e.id)) };
      if (e.name) ev.propertyName = String(e.name);
      if (e.description) ev.description = String(e.description);
      return ev;
    });
  }

  // Fetch project and its standards for definitions.standards.
  const project = assessment.project_id
    ? await db
        .selectFrom('project')
        .where('id', '=', assessment.project_id)
        .selectAll()
        .executeTakeFirst()
    : null;

  // An assessment is scoped to a single standard via
  // `assessment.standard_id`. Include only that standard in the
  // export (not every standard the parent project uses), scoped to
  // "the standard(s) being attested to". Fall back to the first
  // project standard when `assessment.standard_id` is null on older
  // rows so legacy assessments still export something useful.
  const standards: CdxStandard[] = [];
  let effectiveStandardId: string | null = null;
  if (assessment.standard_id) {
    effectiveStandardId = assessment.standard_id as string;
  } else if (project) {
    const firstProjectStandard = await db
      .selectFrom('project_standard')
      .where('project_id', '=', project.id)
      .select('standard_id')
      .executeTakeFirst();
    effectiveStandardId = firstProjectStandard?.standard_id ?? null;
  }

  if (effectiveStandardId) {
    const standardRow = await db
      .selectFrom('standard')
      .where('id', '=', effectiveStandardId)
      .selectAll()
      .executeTakeFirst();
    if (standardRow) {
      const requirements = await db
        .selectFrom('requirement')
        .where('standard_id', '=', effectiveStandardId)
        .selectAll()
        .execute();

      standards.push(
        standardFromRow({
          row: {
            id: standardRow.id as string,
            identifier: (standardRow.identifier as string | null) ?? null,
            name: (standardRow.name as string | null) ?? null,
            version: (standardRow.version as string | null) ?? null,
            description: (standardRow.description as string | null) ?? null,
            owner: (standardRow.owner as string | null) ?? null,
            // standard-import.ts stores the original CycloneDX
            // `bom-ref` from the upstream feed into
            // `standard.identifier`. Surface it as the imported
            // bom-ref so exports round trip with that value.
            imported_bom_ref: (standardRow.identifier as string | null) ?? null,
          },
          requirements: requirements.map((r) => ({
            id: r.id as string,
            identifier: (r.identifier as string | null | undefined) ?? null,
            name: (r.name as string | null | undefined) ?? null,
            description: (r.description as string | null | undefined) ?? null,
            parent_id: (r.parent_id as string | null | undefined) ?? null,
            open_cre: (r.open_cre as string | null | undefined) ?? null,
            imported_bom_ref:
              (r.imported_bom_ref as string | null | undefined) ?? null,
          })),
        })
      );
    }
  }

  // Fetch the assessment level affirmation. The PR3 cascade signing
  // model binds one affirmation per assessment via the
  // `assessment_id` column. The build helper walks the
  // affirmation_signatory slot table, rehydrates each JSF envelope,
  // and filters any signatory that fails the CycloneDX 1.6/1.7
  // Signatory oneOf (signature OR externalReference + organization).
  const {
    affirmation,
    declarationsSeal: declarationsSealEnvelope,
    documentSeal: documentSealEnvelope,
  } = await buildAffirmationForAssessment(db, assessmentId);

  // PR3.6: per-attestation signature material was removed. An
  // assessment that has no affirmation row simply exports without a
  // declarations.affirmation block. Consumers can still see the
  // attestation map and claims; the signature layer is optional.

  const declarations = composeDeclarations({
    assessors,
    attestations: declarationAttestations,
    claims: allClaimsOut,
    evidence: evidenceOut,
    affirmation,
    seal: declarationsSealEnvelope,
    targetResolver,
  });

  return composeBom({
    specVersion,
    declarations,
    definitions: standards.length > 0 ? { standards } : undefined,
    documentSeal: documentSealEnvelope,
  });
}

// ---- Helper functions for PDF generation ----

type ExportDb = ReturnType<typeof getDatabase>;

function formatDate(value: unknown): string {
  return value ? new Date(value as string).toLocaleDateString('en-US') : 'N/A';
}

/**
 * Add title page to PDF.
 */
function addTitlePage(
  doc: PdfDoc,
  title: string,
  subtitle: string,
  project: Record<string, unknown> | null | undefined,
): void {
  doc.fontSize(36).fillColor('#000000').text(title, { align: 'center' });
  doc.fontSize(24).text(subtitle, { align: 'center' });
  doc.moveDown();

  doc.fontSize(12);
  if (project) {
    doc.text(`Project: ${project.name}`);
  }
  const now = new Date();
  doc.text(`Date Generated: ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  doc.moveDown();
}

async function generateAssessmentPDF(assessmentId: string): Promise<Buffer> {
  const model = await buildAssessmentReportModel(getDatabase(), assessmentId);
  return renderAssessmentReportPdf(model);
}

// ---- Project PDF report ----

type ProjectAssessmentRow = {
  id: string;
  title: string;
  state: string;
  due_date?: Date | null;
  standard_id?: string | null;
  standard_name: string | null;
  standard_version?: string | null;
};

function standardLabel(name: string, version: string | null | undefined): string {
  // Some imported names already end with their version.
  return version && !name.includes(version) ? `${name} ${version}` : name;
}

/**
 * The project's own standards plus any an assessment is scoped to, so
 * the report names every standard it covers.
 */
async function fetchProjectStandardLabels(
  db: ExportDb,
  projectId: string,
  assessments: ProjectAssessmentRow[],
): Promise<string[]> {
  const standards = new Map<string, string>();
  for (const s of await fetchProjectStandards(db, projectId)) {
    standards.set(s.id, standardLabel(s.name, s.version));
  }
  for (const a of assessments) {
    if (a.standard_id && a.standard_name && !standards.has(a.standard_id)) {
      standards.set(a.standard_id, standardLabel(a.standard_name, a.standard_version));
    }
  }
  return [...standards.values()];
}

async function fetchRequirementCounts(db: ExportDb, assessmentIds: string[]) {
  const counts = new Map<string, { total: number; assessed: number }>();
  const rows = await db
    .selectFrom('assessment_requirement')
    .where('assessment_id', 'in', assessmentIds)
    .select(['assessment_id', 'result'])
    .execute();
  for (const row of rows) {
    const entry = counts.get(row.assessment_id) ?? { total: 0, assessed: 0 };
    entry.total += 1;
    if (row.result) entry.assessed += 1;
    counts.set(row.assessment_id, entry);
  }
  return counts;
}

/**
 * Attestation ids plus the mean attested conformance per assessment
 * (null when an attestation has no scored requirements).
 */
async function fetchAttestationScores(db: ExportDb, assessmentIds: string[]) {
  const rows = await db
    .selectFrom('attestation')
    .leftJoin('attestation_requirement', 'attestation_requirement.attestation_id', 'attestation.id')
    .where('attestation.assessment_id', 'in', assessmentIds)
    .select(['attestation.id as attestation_id', 'attestation.assessment_id', 'attestation_requirement.conformance_score'])
    .execute();
  const attestationIds = new Set<string>();
  const sums = new Map<string, { sum: number; n: number }>();
  for (const row of rows) {
    attestationIds.add(row.attestation_id);
    const agg = sums.get(row.assessment_id) ?? { sum: 0, n: 0 };
    if (row.conformance_score !== null && row.conformance_score !== undefined) {
      agg.sum += Number(row.conformance_score);
      agg.n += 1;
    }
    sums.set(row.assessment_id, agg);
  }
  const scores = new Map<string, number | null>();
  for (const [id, agg] of sums) {
    scores.set(id, agg.n > 0 ? agg.sum / agg.n : null);
  }
  return { attestationIds: [...attestationIds], scores };
}

async function countProjectEvidence(db: ExportDb, assessmentIds: string[]): Promise<number> {
  const rows = await db
    .selectFrom('assessment_requirement_evidence')
    .innerJoin('assessment_requirement', 'assessment_requirement.id', 'assessment_requirement_evidence.assessment_requirement_id')
    .where('assessment_requirement.assessment_id', 'in', assessmentIds)
    .select('assessment_requirement_evidence.evidence_id')
    .distinct()
    .execute();
  return rows.length;
}

async function countClaims(db: ExportDb, attestationIds: string[]): Promise<number> {
  if (attestationIds.length === 0) return 0;
  const result = await db
    .selectFrom('claim')
    .where('attestation_id', 'in', attestationIds)
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirst();
  return Number(result?.count ?? 0);
}

async function fetchProjectPDFData(projectId: string) {
  const db = getDatabase();

  const project = await db
    .selectFrom('project')
    .where('id', '=', projectId)
    .selectAll()
    .executeTakeFirst();
  if (!project) {
    throw new Error('Project not found');
  }

  const assessments: ProjectAssessmentRow[] = await db
    .selectFrom('assessment')
    .leftJoin('standard', 'standard.id', 'assessment.standard_id')
    .where('assessment.project_id', '=', projectId)
    .where('assessment.deleted_at', 'is', null)
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.state',
      'assessment.due_date',
      'assessment.standard_id',
      'standard.name as standard_name',
      'standard.version as standard_version',
    ])
    .orderBy('assessment.created_at', 'asc')
    .execute();
  const assessmentIds = assessments.map((a) => a.id);
  const standards = await fetchProjectStandardLabels(db, projectId, assessments);

  if (assessmentIds.length === 0) {
    return { project, standards, assessments: [], totals: { evidence: 0, claims: 0, attestations: 0 } };
  }

  const requirementCounts = await fetchRequirementCounts(db, assessmentIds);
  const { attestationIds, scores } = await fetchAttestationScores(db, assessmentIds);

  return {
    project,
    standards,
    assessments: assessments.map((a) => ({
      ...a,
      requirements: requirementCounts.get(a.id) ?? { total: 0, assessed: 0 },
      // undefined: no attestation; null: attestation without scores.
      attestationScore: scores.get(a.id),
    })),
    totals: {
      evidence: await countProjectEvidence(db, assessmentIds),
      claims: await countClaims(db, attestationIds),
      attestations: attestationIds.length,
    },
  };
}

async function generateProjectPDF(projectId: string): Promise<Buffer> {
  const { project, standards, assessments, totals } = await fetchProjectPDFData(projectId);

  const doc = createReportDocument();

  addTitlePage(doc, 'Project Report', project.name, null);
  doc.addPage();

  sectionHeading(doc, 'Project Summary');
  doc.fontSize(11);
  if (project.description) {
    doc.text(`Description: ${project.description}`);
    doc.moveDown();
  }
  doc.text(`State: ${project.state}`);
  doc.text(`Start Date: ${formatDate(project.start_date)}`);
  doc.text(`Due Date: ${formatDate(project.due_date)}`);
  doc.text(`Standards: ${standards.length > 0 ? standards.join(', ') : 'None'}`);
  doc.moveDown();

  const complete = assessments.filter((a) => a.state === 'complete').length;
  const inProgress = assessments.filter((a) => a.state === 'in_progress').length;
  doc.text(`Assessments: ${assessments.length} (${complete} complete, ${inProgress} in progress)`);
  doc.text(`Evidence items: ${totals.evidence}`);
  doc.text(`Claims: ${totals.claims}`);
  doc.text(`Attestations: ${totals.attestations}`);
  doc.moveDown();

  sectionHeading(doc, 'Assessments');
  if (assessments.length === 0) {
    doc.fontSize(10).text('This project has no assessments.');
  } else {
    drawTable(
      doc,
      [
        { header: 'Assessment', width: 135 },
        { header: 'Standard', width: 115 },
        { header: 'State', width: 60 },
        { header: 'Due', width: 60 },
        { header: 'Assessed', width: 55 },
        { header: 'Conformance', width: 70 },
      ],
      assessments.map((a) => [
        a.title,
        a.standard_name ?? 'N/A',
        a.state.replace(/_/g, ' '),
        formatDate(a.due_date),
        a.requirements.total > 0 ? `${a.requirements.assessed} / ${a.requirements.total}` : 'N/A',
        a.attestationScore === undefined ? 'Not attested' : formatPercent(a.attestationScore),
      ]),
    );
  }

  stampFooters(doc, new Date().toISOString());
  return renderToBuffer(doc);
}

router.get('/assessment/:assessmentId', requireSession, requirePermission('export.cyclonedx'), requireAssessmentRead('assessmentId'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { assessmentId } = req.params as { assessmentId: string };
  const specVersion = parseSpecVersion(req);
  const db = getDatabase();

  // Verify assessment exists
  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', assessmentId)
    .selectAll()
    .executeTakeFirst();

  if (!assessment) {
    res.status(404).json({ error: 'Assessment not found' });
    return;
  }

  // Build BOM
  const bom = await buildAssessmentBOM(assessmentId, specVersion);

  const check = assertBomValid(bom, specVersion, { assessmentId, requestId: req.requestId });
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.cyclonedx+json');
  res.setHeader('Content-Disposition', `attachment; filename="assessment-${assessmentId}-cdx-${specVersion}.json"`);

  res.json(bom);

  logger.info('Assessment exported', {
    assessmentId,
    specVersion,
    requestId: req.requestId,
  });
}));

router.get('/assessment/:assessmentId/pdf', requireSession, requirePermission('export.pdf'), requireAssessmentRead('assessmentId'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { assessmentId } = req.params as { assessmentId: string };
  const db = getDatabase();

  // Verify assessment exists
  const assessment = await db
    .selectFrom('assessment')
    .where('id', '=', assessmentId)
    .selectAll()
    .executeTakeFirst();

  if (!assessment) {
    res.status(404).json({ error: 'Assessment not found' });
    return;
  }

  // Generate PDF
  const pdfBuffer = await generateAssessmentPDF(assessmentId);

  // Set response headers (sanitize title to prevent header injection)
  const safeSlug = assessment.title.replace(/[^a-z0-9]/gi, '-').toLowerCase().substring(0, 200);
  const filename = `assessment-${safeSlug}-report.pdf`;
  const encodedFilename = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
  );
  res.setHeader('Content-Length', pdfBuffer.length);

  res.send(pdfBuffer);

  logger.info('Assessment PDF exported', {
    assessmentId,
    requestId: req.requestId,
  });
}));

router.get('/project/:projectId/pdf', requireSession, requirePermission('export.pdf'), requireProjectRead('projectId'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const db = getDatabase();

  const project = await db
    .selectFrom('project')
    .where('id', '=', projectId)
    .select(['id', 'name'])
    .executeTakeFirst();

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const pdfBuffer = await generateProjectPDF(projectId);

  // Sanitize the name to prevent header injection, as for assessments.
  const safeSlug = project.name.replace(/[^a-z0-9]/gi, '-').toLowerCase().substring(0, 200);
  const filename = `project-${safeSlug}-report.pdf`;
  const encodedFilename = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
  );
  res.setHeader('Content-Length', pdfBuffer.length);

  res.send(pdfBuffer);

  logger.info('Project PDF exported', {
    projectId,
    requestId: req.requestId,
  });
}));

router.get('/project/:projectId', requireSession, requirePermission('export.cyclonedx'), requireProjectRead('projectId'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const specVersion = parseSpecVersion(req);
  const db = getDatabase();

  // Verify project exists
  const project = await db
    .selectFrom('project')
    .where('id', '=', projectId)
    .selectAll()
    .executeTakeFirst();

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Fetch all assessments for this project
  const assessments = await db
    .selectFrom('assessment')
    .where('project_id', '=', projectId)
    .selectAll()
    .execute();

  // Build BOMs for all assessments
  const boms = await Promise.all(assessments.map((a) => buildAssessmentBOM(a.id, specVersion)));

  // Merge all assessment BOMs into a single project-scoped BOM. The
  // merge preserves per-attestation map entries verbatim while
  // deduping the shared declaration arrays (assessors, claims,
  // evidence, standards). Keys are the bom-ref values to guarantee
  // cross-reference integrity.
  const mergedAssessors = new Map<string, CdxAssessor>();
  const mergedAttestations: CdxAttestation[] = [];
  const mergedClaims = new Map<string, CdxClaim>();
  const mergedEvidence = new Map<string, CdxEvidence>();
  const mergedStandards = new Map<string, CdxStandard>();
  let mergedAffirmation: CdxAffirmation | undefined;

  for (const bom of boms) {
    const decls = bom.declarations;
    const defs = bom.definitions;
    if (decls) {
      for (const assessor of decls.assessors ?? []) {
        mergedAssessors.set(assessor['bom-ref'], assessor);
      }
      if (decls.attestations) mergedAttestations.push(...decls.attestations);
      for (const claim of decls.claims ?? []) {
        mergedClaims.set(claim['bom-ref'], claim);
      }
      for (const evidence of decls.evidence ?? []) {
        mergedEvidence.set(evidence['bom-ref'], evidence);
      }
      // A project BOM is the union of multiple assessment BOMs;
      // each assessment may have its own sealed affirmation, but
      // the declarations block can only carry one affirmation. Keep
      // the first one encountered.
      if (decls.affirmation && !mergedAffirmation) {
        mergedAffirmation = decls.affirmation;
      }
    }
    if (defs?.standards) {
      for (const standard of defs.standards) {
        mergedStandards.set(standard['bom-ref'], standard);
      }
    }
  }

  // Propagate declarations and document seals only when exactly one
  // sealed assessment contributed to this project BOM. A merged
  // multi-assessment BOM has a different canonical form than any
  // single assessment BOM, so seals from more than one source would
  // not verify against the merged document and are therefore
  // dropped.
  let mergedSeal: CdxSignature | undefined;
  let mergedDocumentSeal: CdxSignature | undefined;
  const sealedBoms = boms.filter((b) => Boolean(b.declarations?.signature));
  if (sealedBoms.length === 1) {
    const sealed = sealedBoms[0];
    mergedSeal = sealed.declarations?.signature;
    mergedDocumentSeal = sealed.signature;
  }

  const projectDeclarations = composeDeclarations({
    assessors: Array.from(mergedAssessors.values()),
    attestations: mergedAttestations,
    claims: Array.from(mergedClaims.values()),
    evidence: Array.from(mergedEvidence.values()),
    affirmation: mergedAffirmation,
    seal: mergedSeal,
  });

  const projectBOM = composeBom({
    specVersion,
    declarations: projectDeclarations,
    definitions:
      mergedStandards.size > 0
        ? { standards: Array.from(mergedStandards.values()) }
        : undefined,
    documentSeal: mergedDocumentSeal,
  });

  const check = assertBomValid(projectBOM, specVersion, { projectId, requestId: req.requestId });
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return;
  }

  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.cyclonedx+json');
  res.setHeader('Content-Disposition', `attachment; filename="project-${projectId}-cdx-${specVersion}.json"`);

  res.json(projectBOM);

  logger.info('Project exported', {
    projectId,
    specVersion,
    assessmentCount: assessments.length,
    requestId: req.requestId,
  });
}));

export default router;
