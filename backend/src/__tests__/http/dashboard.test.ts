import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupHttpTests, getAgent, loginAs, createPersona } from '../helpers/http.js';

describe('Dashboard Routes (HTTP Integration)', () => {
  setupHttpTests();

  describe('GET /api/v1/dashboard/stats', () => {
    it('should return numeric stats when authenticated', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalProjects');
      expect(res.body).toHaveProperty('projectsInProgress');
      expect(res.body).toHaveProperty('totalAssessments');
      expect(res.body).toHaveProperty('assessmentsInProgress');
      expect(res.body).toHaveProperty('assessmentsComplete');
      expect(res.body).toHaveProperty('totalEvidence');
      expect(res.body).toHaveProperty('totalClaims');
      expect(res.body).toHaveProperty('totalAttestations');
      expect(res.body).toHaveProperty('totalStandards');
      expect(res.body).toHaveProperty('evidenceExpiringSoon');
      expect(res.body).toHaveProperty('assessmentsOverdue');
      expect(res.body).toHaveProperty('completionRate');
    });

    it('should return all properties as numbers', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(typeof res.body.totalProjects).toBe('number');
      expect(typeof res.body.projectsInProgress).toBe('number');
      expect(typeof res.body.totalAssessments).toBe('number');
      expect(typeof res.body.assessmentsInProgress).toBe('number');
      expect(typeof res.body.assessmentsComplete).toBe('number');
      expect(typeof res.body.totalEvidence).toBe('number');
      expect(typeof res.body.totalClaims).toBe('number');
      expect(typeof res.body.totalAttestations).toBe('number');
      expect(typeof res.body.totalStandards).toBe('number');
      expect(typeof res.body.evidenceExpiringSoon).toBe('number');
      expect(typeof res.body.assessmentsOverdue).toBe('number');
      expect(typeof res.body.completionRate).toBe('number');
    });

    it('should return non-negative values', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(res.body.totalProjects).toBeGreaterThanOrEqual(0);
      expect(res.body.projectsInProgress).toBeGreaterThanOrEqual(0);
      expect(res.body.totalAssessments).toBeGreaterThanOrEqual(0);
      expect(res.body.assessmentsInProgress).toBeGreaterThanOrEqual(0);
      expect(res.body.assessmentsComplete).toBeGreaterThanOrEqual(0);
      expect(res.body.totalEvidence).toBeGreaterThanOrEqual(0);
      expect(res.body.totalClaims).toBeGreaterThanOrEqual(0);
      expect(res.body.totalAttestations).toBeGreaterThanOrEqual(0);
      expect(res.body.totalStandards).toBeGreaterThanOrEqual(0);
      expect(res.body.evidenceExpiringSoon).toBeGreaterThanOrEqual(0);
      expect(res.body.assessmentsOverdue).toBeGreaterThanOrEqual(0);
      expect(res.body.completionRate).toBeGreaterThanOrEqual(0);
    });

    it('should have completionRate between 0-100', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(res.body.completionRate).toBeGreaterThanOrEqual(0);
      expect(res.body.completionRate).toBeLessThanOrEqual(100);
    });

    it('should be accessible to assessor role', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalProjects');
    });

    it('should be accessible to assessee role (scoped data, same shape)', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(200);
      expect(typeof res.body.totalProjects).toBe('number');
      expect(typeof res.body.completionRate).toBe('number');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/dashboard/stats');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/dashboard/recent-assessments', () => {
    it('should return array of recent assessments when authenticated', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return camelCase fields in response', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const assessment = res.body.data[0];
        // Check for camelCase fields
        if (assessment.projectName !== undefined) {
          expect(assessment).toHaveProperty('projectName');
          expect(assessment).not.toHaveProperty('project_name');
        }
        expect(assessment).toHaveProperty('dueDate');
        expect(assessment).toHaveProperty('createdAt');
        expect(assessment).not.toHaveProperty('due_date');
        expect(assessment).not.toHaveProperty('created_at');
      }
    });

    it('should limit results to 5 recent assessments', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should include required fields', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const assessment = res.body.data[0];
        expect(assessment).toHaveProperty('id');
        expect(assessment).toHaveProperty('title');
        expect(assessment).toHaveProperty('state');
      }
    });

    it('should be accessible to assessor role', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should be accessible to assessee role', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(401);
    });

    it('should handle empty results gracefully', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-assessments');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/dashboard/upcoming-due-dates', () => {
    it('should return array of upcoming assessments when authenticated', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should include overdue assessments flagged and sorted before upcoming ones', async () => {
      const agent = await loginAs('admin');

      // Fixtures: a project (needs a standard) with one overdue and one
      // far-future assessment. The deadline feed must surface both, flag
      // the past-due one, and sort it ahead of the future one.
      const suffix = Date.now();
      const standard = await agent
        .post('/api/v1/standards')
        .send({ identifier: `DUE-STD-${suffix}`, name: 'Due Date Standard', version: '1.0' });
      expect(standard.status).toBe(201);

      const project = await agent
        .post('/api/v1/projects')
        .send({ name: `Deadline Project ${suffix}`, standardIds: [standard.body.id] });
      expect(project.status).toBe(201);

      const overdue = await agent
        .post('/api/v1/assessments')
        .send({ title: `Overdue Assessment ${suffix}`, projectId: project.body.id, dueDate: '2020-06-15' });
      expect(overdue.status).toBe(201);

      // Near-future (not year 2999) so it stays inside the limited window
      // even if the shared test DB accumulates other due-dated rows.
      const soon = new Date();
      soon.setDate(soon.getDate() + 3);
      const future = await agent
        .post('/api/v1/assessments')
        .send({ title: `Future Assessment ${suffix}`, projectId: project.body.id, dueDate: soon.toISOString().slice(0, 10) });
      expect(future.status).toBe(201);

      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');
      expect(res.status).toBe(200);

      const overdueRow = res.body.data.find((a: any) => a.id === overdue.body.id);
      const futureRow = res.body.data.find((a: any) => a.id === future.body.id);

      expect(overdueRow).toBeDefined();
      expect(overdueRow.overdue).toBe(true);
      expect(overdueRow.daysUntilDue).toBeLessThan(0);

      expect(futureRow).toBeDefined();
      expect(futureRow.overdue).toBe(false);
      expect(futureRow.daysUntilDue).toBeGreaterThan(0);

      // Ascending order => the overdue row precedes the future row.
      const overdueIdx = res.body.data.findIndex((a: any) => a.id === overdue.body.id);
      const futureIdx = res.body.data.findIndex((a: any) => a.id === future.body.id);
      expect(overdueIdx).toBeLessThan(futureIdx);
    });

    it('should limit results to 20 assessments', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('should return camelCase fields in response', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const assessment = res.body.data[0];
        expect(assessment).toHaveProperty('daysUntilDue');
        expect(assessment).toHaveProperty('projectName');
        expect(assessment).not.toHaveProperty('days_until_due');
        expect(assessment).not.toHaveProperty('project_name');
      }
    });

    it('should include required fields', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const assessment = res.body.data[0];
        expect(assessment).toHaveProperty('id');
        expect(assessment).toHaveProperty('title');
        expect(assessment).toHaveProperty('dueDate');
        expect(assessment).toHaveProperty('state');
        expect(assessment).toHaveProperty('daysUntilDue');
        expect(assessment).toHaveProperty('overdue');
      }
    });

    it('should set the overdue flag to match the sign of daysUntilDue', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      res.body.data.forEach((assessment: any) => {
        expect(typeof assessment.daysUntilDue).toBe('number');
        expect(assessment.overdue).toBe(assessment.daysUntilDue < 0);
      });
    });

    it('should order results ascending by due date (overdue first)', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      const days = res.body.data.map((a: any) => a.daysUntilDue);
      const sorted = [...days].sort((x, y) => x - y);
      expect(days).toEqual(sorted);
    });

    it('should exclude complete, cancelled, and archived assessments', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      res.body.data.forEach((assessment: any) => {
        expect(assessment.state).not.toBe('complete');
        expect(assessment.state).not.toBe('cancelled');
        expect(assessment.state).not.toBe('archived');
      });
    });

    it('should be accessible to assessor role', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should be accessible to assessee role', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(401);
    });

    it('should handle empty results gracefully', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/upcoming-due-dates');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/dashboard/compliance-coverage', () => {
    it('should return array of compliance coverage data when authenticated', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return camelCase fields in response', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const coverage = res.body.data[0];
        expect(coverage).toHaveProperty('standardId');
        expect(coverage).toHaveProperty('standardName');
        expect(coverage).toHaveProperty('totalRequirements');
        expect(coverage).toHaveProperty('assessedRequirements');
        expect(coverage).toHaveProperty('coveragePercent');
        expect(coverage).not.toHaveProperty('standard_id');
        expect(coverage).not.toHaveProperty('standard_name');
        expect(coverage).not.toHaveProperty('total_requirements');
        expect(coverage).not.toHaveProperty('assessed_requirements');
        expect(coverage).not.toHaveProperty('coverage_percent');
      }
    });

    it('should include required fields', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const coverage = res.body.data[0];
        expect(coverage).toHaveProperty('standardId');
        expect(coverage).toHaveProperty('standardName');
        expect(coverage).toHaveProperty('version');
        expect(coverage).toHaveProperty('totalRequirements');
        expect(coverage).toHaveProperty('assessedRequirements');
        expect(coverage).toHaveProperty('coveragePercent');
      }
    });

    it('should have numeric values for coverage metrics', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      res.body.data.forEach((coverage: any) => {
        expect(typeof coverage.totalRequirements).toBe('number');
        expect(typeof coverage.assessedRequirements).toBe('number');
        expect(typeof coverage.coveragePercent).toBe('number');
      });
    });

    it('should have coveragePercent between 0-100', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      res.body.data.forEach((coverage: any) => {
        expect(coverage.coveragePercent).toBeGreaterThanOrEqual(0);
        expect(coverage.coveragePercent).toBeLessThanOrEqual(100);
      });
    });

    it('should have assessedRequirements <= totalRequirements', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      res.body.data.forEach((coverage: any) => {
        expect(coverage.assessedRequirements).toBeLessThanOrEqual(coverage.totalRequirements);
      });
    });

    it('should be accessible to assessor role', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should be accessible to assessee role', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(401);
    });

    it('should handle empty results gracefully', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/compliance-coverage');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/dashboard/recent-activity', () => {
    const DOMAIN_ENTITY_TYPES = [
      'project', 'assessment', 'claim', 'evidence',
      'mitigation', 'attestation', 'standard', 'entity',
    ];
    const DOMAIN_ACTIONS = [
      'create', 'create_for_other', 'update', 'delete',
      'state_change', 'link', 'unlink',
    ];

    it('should return array of activity items when authenticated', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-activity');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should surface a domain mutation with enriched names', async () => {
      const agent = await loginAs('admin');
      const standard = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `ACT-STD-${Date.now()}`,
          name: 'Activity Feed Standard',
          version: '1.0',
        });
      expect(standard.status).toBe(201);

      const created = await agent
        .post('/api/v1/projects')
        .send({ name: 'Activity Feed Probe', standardIds: [standard.body.id] });
      expect(created.status).toBe(201);

      const res = await agent.get('/api/v1/dashboard/recent-activity');
      expect(res.status).toBe(200);

      const entry = res.body.data.find(
        (item: any) => item.entityType === 'project' && item.entityId === created.body.id,
      );
      expect(entry).toBeDefined();
      expect(entry.action).toBe('create');
      expect(entry.entityName).toBe('Activity Feed Probe');
      expect(entry.userName).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
    });

    it('should only contain whitelisted domain entity types and actions', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-activity');

      expect(res.status).toBe(200);
      res.body.data.forEach((item: any) => {
        expect(DOMAIN_ENTITY_TYPES).toContain(item.entityType);
        expect(DOMAIN_ACTIONS).toContain(item.action);
      });
    });

    it('should respect the limit query parameter', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-activity?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should fall back to the default limit on invalid input', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/dashboard/recent-activity?limit=banana');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('should be accessible to assessor role', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/dashboard/recent-activity');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should be accessible to assessee role', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.get('/api/v1/dashboard/recent-activity');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 for unauthenticated requests', async () => {
      const agent = getAgent();
      const res = await agent.get('/api/v1/dashboard/recent-activity');

      expect(res.status).toBe(401);
    });
  });

  // Security review Z6: aggregates for callers without assessments.view_all
  // are computed only over the assessments they participate in.
  describe('aggregate scoping (security review Z6)', () => {
    const suffix = Date.now();
    const titleA = `Z6 In-Scope Assessment ${suffix}`;
    const titleB = `Z6 Out-Of-Scope Assessment ${suffix}`;
    let assessmentA: string;
    let assessmentB: string;
    let assigned: Awaited<ReturnType<typeof createPersona>>;
    let outsider: Awaited<ReturnType<typeof createPersona>>;

    const db = async () => (await import('../../db/connection.js')).getDatabase();
    const soon = () => {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      return d.toISOString().slice(0, 10);
    };

    beforeAll(async () => {
      const admin = await loginAs('admin');
      const standard = await admin
        .post('/api/v1/standards')
        .send({ identifier: `Z6-STD-${suffix}`, name: 'Z6 Standard', version: '1.0' });
      expect(standard.status).toBe(201);
      const project = await admin
        .post('/api/v1/projects')
        .send({ name: `Z6 Project ${suffix}`, standardIds: [standard.body.id] });
      expect(project.status).toBe(201);

      const a = await admin
        .post('/api/v1/assessments')
        .send({ title: titleA, projectId: project.body.id, dueDate: soon() });
      expect(a.status).toBe(201);
      assessmentA = a.body.id;

      // B is overdue so the old code also leaked its title via /risk-insights.
      const b = await admin
        .post('/api/v1/assessments')
        .send({ title: titleB, projectId: project.body.id, dueDate: '2020-01-15' });
      expect(b.status).toBe(201);
      assessmentB = b.body.id;

      assigned = await createPersona('assessee', 'z6_assigned');
      outsider = await createPersona('assessee', 'z6_outsider');

      const conn = await db();
      await conn.insertInto('assessment_assessee')
        .values({ assessment_id: assessmentA, user_id: assigned.id, created_at: new Date() })
        .execute();

      // Org-wide rows that no assessee above can reach.
      const admins = await conn.selectFrom('app_user').select('id').where('role', '=', 'admin').limit(1).execute();
      await conn.insertInto('evidence').values({
        id: uuidv4(), name: `Z6 Evidence ${suffix}`, description: 'z6', state: 'in_review', author_id: admins[0].id,
      } as any).execute();
      await conn.insertInto('claim').values({
        id: uuidv4(), name: `Z6 Claim ${suffix}`, target: 't', predicate: 'p',
        is_counter_claim: true, status: 'Under Review',
      } as any).execute();
      await conn.insertInto('mitigation').values({
        id: uuidv4(), title: `Z6 Mitigation ${suffix}`, type: 'Technical', priority: 'High',
        status: 'Proposed', target_date: '2020-01-01',
      } as any).execute();
    });

    it('an assessee with no assessments gets zero counts and no titles', async () => {
      const { agent } = outsider;

      const stats = await agent.get('/api/v1/dashboard/stats');
      expect(stats.status).toBe(200);
      expect(stats.body).toMatchObject({
        totalProjects: 0,
        projectsInProgress: 0,
        totalAssessments: 0,
        assessmentsInProgress: 0,
        assessmentsComplete: 0,
        totalEvidence: 0,
        totalClaims: 0,
        totalAttestations: 0,
        evidenceExpiringSoon: 0,
        assessmentsOverdue: 0,
        completionRate: 0,
      });

      for (const path of ['recent-assessments', 'upcoming-due-dates', 'project-health', 'risk-insights']) {
        const res = await agent.get(`/api/v1/dashboard/${path}`);
        expect(res.status, path).toBe(200);
        expect(res.body.data, path).toEqual([]);
      }

      const cm = await agent.get('/api/v1/dashboard/claims-mitigations');
      expect(cm.status).toBe(200);
      expect(cm.body.claims.total).toBe(0);
      expect(cm.body.claims.counterClaims).toBe(0);
      expect(cm.body.mitigations.total).toBe(0);
      expect(cm.body.evidence).toEqual({ inReview: 0, inProgress: 0, claimed: 0, expired: 0 });
      expect(cm.body.requirements).toEqual({ attested: 0, claimed: 0, mitigated: 0, attestations: 0 });
      expect(cm.body.attention.claimsUnderReview).toEqual([]);
      expect(cm.body.attention.evidenceUnderReview).toEqual([]);
      expect(cm.body.attention.counterClaims).toEqual([]);
      expect(cm.body.attention.overdueMitigations).toEqual([]);
      expect(cm.body.attention.recentlyClosed).toEqual([]);
    });

    it('an assigned assessee sees only their own assessment in the lists', async () => {
      const { agent } = assigned;

      const recent = await agent.get('/api/v1/dashboard/recent-assessments');
      expect(recent.status).toBe(200);
      expect(recent.body.data.map((a: any) => a.title)).toEqual([titleA]);

      const due = await agent.get('/api/v1/dashboard/upcoming-due-dates');
      expect(due.status).toBe(200);
      expect(due.body.data.map((a: any) => a.title)).toEqual([titleA]);

      const stats = await agent.get('/api/v1/dashboard/stats');
      expect(stats.body.totalAssessments).toBe(1);
      expect(stats.body.totalProjects).toBe(1);
      expect(stats.body.assessmentsOverdue).toBe(0);

      const health = await agent.get('/api/v1/dashboard/project-health');
      expect(health.body.data).toHaveLength(1);
      expect(health.body.data[0].totalAssessments).toBe(1);
      expect(health.body.data[0].overdueAssessments).toBe(0);

      const risks = await agent.get('/api/v1/dashboard/risk-insights');
      expect(JSON.stringify(risks.body.data)).not.toContain(titleB);
    });

    it("/recent-activity hides an admin's action on an out-of-scope assessment", async () => {
      for (const persona of [assigned, outsider]) {
        const res = await persona.agent.get('/api/v1/dashboard/recent-activity?limit=50');
        expect(res.status).toBe(200);
        const ids = res.body.data.map((r: any) => r.entityId);
        expect(ids).not.toContain(assessmentB);
        res.body.data.forEach((r: any) => {
          expect(r.entityName).not.toBe(titleB);
        });
      }

      // The admin's action on the assessee's own assessment is still visible.
      const mine = await assigned.agent.get('/api/v1/dashboard/recent-activity?limit=50');
      expect(mine.body.data.map((r: any) => r.entityId)).toContain(assessmentA);
    });

    it('admin and assessor still get org-wide results', async () => {
      const conn = await db();
      const countOf = async (table: 'assessment' | 'project' | 'claim' | 'mitigation' | 'evidence') =>
        Number((await conn.selectFrom(table).select(conn.fn.count<number>('id').as('c')).executeTakeFirstOrThrow()).c);

      for (const role of ['admin', 'assessor'] as const) {
        const agent = await loginAs(role);

        const stats = await agent.get('/api/v1/dashboard/stats');
        expect(stats.status).toBe(200);
        expect(stats.body.totalAssessments, role).toBe(await countOf('assessment'));
        expect(stats.body.totalProjects, role).toBe(await countOf('project'));
        expect(stats.body.totalEvidence, role).toBe(await countOf('evidence'));
        expect(stats.body.totalClaims, role).toBe(await countOf('claim'));

        const recent = await agent.get('/api/v1/dashboard/recent-assessments');
        const titles = recent.body.data.map((a: any) => a.title);
        expect(titles, role).toContain(titleA);
        expect(titles, role).toContain(titleB);

        const risks = await agent.get('/api/v1/dashboard/risk-insights');
        expect(JSON.stringify(risks.body.data), role).toContain(titleB);

        const cm = await agent.get('/api/v1/dashboard/claims-mitigations');
        expect(cm.body.claims.total, role).toBe(await countOf('claim'));
        expect(cm.body.mitigations.total, role).toBe(await countOf('mitigation'));

        const activity = await agent.get('/api/v1/dashboard/recent-activity?limit=50');
        expect(activity.body.data.map((r: any) => r.entityId), role).toContain(assessmentB);
      }
    });
  });

  describe('approved evidence no claim cites', () => {
    const db = async () => (await import('../../db/connection.js')).getDatabase();
    const suffix = Date.now();

    async function evidence(state: string, name: string): Promise<string> {
      const conn = await db();
      const admins = await conn.selectFrom('app_user').select('id').where('role', '=', 'admin').limit(1).execute();
      const id = uuidv4();
      await conn.insertInto('evidence').values({ id, name: `${name} ${suffix}`, state, author_id: admins[0].id } as any).execute();
      return id;
    }
    async function claim(): Promise<string> {
      const id = uuidv4();
      await (await db()).insertInto('claim').values({
        id, name: `Uncited fixture claim ${uuidv4()}`, target: 't', predicate: 'p', is_counter_claim: false,
      } as any).execute();
      return id;
    }
    async function uncitedCount(): Promise<number> {
      const res = await (await loginAs('admin')).get('/api/v1/dashboard/stats');
      expect(res.status).toBe(200);
      return res.body.evidenceUncited;
    }

    it('counts claimed evidence with no supporting, counter or mitigation link', async () => {
      const before = await uncitedCount();
      const conn = await db();

      const uncited = await evidence('claimed', 'Uncited approved');
      await evidence('in_progress', 'Uncited draft');
      const supporting = await evidence('claimed', 'Supporting');
      const counter = await evidence('claimed', 'Counter');
      await conn.insertInto('claim_evidence').values({ claim_id: await claim(), evidence_id: supporting } as any).execute();
      await conn.insertInto('claim_counter_evidence').values({ claim_id: await claim(), evidence_id: counter } as any).execute();

      expect(await uncitedCount()).toBe(before + 1);

      await conn.insertInto('claim_mitigation_strategy').values({ claim_id: await claim(), evidence_id: uncited } as any).execute();
      expect(await uncitedCount()).toBe(before);
    });

    it('raises a low-severity gap insight while any remain, after the critical ones', async () => {
      await evidence('claimed', 'Uncited for insight');
      // A long-overdue assessment yields a critical insight to sort against.
      const admin = await loginAs('admin');
      const standard = await admin.post('/api/v1/standards')
        .send({ identifier: `UNCITED-STD-${suffix}`, name: 'Uncited Standard', version: '1.0' });
      const project = await admin.post('/api/v1/projects')
        .send({ name: `Uncited Project ${suffix}`, standardIds: [standard.body.id] });
      const overdue = await admin.post('/api/v1/assessments')
        .send({ title: `Uncited Overdue ${suffix}`, projectId: project.body.id, dueDate: '2020-01-15' });
      expect(overdue.status).toBe(201);

      const res = await admin.get('/api/v1/dashboard/risk-insights');
      expect(res.status).toBe(200);

      const insight = res.body.data.find((i: any) => /not cited by any claim/.test(i.title));
      expect(insight).toMatchObject({ type: 'gap', severity: 'low' });

      expect(res.body.data[0].severity).toBe('critical');
      // Critical sorts first: a rank of 0 must not fall through to "unknown".
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const ranks = res.body.data.map((i: any) => rank[i.severity]);
      expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));
    });
  });
});
