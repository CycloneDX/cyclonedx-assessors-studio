import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  setupHttpTests,
  loginAs,
  testUsers,
  forceAssessmentStateForTests,
} from '../helpers/http.js';

// Signature labels are unique per (user, label). Generate a short
// random suffix so tests across files do not collide on the shared
// PGlite database used by the HTTP harness.
function sigLabel(prefix: string): string {
  return `${prefix} ${crypto.randomBytes(4).toString('hex')}`;
}

describe('Attestations HTTP Routes', () => {
  setupHttpTests();

  /**
   * Helper to create test data: project, standard with requirements, assessment.
   * Returns { projectId, standardId, assessmentId, requirementIds }
   *
   * The assessment is marked `complete` by default because the CREATE
   * attestation route now requires a completed assessment (see
   * POST /api/v1/attestations). Pass `{ state: 'new' }` to leave the
   * assessment in its initial state for tests that specifically
   * exercise non-complete error paths.
   */
  let testDataCounter = 0;
  async function createTestData(
    agent: any,
    opts: { state?: 'new' | 'complete' | 'archived' | 'cancelled' } = {},
  ) {
    const state = opts.state ?? 'complete';
    testDataCounter++;
    const suffix = testDataCounter;

    // Create standard first (needed for project.standardIds)
    const standardRes = await agent
      .post('/api/v1/standards')
      .send({
        identifier: `ATT-STD-${suffix}-${Date.now()}`,
        name: `Test Standard ${suffix}`,
        version: '1.0',
      });
    expect(standardRes.status).toBe(201);
    const standardId = standardRes.body.id;

    // Create requirements on the standard
    const requirementIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({
          identifier: `REQ-${suffix}-${i}`,
          name: `Requirement ${suffix}-${i}`,
          description: `Test requirement ${suffix}-${i}`,
        });
      expect(reqRes.status).toBe(201);
      requirementIds.push(reqRes.body.id);
    }

    // Create project with standardIds
    const projectRes = await agent
      .post('/api/v1/projects')
      .send({
        name: `Test Project ${suffix}`,
        description: 'Project for attestation tests',
        standardIds: [standardId],
      });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id;

    // Create assessment
    const assessmentRes = await agent
      .post('/api/v1/assessments')
      .send({
        title: `Test Assessment ${suffix}`,
        description: 'Assessment for attestation tests',
        projectId,
      });
    expect(assessmentRes.status).toBe(201);
    const assessmentId = assessmentRes.body.id;

    if (state !== 'new') {
      // The legitimate state machine requires hydrated requirements,
      // scored requirements, and at least one linked evidence to reach
      // 'complete'. None of those matter for attestation tests; use the
      // test-only DB hatch to jump straight to the target state.
      await forceAssessmentStateForTests(assessmentId, state);
    }

    return { projectId, standardId, assessmentId, requirementIds };
  }

  describe('POST /api/v1/attestations', () => {
    it('should create an attestation with valid assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Test Attestation Summary',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.assessmentId).toBe(assessmentId);
      expect(res.body.summary).toBe('Test Attestation Summary');
    });

    it('should create attestation without optional summary', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.assessmentId).toBe(assessmentId);
    });

    it('should return 404 for invalid assessmentId', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId: '00000000-0000-0000-0000-000000000000',
          summary: 'Invalid Assessment',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 400 for missing assessmentId', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          summary: 'Missing Assessment ID',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should return 409 if assessment is not yet complete', async () => {
      const agent = await loginAs('admin');
      // Keep the assessment in its initial `new` state — not complete.
      const { assessmentId } = await createTestData(agent, { state: 'new' });

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Should Fail',
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('completed assessments');
    });

    it('should return 409 if assessment is archived', async () => {
      const agent = await loginAs('admin');
      // Assessment must be completed first before it can be archived.
      const { assessmentId } = await createTestData(agent, { state: 'complete' });
      await forceAssessmentStateForTests(assessmentId, 'archived');

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Should Fail',
        });

      // An archived assessment is not `complete`, so the create guard
      // rejects it. The response is 409 because the request conflicts
      // with the assessment's state, not with authorization.
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('completed assessments');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createTestData(adminAgent);

      // Assessee should not be able to create attestations
      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Unauthorized',
        });

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const { getAgent } = await import('../helpers/http.js');
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/attestations')
        .send({
          assessmentId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/attestations', () => {
    it('should list attestations with pagination', async () => {
      const agent = await loginAs('admin');
      const { assessmentId: assessmentId1 } = await createTestData(agent);
      const { assessmentId: assessmentId2 } = await createTestData(agent);

      // Create attestations
      await agent
        .post('/api/v1/attestations')
        .send({ assessmentId: assessmentId1, summary: 'First' });

      await agent
        .post('/api/v1/attestations')
        .send({ assessmentId: assessmentId2, summary: 'Second' });

      const res = await agent.get('/api/v1/attestations?limit=10&offset=0');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('offset');
      expect(res.body.pagination).toHaveProperty('total');
    });

    it('should respect limit parameter', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/attestations?limit=5&offset=0');

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(5);
    });

    it('should respect offset parameter', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/attestations?limit=10&offset=5');

      expect(res.status).toBe(200);
      expect(res.body.pagination.offset).toBe(5);
    });

    it('should require authentication', async () => {
      const { getAgent } = await import('../helpers/http.js');
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/attestations');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/attestations/:id', () => {
    it('should retrieve attestation details by ID', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const createRes = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Test Summary',
        });

      const attestationId = createRes.body.id;

      const getRes = await agent.get(`/api/v1/attestations/${attestationId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toHaveProperty('attestation');
      expect(getRes.body.attestation.id).toBe(attestationId);
      expect(getRes.body).toHaveProperty('requirements');
      expect(getRes.body).toHaveProperty('claims');
      expect(getRes.body).toHaveProperty('signatory');
    });

    it('should return 404 for non-existent attestation', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/attestations/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Attestation not found');
    });

    it('should require authentication', async () => {
      const { getAgent } = await import('../helpers/http.js');
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/attestations/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/v1/attestations/:id', () => {
    it('should update attestation summary', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const createRes = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Original Summary',
        });

      const attestationId = createRes.body.id;

      const updateRes = await agent
        .put(`/api/v1/attestations/${attestationId}`)
        .send({
          summary: 'Updated Summary',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.summary).toBe('Updated Summary');
    });

    it('should return 404 for non-existent attestation', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .put('/api/v1/attestations/00000000-0000-0000-0000-000000000000')
        .send({ summary: 'Updated' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Attestation not found');
    });

    it('should return 409 if assessment is archived (terminal retention lock)', async () => {
      const agent = await loginAs('admin');
      // Default state is `complete` so create succeeds. `complete` is
      // no longer a retention terminal (it is the working state for
      // attestation authoring); transitioning to `archived` is what
      // triggers the assessment_terminal lock.
      const { assessmentId } = await createTestData(agent);

      const createRes = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Will Be Locked',
        });

      const attestationId = createRes.body.id;

      await forceAssessmentStateForTests(assessmentId, 'archived');

      const updateRes = await agent
        .put(`/api/v1/attestations/${attestationId}`)
        .send({ summary: 'Updated' });

      expect(updateRes.status).toBe(409);
      expect(updateRes.body.reason).toBe('assessment_terminal');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createTestData(adminAgent);

      const createRes = await adminAgent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = createRes.body.id;

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .put(`/api/v1/attestations/${attestationId}`)
        .send({ summary: 'Updated' });

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const { getAgent } = await import('../helpers/http.js');
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .put('/api/v1/attestations/00000000-0000-0000-0000-000000000000')
        .send({ summary: 'Updated' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/attestations/:id/requirements', () => {
    it('should add a requirement to an attestation', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      const res = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.85,
          conformanceRationale: 'Mostly compliant with some gaps',
          confidenceScore: 0.9,
          confidenceRationale: 'High confidence based on testing',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message');
    });

    it('should allow adding multiple requirements', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      // Add first requirement
      const res1 = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.8,
          conformanceRationale: 'First requirement',
        });
      expect(res1.status).toBe(201);

      // Add second requirement
      const res2 = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[1],
          conformanceScore: 0.9,
          conformanceRationale: 'Second requirement',
        });
      expect(res2.status).toBe(201);

      // Verify both are in the attestation
      const getRes = await agent.get(`/api/v1/attestations/${attestationId}`);
      expect(getRes.body.requirements.length).toBe(2);
    });

    it('should return 404 for non-existent attestation', async () => {
      const agent = await loginAs('admin');
      const { requirementIds } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/attestations/00000000-0000-0000-0000-000000000000/requirements')
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.8,
          conformanceRationale: 'Test',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Attestation not found');
    });

    it('should return 404 for non-existent requirement', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      const res = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: '00000000-0000-0000-0000-000000000000',
          conformanceScore: 0.8,
          conformanceRationale: 'Test',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Requirement not found');
    });

    it('should return 400 for invalid conformance score', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      const res = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 1.5,
          conformanceRationale: 'Out of range',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should return 409 if assessment is archived (terminal retention lock)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      await forceAssessmentStateForTests(assessmentId, 'archived');

      const res = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.8,
          conformanceRationale: 'Should Fail',
        });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('assessment_terminal');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(adminAgent);

      const attestationRes = await adminAgent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.8,
          conformanceRationale: 'Unauthorized',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/attestations/:id/requirements/:requirementId', () => {
    it('should update requirement conformance score', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      // Add requirement
      await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.5,
          conformanceRationale: 'Initial score',
        });

      // Update requirement
      const updateRes = await agent
        .put(`/api/v1/attestations/${attestationId}/requirements/${requirementIds[0]}`)
        .send({
          conformanceScore: 0.95,
          conformanceRationale: 'Updated after fixes',
          confidenceScore: 0.99,
          confidenceRationale: 'Very confident now',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body).toHaveProperty('message');
    });

    it('should return 404 for non-existent requirement in attestation', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      const res = await agent
        .put(`/api/v1/attestations/${attestationId}/requirements/${requirementIds[0]}`)
        .send({
          conformanceScore: 0.8,
          conformanceRationale: 'Not added yet',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Attestation requirement not found');
    });

    it('should return 409 if assessment is archived (terminal retention lock)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      // Add requirement
      await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.5,
          conformanceRationale: 'Initial',
        });

      await forceAssessmentStateForTests(assessmentId, 'archived');

      const updateRes = await agent
        .put(`/api/v1/attestations/${attestationId}/requirements/${requirementIds[0]}`)
        .send({
          conformanceScore: 0.8,
          conformanceRationale: 'Should Fail',
        });

      expect(updateRes.status).toBe(409);
      expect(updateRes.body.reason).toBe('assessment_terminal');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(adminAgent);

      const attestationRes = await adminAgent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      // Add requirement
      await adminAgent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.5,
          conformanceRationale: 'Initial',
        });

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .put(`/api/v1/attestations/${attestationId}/requirements/${requirementIds[0]}`)
        .send({
          conformanceScore: 0.8,
          conformanceRationale: 'Unauthorized',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/attestations/:id/requirements', () => {
    it('should retrieve requirements for an attestation', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createTestData(agent);

      const attestationRes = await agent
        .post('/api/v1/attestations')
        .send({ assessmentId });

      const attestationId = attestationRes.body.id;

      // Add requirements
      await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[0],
          conformanceScore: 0.8,
          conformanceRationale: 'Compliant',
        });

      await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[1],
          conformanceScore: 0.9,
          conformanceRationale: 'Highly compliant',
        });

      const res = await agent.get(`/api/v1/attestations/${attestationId}/requirements`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('should return 404 for non-existent attestation', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/attestations/00000000-0000-0000-0000-000000000000/requirements');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Attestation not found');
    });

    it('should require authentication', async () => {
      const { getAgent } = await import('../helpers/http.js');
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/attestations/00000000-0000-0000-0000-000000000000/requirements');

      expect(res.status).toBe(401);
    });
  });

  // PR3.6: The POST /:id/sign, /sign/prepare, /verify, /rescind suites
  // that previously lived here have been removed along with the
  // per-attestation signing endpoints. Attestation authority now flows
  // through the assessment's affirmation; see
  // backend/src/__tests__/http/affirmations.test.ts for cascade-sign
  // coverage.

  describe('Edge cases and role-based access', () => {
    it('should allow an assigned assessor to create attestations', async () => {
      // Admin creates test data (standards require admin/standards_manager role)
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createTestData(adminAgent);
      // Writes need assignment, not just assessments.view_all (security review Z8).
      const { getDatabase } = await import('../../db/connection.js');
      await getDatabase().insertInto('assessment_assessor')
        .values({ assessment_id: assessmentId, user_id: testUsers.assessor.id, created_at: new Date() })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Assessor creates the attestation
      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Assessor Created',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should reject an unassigned assessor creating attestations (Z8)', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createTestData(adminAgent);
      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent
        .post('/api/v1/attestations')
        .send({ assessmentId, summary: 'Not assigned' });
      expect(res.status).toBe(403);
    });

    it('should reject assessee trying to create attestations', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createTestData(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Should Fail',
        });

      expect(res.status).toBe(403);
    });

    it('should use camelCase in response bodies', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId,
          summary: 'Camel Case Test',
        });

      expect(res.status).toBe(201);
      // Response should have camelCase due to middleware
      expect(res.body).toHaveProperty('assessmentId');
      expect(res.body).not.toHaveProperty('assessment_id');
    });
  });
});
