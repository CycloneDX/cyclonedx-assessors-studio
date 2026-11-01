import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { uniqueAssessmentTitle, uniqueEvidenceName, VALID_RATIONALE } from './data.js';

/**
 * End-to-end builder for an assessment in the `complete` state.
 *
 * Many Phase 2 surfaces (attestations, affirmations, claims-on-
 * completed-assessment) need an assessment that has already moved
 * through the full lifecycle. Reproducing that flow inline in
 * every spec is repetitive and brittle; this helper does it via
 * the API in five steps:
 *
 *   1. Look up the baseline standard global-setup imported (has
 *      requirements). Throws if missing — global-setup regressed.
 *   2. POST /assessments with that standardId.
 *   3. POST /assessments/:id/start (copies requirements onto the
 *      assessment_requirement table).
 *   4. PUT each assessment_requirement to result=yes with a
 *      15-word rationale so the complete-prerequisite validator
 *      is happy.
 *   5. POST /evidence + link to the first requirement so the
 *      complete handler's "at least one evidence" check passes.
 *   6. POST /assessments/:id/complete.
 *
 * Caller receives the assessment id, standard id, and the list of
 * requirement ids (in the order they appear on the assessment).
 * Skip the build by setting `linkEvidence: false` to stop after
 * scoring — useful for tests that want to assert the complete
 * endpoint rejects unlinked-evidence preconditions.
 */
export interface CompletedAssessmentFixture {
  assessmentId: string;
  standardId: string;
  requirementIds: string[];
}

export async function buildCompletedAssessment(
  api: APIRequestContext,
  opts: { linkEvidence?: boolean; complete?: boolean; assessorIds?: string[] } = {},
): Promise<CompletedAssessmentFixture> {
  const { linkEvidence = true, complete = true, assessorIds } = opts;

  const standards = await api.get('/api/v1/standards?limit=100').then((r) => r.json());
  const baseline = (
    standards.data as Array<{
      id: string;
      name: string;
      createdAt?: string;
      requirementsCount?: number;
    }>
  )
    .filter((s) => (s.requirementsCount ?? 0) > 0)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
  if (!baseline) {
    throw new Error(
      'buildCompletedAssessment: no standard with requirements found. ' +
        'global-setup.ensureSeedStandard should have imported one.',
    );
  }

  const assessment = await api
    .post('/api/v1/assessments', {
      // assessorIds: writes on an assessment are limited to its assigned
      // assessors (security review Z8), so callers that act as an
      // assessor must be assigned here.
      data: { title: uniqueAssessmentTitle(), standardId: baseline.id, ...(assessorIds ? { assessorIds } : {}) },
    })
    .then((r) => r.json());
  expect(assessment.id, 'assessment.id missing on create').toBeTruthy();

  const startRes = await api.post(`/api/v1/assessments/${assessment.id}/start`);
  expect(startRes.status(), `start failed: ${await startRes.text()}`).toBe(200);

  const detailRes = await api.get(`/api/v1/assessments/${assessment.id}`);
  const detailBody = await detailRes.json();
  // The response now (post product-fix to assessments.ts) returns the
  // junction PK under `id` and the catalog id under `requirementId`.
  // Earlier responses had `id` collide with the catalog id; that bug
  // is fixed and this helper assumes the corrected shape.
  const requirements: Array<{
    id: string;
    requirementId?: string;
    requirement_id?: string;
  }> = detailBody.requirements ?? [];
  expect(requirements.length, 'assessment has no requirements after start').toBeGreaterThan(0);

  // For scoring (PUT /assessments/:id/requirements/:reqId): the catalog
  // requirement_id is the route param.
  const requirementIds = requirements.map(
    (r) => r.requirementId ?? r.requirement_id ?? r.id,
  );
  // For evidence linking (POST /evidence/:id/link): the junction row id
  // is the body param. Same row order as requirementIds so [0] aligns
  // with the first scored requirement.
  const junctionIds = requirements.map((r) => r.id);

  for (const reqId of requirementIds) {
    const upd = await api.put(
      `/api/v1/assessments/${assessment.id}/requirements/${reqId}`,
      { data: { result: 'yes', rationale: VALID_RATIONALE } },
    );
    expect(upd.ok(), `requirement update failed: ${await upd.text()}`).toBeTruthy();
  }

  if (linkEvidence) {
    const evidence = await api
      .post('/api/v1/evidence', {
        data: {
          name: uniqueEvidenceName(),
          description: 'E2E evidence linkage',
          state: 'in_progress',
        },
      })
      .then((r) => r.json());
    expect(evidence.id, 'evidence.id missing on create').toBeTruthy();

    // The link endpoint hangs off the evidence row, not the assessment.
    // Body carries the junction id (assessment_requirement.id), not the
    // catalog requirement id.
    const linkRes = await api.post(`/api/v1/evidence/${evidence.id}/link`, {
      data: { assessmentRequirementId: junctionIds[0] },
    });
    expect(
      linkRes.ok(),
      `evidence link failed: ${linkRes.status()} ${await linkRes.text()}`,
    ).toBeTruthy();
  }

  if (complete) {
    const completeRes = await api.post(`/api/v1/assessments/${assessment.id}/complete`);
    expect(
      completeRes.ok(),
      `complete failed: ${completeRes.status()} ${await completeRes.text()}`,
    ).toBeTruthy();
  }

  return {
    assessmentId: assessment.id,
    standardId: baseline.id,
    requirementIds,
  };
}
