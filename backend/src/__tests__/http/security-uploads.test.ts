/**
 * Security regression tests for multipart uploads (security review I1, I3,
 * I6, I10, I11).
 *
 * I1: a truncated multipart body made busboy emit 'error' then 'close',
 * and both handlers responded; the second res.json() threw outside any
 * handler and killed the process. These tests send malformed bodies and
 * then prove the server still answers.
 */
import { describe, it, expect } from 'vitest';
import { setupHttpTests, loginAs, getAgent } from '../helpers/http.js';

const BOUNDARY = 'x-boundary';
const truncatedBody =
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n` +
  'Content-Type: text/plain\r\n\r\npartial content with no closing boundary';

async function createEvidence(agent: Awaited<ReturnType<typeof loginAs>>): Promise<string> {
  const res = await agent.post('/api/v1/evidence').send({ name: 'Upload security', description: 'fixture' });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function attachmentCount(evidenceId: string): Promise<number> {
  const { getDatabase } = await import('../../db/connection.js');
  const rows = await getDatabase()
    .selectFrom('evidence_attachment')
    .select('id')
    .where('evidence_id', '=', evidenceId)
    .execute();
  return rows.length;
}

async function serverAlive(): Promise<void> {
  const res = await getAgent().get('/api/health');
  expect(res.status).toBe(200);
}

describe('Upload hardening (security review)', () => {
  setupHttpTests();

  describe('evidence attachments', () => {
    it('answers a truncated multipart body once with 400 and stays up (I1)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
        .send(truncatedBody);
      expect(res.status).toBe(400);
      await serverAlive();
    });

    it('answers an empty multipart body without crashing (I1)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
        .send('');
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      await serverAlive();
    });

    it('refuses more files than the per-upload limit and saves none (I3)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      let req = agent.post(`/api/v1/evidence/${id}/attachments`);
      for (let i = 0; i < 11; i++) {
        req = req.attach('file', Buffer.from(`file ${i}`), { filename: `f${i}.txt`, contentType: 'text/plain' });
      }
      const res = await req;
      expect(res.status).toBe(413);
      expect(await attachmentCount(id)).toBe(0);
    });

    it('refuses a filename longer than the column allows instead of failing after the write (I3)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .attach('file', Buffer.from('x'), { filename: `${'a'.repeat(252)}.txt`, contentType: 'text/plain' });
      expect(res.status).toBe(400);
    });

    it('saves nothing when one file of the set is rejected (I11)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .attach('file', Buffer.from('fine'), { filename: 'ok.txt', contentType: 'text/plain' })
        .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'evil.html', contentType: 'text/html' });
      expect(res.status).toBe(415);
      expect(await attachmentCount(id)).toBe(0);
    });

    it('builds the storage key from ids only, never the client filename (I6)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .attach('file', Buffer.from('k'), { filename: '..%2F..%2Fescape.txt', contentType: 'text/plain' });
      expect(res.status).toBe(201);
      const key: string = res.body.attachments[0].storagePath;
      expect(key).toMatch(/^evidence\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    });

    it('responds only after every file is saved (I11)', async () => {
      const agent = await loginAs('assessor');
      const id = await createEvidence(agent);
      const res = await agent
        .post(`/api/v1/evidence/${id}/attachments`)
        .attach('file', Buffer.from('one'), { filename: 'one.txt', contentType: 'text/plain' })
        .attach('file', Buffer.from('two'), { filename: 'two.txt', contentType: 'text/plain' });
      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(2);
    });
  });

  describe('entity import', () => {
    it('answers a truncated multipart body once and stays up (I1)', async () => {
      const agent = await loginAs('admin');
      const res = await agent
        .post('/api/v1/entities/import')
        .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
        .send(truncatedBody);
      expect(res.status).toBe(400);
      await serverAlive();
    });

    it('refuses more than one file (I3)', async () => {
      const agent = await loginAs('admin');
      const res = await agent
        .post('/api/v1/entities/import')
        .attach('file', Buffer.from('name\nA'), { filename: 'a.csv', contentType: 'text/csv' })
        .attach('file', Buffer.from('name\nB'), { filename: 'b.csv', contentType: 'text/csv' });
      expect(res.status).toBe(413);
    });

    it('does not echo parser internals on a bad file (I10)', async () => {
      const agent = await loginAs('admin');
      const res = await agent
        .post('/api/v1/entities/import')
        .attach('file', Buffer.from('{not json'), { filename: 'bad.json', contentType: 'application/json' });
      expect(res.status).toBe(400);
      expect(res.body.error).not.toMatch(/position|token|Unexpected/i);
    });
  });
});
