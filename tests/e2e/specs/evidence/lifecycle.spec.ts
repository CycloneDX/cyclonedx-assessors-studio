import { test, expect } from '../../fixtures/index.js';
import { request, type APIRequestContext } from '@playwright/test';
import { uniqueEvidenceName } from '../../helpers/data.js';
import {
  DEMO_PASSWORD,
  DEMO_USERS,
} from '../../auth/credentials.js';

/**
 * Construct a one-off APIRequestContext authenticated as the given
 * demo username. Use when a test needs a *second* concrete identity
 * alongside the apiAs(role) fixture — for example, an evidence
 * author and a separate non-author reviewer who both happen to be
 * `assessor`. apiAs returns the same role's session twice, which
 * defeats author-equals-reviewer guards.
 */
async function loginAs(username: string): Promise<APIRequestContext> {
  const apiUrl = process.env.E2E_API_URL || 'http://localhost:3001';
  const ctx = await request.newContext({ baseURL: apiUrl });
  const r = await ctx.post('/api/v1/auth/login', {
    data: { username, password: DEMO_PASSWORD },
  });
  if (!r.ok()) {
    throw new Error(`loginAs(${username}) failed: ${r.status()}`);
  }
  return ctx;
}

/**
 * Evidence lifecycle, retention immutability, and RBAC.
 *
 * Reference (backend/src/routes/evidence.ts):
 *
 * State machine:
 *   in_progress (default) → submit-for-review → in_review
 *   in_review             → approve            → claimed
 *   in_review             → reject             → in_progress
 *
 * Retention immutability (memory: feedback_evidence_retention):
 * Evidence is immutable for everyone — including admin — once any
 * one of these is true:
 *   1. state === 'claimed' (approved evidence)
 *   2. cited in a claim (claim_evidence / counter / mitigation)
 *   3. linked to a terminal assessment (complete / archived /
 *      cancelled)
 * The 409 carries `error: 'Evidence is immutable ...'` so callers
 * can distinguish retention from 403 (no permission) and 404
 * (not found).
 *
 * Permissions (backend/src/db/seed.ts):
 *   admin    : all
 *   assessor : view, view_all, create, edit, review
 *   assessee : view (own-authored / to-review rows), create, submit
 *   standards_manager / standards_approver : none (no evidence.view)
 *
 * Author guards:
 *   - Authors cannot approve their own evidence (line 299).
 *   - Authors cannot reject their own evidence (line 1190).
 *   - Author may submit-for-review even without `evidence.submit`
 *     (a defensive carve-out for assessees who own a piece of
 *     evidence they uploaded).
 */

interface Evidence {
  id: string;
  name: string;
  state: 'in_progress' | 'in_review' | 'claimed' | 'expired';
  author_id?: string;
  authorId?: string;
}

async function createEvidence(
  api: APIRequestContext,
  overrides: Partial<{
    name: string;
    description: string;
    state: Evidence['state'];
    classification: string;
    isCounterEvidence: boolean;
  }> = {},
): Promise<Evidence> {
  const r = await api.post('/api/v1/evidence', {
    data: {
      name: overrides.name ?? uniqueEvidenceName(),
      description: overrides.description ?? 'E2E lifecycle evidence',
      state: overrides.state ?? 'in_progress',
      classification: overrides.classification,
      isCounterEvidence: overrides.isCounterEvidence ?? false,
    },
  });
  expect(r.status(), `create evidence: ${await r.text()}`).toBe(201);
  return await r.json();
}

async function fetchEvidence(
  api: APIRequestContext,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await api.get(`/api/v1/evidence/${id}`);
  expect(r.ok(), `fetch evidence ${id}: ${r.status()}`).toBeTruthy();
  const body = await r.json();
  // The detail endpoint returns `{ evidence, notes, attachments }`;
  // some helpers return the bare row. Normalize.
  return (body.evidence ?? body) as Record<string, unknown>;
}

async function getUserId(api: APIRequestContext, username: string): Promise<string> {
  // Admin can read /users; we use that to resolve a username → id
  // without making assumptions about the demo seed UUIDs.
  const r = await api.get(`/api/v1/users?limit=100`).then((r) => r.json());
  const user = (r.data as Array<{ id: string; username: string }>).find(
    (u) => u.username === username,
  );
  if (!user) throw new Error(`user ${username} not found via /users`);
  return user.id;
}

test.describe('Evidence lifecycle @regression', () => {
  test.describe('CRUD', () => {
    test('assessor can create evidence and it persists', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const e = await createEvidence(api);
      expect(e.state).toBe('in_progress');

      const detail = await fetchEvidence(api, e.id);
      expect(detail.name).toBe(e.name);
    });

    test('assessor can edit evidence while in_progress', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const e = await createEvidence(api);

      const r = await api.put(`/api/v1/evidence/${e.id}`, {
        data: { description: 'Edited body', classification: 'Public' },
      });
      expect(r.ok(), `edit failed: ${await r.text()}`).toBeTruthy();

      const after = await fetchEvidence(api, e.id);
      expect(after.description).toBe('Edited body');
    });

    test('assessor can add a note to in_progress evidence', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const e = await createEvidence(api);

      const r = await api.post(`/api/v1/evidence/${e.id}/notes`, {
        data: { content: 'Note added by E2E' },
      });
      expect(r.ok(), `add note failed: ${await r.text()}`).toBeTruthy();

      const detail = await api.get(`/api/v1/evidence/${e.id}`).then((r) => r.json());
      const notes = detail.notes as Array<{ content: string }>;
      expect(notes.some((n) => n.content === 'Note added by E2E')).toBeTruthy();
    });

    test('create with classification and counter-evidence flag round-trips', async ({
      apiAs,
    }) => {
      const api = await apiAs('assessor');
      const e = await createEvidence(api, {
        classification: 'Confidential',
        isCounterEvidence: true,
      });
      const detail = await fetchEvidence(api, e.id);
      expect(detail.classification).toBe('Confidential');
      expect(detail.isCounterEvidence ?? detail.is_counter_evidence).toBe(true);
    });

    test('admin can delete (hard-delete) unclaimed evidence', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const e = await createEvidence(adminApi);
      const del = await adminApi.delete(`/api/v1/evidence/${e.id}`);
      expect([200, 204]).toContain(del.status());
      const after = await adminApi.get(`/api/v1/evidence/${e.id}`);
      expect(after.status()).toBe(404);
    });

    test('create rejects missing name with 400', async ({ apiAs }) => {
      const api = await apiAs('assessor');
      const r = await api.post('/api/v1/evidence', { data: { description: 'no name' } });
      expect(r.status()).toBe(400);
    });
  });

  test.describe('review state machine', () => {
    test('submit-for-review moves in_progress → in_review', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);

      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      const submitRes = await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });
      expect(submitRes.ok(), `submit: ${await submitRes.text()}`).toBeTruthy();

      const after = await fetchEvidence(authorApi, e.id);
      expect(after.state).toBe('in_review');
    });

    test('approve by a non-author reviewer moves in_review → claimed', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      // Approve as a different reviewer. mwilson is an assessor and
      // carries evidence.review, so they qualify as a non-author
      // reviewer. We construct a one-off API context here rather than
      // adding a second apiAs call because the test specifically needs
      // two different concrete identities (author vs reviewer), and
      // apiAs('assessor') would return the same user twice.
      const reviewerApi = await loginAs(DEMO_USERS.mwilson.username);
      const approve = await reviewerApi.post(`/api/v1/evidence/${e.id}/approve`);
      expect(approve.ok(), `approve: ${await approve.text()}`).toBeTruthy();
      await reviewerApi.dispose();

      const after = await fetchEvidence(authorApi, e.id);
      expect(after.state).toBe('claimed');
    });

    test('author cannot approve their own evidence (403)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      // assessor (jthompson) is the author. Approving as themselves
      // must fail with 403 even though they have evidence.review.
      const r = await authorApi.post(`/api/v1/evidence/${e.id}/approve`);
      expect(r.status()).toBe(403);
    });

    test('reject by a non-author reviewer moves in_review → in_progress', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const reviewerApi = await loginAs(DEMO_USERS.mwilson.username);
      const reject = await reviewerApi.post(`/api/v1/evidence/${e.id}/reject`, {
        data: { note: 'Insufficient detail' },
      });
      expect(reject.ok(), `reject: ${await reject.text()}`).toBeTruthy();
      await reviewerApi.dispose();

      const after = await fetchEvidence(authorApi, e.id);
      expect(after.state).toBe('in_progress');
    });

    test('cannot submit-for-review from in_review (409)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const second = await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });
      expect(second.status()).toBe(409);
    });

    test('cannot approve evidence still in in_progress (409)', async ({ apiAs }) => {
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);

      // Approve while still in_progress, as a non-author (admin).
      const adminApi = await apiAs('admin');
      const r = await adminApi.post(`/api/v1/evidence/${e.id}/approve`);
      expect([400, 409]).toContain(r.status());
    });
  });

  test.describe('retention immutability', () => {
    test('claimed evidence cannot be edited even by admin (409 with retention reason)', async ({
      apiAs,
    }) => {
      // Drive to claimed state via the full happy path.
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const reviewerApi = await loginAs(DEMO_USERS.mwilson.username);
      await reviewerApi.post(`/api/v1/evidence/${e.id}/approve`);
      await reviewerApi.dispose();

      // Now claimed. Try to edit as admin — must fail with 409.
      const editRes = await adminApi.put(`/api/v1/evidence/${e.id}`, {
        data: { description: 'Hijack' },
      });
      expect(editRes.status()).toBe(409);
      const body = await editRes.json();
      expect(body.error).toMatch(/immutable/i);
    });

    test('claimed evidence cannot have notes added (409)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const reviewerApi = await loginAs(DEMO_USERS.mwilson.username);
      await reviewerApi.post(`/api/v1/evidence/${e.id}/approve`);
      await reviewerApi.dispose();

      const noteRes = await adminApi.post(`/api/v1/evidence/${e.id}/notes`, {
        data: { content: 'Should not stick' },
      });
      expect(noteRes.status()).toBe(409);
    });

    test('claimed evidence cannot be deleted (409)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const reviewerApi = await loginAs(DEMO_USERS.mwilson.username);
      await reviewerApi.post(`/api/v1/evidence/${e.id}/approve`);
      await reviewerApi.dispose();

      const del = await adminApi.delete(`/api/v1/evidence/${e.id}`);
      // Some builds map retention-locked deletes to 409, others 403 with
      // a retention-specific error key. Accept either; the 200/204 path
      // (which would be a real bug) is excluded.
      expect([403, 409]).toContain(del.status());
    });
  });

  test.describe('RBAC matrix @smoke', () => {
    test('assessee cannot edit evidence even when they are the author', async ({ apiAs }) => {
      // assessee has create + submit but NOT edit. Make them create
      // their own row, then try to PUT it.
      const assesseeApi = await apiAs('assessee');
      const e = await createEvidence(assesseeApi);
      const r = await assesseeApi.put(`/api/v1/evidence/${e.id}`, {
        data: { description: 'Nope' },
      });
      expect(r.status()).toBe(403);
    });

    test('assessee cannot approve evidence (no evidence.review)', async ({ apiAs }) => {
      const adminApi = await apiAs('admin');
      const authorApi = await apiAs('assessor');
      const e = await createEvidence(authorApi);
      const reviewerId = await getUserId(adminApi, DEMO_USERS.mwilson.username);
      await authorApi.post(`/api/v1/evidence/${e.id}/submit-for-review`, {
        data: { reviewerId },
      });

      const assesseeApi = await apiAs('assessee');
      const r = await assesseeApi.post(`/api/v1/evidence/${e.id}/approve`);
      expect(r.status()).toBe(403);
    });

    test('standards_manager cannot create evidence', async ({ apiAs }) => {
      const api = await apiAs('standards_manager');
      const r = await api.post('/api/v1/evidence', {
        data: { name: uniqueEvidenceName(), description: 'Should fail' },
      });
      expect(r.status()).toBe(403);
    });

    // Least privilege (01fb734, confirmed 2026-10-16): the standards roles
    // do not read evidence; assessees get a list scoped to their own.
    test('evidence list access follows least privilege', async ({ apiAs }) => {
      for (const role of ['admin', 'assessor', 'assessee'] as const) {
        const r = await (await apiAs(role)).get('/api/v1/evidence');
        expect(r.ok(), `${role} should read /evidence`).toBeTruthy();
      }
      for (const role of ['standards_manager', 'standards_approver'] as const) {
        const r = await (await apiAs(role)).get('/api/v1/evidence');
        expect(r.status(), `${role} has no evidence.view`).toBe(403);
      }
    });
  });
});
