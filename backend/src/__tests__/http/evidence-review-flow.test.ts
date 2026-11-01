/**
 * Evidence enters review only through POST /:id/submit-for-review, which
 * validates the reviewer and notifies them. PUT and create used to set
 * state 'in_review' directly, so the app moved evidence into review
 * without notifying anyone.
 */
import { describe, it, expect, vi } from 'vitest';
import { setupHttpTests, createPersona } from '../helpers/http.js';

// The author is an assessor so PUT reaches the state rules (assessees do
// not hold evidence.edit).
async function personas() {
  const author = await createPersona('assessor', 'flowauthor');
  const reviewer = await createPersona('assessor', 'flowreviewer');
  return { author, reviewer };
}

async function notificationTitles(agent: Awaited<ReturnType<typeof createPersona>>['agent']) {
  const res = await agent.get('/api/v1/notifications?limit=50');
  const rows = (res.body.data ?? res.body) as { title: string; message: string }[];
  return rows;
}

describe('Evidence review flow', () => {
  setupHttpTests();

  it('refuses to create evidence directly in review', async () => {
    const { author } = await personas();
    const res = await author.agent.post('/api/v1/evidence').send({ name: 'Direct review', state: 'in_review' });
    expect(res.status).toBe(400);
  });

  it('refuses to move evidence into review with PUT', async () => {
    const { author } = await personas();
    const ev = await author.agent.post('/api/v1/evidence').send({ name: 'PUT review' });
    const res = await author.agent.put(`/api/v1/evidence/${ev.body.id}`).send({ state: 'in_review' });
    expect(res.status).toBe(400);
  });

  it('refuses a state change with PUT while the evidence is in review', async () => {
    const { author, reviewer } = await personas();
    const ev = await author.agent.post('/api/v1/evidence').send({ name: 'Locked in review' });
    await author.agent.post(`/api/v1/evidence/${ev.body.id}/submit-for-review`).send({ reviewerId: reviewer.id });
    const res = await author.agent.put(`/api/v1/evidence/${ev.body.id}`).send({ state: 'in_progress' });
    expect(res.status).toBe(409);
  });

  it('notifies the reviewer on submit, and returns the rejection reason to the author', async () => {
    const { author, reviewer } = await personas();
    const ev = await author.agent.post('/api/v1/evidence').send({ name: 'Flow evidence' });
    expect((await author.agent.post(`/api/v1/evidence/${ev.body.id}/submit-for-review`).send({ reviewerId: reviewer.id })).status).toBe(200);
    await vi.waitFor(async () => {
      expect((await notificationTitles(reviewer.agent)).map((n) => n.title)).toContain('Evidence Submitted for Review');
    });

    const reason = 'Scope page is missing';
    expect((await reviewer.agent.post(`/api/v1/evidence/${ev.body.id}/reject`).send({ note: reason })).status).toBe(200);
    await vi.waitFor(async () => {
      const rows = await notificationTitles(author.agent);
      expect(rows.some((n) => n.title === 'Evidence Rejected' && n.message.includes(reason))).toBe(true);
    });
    const detail = await author.agent.get(`/api/v1/evidence/${ev.body.id}`);
    expect(JSON.stringify(detail.body.notes ?? detail.body.evidence?.notes)).toContain(reason);
  });
});
