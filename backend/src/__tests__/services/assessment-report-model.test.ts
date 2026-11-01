import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupHttpTests, testUsers } from '../helpers/http.js';

/**
 * buildAssessmentReportModel against a small fixture written straight
 * to the database: two requirement groups, evidence cited by two
 * requirements and a claim, attested scores including zeros, a claim
 * and a counter-claim, and an unsealed affirmation.
 */
describe('buildAssessmentReportModel', () => {
  setupHttpTests();

  let db: Awaited<ReturnType<typeof getDb>>;
  async function getDb() {
    const { getDatabase } = await import('../../db/connection.js');
    return getDatabase();
  }
  async function buildModel(assessmentId: string) {
    const { buildAssessmentReportModel } = await import('../../services/assessment-report/model.js');
    return buildAssessmentReportModel(db, assessmentId);
  }

  const ids = {
    standard: uuidv4(),
    g1: uuidv4(),
    g1_2: uuidv4(),
    g1_10: uuidv4(),
    g2: uuidv4(),
    g2_1: uuidv4(),
    g2_5: uuidv4(),
    assessment: uuidv4(),
    attestation: uuidv4(),
    evidenceShared: uuidv4(),
    evidenceClaim: uuidv4(),
    evidenceDeleted: uuidv4(),
    claim: uuidv4(),
    counterClaim: uuidv4(),
    affirmation: uuidv4(),
  };
  const arIds = { g1_2: uuidv4(), g1_10: uuidv4(), g2_1: uuidv4() };
  const atrIds = { g1_10: uuidv4(), g1_2: uuidv4() };

  beforeAll(async () => {
    db = await getDb();
    const authorId = testUsers.assessor.id;
    const suffix = Date.now();

    await db.insertInto('standard').values({
      id: ids.standard, identifier: `RPT-STD-${suffix}`, name: 'Report Fixture Standard', version: '2.0',
      state: 'published', is_imported: false,
    }).execute();
    const req = (id: string, identifier: string, name: string, parent_id: string | null) =>
      db.insertInto('requirement').values({ id, identifier, name, parent_id, standard_id: ids.standard }).execute();
    await req(ids.g1, 'G1', 'Group one', null);
    await req(ids.g2, 'G2', 'Group two', null);
    await req(ids.g1_2, 'G1.2', 'Second control', ids.g1);
    await req(ids.g1_10, 'G1.10', 'Tenth control', ids.g1);
    await req(ids.g2_1, 'G2.1', 'Unassessed control', ids.g2);
    await req(ids.g2_5, 'G2.5', 'Attested-only control', ids.g2);

    await db.insertInto('assessment').values({
      id: ids.assessment, title: 'Report fixture assessment', state: 'complete',
      standard_id: ids.standard, description: 'Fixture description',
    } as never).execute();
    await db.insertInto('assessment_assessor').values({ assessment_id: ids.assessment, user_id: authorId } as never).execute();

    await db.insertInto('assessment_requirement').values([
      { id: arIds.g1_2, assessment_id: ids.assessment, requirement_id: ids.g1_2, result: 'partial', rationale: 'Partly done' },
      { id: arIds.g1_10, assessment_id: ids.assessment, requirement_id: ids.g1_10, result: 'yes', rationale: 'Done' },
      { id: arIds.g2_1, assessment_id: ids.assessment, requirement_id: ids.g2_1, result: null },
    ]).execute();

    const evidence = (id: string, name: string, deleted = false) =>
      db.insertInto('evidence').values({
        id, name, state: 'claimed', author_id: authorId, is_counter_evidence: false,
        ...(deleted ? { deleted_at: new Date() } : {}),
      } as never).execute();
    await evidence(ids.evidenceShared, 'Shared evidence');
    await evidence(ids.evidenceClaim, 'Claim-only evidence');
    await evidence(ids.evidenceDeleted, 'Deleted evidence', true);
    await db.insertInto('assessment_requirement_evidence').values([
      { assessment_requirement_id: arIds.g1_2, evidence_id: ids.evidenceShared },
      { assessment_requirement_id: arIds.g1_10, evidence_id: ids.evidenceShared },
      { assessment_requirement_id: arIds.g1_10, evidence_id: ids.evidenceDeleted },
    ] as never).execute();

    await db.insertInto('attestation').values({ id: ids.attestation, assessment_id: ids.assessment, summary: 'Fixture attestation summary' }).execute();
    await db.insertInto('attestation_requirement').values([
      { id: atrIds.g1_10, attestation_id: ids.attestation, requirement_id: ids.g1_10, conformance_score: 1, conformance_rationale: 'Verified', confidence_score: 0.9 },
      { id: atrIds.g1_2, attestation_id: ids.attestation, requirement_id: ids.g1_2, conformance_score: 0, conformance_rationale: 'Absent', confidence_score: 0 },
      // Attested without an assessment row: reported, not dropped.
      { id: uuidv4(), attestation_id: ids.attestation, requirement_id: ids.g2_5, conformance_score: 0.8, conformance_rationale: 'Sampled' },
    ]).execute();

    await db.insertInto('claim').values([
      { id: ids.claim, name: 'Claim one', target: 'Product A', predicate: 'Uses MFA', is_counter_claim: false, status: 'active', attestation_id: ids.attestation },
      { id: ids.counterClaim, name: 'Counter one', target: 'Product A', predicate: 'MFA bypass exists', is_counter_claim: true, status: 'active', attestation_id: ids.attestation },
    ] as never).execute();
    await db.insertInto('claim_evidence').values([
      { claim_id: ids.claim, evidence_id: ids.evidenceClaim },
      { claim_id: ids.claim, evidence_id: ids.evidenceShared },
    ] as never).execute();
    await db.insertInto('attestation_requirement_claim').values({ attestation_requirement_id: atrIds.g1_10, claim_id: ids.claim } as never).execute();

    await db.insertInto('affirmation').values({ id: ids.affirmation, statement: 'We affirm the fixture.', assessment_id: ids.assessment } as never).execute();
    await db.insertInto('affirmation_signatory').values({
      id: uuidv4(), affirmation_id: ids.affirmation, required_title: 'CISO', created_at: new Date(), updated_at: new Date(),
    } as never).execute();
  });

  it('groups requirements by top-level parent and sorts identifiers naturally', async () => {
    const model = await buildModel(ids.assessment);

    expect(model.groups.map((g) => [g.title, g.description])).toEqual([
      ['G1 Group one', null],
      ['G2 Group two', null],
    ]);
    expect(model.groups[0].requirements.map((r) => r.identifier)).toEqual(['G1.2', 'G1.10']);
    expect(model.groups[1].requirements.map((r) => [r.identifier, r.result])).toEqual([
      ['G2.1', 'not_assessed'],
      ['G2.5', 'not_assessed'],
    ]);
    expect(model.standard).toBe('Report Fixture Standard 2.0');
  });

  it('merges attested scores into requirement rows and keeps zero scores', async () => {
    const model = await buildModel(ids.assessment);
    const [g1_2, g1_10] = model.groups[0].requirements;

    expect(g1_2).toMatchObject({ result: 'partial', conformance: 0, confidence: 0, attestedRationale: 'Absent' });
    expect(g1_10).toMatchObject({ result: 'yes', conformance: 1, confidence: 0.9, claimRefs: ['C1'] });
    expect(model.groups[1].requirements[0]).toMatchObject({ conformance: null, confidence: null });
    expect(model.groups[1].requirements[1]).toMatchObject({ conformance: 0.8, confidence: null });
  });

  it('lists each evidence item once with everything it supports, skipping deleted evidence', async () => {
    const model = await buildModel(ids.assessment);

    expect(model.evidence.map((e) => [e.ref, e.name])).toEqual([
      ['E1', 'Shared evidence'],
      ['E2', 'Claim-only evidence'],
    ]);
    expect(model.evidence[0].supports).toEqual(['G1.2', 'G1.10', 'C1']);
    expect(model.evidence[1].supports).toEqual(['C1']);
    expect(model.groups[0].requirements[1].evidenceRefs).toEqual(['E1']);
    expect(model.claims[0].evidenceRefs).toEqual(['E1', 'E2']);
  });

  it('summarises results, scores, claims and counter-claims', async () => {
    const { summary, claims, attestationSummaries } = await buildModel(ids.assessment);

    expect(summary).toMatchObject({
      requirementCount: 4,
      assessedCount: 2,
      attestedCount: 3,
      evidenceCount: 2,
      claimCount: 1,
      counterClaimCount: 1,
    });
    expect(summary.resultCounts).toMatchObject({ yes: 1, partial: 1, no: 0, not_assessed: 2 });
    expect(summary.meanConformance).toBeCloseTo(0.6);
    expect(summary.meanConfidence).toBeCloseTo(0.45);
    expect(claims.map((c) => [c.ref, c.isCounterClaim])).toEqual([['C1', false], ['C2', true]]);
    expect(attestationSummaries).toEqual(['Fixture attestation summary']);
  });

  it('reports the affirmation seal status', async () => {
    let model = await buildModel(ids.assessment);
    expect(model.affirmation).toMatchObject({ statement: 'We affirm the fixture.', sealStatus: 'unsealed' });
    expect(model.affirmation!.signatories).toEqual([
      expect.objectContaining({ title: 'CISO', signatureType: null, signedAt: null }),
    ]);

    // A seal whose platform key cannot be found fails verification.
    await db.updateTable('affirmation')
      .set({ sealed_at: new Date(), platform_key_fingerprint: 'missing-key' } as never)
      .where('id', '=', ids.affirmation).execute();
    model = await buildModel(ids.assessment);
    expect(model.affirmation!.sealStatus).toBe('failed');
    expect(model.affirmation!.issues.join(' ')).toContain('could not be located');

    await db.updateTable('affirmation')
      .set({ rescinded_at: new Date() } as never)
      .where('id', '=', ids.affirmation).execute();
    model = await buildModel(ids.assessment);
    expect(model.affirmation!.sealStatus).toBe('rescinded');
  });

  it('throws for an unknown assessment', async () => {
    await expect(buildModel(uuidv4())).rejects.toThrow('Assessment not found');
  });
});
