import { test, expect } from '../../fixtures/index.js';
import { buildCompletedAssessment } from '../../helpers/assessment-builder.js';
import { uniqueAssessmentTitle } from '../../helpers/data.js';

/**
 * Attestation lifecycle.
 *
 * Reference (backend/src/routes/attestations.ts and the comment
 * block at line 466 introduced in PR 3.6):
 *
 *   - An attestation is a record on a completed assessment.
 *   - It carries `summary`, `assessmentId`, optional `signatoryId`
 *     and `assessorId`. It does NOT carry signature material — that
 *     moved to the affirmation layer in PR 3.6 (see
 *     project_pr3_affirmation_design memory).
 *   - POST /:id/requirements adds an attestation_requirement row
 *     with conformanceScore [0, 1] and a required rationale.
 *   - GET /:id/export returns a CycloneDX 1.6 or 1.7 attestations
 *     document (CDXA). spec=1.7 by default.
 *
 * Mutability:
 *   - Create requires assessment.state === 'complete'.
 *   - Edits succeed while the affirmation is unsealed (a complete
 *     assessment is intentionally NOT treated as read-only for
 *     attestation edits; see checkAttestationAssessmentReadOnly).
 *   - Edits are rejected (409) once the affirmation is sealed or
 *     the assessment is archived.
 *
 * Permissions:
 *   admin    : attestations.{view,create,edit,sign,export}
 *   assessor : attestations.{view,create,edit,sign,export}
 *   assessee : attestations.view
 *   standards_*: attestations.view
 */

test.describe('Attestation lifecycle @regression', () => {
  test.describe('create', () => {
    test('succeeds when the parent assessment is complete', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId } = await buildCompletedAssessment(api);

      const r = await api.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'E2E attestation' },
      });
      expect(r.status(), `create attestation: ${await r.text()}`).toBe(201);
      const body = await r.json();
      expect(body.id).toBeTruthy();
      expect(body.assessmentId).toBe(assessmentId);
    });

    test('rejects creation on a non-complete assessment with 409', async ({ apiAs }) => {
      const api = await apiAs('admin');
      // Build assessment but stop before complete.
      const { assessmentId } = await buildCompletedAssessment(api, {
        linkEvidence: false,
        complete: false,
      });

      const r = await api.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'Should not stick' },
      });
      expect(r.status()).toBe(409);
      const body = await r.json();
      expect(body.error).toMatch(/completed assessments?/i);
    });

    test('returns 404 for an unknown assessmentId', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/attestations', {
        data: {
          assessmentId: '00000000-0000-0000-0000-000000000000',
          summary: 'No-op',
        },
      });
      expect(r.status()).toBe(404);
    });

    test('rejects missing assessmentId with 400', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/attestations', {
        data: { summary: 'No assessment id' },
      });
      expect(r.status()).toBe(400);
    });
  });

  test.describe('edit and requirement claims', () => {
    test('can edit summary while affirmation is unsealed', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', {
          data: { assessmentId, summary: 'Initial' },
        })
        .then((r) => r.json());

      const editRes = await api.put(`/api/v1/attestations/${a.id}`, {
        data: { summary: 'Edited' },
      });
      expect(editRes.ok(), `edit: ${await editRes.text()}`).toBeTruthy();

      const detail = await api.get(`/api/v1/attestations/${a.id}`).then((r) => r.json());
      expect(detail.attestation?.summary ?? detail.summary).toBe('Edited');
    });

    test('can add a requirement claim with conformance score and rationale', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId } })
        .then((r) => r.json());

      const addRes = await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 1.0,
          conformanceRationale: 'Fully conformant per E2E coverage',
          confidenceScore: 0.9,
          confidenceRationale: 'High',
        },
      });
      expect(addRes.status(), `add requirement: ${await addRes.text()}`).toBe(201);

      const list = await api.get(`/api/v1/attestations/${a.id}/requirements`).then((r) => r.json());
      const items = list.data as Array<{ conformance_score?: number; conformanceScore?: number }>;
      expect(items.length).toBe(1);
      expect(items[0].conformanceScore ?? items[0].conformance_score).toBe(1.0);
    });

    test('rejects requirement claim with out-of-range conformanceScore', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId } })
        .then((r) => r.json());

      const r = await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 2.0,
          conformanceRationale: 'Above the cap',
        },
      });
      expect(r.status()).toBe(400);
    });

    test('rejects requirement claim without rationale', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId } })
        .then((r) => r.json());

      const r = await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 0.5,
          conformanceRationale: '',
        },
      });
      expect(r.status()).toBe(400);
    });

    test('can update a requirement claim', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId } })
        .then((r) => r.json());

      await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 0.5,
          conformanceRationale: 'Partial',
        },
      });

      const updRes = await api.put(
        `/api/v1/attestations/${a.id}/requirements/${requirementIds[0]}`,
        {
          data: {
            conformanceScore: 1.0,
            conformanceRationale: 'Upgraded to full after re-review',
          },
        },
      );
      expect(updRes.ok(), `update requirement: ${await updRes.text()}`).toBeTruthy();
    });
  });

  test.describe('export', () => {
    test('returns a CycloneDX 1.7 document by default', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId, summary: 'Export me' } })
        .then((r) => r.json());
      await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 1.0,
          conformanceRationale: 'Fully conformant',
        },
      });

      const r = await api.get(`/api/v1/attestations/${a.id}/export`);
      expect(r.ok(), `export: ${await r.text()}`).toBeTruthy();
      const body = await r.json();
      expect(body.bomFormat ?? body.bom_format).toBe('CycloneDX');
      expect(String(body.specVersion ?? body.spec_version)).toBe('1.7');
    });

    test('honors ?spec=1.6 for CycloneDX 1.6 export', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const { assessmentId, requirementIds } = await buildCompletedAssessment(api);
      const a = await api
        .post('/api/v1/attestations', { data: { assessmentId } })
        .then((r) => r.json());
      await api.post(`/api/v1/attestations/${a.id}/requirements`, {
        data: {
          requirementId: requirementIds[0],
          conformanceScore: 1.0,
          conformanceRationale: 'Fully conformant',
        },
      });

      const r = await api.get(`/api/v1/attestations/${a.id}/export?spec=1.6`);
      expect(r.ok()).toBeTruthy();
      const body = await r.json();
      expect(String(body.specVersion ?? body.spec_version)).toBe('1.6');
    });

    test('export returns 404 for unknown attestation id', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.get('/api/v1/attestations/00000000-0000-0000-0000-000000000000/export');
      expect(r.status()).toBe(404);
    });
  });

  test.describe('RBAC matrix @smoke', () => {
    let preExistingAttestationId: string | null = null;

    test.beforeAll(async () => {
      // Build one attestation that the read-only role checks can
      // exercise without rebuilding the whole assessment chain per
      // test. Uses a throwaway admin context.
      const { request } = await import('@playwright/test');
      const apiUrl = process.env.E2E_API_URL || 'http://localhost:3001';
      const ctx = await request.newContext({ baseURL: apiUrl });
      await ctx.post('/api/v1/auth/login', {
        data: { username: 'e2e_admin', password: 'E2eAdminPassword!2026' },
      });
      try {
        const built = await buildCompletedAssessment(ctx);
        const a = await ctx
          .post('/api/v1/attestations', {
            data: {
              assessmentId: built.assessmentId,
              summary: uniqueAssessmentTitle(),
            },
          })
          .then((r) => r.json());
        preExistingAttestationId = a.id ?? null;
      } finally {
        await ctx.dispose();
      }
    });

    test('assigned assessor can create an attestation', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const assessorApi = await apiAs('assessor');
      const me = await assessorApi.get('/api/v1/auth/me').then((r) => r.json());
      const { assessmentId } = await buildCompletedAssessment(adminApi, { assessorIds: [me.user.id] });

      const r = await assessorApi.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'Created by assessor' },
      });
      expect(r.status()).toBe(201);
    });

    test('assessee cannot create an attestation (403)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const { assessmentId } = await buildCompletedAssessment(adminApi);

      const assesseeApi = await apiAs('assessee');
      const r = await assesseeApi.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'No-go' },
      });
      expect(r.status()).toBe(403);
    });

    test('standards_manager cannot create an attestation (403)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const { assessmentId } = await buildCompletedAssessment(adminApi);

      const smApi = await apiAs('standards_manager');
      const r = await smApi.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'No-go' },
      });
      expect(r.status()).toBe(403);
    });

    test('assessee cannot export an attestation (403)', async ({ apiAs }) => {
      expect(preExistingAttestationId).toBeTruthy();
      const assesseeApi = await apiAs('assessee');
      const r = await assesseeApi.get(
        `/api/v1/attestations/${preExistingAttestationId}/export`,
      );
      expect(r.status()).toBe(403);
    });

    test('assessor can export an attestation', async ({ apiAs }) => {
      expect(preExistingAttestationId).toBeTruthy();
      const assessorApi = await apiAs('assessor');
      const r = await assessorApi.get(
        `/api/v1/attestations/${preExistingAttestationId}/export`,
      );
      expect(r.ok()).toBeTruthy();
    });

    test('assessor cannot create an attestation on an assessment they are not assigned to (403)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const { assessmentId } = await buildCompletedAssessment(adminApi);
      const assessorApi = await apiAs('assessor');
      const r = await assessorApi.post('/api/v1/attestations', {
        data: { assessmentId, summary: 'Not assigned' },
      });
      expect(r.status()).toBe(403);
    });

    test('roles with attestations.view can list attestations', async ({ apiAs }) => {
      for (const role of ['admin', 'assessor', 'assessee'] as const) {
        const api = await apiAs(role);
        const r = await api.get('/api/v1/attestations');
        expect(r.ok(), `${role} could not list /attestations`).toBeTruthy();
      }
    });

    test('standards roles cannot list attestations (least privilege, 403)', async ({ apiAs }) => {
      for (const role of ['standards_manager', 'standards_approver'] as const) {
        const api = await apiAs(role);
        const r = await api.get('/api/v1/attestations');
        expect(r.status(), `${role} listed /attestations`).toBe(403);
      }
    });
  });
});
