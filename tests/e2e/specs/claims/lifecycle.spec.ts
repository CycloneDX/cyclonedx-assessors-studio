import { test, expect } from '../../fixtures/index.js';
import type { APIRequestContext } from '@playwright/test';
import { uniqueEvidenceName } from '../../helpers/data.js';

/**
 * Claim lifecycle.
 *
 * Reference (backend/src/routes/claims.ts):
 *   - Claims are standalone records: { name, target, predicate,
 *     reasoning?, isCounterClaim, attestationId?, targetEntityId?,
 *     evidenceIds[], counterEvidenceIds[] }.
 *   - GET /:id returns the claim with denormalized evidence,
 *     counter-evidence, mitigation strategies, target entity, and
 *     external references.
 *   - POST / creates a claim. evidenceIds and counterEvidenceIds
 *     populate the junction tables.
 *   - PUT /:id replaces the linked-evidence sets when arrays are
 *     present (sync semantics).
 *   - DELETE /:id removes the claim. Mitigation strategies are
 *     populated through a separate path (claim_mitigation_strategy
 *     junction read here is read-only from the claims route).
 *
 * Permissions:
 *   admin    : claims.{view,create,edit}
 *   assessor : claims.{view,view_all,create,edit}
 *   assessee : claims.view (only claims scoped to their assessments; 404 otherwise)
 *   standards_* : none (403)
 */

interface ClaimCreate {
  name: string;
  target: string;
  predicate: string;
  reasoning?: string;
  isCounterClaim?: boolean;
  targetEntityId?: string;
  attestationId?: string;
  evidenceIds?: string[];
  counterEvidenceIds?: string[];
}

async function createEvidence(api: APIRequestContext): Promise<{ id: string }> {
  const r = await api.post('/api/v1/evidence', {
    data: { name: uniqueEvidenceName(), description: 'E2E claim linkage', state: 'in_progress' },
  });
  expect(r.status()).toBe(201);
  return await r.json();
}

async function createClaim(api: APIRequestContext, overrides: Partial<ClaimCreate> = {}): Promise<{ id: string }> {
  const r = await api.post('/api/v1/claims', {
    data: {
      name: overrides.name ?? `E2E claim ${Date.now().toString(36)}`,
      target: overrides.target ?? 'urn:example:e2e-target',
      predicate: overrides.predicate ?? 'implements',
      reasoning: overrides.reasoning,
      isCounterClaim: overrides.isCounterClaim ?? false,
      targetEntityId: overrides.targetEntityId,
      attestationId: overrides.attestationId,
      evidenceIds: overrides.evidenceIds,
      counterEvidenceIds: overrides.counterEvidenceIds,
    },
  });
  expect(r.status(), `create claim: ${await r.text()}`).toBe(201);
  return await r.json();
}

test.describe('Claim lifecycle @regression', () => {
  test.describe('CRUD', () => {
    test('admin can create a claim with required fields only', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const claim = await createClaim(api);
      expect(claim.id).toBeTruthy();

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      const node = detail.claim as Record<string, unknown>;
      expect(node.id).toBe(claim.id);
      expect(detail.evidence).toEqual([]);
      expect(detail.counterEvidence).toEqual([]);
    });

    test('admin can create a claim with linked evidence and counter-evidence', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');
      const e1 = await createEvidence(api);
      const e2 = await createEvidence(api);
      const ec = await createEvidence(api);

      const claim = await createClaim(api, {
        evidenceIds: [e1.id, e2.id],
        counterEvidenceIds: [ec.id],
      });

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      expect((detail.evidence as Array<{ id: string }>).map((e) => e.id).sort()).toEqual(
        [e1.id, e2.id].sort(),
      );
      expect(detail.counterEvidence).toHaveLength(1);
      expect(detail.counterEvidence[0].id).toBe(ec.id);
    });

    test('admin can edit name, target, and predicate', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const claim = await createClaim(api);

      const r = await api.put(`/api/v1/claims/${claim.id}`, {
        data: { name: 'Renamed claim', predicate: 'satisfies' },
      });
      expect(r.ok(), `edit: ${await r.text()}`).toBeTruthy();

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      expect(detail.claim.name).toBe('Renamed claim');
      expect(detail.claim.predicate).toBe('satisfies');
    });

    test('PUT with evidenceIds replaces the linked-evidence set (sync semantics)', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');
      const e1 = await createEvidence(api);
      const e2 = await createEvidence(api);
      const e3 = await createEvidence(api);

      const claim = await createClaim(api, { evidenceIds: [e1.id, e2.id] });

      // Replace [e1, e2] with [e3]. The route uses sync semantics:
      // delete all existing rows, then insert the new set.
      const r = await api.put(`/api/v1/claims/${claim.id}`, {
        data: { evidenceIds: [e3.id] },
      });
      expect(r.ok(), `put: ${await r.text()}`).toBeTruthy();

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      const linked = (detail.evidence as Array<{ id: string }>).map((e) => e.id);
      expect(linked).toEqual([e3.id]);
    });

    test('PUT without evidenceIds leaves the linked set unchanged', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const e1 = await createEvidence(api);
      const claim = await createClaim(api, { evidenceIds: [e1.id] });

      // Edit something unrelated; do NOT pass evidenceIds.
      const r = await api.put(`/api/v1/claims/${claim.id}`, {
        data: { reasoning: 'Only changing reasoning' },
      });
      expect(r.ok()).toBeTruthy();

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      expect((detail.evidence as Array<{ id: string }>).map((e) => e.id)).toEqual([e1.id]);
    });

    test('PUT with empty evidenceIds[] clears the link set', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const e1 = await createEvidence(api);
      const claim = await createClaim(api, { evidenceIds: [e1.id] });

      const r = await api.put(`/api/v1/claims/${claim.id}`, {
        data: { evidenceIds: [] },
      });
      expect(r.ok()).toBeTruthy();

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      expect(detail.evidence).toEqual([]);
    });

    test('admin can delete a claim', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const claim = await createClaim(api);
      const del = await api.delete(`/api/v1/claims/${claim.id}`);
      expect([200, 204]).toContain(del.status());

      const after = await api.get(`/api/v1/claims/${claim.id}`);
      expect(after.status()).toBe(404);
    });

    test('isCounterClaim flag round-trips', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const claim = await createClaim(api, { isCounterClaim: true });
      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      const node = detail.claim as Record<string, unknown>;
      expect(node.isCounterClaim ?? node.is_counter_claim).toBe(true);
    });

    test('linking the same evidence to a claim twice (via duplicates in evidenceIds) deduplicates', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');
      const e1 = await createEvidence(api);
      const claim = await createClaim(api, { evidenceIds: [e1.id, e1.id] });

      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());
      // The junction table has a primary-key constraint on (claim_id,
      // evidence_id), so two inserts of the same pair collapse to one.
      const ids = (detail.evidence as Array<{ id: string }>).map((e) => e.id);
      expect(ids).toEqual([e1.id]);
    });

    test('claim with targetEntityId resolves the target entity in the detail response', async ({
      apiAs,
    }) => {
      const api = await apiAs('admin');

      // Create a target entity to link.
      const entity = (await api
        .post('/api/v1/entities', {
          data: { name: 'E2E Claim Target', entityType: 'product' },
        })
        .then((r) => r.json())) as { id: string; name: string };

      const claim = await createClaim(api, { targetEntityId: entity.id });
      const detail = await api.get(`/api/v1/claims/${claim.id}`).then((r) => r.json());

      expect(detail.targetEntity).toBeTruthy();
      expect(detail.targetEntity.id).toBe(entity.id);
      expect(detail.targetEntity.name).toBe('E2E Claim Target');
    });
  });

  test.describe('validation', () => {
    test('missing name returns 400', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/claims', {
        data: { target: 'urn:x', predicate: 'implements' },
      });
      expect(r.status()).toBe(400);
    });

    test('missing target returns 400', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/claims', {
        data: { name: 'No target', predicate: 'implements' },
      });
      expect(r.status()).toBe(400);
    });

    test('missing predicate returns 400', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/claims', {
        data: { name: 'No predicate', target: 'urn:x' },
      });
      expect(r.status()).toBe(400);
    });

    test('invalid UUID in evidenceIds returns 400', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.post('/api/v1/claims', {
        data: {
          name: 'Bad uuid',
          target: 'urn:x',
          predicate: 'implements',
          evidenceIds: ['not-a-uuid'],
        },
      });
      expect(r.status()).toBe(400);
    });

    test('GET /:id returns 404 for unknown claim', async ({ apiAs }) => {
      const api = await apiAs('admin');
      const r = await api.get('/api/v1/claims/00000000-0000-0000-0000-000000000000');
      expect(r.status()).toBe(404);
    });
  });

  test.describe('RBAC matrix @smoke', () => {
    test('assessor can create a claim', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const claim = await createClaim(api);
      expect(claim.id).toBeTruthy();
    });

    test('assessor can edit a claim', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const claim = await createClaim(api);
      const r = await api.put(`/api/v1/claims/${claim.id}`, {
        data: { name: 'Edited by assessor' },
      });
      expect(r.ok()).toBeTruthy();
    });

    test('assessee cannot create a claim (lacks claims.create)', async ({ apiAs }) => {
      const api = await apiAs('assessee');
      const r = await api.post('/api/v1/claims', {
        data: { name: 'No-go', target: 'urn:x', predicate: 'implements' },
      });
      expect(r.status()).toBe(403);
    });

    test('assessee cannot edit a claim (lacks claims.edit)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const claim = await createClaim(adminApi);

      const assesseeApi = await apiAs('assessee');
      const r = await assesseeApi.put(`/api/v1/claims/${claim.id}`, {
        data: { name: 'Hijack' },
      });
      expect(r.status()).toBe(403);
    });

    test('assessee cannot delete a claim', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const claim = await createClaim(adminApi);

      const assesseeApi = await apiAs('assessee');
      const r = await assesseeApi.delete(`/api/v1/claims/${claim.id}`);
      expect(r.status()).toBe(403);
    });

    test('standards_manager cannot create a claim', async ({ apiAs }) => {
      const api = await apiAs('standards_manager');
      const r = await api.post('/api/v1/claims', {
        data: { name: 'No-go', target: 'urn:x', predicate: 'implements' },
      });
      expect(r.status()).toBe(403);
    });

    // Least privilege (01fb734, confirmed 2026-10-16): claims are readable
    // org-wide by roles with claims.view_all, by participants of the
    // claim's assessment, and by nobody else.
    test('claim read access follows least privilege', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const claim = await createClaim(adminApi);

      for (const role of ['admin', 'assessor'] as const) {
        const r = await (await apiAs(role)).get(`/api/v1/claims/${claim.id}`);
        expect(r.ok(), `${role} should read the claim`).toBeTruthy();
      }
      // Not a participant in the claim's assessment.
      const assessee = await (await apiAs('assessee')).get(`/api/v1/claims/${claim.id}`);
      expect([403, 404], 'assessee outside the assessment').toContain(assessee.status());
      for (const role of ['standards_manager', 'standards_approver'] as const) {
        const r = await (await apiAs(role)).get(`/api/v1/claims/${claim.id}`);
        expect(r.status(), `${role} has no claims.view`).toBe(403);
      }
    });
  });
});
