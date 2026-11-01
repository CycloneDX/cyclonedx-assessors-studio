/**
 * Security regression tests: object-level authorization (security review
 * Z1-Z5, Z7-Z13). Dashboard scoping (Z6) lives in dashboard.test.ts.
 *
 * Fixture: assessment A (project PA, entity EA) with an assigned assessor
 * and an assigned assessee; assessment B nobody here is assigned to.
 * "Outsider" personas hold the same role but no assignment.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupHttpTests, loginAs, createPersona, testUsers } from '../helpers/http.js';

type Persona = Awaited<ReturnType<typeof createPersona>>;

interface Fixture {
  projectA: string;
  entityA: string;
  assessmentA: string;
  assessmentB: string;
  attestationA: string;
  claimA: string;
  evidenceInsider: string;
  evidenceOther: string;
  mitigation: string;
  schedule: string;
  insiderAssessor: Persona;
  outsiderAssessor: Persona;
  insiderAssessee: Persona;
  outsiderAssessee: Persona;
  standardsManager: Persona;
}

let fx: Fixture;

async function buildFixture(): Promise<Fixture> {
  const { getDatabase } = await import('../../db/connection.js');
  const db = getDatabase();
  const [insiderAssessor, outsiderAssessor, insiderAssessee, outsiderAssessee, standardsManager] = await Promise.all([
    createPersona('assessor', 'in_assessor'),
    createPersona('assessor', 'out_assessor'),
    createPersona('assessee', 'in_assessee'),
    createPersona('assessee', 'out_assessee'),
    createPersona('standards_manager', 'std_mgr'),
  ]);
  const projectA = uuidv4();
  const entityA = uuidv4();
  const assessmentA = uuidv4();
  const assessmentB = uuidv4();
  const attestationA = uuidv4();
  const claimA = uuidv4();
  const evidenceInsider = uuidv4();
  const evidenceOther = uuidv4();
  const mitigation = uuidv4();
  const schedule = uuidv4();
  await db.insertInto('project').values({ id: projectA, name: 'Authz Project A', description: 'x', state: 'new' }).execute();
  await db.insertInto('entity').values({ id: entityA, name: `Authz Entity ${entityA.slice(0, 6)}`, entity_type: 'team', bom_ref: `team-${entityA.slice(0, 8)}` } as never).execute();
  await db.insertInto('assessment').values([
    { id: assessmentA, title: 'Authz Assessment A', description: 'x', project_id: projectA, entity_id: entityA, state: 'in_progress' },
    { id: assessmentB, title: 'Authz Assessment B (secret)', description: 'x', project_id: projectA, entity_id: entityA, state: 'in_progress' },
  ] as never).execute();
  await db.insertInto('assessment_assessor').values({ assessment_id: assessmentA, user_id: insiderAssessor.id, created_at: new Date() }).execute();
  await db.insertInto('assessment_assessee').values({ assessment_id: assessmentA, user_id: insiderAssessee.id, created_at: new Date() }).execute();
  await db.insertInto('attestation').values({ id: attestationA, assessment_id: assessmentA, summary: 'Authz attestation' } as never).execute();
  await db.insertInto('claim').values({ id: claimA, name: 'Authz claim', target: 't', predicate: 'p', attestation_id: attestationA } as never).execute();
  await db.insertInto('evidence').values([
    { id: evidenceInsider, name: 'Insider evidence', description: 'x', state: 'in_progress', author_id: insiderAssessee.id },
    { id: evidenceOther, name: 'Someone else evidence', description: 'x', state: 'in_progress', author_id: testUsers.admin.id },
  ] as never).execute();
  await db.insertInto('assessment_evidence').values([
    { assessment_id: assessmentA, evidence_id: evidenceInsider },
    { assessment_id: assessmentA, evidence_id: evidenceOther },
  ] as never).execute();
  await db.insertInto('claim_evidence').values({ claim_id: claimA, evidence_id: evidenceOther } as never).execute();
  await db.insertInto('mitigation').values({ id: mitigation, title: 'Authz mitigation', type: 'Process', priority: 'High' } as never).execute();
  await db.insertInto('scheduled_assessment').values({ id: schedule, title: 'Authz schedule', scheduled_date: new Date(), created_by: testUsers.admin.id } as never).execute();
  return {
    projectA, entityA, assessmentA, assessmentB, attestationA, claimA, evidenceInsider, evidenceOther,
    mitigation, schedule, insiderAssessor, outsiderAssessor, insiderAssessee, outsiderAssessee, standardsManager,
  };
}

describe('Authorization hardening (security review)', () => {
  setupHttpTests();
  beforeAll(async () => {
    fx = await buildFixture();
  });

  describe('Z8 assessment writes need assignment, not view_all', () => {
    it('refuses an outsider assessor adding themselves to an assessment', async () => {
      const res = await fx.outsiderAssessor.agent.put(`/api/v1/assessments/${fx.assessmentA}`)
        .send({ assessorIds: [fx.outsiderAssessor.id] });
      expect(res.status).toBe(403);
    });

    it('refuses an outsider assessor linking evidence to the assessment', async () => {
      const res = await fx.outsiderAssessor.agent.post(`/api/v1/assessments/${fx.assessmentA}/evidence/link`)
        .send({ evidenceId: fx.evidenceOther });
      expect(res.status).toBe(403);
    });

    it('lets the assigned assessor edit', async () => {
      const res = await fx.insiderAssessor.agent.put(`/api/v1/assessments/${fx.assessmentA}`)
        .send({ description: 'edited by the assigned assessor' });
      expect(res.status).toBe(200);
    });

    it('assigns a non-admin creator to the assessment they create', async () => {
      const res = await fx.outsiderAssessor.agent.post('/api/v1/assessments')
        .send({ title: 'Created by assessor', projectId: fx.projectA });
      expect(res.status).toBe(201);
      const edit = await fx.outsiderAssessor.agent.put(`/api/v1/assessments/${res.body.id ?? res.body.assessment?.id}`)
        .send({ description: 'creator can still edit' });
      expect(edit.status).toBe(200);
    });
  });

  describe('Z9 notes', () => {
    it('refuses notes from an assessee outside the assessment', async () => {
      const res = await fx.outsiderAssessee.agent.post(`/api/v1/assessments/${fx.assessmentA}/notes`).send({ content: 'hi' });
      expect(res.status).toBe(403);
    });
  });

  describe('Z12 evidence through assessment lists', () => {
    it("does not show a participant assessee other people's evidence", async () => {
      const res = await fx.insiderAssessee.agent.get(`/api/v1/assessments/${fx.assessmentA}/evidence`);
      expect(res.status).toBe(200);
      const ids = (res.body.data as { id: string }[]).map((e) => e.id);
      expect(ids).toContain(fx.evidenceInsider);
      expect(ids).not.toContain(fx.evidenceOther);
    });
  });

  describe('Z1 mitigations', () => {
    it('refuses edits and deletes from roles without claims.edit', async () => {
      expect((await fx.standardsManager.agent.put(`/api/v1/mitigations/${fx.mitigation}`).send({ title: 'pwned', type: 'Process', priority: 'Low' })).status).toBe(403);
      expect((await fx.insiderAssessee.agent.delete(`/api/v1/mitigations/${fx.mitigation}`)).status).toBe(403);
      expect((await fx.standardsManager.agent.get('/api/v1/mitigations')).status).toBe(403);
    });

    it('keeps the audit log for auditors', async () => {
      expect((await fx.insiderAssessor.agent.get(`/api/v1/mitigations/${fx.mitigation}/audit`)).status).toBe(403);
    });
  });

  describe('Z2 claim link routes', () => {
    it('refuses unlinking evidence without claims.edit or participation', async () => {
      expect((await fx.insiderAssessee.agent.delete(`/api/v1/claims/${fx.claimA}/evidence/${fx.evidenceOther}`)).status).toBe(403);
      expect((await fx.standardsManager.agent.delete(`/api/v1/claims/${fx.claimA}/evidence/${fx.evidenceOther}`)).status).toBe(403);
      expect((await fx.outsiderAssessor.agent.delete(`/api/v1/claims/${fx.claimA}/evidence/${fx.evidenceOther}`)).status).toBe(403);
    });
  });

  describe('Z3 attestations', () => {
    it('hides attestations outside the caller scope', async () => {
      const list = await fx.outsiderAssessee.agent.get('/api/v1/attestations');
      expect(list.status).toBe(200);
      expect((list.body.data as { id: string }[]).map((a) => a.id)).not.toContain(fx.attestationA);
      expect((await fx.outsiderAssessee.agent.get(`/api/v1/attestations/${fx.attestationA}`)).status).toBe(404);
      expect((await fx.standardsManager.agent.get('/api/v1/attestations')).status).toBe(403);
    });

    it('shows them to participants', async () => {
      expect((await fx.insiderAssessee.agent.get(`/api/v1/attestations/${fx.attestationA}`)).status).toBe(200);
    });

    it('refuses attestation edits from an outsider assessor', async () => {
      expect((await fx.outsiderAssessor.agent.put(`/api/v1/attestations/${fx.attestationA}`).send({ summary: 'x' })).status).toBe(403);
    });
  });

  describe('Z4 entity assessment listings', () => {
    it('lists only readable assessments and refuses roles without assessments.view', async () => {
      const out = await fx.outsiderAssessee.agent.get(`/api/v1/entities/${fx.entityA}/assessments`);
      expect(out.status).toBe(200);
      expect(out.body.data).toHaveLength(0);
      const inside = await fx.insiderAssessee.agent.get(`/api/v1/entities/${fx.entityA}/assessments`);
      expect((inside.body.data as { id: string }[]).map((a) => a.id)).toEqual([fx.assessmentA]);
      expect((await fx.standardsManager.agent.get(`/api/v1/entities/${fx.entityA}/assessments`)).status).toBe(403);
    });
  });

  describe('Z5 projects', () => {
    it('treats out-of-scope projects as missing', async () => {
      expect((await fx.outsiderAssessee.agent.get(`/api/v1/projects/${fx.projectA}`)).status).toBe(404);
      expect((await fx.outsiderAssessee.agent.get(`/api/v1/projects/${fx.projectA}/stats`)).status).toBe(404);
      expect((await fx.insiderAssessee.agent.get(`/api/v1/projects/${fx.projectA}`)).status).toBe(200);
    });
  });

  describe('Z7 scheduler', () => {
    it('refuses writes without assessments.manage, and from non-owners', async () => {
      expect((await fx.insiderAssessee.agent.delete(`/api/v1/scheduler/${fx.schedule}`)).status).toBe(403);
      expect((await fx.outsiderAssessor.agent.delete(`/api/v1/scheduler/${fx.schedule}`)).status).toBe(403);
    });
  });

  describe('Z10 personal notification rules', () => {
    it('refuses a wildcard subscription', async () => {
      const res = await fx.outsiderAssessee.agent.post('/api/v1/notification-rules')
        .send({ name: 'everything', channel: 'in_app', eventTypes: ['*'] });
      expect(res.status).toBe(400);
    });
  });

  describe('Z11 evidence ownership', () => {
    it("refuses an outsider assessor editing someone else's evidence", async () => {
      const res = await fx.outsiderAssessor.agent.put(`/api/v1/evidence/${fx.evidenceInsider}`).send({ name: 'hijacked' });
      expect(res.status).toBe(404);
    });
  });

  describe('Z13 administrators', () => {
    it('refuses an admin changing their own role', async () => {
      const admin = await loginAs('admin');
      const res = await admin.put(`/api/v1/users/${testUsers.admin.id}`).send({ role: 'assessee' });
      expect(res.status).toBe(400);
    });
  });
});
