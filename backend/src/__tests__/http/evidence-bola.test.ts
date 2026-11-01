/**
 * Regression tests for Sprint 4 F01 / F02 (evidence BOLA).
 *
 * F01: Non-participants could read any evidence and its claim linkage
 *      via GET /api/v1/evidence/:id and GET /api/v1/evidence/:id/claims,
 *      and could download attachment binaries. Fix requires participant
 *      or view-all check in each route.
 *
 * F02: Non-participants with the evidence.edit or evidence.delete
 *      permission could attach or delete binaries on evidence they had
 *      no relationship to. Fix requires participant or view-all check
 *      in POST and DELETE attachment routes.
 *
 * These tests drive the routes end-to-end via supertest to guarantee the
 * fix stays in place even if the helper is refactored. Database-level
 * assertions in evidence-authorization.test.ts complement these by
 * verifying the underlying schema and helper semantics.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  setupHttpTests,
  getAgent,
  getBaseUrl,
  loginAs,
  testUsers,
} from '../helpers/http.js';
import supertest from 'supertest';

// Shared fixtures created once to avoid churning the DB per test.
interface Fixtures {
  outsiderUser: { id: string; username: string; password: string };
  insiderUser: { id: string; username: string; password: string };
  evidenceId: string;
  attachmentId: string;
  assessmentId: string;
}

let fixtures: Fixtures;

async function seedFixtures(): Promise<Fixtures> {
  const { getDatabase } = await import('../../db/connection.js');
  const { hashPassword } = await import('../../utils/crypto.js');
  const db = getDatabase();

  // Two fresh assessee users beyond the shared ones in testUsers.
  const outsiderId = uuidv4();
  const insiderId = uuidv4();
  const password = 'Password123!';
  const passwordHash = await hashPassword(password);
  const outsiderUsername = `bola_outsider_${Date.now()}`;
  const insiderUsername = `bola_insider_${Date.now()}`;

  await db.insertInto('app_user').values([
    {
      id: outsiderId,
      username: outsiderUsername,
      email: `${outsiderUsername}@test.local`,
      password_hash: passwordHash,
      display_name: 'Outsider',
      role: 'assessee',
      is_active: true,
    },
    {
      id: insiderId,
      username: insiderUsername,
      email: `${insiderUsername}@test.local`,
      password_hash: passwordHash,
      display_name: 'Insider',
      role: 'assessee',
      is_active: true,
    },
  ]).execute();

  // Author the evidence as a third party (the admin). Neither the
  // outsider nor insider is the author.
  const adminUser = testUsers.admin;
  const evidenceId = uuidv4();
  await db.insertInto('evidence').values({
    id: evidenceId,
    name: 'BOLA fixture evidence',
    description: 'Regression fixture for F01/F02',
    state: 'in_progress',
    author_id: adminUser.id,
    is_counter_evidence: false,
  }).execute();

  // A minimal assessment chain so the insider can be linked via
  // assessment_requirement_evidence.
  const projectId = uuidv4();
  await db.insertInto('project').values({
    id: projectId,
    name: 'BOLA fixture project',
    state: 'in_progress',
    workflow_type: 'evidence_driven',
  }).execute();

  const assessmentId = uuidv4();
  await db.insertInto('assessment').values({
    id: assessmentId,
    title: 'BOLA fixture assessment',
    state: 'in_progress',
    project_id: projectId,
  }).execute();

  // Insider is an assessee on the assessment. Outsider is not.
  await db.insertInto('assessment_assessee').values({
    assessment_id: assessmentId,
    user_id: insiderId,
    created_at: new Date(),
  }).execute();

  const standardId = uuidv4();
  await db.insertInto('standard').values({
    id: standardId,
    identifier: `STD-BOLA-${Date.now()}`,
    name: 'BOLA fixture standard',
    state: 'published',
    is_imported: false,
  }).execute();

  const requirementId = uuidv4();
  await db.insertInto('requirement').values({
    id: requirementId,
    identifier: `R-BOLA-${Date.now()}`,
    name: 'BOLA fixture requirement',
    standard_id: standardId,
  }).execute();

  const assessmentRequirementId = uuidv4();
  await db.insertInto('assessment_requirement').values({
    id: assessmentRequirementId,
    assessment_id: assessmentId,
    requirement_id: requirementId,
  }).execute();

  await db.insertInto('assessment_requirement_evidence').values({
    assessment_requirement_id: assessmentRequirementId,
    evidence_id: evidenceId,
    created_at: new Date(),
  }).execute();

  // One attachment for the download + delete tests.
  const attachmentId = uuidv4();
  await db.insertInto('evidence_attachment').values({
    id: attachmentId,
    evidence_id: evidenceId,
    filename: 'fixture.txt',
    content_type: 'text/plain',
    size_bytes: 5,
    storage_path: null,
    storage_provider: 'database',
    binary_content: Buffer.from('hello'),
  }).execute();

  return {
    outsiderUser: { id: outsiderId, username: outsiderUsername, password },
    insiderUser: { id: insiderId, username: insiderUsername, password },
    evidenceId,
    attachmentId,
    assessmentId,
  };
}

async function loginAsUsername(username: string, password: string): Promise<ReturnType<typeof supertest.agent>> {
  const agent = supertest.agent(getBaseUrl());
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ username, password });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

describe('Evidence BOLA regressions (F01 / F02)', () => {
  setupHttpTests();

  beforeAll(async () => {
    fixtures = await seedFixtures();
  });

  describe('F01: evidence read authorization', () => {
    it('returns 401 for unauthenticated GET /evidence/:id', async () => {
      const res = await getAgent().get(`/api/v1/evidence/${fixtures.evidenceId}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 to an outsider on GET /evidence/:id', async () => {
      const agent = await loginAsUsername(fixtures.outsiderUser.username, fixtures.outsiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 to a participant who is neither author nor reviewer (participation no longer grants evidence visibility)', async () => {
      // Least-privilege policy: a non-view_all caller (assessee) sees only
      // evidence they authored or were assigned to review. The insider here is
      // an assessee on the assessment but not the author (admin is), so
      // participation alone must not expose the evidence.
      const agent = await loginAsUsername(fixtures.insiderUser.username, fixtures.insiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}`);
      expect(res.status).toBe(404);
    });

    it('returns 200 to admin via evidence.view_all permission', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}`);
      expect(res.status).toBe(200);
    });

    it('returns 404 to an outsider on GET /evidence/:id/claims', async () => {
      const agent = await loginAsUsername(fixtures.outsiderUser.username, fixtures.outsiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}/claims`);
      expect(res.status).toBe(404);
    });

    it('returns 404 to a non-author/non-reviewer participant on GET /evidence/:id/claims', async () => {
      const agent = await loginAsUsername(fixtures.insiderUser.username, fixtures.insiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}/claims`);
      expect(res.status).toBe(404);
    });

    it('returns 404 to an outsider on GET /evidence/:id/attachments/:attId/download', async () => {
      const agent = await loginAsUsername(fixtures.outsiderUser.username, fixtures.outsiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}/attachments/${fixtures.attachmentId}/download`);
      expect(res.status).toBe(404);
    });

    it('returns 404 to a non-author/non-reviewer participant on the attachment download', async () => {
      const agent = await loginAsUsername(fixtures.insiderUser.username, fixtures.insiderUser.password);
      const res = await agent.get(`/api/v1/evidence/${fixtures.evidenceId}/attachments/${fixtures.attachmentId}/download`);
      expect(res.status).toBe(404);
    });
  });

  describe('F02: attachment write authorization', () => {
    it('returns 403 to an assessee outsider on POST attachment because evidence.edit is missing', async () => {
      // Assessee role lacks evidence.edit, so the permission gate fires
      // first; the point of this assertion is that the gate does NOT
      // allow write-through on unrelated evidence.
      const agent = await loginAsUsername(fixtures.outsiderUser.username, fixtures.outsiderUser.password);
      const res = await agent
        .post(`/api/v1/evidence/${fixtures.evidenceId}/attachments`)
        .send({ filename: 'bola.txt', contentType: 'text/plain', binaryContent: Buffer.from('x').toString('base64') });
      // 403 is the permission layer speaking; either way the write must
      // not succeed for an outsider.
      expect(res.status === 403 || res.status === 404).toBe(true);
    });

    it('returns 404 to an assessor outsider on POST attachment (holds evidence.edit but no link)', async () => {
      // Borrow the shared assessor user, which has evidence.edit but is
      // not linked to this assessment; the participant check must block.
      const agent = await loginAs('assessor');
      const res = await agent
        .post(`/api/v1/evidence/${fixtures.evidenceId}/attachments`)
        .send({ filename: 'bola.txt', contentType: 'text/plain', binaryContent: Buffer.from('x').toString('base64') });
      expect(res.status).toBe(404);
    });

    it('blocks an assessor outsider from DELETE attachment', async () => {
      // Assessors do not hold evidence.delete, so the permission layer
      // fires first with 403. If the permission layer is ever broadened
      // to include assessors, the participant check must still block
      // with 404. Either way the attachment must not be removed.
      const agent = await loginAs('assessor');
      const res = await agent.delete(`/api/v1/evidence/${fixtures.evidenceId}/attachments/${fixtures.attachmentId}`);
      expect(res.status === 403 || res.status === 404).toBe(true);
    });

    it('admin can DELETE attachment via assessments.view_all', async () => {
      // Run the delete last so prior tests still find the attachment.
      const agent = await loginAs('admin');
      const res = await agent.delete(`/api/v1/evidence/${fixtures.evidenceId}/attachments/${fixtures.attachmentId}`);
      expect([200, 204]).toContain(res.status);
    });
  });
});
