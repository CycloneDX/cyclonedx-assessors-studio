/**
 * Security regression tests: input handling (security review I4, I7, I8,
 * I9, I10/W10, I12).
 */
import { describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import supertest from 'supertest';
import { setupHttpTests, loginAs, getBaseUrl } from '../helpers/http.js';
import { contentDisposition } from '../../utils/content-disposition.js';

async function db() {
  return (await import('../../db/connection.js')).getDatabase();
}

function attestationDoc(standardRef: string, requirements: Record<string, unknown>[]) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    definitions: { standards: [{ 'bom-ref': standardRef, name: standardRef, version: '1', requirements }] },
    declarations: { attestations: [], claims: [], evidence: [] },
  };
}

describe('Input hardening (security review)', () => {
  setupHttpTests();

  describe('CycloneDX import (I4)', () => {
    it('does not append requirements to an existing standard on re-import', async () => {
      const admin = await loginAs('admin');
      const ref = `IMP-${uuidv4().slice(0, 8)}`;
      const first = await admin.post('/api/v1/import/attestation').send(attestationDoc(ref, [{ 'bom-ref': 'r1', identifier: 'R1', title: 'One' }]));
      expect(first.status).toBe(201);
      const second = await admin.post('/api/v1/import/attestation').send(attestationDoc(ref, [
        { 'bom-ref': 'r1', identifier: 'R1', title: 'One' },
        { 'bom-ref': 'r2', identifier: 'INJECTED', title: 'Appended by an importer' },
      ]));
      expect(second.status).toBe(201);
      const std = await (await db()).selectFrom('standard').select('id').where('identifier', '=', ref).executeTakeFirstOrThrow();
      const reqs = await (await db()).selectFrom('requirement').select('identifier').where('standard_id', '=', std.id).execute();
      expect(reqs.map((r) => r.identifier).sort()).toEqual(['R1']);
    });

    it('coerces wrong-typed nested fields instead of failing half-way', async () => {
      const admin = await loginAs('admin');
      const ref = `IMP-${uuidv4().slice(0, 8)}`;
      const res = await admin.post('/api/v1/import/attestation').send(attestationDoc(ref, [{ 'bom-ref': 'r1', identifier: 'R1', text: 5, title: { not: 'a string' } }]));
      expect(res.status).toBe(201);
    });
  });

  describe('standard import ordering (I12)', () => {
    it('imports a requirement that names itself as parent without overflowing', async () => {
      const { importStandard } = await import('../../services/standard-import.js');
      const ref = `SELF-${uuidv4().slice(0, 8)}`;
      const result = await importStandard({
        'bom-ref': ref,
        name: ref,
        requirements: [
          { 'bom-ref': 'a', identifier: 'A', title: 'A', parent: 'a' },
          { 'bom-ref': 'b', identifier: 'B', title: 'B', parent: 'c' },
          { 'bom-ref': 'c', identifier: 'C', title: 'C', parent: 'b' },
        ],
      } as never);
      expect(result.skipped).toBe(false);
      const count = await (await db()).selectFrom('requirement').select('id').where('standard_id', '=', result.id).execute();
      expect(count).toHaveLength(3);
    });
  });

  describe('pagination and filters (I8)', () => {
    it.each([
      '/api/v1/standards?limit=-5&offset=-1',
      '/api/v1/roles?limit=1.5&offset=abc',
      '/api/v1/users?limit=100000&offset=-3',
      '/api/v1/attestations?limit=-1',
    ])('clamps %s instead of failing', async (url) => {
      const admin = await loginAs('admin');
      expect((await admin.get(url)).status).toBe(200);
    });

    it('rejects an unknown standards state with 400, not 500', async () => {
      const admin = await loginAs('admin');
      expect((await admin.get('/api/v1/standards?state=bogus')).status).toBe(400);
    });
  });

  describe('query and body parsing (I9)', () => {
    it('handles a repeated search parameter', async () => {
      const admin = await loginAs('admin');
      expect((await admin.get('/api/v1/evidence?search=a&search=b')).status).toBe(200);
    });

    it('treats % in a search as a literal character', async () => {
      const admin = await loginAs('admin');
      const tag = uuidv4().slice(0, 8);
      await admin.post('/api/v1/evidence').send({ name: `${tag} 100% coverage` });
      await admin.post('/api/v1/evidence').send({ name: `${tag} other` });
      const res = await admin.get(`/api/v1/evidence?search=${encodeURIComponent(`${tag} 100%`)}&limit=100`);
      const names = (res.body.data as { name: string }[]).map((e) => e.name);
      expect(names).toContain(`${tag} 100% coverage`);
      expect(names).not.toContain(`${tag} other`);
      const wildcard = await admin.get(`/api/v1/evidence?search=${encodeURIComponent('%')}&limit=100`);
      expect((wildcard.body.data as { name: string }[]).every((e) => e.name.includes('%') || /%/.test(JSON.stringify(e)))).toBe(true);
    });

    it('validates request bodies (level requirement ids must be uuids)', async () => {
      const admin = await loginAs('admin');
      const tag = uuidv4().slice(0, 8);
      const std = await admin.post('/api/v1/standards').send({ identifier: `VAL-${tag}`, name: `Validation ${tag}`, version: '1.0' });
      expect(std.status).toBe(201);
      const level = await admin.post(`/api/v1/standards/${std.body.id}/levels`).send({ identifier: 'L1', title: 'Level 1' });
      expect(level.status).toBe(201);
      const levelId = level.body.id ?? level.body.level?.id ?? level.body.data?.id;
      const res = await admin.put(`/api/v1/standards/${std.body.id}/levels/${levelId}/requirements`).send({ requirementIds: ['not-a-uuid'] });
      expect(res.status).toBe(400);
    });

    it('refuses a non-uuid signature id at /sign/prepare with 400, not 500', async () => {
      const admin = await loginAs('admin');
      const res = await admin.post(`/api/v1/affirmations/${uuidv4()}/signatories/${uuidv4()}/sign/prepare`).send({ userSignatureId: 'nope' });
      expect(res.status).toBe(400);
    });
  });

  describe('error responses (I10/W10)', () => {
    it('does not echo parser internals for malformed JSON', async () => {
      const res = await supertest(getBaseUrl()).post('/api/v1/auth/login')
        .set('Content-Type', 'application/json').send('{"username": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Malformed request');
    });

    it('logs a malformed body as a rejected request (warn), not an unhandled error', async () => {
      const { logger } = await import('../../utils/logger.js');
      const error = vi.spyOn(logger, 'error');
      const warn = vi.spyOn(logger, 'warn');
      try {
        await supertest(getBaseUrl()).post('/api/v1/auth/login')
          .set('Content-Type', 'application/json').send('{"username": ');
        expect(error.mock.calls.some(([msg]) => msg === 'Unhandled error')).toBe(false);
        expect(warn).toHaveBeenCalledWith('Request rejected', expect.objectContaining({ status: 400, path: '/api/v1/auth/login' }));
      } finally {
        error.mockRestore();
        warn.mockRestore();
      }
    });
  });

  describe('Content-Disposition (I7)', () => {
    it('keeps a safe ASCII fallback and the real UTF-8 name', () => {
      const header = contentDisposition('inline', 'подпись "x"\r\nSet-Cookie: a=b.png');
      expect(header).not.toMatch(/[\r\n]/);
      expect(header).toMatch(/^inline; filename="[\w\s.\-()]+"; filename\*=UTF-8''/);
      expect(header).toContain(encodeURIComponent('подпись'));
    });
  });
});
