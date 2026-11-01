/**
 * Only the assigned reviewer (or an administrator) may approve or reject
 * evidence that is in review. Both routes require evidence.review, which
 * every assessor holds, so the "assigned reviewer" check used to be dead
 * code: any assessor could approve or reject any evidence under review.
 */
import { describe, it, expect } from 'vitest';
import { setupHttpTests, createPersona, loginAs } from '../helpers/http.js';

async function evidenceInReview() {
  const author = await createPersona('assessee', 'evauthor');
  const reviewer = await createPersona('assessor', 'evreviewer');
  const outsider = await createPersona('assessor', 'evoutsider');
  const ev = await author.agent.post('/api/v1/evidence').send({ name: 'Review authz evidence' });
  expect(ev.status).toBe(201);
  const sub = await author.agent.post(`/api/v1/evidence/${ev.body.id}/submit-for-review`).send({ reviewerId: reviewer.id });
  expect(sub.status).toBe(200);
  return { id: ev.body.id as string, author, reviewer, outsider };
}

describe('Evidence review authorization', () => {
  setupHttpTests();

  it('refuses approval by an assessor who is not the assigned reviewer', async () => {
    const { id, outsider } = await evidenceInReview();
    const res = await outsider.agent.post(`/api/v1/evidence/${id}/approve`);
    expect(res.status).toBe(403);
  });

  it('refuses rejection by an assessor who is not the assigned reviewer', async () => {
    const { id, outsider } = await evidenceInReview();
    const res = await outsider.agent.post(`/api/v1/evidence/${id}/reject`).send({ note: 'not mine to reject' });
    expect(res.status).toBe(403);
  });

  it('lets the assigned reviewer approve', async () => {
    const { id, reviewer } = await evidenceInReview();
    expect((await reviewer.agent.post(`/api/v1/evidence/${id}/approve`)).status).toBe(200);
  });

  it('lets the assigned reviewer reject', async () => {
    const { id, reviewer } = await evidenceInReview();
    expect((await reviewer.agent.post(`/api/v1/evidence/${id}/reject`).send({ note: 'needs more detail' })).status).toBe(200);
  });

  it('lets an administrator approve', async () => {
    const { id } = await evidenceInReview();
    expect((await (await loginAs('admin')).post(`/api/v1/evidence/${id}/approve`)).status).toBe(200);
  });

  it('still refuses the author approving their own evidence', async () => {
    const { id, author } = await evidenceInReview();
    expect((await author.agent.post(`/api/v1/evidence/${id}/approve`)).status).toBe(403);
  });
});
