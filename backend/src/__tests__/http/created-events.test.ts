/**
 * assessment.created, evidence.created and attestation.created were in the
 * event catalog, with email templates and subscribers, but no route ever
 * emitted them, so webhooks and notification rules for them never fired.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'node:crypto';
import { setupHttpTests, loginAs } from '../helpers/http.js';
import type { EventEnvelope } from '../../events/types.js';

describe('created events are emitted', () => {
  setupHttpTests();
  const seen: EventEnvelope[] = [];

  beforeAll(async () => {
    const { getEventBus } = await import('../../events/index.js');
    for (const type of ['assessment.created', 'evidence.created', 'attestation.created']) {
      getEventBus().on(type, async (envelope) => { seen.push(envelope); });
    }
  });

  const find = (type: string, key: string, id: string) =>
    seen.find((e) => e.type === type && (e.data as Record<string, unknown>)[key] === id);

  it('POST /assessments emits assessment.created', async () => {
    const admin = await loginAs('admin');
    const res = await admin.post('/api/v1/assessments').send({ title: `Created event ${crypto.randomUUID().slice(0, 6)}` });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(find('assessment.created', 'assessmentId', res.body.id)).toBeTruthy());
    const event = find('assessment.created', 'assessmentId', res.body.id)!;
    expect(event.data).toMatchObject({ assessmentTitle: res.body.title, projectName: null });
    expect(event.actor.userId).toBeTruthy();
  });

  it('POST /evidence emits evidence.created', async () => {
    const admin = await loginAs('admin');
    const res = await admin.post('/api/v1/evidence').send({ name: `Created event evidence ${crypto.randomUUID().slice(0, 6)}` });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(find('evidence.created', 'evidenceId', res.body.id)).toBeTruthy());
    expect(find('evidence.created', 'evidenceId', res.body.id)!.data).toMatchObject({ evidenceName: res.body.name });
  });

  it('POST /attestations emits attestation.created', async () => {
    const { getDatabase } = await import('../../db/connection.js');
    const db = getDatabase();
    const projectId = crypto.randomUUID();
    const assessmentId = crypto.randomUUID();
    await db.insertInto('project').values({ id: projectId, name: 'Event project', description: 'x', state: 'new' } as never).execute();
    await db.insertInto('assessment').values({ id: assessmentId, title: 'Event assessment', description: 'x', project_id: projectId, state: 'complete' } as never).execute();
    const admin = await loginAs('admin');
    const res = await admin.post('/api/v1/attestations').send({ assessmentId, summary: 'Event test' });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(find('attestation.created', 'attestationId', res.body.id)).toBeTruthy());
    expect(find('attestation.created', 'attestationId', res.body.id)!.data).toMatchObject({ assessmentId, projectName: 'Event project' });
  });
});
