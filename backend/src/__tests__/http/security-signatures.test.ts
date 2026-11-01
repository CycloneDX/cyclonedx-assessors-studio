/**
 * Security regression tests: signatures (security review X2, I5).
 *
 * The flow a real client follows: register a public key, call
 * /sign/prepare, sign the returned canonical bytes with the private key,
 * submit the value. A value that does not verify must never be stored,
 * and seal must refuse a slot whose stored signature does not verify.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { setupHttpTests, loginAs } from '../helpers/http.js';

type Agent = Awaited<ReturnType<typeof loginAs>>;

function suffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function assessmentFixture(): Promise<string> {
  const { getDatabase } = await import('../../db/connection.js');
  const db = getDatabase();
  const projectId = crypto.randomUUID();
  const assessmentId = crypto.randomUUID();
  await db.insertInto('project').values({ id: projectId, name: `Sig project ${suffix()}`, description: 'x', state: 'new' } as never).execute();
  await db.insertInto('assessment').values({ id: assessmentId, title: `Sig assessment ${suffix()}`, description: 'x', project_id: projectId, state: 'in_progress' } as never).execute();
  return assessmentId;
}

async function digitalSignature(agent: Agent) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const res = await agent.post('/api/v1/me/signatures').send({
    signatureType: 'digital',
    label: `Digital ${suffix()}`,
    payload: {
      signatureFormat: 'jsf',
      signatureAlgorithm: 'RS256',
      publicKeyPem: publicKey,
      name: 'Digital Signer',
      role: 'CTO',
      organization: { name: 'Acme Inc.' },
    },
  });
  if (res.status !== 201) throw new Error(`signature create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: res.body.id as string, privateKeyPem: privateKey as string };
}

async function affirmationWithSlot(agent: Agent) {
  const assessmentId = await assessmentFixture();
  const aff = await agent.post('/api/v1/affirmations').send({ assessmentId, statement: 'We affirm.' });
  expect(aff.status).toBe(201);
  const affirmationId = (aff.body.data?.id ?? aff.body.id) as string;
  const slot = await agent.post(`/api/v1/affirmations/${affirmationId}/signatories`).send({ requiredTitle: 'CTO' });
  expect(slot.status).toBe(201);
  return { affirmationId, slotId: (slot.body.data?.id ?? slot.body.id) as string };
}

async function signViaPrepare(agent: Agent, affirmationId: string, slotId: string, sig: { id: string; privateKeyPem: string }) {
  const prep = await agent.post(`/api/v1/affirmations/${affirmationId}/signatories/${slotId}/sign/prepare`)
    .send({ userSignatureId: sig.id });
  expect(prep.status).toBe(200);
  const bytes = Buffer.from(prep.body.canonicalPayload as string, 'base64url');
  const signatureValue = crypto.sign('sha256', bytes, sig.privateKeyPem).toString('base64url');
  return agent.post(`/api/v1/affirmations/${affirmationId}/signatories/${slotId}/sign`)
    .send({ userSignatureId: sig.id, signatureValue });
}

describe('Signature hardening (security review)', () => {
  setupHttpTests();

  it('refuses a signature value that does not verify (X2)', async () => {
    const admin = await loginAs('admin');
    const sig = await digitalSignature(admin);
    const { affirmationId, slotId } = await affirmationWithSlot(admin);
    const res = await admin.post(`/api/v1/affirmations/${affirmationId}/signatories/${slotId}/sign`)
      .send({ userSignatureId: sig.id, signatureValue: Buffer.from('not a signature').toString('base64url') });
    expect(res.status).toBe(400);
  });

  it('accepts a signature over the bytes /sign/prepare returns (X2)', async () => {
    const admin = await loginAs('admin');
    const sig = await digitalSignature(admin);
    const { affirmationId, slotId } = await affirmationWithSlot(admin);
    const res = await signViaPrepare(admin, affirmationId, slotId, sig);
    expect([200, 201]).toContain(res.status);
    const verify = await admin.post(`/api/v1/affirmations/${affirmationId}/verify`);
    const slotResult = (verify.body.slots ?? verify.body.slotResults ?? []).find((s: { slotId: string }) => s.slotId === slotId);
    if (slotResult) expect(slotResult.valid).toBe(true);
  });

  it('ignores a client-supplied canonical hash (X2)', async () => {
    const admin = await loginAs('admin');
    const sig = await digitalSignature(admin);
    const { affirmationId, slotId } = await affirmationWithSlot(admin);
    const prep = await admin.post(`/api/v1/affirmations/${affirmationId}/signatories/${slotId}/sign/prepare`).send({ userSignatureId: sig.id });
    const bytes = Buffer.from(prep.body.canonicalPayload as string, 'base64url');
    const signatureValue = crypto.sign('sha256', bytes, sig.privateKeyPem).toString('base64url');
    await admin.post(`/api/v1/affirmations/${affirmationId}/signatories/${slotId}/sign`)
      .send({ userSignatureId: sig.id, signatureValue, canonicalPayloadHash: 'f'.repeat(64) });
    const { getDatabase } = await import('../../db/connection.js');
    const row = await getDatabase().selectFrom('affirmation_signatory').select('canonical_hash').where('id', '=', slotId).executeTakeFirstOrThrow();
    expect(row.canonical_hash).toBe(prep.body.canonicalPayloadHash);
  });

  it('refuses to seal a slot whose stored signature no longer verifies (X2)', async () => {
    const admin = await loginAs('admin');
    const sig = await digitalSignature(admin);
    const { affirmationId, slotId } = await affirmationWithSlot(admin);
    expect([200, 201]).toContain((await signViaPrepare(admin, affirmationId, slotId, sig)).status);
    // Simulate a slot stored before verification existed (or tampered with).
    const { getDatabase } = await import('../../db/connection.js');
    const db = getDatabase();
    const row = await db.selectFrom('affirmation_signatory').select('signature_json').where('id', '=', slotId).executeTakeFirstOrThrow();
    const envelope = (typeof row.signature_json === 'string' ? JSON.parse(row.signature_json) : row.signature_json) as Record<string, Record<string, unknown>>;
    envelope.signature.value = Buffer.from('forged').toString('base64url');
    await db.updateTable('affirmation_signatory').set({ signature_json: JSON.stringify(envelope) }).where('id', '=', slotId).execute();
    const seal = await admin.post(`/api/v1/affirmations/${affirmationId}/seal`);
    expect(seal.status).toBe(409);
    expect(seal.body.reason).toBe('invalid_slot_signatures');
  });

  it('refuses an HMAC algorithm or unknown fields on a digital signature update (I5)', async () => {
    const admin = await loginAs('admin');
    const sig = await digitalSignature(admin);
    expect((await admin.put(`/api/v1/me/signatures/${sig.id}`).send({ payload: { signatureAlgorithm: 'HS256' } })).status).toBe(400);
    expect((await admin.put(`/api/v1/me/signatures/${sig.id}`).send({ payload: { publicKeyPem: 123 } })).status).toBe(400);
    expect((await admin.put(`/api/v1/me/signatures/${sig.id}`).send({ payload: { surprise: true } })).status).toBe(400);
  });
});
