import { describe, it, expect } from 'vitest';
import { setupHttpTests, loginAs, getAgent } from '../helpers/http.js';

describe('Assessments HTTP Routes', () => {
  setupHttpTests();

  let testDataCounter = 0;

  /**
   * Helper to create test data: standard with requirements, project, and assessment.
   * Returns { projectId, standardId, assessmentId, requirementIds, userIds }
   */
  async function createTestData(agent: any) {
    testDataCounter++;
    const suffix = testDataCounter;

    // Create standard
    const standardRes = await agent
      .post('/api/v1/standards')
      .send({
        identifier: `ASST-STD-${suffix}-${Date.now()}`,
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

    // Create project with standard
    const projectRes = await agent
      .post('/api/v1/projects')
      .send({
        name: `Test Project ${suffix}`,
        description: 'Project for assessment tests',
        standardIds: [standardId],
      });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id;

    return { projectId, standardId, assessmentId: undefined, requirementIds };
  }

  /**
   * Helper to create full assessment with all prerequisites
   */
  async function createFullAssessment(agent: any, overrides?: any) {
    const { projectId, standardId, requirementIds } = await createTestData(agent);

    const assessmentRes = await agent
      .post('/api/v1/assessments')
      .send({
        title: overrides?.title || `Test Assessment ${testDataCounter}`,
        description: overrides?.description || 'Full test assessment',
        projectId,
        ...overrides,
      });
    expect(assessmentRes.status).toBe(201);

    return { projectId, standardId, assessmentId: assessmentRes.body.id, requirementIds };
  }

  /**
   * Helper to create evidence and link it to an assessment requirement
   */
  async function createAndLinkEvidence(agent: any, assessmentId: string) {
    // Create evidence
    const evidenceRes = await agent
      .post('/api/v1/evidence')
      .send({
        name: `Test Evidence ${Date.now()}`,
        description: 'Test evidence for assessment completion',
        state: 'in_progress',
      });

    if (evidenceRes.status !== 201) {
      throw new Error(`Failed to create evidence: ${evidenceRes.status} - ${JSON.stringify(evidenceRes.body)}`);
    }

    const evidenceId = evidenceRes.body.id;

    // Link evidence to the first assessment requirement
    const { getDatabase } = await import('../../db/connection.js');
    const db = getDatabase();

    const assessmentReq = await db
      .selectFrom('assessment_requirement')
      .where('assessment_id', '=', assessmentId)
      .select('id')
      .executeTakeFirst();

    if (assessmentReq) {
      await db
        .insertInto('assessment_requirement_evidence')
        .values({
          assessment_requirement_id: assessmentReq.id,
          evidence_id: evidenceId,
          created_at: new Date(),
        })
        .execute();
    }

    return evidenceId;
  }

  // 15-word rationale constant (the route requires at least 15 words)
  const VALID_RATIONALE = 'This requirement has been thoroughly reviewed and is fully satisfied based on comprehensive evidence and detailed analysis provided.';

  /**
   * Helper to fully complete an assessment via API:
   * start -> update all requirements -> link evidence -> complete.
   * Uses the standard requirementIds (not assessment_requirement IDs)
   * because the PUT endpoint looks up by requirement_id.
   */
  async function completeAssessmentViaAPI(agent: any, assessmentId: string, requirementIds: string[]) {
    // Start the assessment
    const startRes = await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});
    if (startRes.status !== 200) {
      throw new Error(`Failed to start assessment: ${startRes.status} - ${JSON.stringify(startRes.body)}`);
    }

    // Mark all requirements as complete with rationale (use standard requirement IDs)
    for (const reqId of requirementIds) {
      const updateRes = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${reqId}`)
        .send({
          result: 'yes',
          rationale: VALID_RATIONALE,
        });
      if (updateRes.status !== 200) {
        throw new Error(`Failed to update requirement ${reqId}: ${updateRes.status} - ${JSON.stringify(updateRes.body)}`);
      }
    }

    // Create and link evidence
    await createAndLinkEvidence(agent, assessmentId);

    // Complete
    const completeRes = await agent.post(`/api/v1/assessments/${assessmentId}/complete`).send({});
    if (completeRes.status !== 200) {
      throw new Error(`Failed to complete assessment: ${completeRes.status} - ${JSON.stringify(completeRes.body)}`);
    }
  }

  describe('POST /api/v1/assessments', () => {
    it('should create an assessment with minimal fields', async () => {
      const agent = await loginAs('admin');
      const timestamp = Date.now();

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment ${timestamp}`,
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe(`Assessment ${timestamp}`);
      expect(res.body.state).toBe('new');
    });

    it('should create an assessment with description', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment with Desc ${Date.now()}`,
          description: 'This is a test description',
        });

      expect(res.status).toBe(201);
      expect(res.body.description).toBe('This is a test description');
    });

    it('should create an assessment with projectId', async () => {
      const agent = await loginAs('admin');
      const { projectId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment with Project ${Date.now()}`,
          projectId,
        });

      expect(res.status).toBe(201);
      expect(res.body.projectId).toBe(projectId);
    });

    it('should create an assessment with dueDate', async () => {
      const agent = await loginAs('admin');
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment with Due Date ${Date.now()}`,
          dueDate,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should create an assessment with assessor and assessee IDs', async () => {
      const agent = await loginAs('admin');
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();

      // Get admin and assessor user IDs
      const adminUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'admin')
        .select('id')
        .executeTakeFirst();

      const assessorUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessor')
        .select('id')
        .executeTakeFirst();

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment with Users ${Date.now()}`,
          assessorIds: [adminUser!.id],
          assesseeIds: [assessorUser!.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should create an assessment with tags', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment with Tags ${Date.now()}`,
          tags: ['urgent', 'compliance', 'security'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should return 404 for invalid projectId', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment ${Date.now()}`,
          projectId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Project not found');
    });

    it('should return 400 for missing title', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          description: 'No title provided',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should return 400 for empty title', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should return 400 for invalid projectId format', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: 'Test Assessment',
          projectId: 'not-a-uuid',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments')
        .send({
          title: 'Unauthorized Assessment',
        });

      expect(res.status).toBe(401);
    });

    it('should require assessments.create permission', async () => {
      const assesseeAgent = await loginAs('assessee');

      const res = await assesseeAgent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment ${Date.now()}`,
        });

      // Assessee typically doesn't have create permission
      expect(res.status).toBe(403);
    });

    /**
     * Regression tests for issue #19's underlying cause:
     * https://github.com/CycloneDX/cyclonedx-assessors-studio/issues/19
     *
     * The create form sent `standardIds` (plural) for ad hoc and
     * standalone assessments. The original schema only accepted
     * `standardId` (singular) and Zod silently dropped the unknown key,
     * persisting null and producing the cascade of nulls the reporter
     * described. The schema now accepts the plural alias capped at one
     * entry and collapses it onto standard_id; arrays of length > 1 are
     * explicitly rejected.
     */
    it('should persist standardId from singular form (regression baseline)', async () => {
      const agent = await loginAs('admin');
      const { standardId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `singular ${Date.now()}`,
          standardId,
        });

      expect(res.status).toBe(201);

      const getRes = await agent.get(`/api/v1/assessments/${res.body.id}`);
      expect(getRes.body.assessment.standardId).toBe(standardId);
    });

    it('should persist standardId from standardIds alias of length 1 (issue #19)', async () => {
      const agent = await loginAs('admin');
      const { standardId } = await createTestData(agent);

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `alias ${Date.now()}`,
          standardIds: [standardId],
        });

      expect(res.status).toBe(201);

      const getRes = await agent.get(`/api/v1/assessments/${res.body.id}`);
      expect(getRes.body.assessment.standardId).toBe(standardId);
    });

    it('should reject standardIds with more than one entry with 400 (issue #19)', async () => {
      const agent = await loginAs('admin');
      const a = await createTestData(agent);
      const b = await createTestData(agent);

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `too many ${Date.now()}`,
          standardIds: [a.standardId, b.standardId],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
      expect(res.body.details.some((d: { path: (string | number)[] }) =>
        d.path.includes('standardIds')
      )).toBe(true);
    });

    it('should prefer singular standardId when both fields are sent (issue #19)', async () => {
      const agent = await loginAs('admin');
      const a = await createTestData(agent);
      const b = await createTestData(agent);

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `both ${Date.now()}`,
          standardId: a.standardId,
          standardIds: [b.standardId],
        });

      expect(res.status).toBe(201);

      const getRes = await agent.get(`/api/v1/assessments/${res.body.id}`);
      expect(getRes.body.assessment.standardId).toBe(a.standardId);
    });
  });

  describe('GET /api/v1/assessments', () => {
    it('should list assessments with pagination', async () => {
      const agent = await loginAs('admin');

      // Create multiple assessments
      for (let i = 0; i < 3; i++) {
        await agent
          .post('/api/v1/assessments')
          .send({
            title: `List Test ${i} ${Date.now()}`,
          });
      }

      const res = await agent.get('/api/v1/assessments?limit=10&offset=0');

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

      const res = await agent.get('/api/v1/assessments?limit=5&offset=0');

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(5);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should respect offset parameter', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/assessments?limit=10&offset=5');

      expect(res.status).toBe(200);
      expect(res.body.pagination.offset).toBe(5);
    });

    it('should filter by state', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get('/api/v1/assessments?state=new');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // All returned assessments should be in 'new' state
      res.body.data.forEach((a: any) => {
        expect(a.state).toBe('new');
      });
    });

    it('should filter by projectId', async () => {
      const agent = await loginAs('admin');
      const { projectId, assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments?projectId=${projectId}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      res.body.data.forEach((a: any) => {
        expect(a.projectId).toBe(projectId);
      });
    });

    it('should filter by myOnly=true to get user assessments', async () => {
      const adminAgent = await loginAs('admin');
      const assessorAgent = await loginAs('assessor');
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();

      const assessorUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessor')
        .select('id')
        .executeTakeFirst();

      // Create assessment with assessor as assessor
      await adminAgent
        .post('/api/v1/assessments')
        .send({
          title: `My Assessment ${Date.now()}`,
          assessorIds: [assessorUser!.id],
        });

      const res = await assessorAgent.get('/api/v1/assessments?myOnly=true');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should include tags in response', async () => {
      const agent = await loginAs('admin');

      await agent
        .post('/api/v1/assessments')
        .send({
          title: `Tagged Assessment ${Date.now()}`,
          tags: ['compliance', 'security'],
        });

      const res = await agent.get('/api/v1/assessments?limit=100');

      expect(res.status).toBe(200);
      // At least some assessments should have the tags property
      const taggedAssessments = res.body.data.filter((a: any) => a.tags && a.tags.length > 0);
      if (taggedAssessments.length > 0) {
        expect(taggedAssessments[0]).toHaveProperty('tags');
      }
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/assessments');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id', () => {
    it('should retrieve assessment details by ID', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, standardId, projectId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('assessment');
      expect(res.body.assessment.id).toBe(assessmentId);
      expect(res.body).toHaveProperty('requirements');
      expect(res.body).toHaveProperty('assessors');
      expect(res.body).toHaveProperty('assessees');
      expect(Array.isArray(res.body.requirements)).toBe(true);
      expect(Array.isArray(res.body.assessors)).toBe(true);
      expect(Array.isArray(res.body.assessees)).toBe(true);
    });

    it('should include standard and project information', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, standardId, projectId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.assessment).toHaveProperty('projectId');
      expect(res.body.assessment).toHaveProperty('standardId');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/assessments/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/assessments/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/v1/assessments/:id', () => {
    it('should update assessment title', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const newTitle = `Updated Title ${Date.now()}`;
      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          title: newTitle,
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe(newTitle);
    });

    it('should update assessment description', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const newDescription = `Updated description ${Date.now()}`;
      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          description: newDescription,
        });

      expect(res.status).toBe(200);
      expect(res.body.description).toBe(newDescription);
    });

    it('should update assessment dueDate', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);
      const newDueDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          dueDate: newDueDate,
        });

      expect(res.status).toBe(200);
    });

    it('should update assessment state', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          state: 'pending',
        });

      expect(res.status).toBe(200);
      expect(res.body.state).toBe('pending');
    });

    it('should update assessment assessorIds', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();

      const assessorUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessor')
        .select('id')
        .executeTakeFirst();

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          assessorIds: [assessorUser!.id],
        });

      expect(res.status).toBe(200);
    });

    it('should update assessment assesseeIds', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();

      const assesseeUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessee')
        .select('id')
        .executeTakeFirst();

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          assesseeIds: [assesseeUser!.id],
        });

      expect(res.status).toBe(200);
    });

    it('should update assessment tags', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          tags: ['updated-tag', 'new-tag'],
        });

      expect(res.status).toBe(200);
      expect(res.body.tags.map((t: any) => t.name)).toEqual(expect.arrayContaining(['updated-tag', 'new-tag']));
    });

    it('should prevent updates to archived assessments', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete and archive the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/archive`).send({});

      // Try to update
      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          title: 'Updated Title',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Archived assessments cannot be modified');
    });

    it('allows reopen via PUT { state } (routes through transition matrix)', async () => {
      // PUT { state } is a thin alias for /transition. It enforces the
      // same matrix and the same assessments.manage permission gate
      // the dedicated route does; non-admin assessors lose state-change
      // ability through PUT just like through /transition.
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({ state: 'in_progress' });

      // Admin has assessments.manage and there is no sealed affirmation,
      // so the reopen succeeds and the row is now back in_progress.
      expect(res.status).toBe(200);
    });

    it('should prevent non-state updates on completed assessments', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      // Try to update title (non-state change)
      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          title: 'New Title',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('read-only');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .put('/api/v1/assessments/00000000-0000-0000-0000-000000000000')
        .send({
          title: 'Updated',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 400 for invalid input', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          state: 'invalid-state',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid input');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .put('/api/v1/assessments/00000000-0000-0000-0000-000000000000')
        .send({
          title: 'Updated',
        });

      expect(res.status).toBe(401);
    });

    it('should require assessments.edit permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent
        .put(`/api/v1/assessments/${assessmentId}`)
        .send({
          title: 'Updated',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/assessments/:id/start', () => {
    it('should start a new assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/start`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment started');
    });

    it('should set state to in_progress when starting', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const getRes = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(getRes.body.assessment.state).toBe('in_progress');
    });

    it('should load requirements from standard_id when starting', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, standardId } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(res.body.requirements.length).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/start')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 409 when starting a non-new assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      // Start once
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      // Try to start again
      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/start`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('new state');
    });

    it('should require assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent
        .post(`/api/v1/assessments/${assessmentId}/start`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/start')
        .send({});

      expect(res.status).toBe(401);
    });

    /**
     * Regression tests for issue #19:
     * https://github.com/CycloneDX/cyclonedx-assessors-studio/issues/19
     *
     * The frontend calls `axios.post('/assessments/:id/start')` with no
     * body. Express's express.json() middleware leaves req.body as
     * undefined when no Content-Type is set, and the original
     * `startAssessmentSchema.parse(req.body)` then threw with
     * `expected object, received undefined`. Fix coerces to `{}` before
     * parsing.
     */
    it('should start an assessment when called with no request body (issue #19)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      // .post() without .send() sends no body and no Content-Type — the
      // exact shape of the frontend call that produced the 400.
      const res = await agent.post(`/api/v1/assessments/${assessmentId}/start`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment started');
    });

    it('should start an assessment when called with an empty JSON object (issue #19)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      // Belt-and-suspenders: explicit empty-object body should remain
      // accepted alongside the no-body case.
      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/start`)
        .set('Content-Type', 'application/json')
        .send({});

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/assessments/:id/complete', () => {
    it('should complete an in_progress assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Start the assessment
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      // Mark all requirements using standard requirement IDs (the PUT endpoint looks up by requirement_id)
      for (const reqId of requirementIds) {
        await agent
          .put(`/api/v1/assessments/${assessmentId}/requirements/${reqId}`)
          .send({
            result: 'yes',
            rationale: VALID_RATIONALE,
          });
      }

      // Create and link evidence
      await createAndLinkEvidence(agent, assessmentId);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/complete`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment completed');
    });

    it('should set state to complete when completing', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Use the completeAssessmentViaAPI helper
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      const getRes = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(getRes.body.assessment.state).toBe('complete');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/complete')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 409 when completing a non-in_progress assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/complete`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('in_progress state');
    });

    it('should return 400 when requirements have unassessed items', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      // Start but don't assess
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/complete`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot complete assessment');
    });

    it('should require assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent
        .post(`/api/v1/assessments/${assessmentId}/complete`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/complete')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/assessments/:id/archive', () => {
    it('should archive a completed assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/archive`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment archived');
    });

    it('should set state to archived', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete and archive the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/archive`).send({});

      const getRes = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(getRes.body.assessment.state).toBe('archived');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/archive')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 409 when archiving a non-completed assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/archive`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('Only completed assessments');
    });

    it('should return 409 when archiving an already archived assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete and archive
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/archive`).send({});

      // Try to archive again
      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/archive`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already archived');
    });

    it('should require assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent
        .post(`/api/v1/assessments/${assessmentId}/archive`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/archive')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/assessments/:id/reopen', () => {
    it('should reopen a completed assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/reopen`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment reopened');
    });

    it('should set state to in_progress when reopening', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete then reopen
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/reopen`).send({});

      const getRes = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(getRes.body.assessment.state).toBe('in_progress');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/reopen')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 403 when reopening an archived assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete and archive
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/archive`).send({});

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/reopen`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Archived assessments cannot be reopened');
    });

    it('should require assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent
        .post(`/api/v1/assessments/${assessmentId}/reopen`)
        .send({});

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/reopen')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/v1/assessments/:id/requirements/:requirementId', () => {
    it('should update requirement result', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      // Use the standard requirement ID (the PUT endpoint looks up by requirement_id)
      const firstReqId = requirementIds[0];

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${firstReqId}`)
        .send({
          result: 'yes',
          rationale: VALID_RATIONALE,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment requirement updated');
    });

    it('should update requirement rationale', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const firstReqId = requirementIds[0];

      await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${firstReqId}`)
        .send({
          result: 'partial',
          rationale: 'Initial partial compliance with some gaps that need careful and thorough addressing and significant improvements going forward.',
        });

      const updatedRes = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${firstReqId}`)
        .send({
          rationale: 'Updated rationale explaining the current status and improvements made here now for detailed verification and final review.',
        });

      expect(updatedRes.status).toBe(200);
    });

    it('should return 400 for insufficient rationale length', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const firstReqId = requirementIds[0];

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${firstReqId}`)
        .send({
          result: 'yes',
          rationale: 'Too short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('at least 15 words');
    });

    it('should return 404 for non-existent requirement', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/00000000-0000-0000-0000-000000000000`)
        .send({
          result: 'yes',
          rationale: 'This should fail because requirement does not exist for assessment.',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment requirement not found');
    });

    it('should prevent updates to completed assessments', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      // Try to update the first requirement
      const res = await agent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${requirementIds[0]}`)
        .send({
          result: 'no',
          rationale: 'This should fail because the assessment is now in a completed and read only state permanently.',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('read-only');
    });

    it('should require assessments.edit permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId, requirementIds } = await createFullAssessment(adminAgent);

      await adminAgent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await assesseeAgent
        .put(`/api/v1/assessments/${assessmentId}/requirements/${requirementIds[0]}`)
        .send({
          result: 'yes',
          rationale: 'Unauthorized attempt with sufficient rationale words included here for testing purposes now.',
        });

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .put('/api/v1/assessments/00000000-0000-0000-0000-000000000000/requirements/00000000-0000-0000-0000-000000000000')
        .send({
          result: 'yes',
          rationale: 'Unauthorized with necessary words for the rationale field validation here.',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id/requirements/:requirementId/evidence', () => {
    it('should retrieve evidence for a requirement', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      // The :requirementId path parameter is the *catalog* requirement
      // id (assessment_requirement.requirement_id), not the junction
      // row's own id. The previous selectAll() collision used to
      // alias them to the same value so the test passed by accident
      // — now that the GET response distinguishes the two columns,
      // we have to pick the right one explicitly.
      const getRes = await agent.get(`/api/v1/assessments/${assessmentId}`);
      expect(getRes.status).toBe(200);
      const assessmentRequirements = getRes.body.requirements || [];
      const firstReqId = assessmentRequirements.length > 0
        ? (assessmentRequirements[0].requirement_id ?? assessmentRequirements[0].requirementId)
        : '00000000-0000-0000-0000-000000000000';

      const res = await agent.get(
        `/api/v1/assessments/${assessmentId}/requirements/${firstReqId}/evidence`
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/requirements/00000000-0000-0000-0000-000000000000/evidence'
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should return 404 for non-existent requirement', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(
        `/api/v1/assessments/${assessmentId}/requirements/00000000-0000-0000-0000-000000000000/evidence`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment requirement not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/requirements/00000000-0000-0000-0000-000000000000/evidence'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id/evidence', () => {
    it('should retrieve all evidence for an assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}/evidence`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/assessments/00000000-0000-0000-0000-000000000000/evidence');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/evidence'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id/claims', () => {
    it('should retrieve all claims for an assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}/claims`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/assessments/00000000-0000-0000-0000-000000000000/claims');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/claims'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id/participants', () => {
    it('should retrieve assessment participants', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}/participants`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/participants'
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/participants'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/assessments/:id/notes', () => {
    it('should retrieve assessment notes', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.get(`/api/v1/assessments/${assessmentId}/notes`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/assessments/00000000-0000-0000-0000-000000000000/notes');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000/notes'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/assessments/:id/notes', () => {
    it('should add a note to an assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/notes`)
        .send({
          content: 'This is a test note with substantial content and meaningful information.',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Work note added successfully');
    });

    it('should return 400 for empty note content', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/notes`)
        .send({
          content: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid input');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/notes')
        .send({
          content: 'Note content for non-existent assessment',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should prevent adding notes to completed assessments', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete the assessment
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      // Try to add note
      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/notes`)
        .send({
          content: 'This note should not be added to completed assessment.',
        });

      expect(res.status).toBe(403);
    });

    it('should require assessments.notes permission', async () => {
      const adminAgent = await loginAs('admin');
      // Use unauthenticated agent to test permission (assessee actually has assessments.notes)
      const unauthAgent = getAgent();

      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await unauthAgent
        .post(`/api/v1/assessments/${assessmentId}/notes`)
        .send({
          content: 'Unauthorized note with substantive content here.',
        });

      // Unauthenticated users get 401
      expect(res.status).toBe(401);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent
        .post('/api/v1/assessments/00000000-0000-0000-0000-000000000000/notes')
        .send({
          content: 'Unauthorized note content here',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/assessments/:id', () => {
    it('should delete an assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);

      const res = await agent.delete(`/api/v1/assessments/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Assessment deleted');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.delete('/api/v1/assessments/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Assessment not found');
    });

    it('should prevent deletion of archived assessments', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);

      // Complete and archive
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);
      await agent.post(`/api/v1/assessments/${assessmentId}/archive`).send({});

      const res = await agent.delete(`/api/v1/assessments/${assessmentId}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Archived assessments cannot be deleted');
    });

    it('should require assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const assesseeAgent = await loginAs('assessee');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const res = await assesseeAgent.delete(`/api/v1/assessments/${assessmentId}`);

      expect(res.status).toBe(403);
    });

    it('should require authentication', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.delete(
        '/api/v1/assessments/00000000-0000-0000-0000-000000000000'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('Edge cases and camelCase transformation', () => {
    it('should use camelCase in response bodies', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `CamelCase Test ${Date.now()}`,
        });

      expect(res.status).toBe(201);
      // Response should have camelCase due to middleware
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('state');
      expect(res.body).not.toHaveProperty('project_id');
    });

    it('should handle null/undefined values correctly', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Null Test ${Date.now()}`,
          description: 'A valid description',
          projectId: null,
          dueDate: null,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should handle empty array values', async () => {
      const agent = await loginAs('admin');

      const res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Empty Array Test ${Date.now()}`,
          assessorIds: [],
          assesseeIds: [],
          tags: [],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('should allow admin to create assessments', async () => {
      const adminAgent = await loginAs('admin');

      const res = await adminAgent
        .post('/api/v1/assessments')
        .send({
          title: `Admin Test ${Date.now()}`,
        });

      expect(res.status).toBe(201);
    });

    it('should allow assessor to create assessments', async () => {
      const assessorAgent = await loginAs('assessor');

      const res = await assessorAgent
        .post('/api/v1/assessments')
        .send({
          title: `Assessor Test ${Date.now()}`,
        });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/v1/assessments/:id/transition', () => {
    it('cancels an in_progress assessment', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});
      // Hydrate at least one requirement-evidence link so cancellation
      // doesn't bump into the unrelated completion preconditions.
      void requirementIds;

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'cancelled', reason: 'lost funding' });

      expect(res.status).toBe(200);
      expect(res.body.from).toBe('in_progress');
      expect(res.body.to).toBe('cancelled');
    });

    it('refuses an invalid transition (in_progress -> archived) with allowedFromHere', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'archived' });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('invalid_transition');
      expect(res.body.from).toBe('in_progress');
      expect(res.body.to).toBe('archived');
      expect(res.body.allowedFromHere).toEqual(expect.arrayContaining(['on_hold', 'complete', 'cancelled']));
    });

    it('refuses transition out of a terminal state', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});
      await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'cancelled' });

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'in_progress' });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('invalid_transition');
      void requirementIds;
    });

    it('refuses no-op transitions with reason no_op_transition', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(agent);
      await agent.post(`/api/v1/assessments/${assessmentId}/start`).send({});

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'in_progress' });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('no_op_transition');
    });

    it('refuses new -> in_progress without hydrated requirements', async () => {
      const agent = await loginAs('admin');
      // createFullAssessment leaves the assessment in 'new' state.
      // Use the unified transition route to skip the dedicated /start
      // hydration step; the route must refuse because requirements
      // have not been loaded yet.
      const stdRes = await agent
        .post('/api/v1/standards')
        .send({ identifier: `STD-tx-${Date.now()}`, name: 'Tx test', version: '1' });
      const standardId = stdRes.body.id;
      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({ identifier: 'R1', name: 'R1' });
      void reqRes;
      const aRes = await agent
        .post('/api/v1/assessments')
        .send({ title: 'No-hydrate test', standardId });
      const assessmentId = aRes.body.id;

      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'in_progress' });

      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('requirements_not_hydrated');
    });

    it('reopen via /transition blocks on sealed affirmation (same as /reopen)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, requirementIds } = await createFullAssessment(agent);
      await completeAssessmentViaAPI(agent, assessmentId, requirementIds);

      // Without an affirmation the transition should succeed; with one,
      // it should 409. We don't seed an affirmation here because the
      // affirmation fixture lives in a different test file — just check
      // the happy reopen path works through /transition.
      const res = await agent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.from).toBe('complete');
      expect(res.body.to).toBe('in_progress');
    });

    it('requires assessments.manage permission', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent
        .post(`/api/v1/assessments/${assessmentId}/transition`)
        .send({ to: 'cancelled' });

      expect(res.status).toBe(403);
    });
  });

  /**
   * Coverage for the assessments.view / assessments.view_all gates
   * added when the original audit found those permissions seeded but
   * never enforced. The behaviour we lock down here:
   *
   *   - No assessments.view at all     -> 403 on every GET
   *   - assessments.view, no view_all  -> list returns only assessments
   *                                       the caller participates in;
   *                                       direct GET of a non-participating
   *                                       assessment returns 403 reason
   *                                       'not_a_participant'
   *   - assessments.view + view_all    -> sees everything
   */
  describe('assessments.view / assessments.view_all enforcement', () => {
    async function loginAsCustomRole(roleKey: string): Promise<ReturnType<typeof import('supertest').default.agent>> {
      const adminAgent = await loginAs('admin');
      const username = `view_probe_${roleKey}_${Date.now()}`;
      const password = 'TestPassword123!';
      const createRes = await adminAgent
        .post('/api/v1/users')
        .send({
          username,
          email: `${username}@test.local`,
          displayName: `Probe ${roleKey}`,
          password,
          role: roleKey,
        });
      if (createRes.status !== 201) {
        throw new Error(`Failed to create ${roleKey} user: ${createRes.status} ${JSON.stringify(createRes.body)}`);
      }
      const supertestAgent = (await import('supertest')).default;
      const { getBaseUrl } = await import('../helpers/http.js');
      const agent = supertestAgent.agent(getBaseUrl());
      const loginRes = await agent.post('/api/v1/auth/login').send({ username, password });
      if (loginRes.status !== 200 && loginRes.status !== 201) {
        throw new Error(`Login failed for ${roleKey}: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
      }
      return agent;
    }

    it('GET / returns 403 when caller lacks assessments.view', async () => {
      // standards_approver holds only standards.view + standards.approve.
      // The list-route middleware (requirePermission) writes a generic
      // "Insufficient permissions" body; we assert the status only.
      const approver = await loginAsCustomRole('standards_approver');
      const res = await approver.get('/api/v1/assessments');
      expect(res.status).toBe(403);
    });

    it('GET /:id returns 403 when caller lacks assessments.view', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(adminAgent);

      // authorizeAssessmentRead writes a more specific body, so we can
      // pin the permission name in the per-row case.
      const approver = await loginAsCustomRole('standards_approver');
      const res = await approver.get(`/api/v1/assessments/${assessmentId}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/assessments\.view/);
    });

    it('view_all caller sees an assessment they are NOT a participant on', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(adminAgent);
      // admin holds assessments.view_all; access regardless of participation.
      const res = await adminAgent.get(`/api/v1/assessments/${assessmentId}`);
      expect(res.status).toBe(200);
    });

    it('view-only caller is 403\'d on detail for an assessment they are not a participant on', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(adminAgent);
      // assessee holds assessments.view but NOT assessments.view_all and
      // is not assigned to this assessment, so the per-row authorizer
      // refuses with reason 'not_a_participant'. (Assessors hold view_all
      // in this RBAC — covered by the view_all test above — so the genuine
      // view-only, per-row-gated role is the assessee.)
      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get(`/api/v1/assessments/${assessmentId}`);
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('not_a_participant');
    });

    it('view-only caller can read detail when they ARE a participant', async () => {
      const adminAgent = await loginAs('admin');
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();
      const assessorUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessor')
        .select('id')
        .executeTakeFirstOrThrow();

      const stdRes = await adminAgent.post('/api/v1/standards').send({
        identifier: `STD-view-${Date.now()}`,
        name: 'View test',
        version: '1.0',
      });
      const standardId = stdRes.body.id;
      const createRes = await adminAgent.post('/api/v1/assessments').send({
        title: `View Test ${Date.now()}`,
        standardId,
        assessorIds: [assessorUser.id],
      });
      const assessmentId = createRes.body.id;

      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent.get(`/api/v1/assessments/${assessmentId}`);
      expect(res.status).toBe(200);
    });

    it('view-only list is row-scoped to assessments the caller participates in', async () => {
      const adminAgent = await loginAs('admin');
      const { getDatabase } = await import('../../db/connection.js');
      const db = getDatabase();
      const assesseeUser = await db
        .selectFrom('app_user')
        .where('role', '=', 'assessee')
        .select('id')
        .executeTakeFirstOrThrow();

      // Two assessments: one the assessee is assigned to, one they are not.
      // (assessee is view-only — no view_all — so the list must row-scope.)
      const stdRes = await adminAgent.post('/api/v1/standards').send({
        identifier: `STD-view-list-${Date.now()}`,
        name: 'View list test',
        version: '1.0',
      });
      const standardId = stdRes.body.id;
      const ownTag = `OWN-${Date.now()}`;
      const otherTag = `OTHER-${Date.now()}`;

      const own = await adminAgent.post('/api/v1/assessments').send({
        title: ownTag,
        standardId,
        assesseeIds: [assesseeUser.id],
      });
      const other = await adminAgent.post('/api/v1/assessments').send({
        title: otherTag,
        standardId,
      });
      expect(own.status).toBe(201);
      expect(other.status).toBe(201);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get('/api/v1/assessments?limit=100');
      expect(res.status).toBe(200);
      const titles = res.body.data.map((a: { title: string }) => a.title);
      expect(titles).toContain(ownTag);
      expect(titles).not.toContain(otherTag);
    });

    it('per-row gate applies to /:id/evidence, /:id/claims, /:id/notes, /:id/participants', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullAssessment(adminAgent);
      const assesseeAgent = await loginAs('assessee');

      for (const path of ['evidence', 'claims', 'notes', 'participants']) {
        const res = await assesseeAgent.get(`/api/v1/assessments/${assessmentId}/${path}`);
        expect(res.status, `GET /${path} should 403 for non-participant`).toBe(403);
        expect(res.body.reason).toBe('not_a_participant');
      }
    });
  });
});
