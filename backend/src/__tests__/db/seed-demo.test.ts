/**
 * End-to-end guard that seedDemoData() loads cleanly against a fresh
 * database. A foreign-key violation inside demo-data.json (e.g. a
 * claim_evidence row pointing at a claim or evidence that no longer
 * exists) blows up at dev-start with a PGlite FK error. This test
 * exercises the full seed path so CI catches that shape of bug
 * before it reaches a running installation.
 *
 * The seed helpers are imported dynamically inside the test to pick
 * up the mocked/test database wiring that `setupHttpTests` puts in
 * place.
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupHttpTests, loginAs } from '../helpers/http.js';

describe('seedDemoData loads demo-data.json without FK violations', () => {
  setupHttpTests();

  it('seeds every demo row, resolves all FK references, and is idempotent', async () => {
    // Ensure an admin user exists so seedDemoData's ADMIN_USER
    // resolver returns a real id rather than a fresh uuid() that
    // fails the audit_log.user_id FK.
    await loginAs('admin');

    const { getDatabase } = await import('../../db/connection.js');
    const db = getDatabase();

    // Import the SSDF standard first so seedSSDF can resolve SSDF
    // requirement identifiers. The production setup-wizard path
    // fetches the standards feed from cyclonedx.org at first boot;
    // here we import a committed local copy of the same document
    // so the test works offline and in CI where network egress
    // may be blocked. The fixture path resolves from the test file
    // location so it is stable across local / CI / sandbox runs.
    const { importStandard } = await import('../../services/standard-import.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const feedPath = path.resolve(here, '../fixtures/nist-ssdf-1.1.cdx.json');
    if (!fs.existsSync(feedPath)) {
      throw new Error(
        `SSDF fixture not found at ${feedPath}. ` +
          'Ensure backend/src/__tests__/fixtures/nist-ssdf-1.1.cdx.json is committed.',
      );
    }
    const raw = fs.readFileSync(feedPath, 'utf8');
    const feed = JSON.parse(raw);
    const std = feed.definitions?.standards?.[0];
    expect(std).toBeDefined();
    await importStandard(std, { markAsImported: true });

    // Seed the demo fixture end to end.
    const { seedDemoData } = await import('../../db/seed-demo.js');
    let seeded: boolean;
    try {
      seeded = await seedDemoData();
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      throw new Error(`seedDemoData threw: ${message}`);
    }
    expect(seeded).toBe(true);

    // The sealed demo affirmation verifies on every layer: each slot,
    // the declarations seal and the document seal. The digital slot used
    // to report "canonical payload has drifted since signing" because the
    // JSF provider returned a hash without the embedded public key.
    const affirmationId = '00000000-0000-4000-b300-000000000002';
    const { verifyAffirmation } = await import('../../routes/affirmations.js');
    const verifyDemo = async () =>
      verifyAffirmation(
        db,
        (await db.selectFrom('affirmation').where('id', '=', affirmationId).selectAll().executeTakeFirstOrThrow()) as never,
      );
    const fresh = await verifyDemo();
    expect(fresh.issues).toEqual([]);
    expect(fresh.verified).toBe(true);

    // Idempotency: a second call on the same database is a no-op and
    // returns false (guarded by the "entities already exist" check
    // at the top of seedDemoData). The seal step still runs as a
    // repair pass and is itself step-idempotent, so nothing changes
    // on a healthy database.
    const again = await seedDemoData();
    expect(again).toBe(false);

    // Databases seeded before the provider fix carry the stale digital
    // slot hash. The repair pass replaces it because the signature
    // itself is valid.
    const [digitalSlot] = await db
      .selectFrom('affirmation_signatory')
      .where('affirmation_id', '=', affirmationId)
      .select(['id', 'canonical_hash'])
      .orderBy('created_at', 'asc')
      .execute();
    const goodHash = digitalSlot.canonical_hash;
    await db
      .updateTable('affirmation_signatory')
      .set({ canonical_hash: 'f'.repeat(64) })
      .where('id', '=', digitalSlot.id)
      .execute();
    expect((await verifyDemo()).verified).toBe(false);
    await seedDemoData();
    const repairedHash = await db
      .selectFrom('affirmation_signatory')
      .where('id', '=', digitalSlot.id)
      .select('canonical_hash')
      .executeTakeFirstOrThrow();
    expect(repairedHash.canonical_hash).toBe(goodHash);
    expect((await verifyDemo()).verified).toBe(true);

    // Repair-pass regression guard: simulate the pre-fix state
    // where the data seed ran but the seal failed, leaving slot
    // signatures absent and the affirmation unsealed. Then call
    // seedDemoData again and assert the seal step completes the
    // missing work in place, without a DB wipe.
    await db
      .updateTable('affirmation_signatory')
      .set({
        signature_json: null,
        signed_at: null,
        signed_by: null,
        canonical_hash: null,
      })
      .where('affirmation_id', '=', affirmationId)
      .execute();
    await db
      .updateTable('affirmation')
      .set({
        sealed_at: null,
        sealed_by: null,
        canonical_hash: null,
        declarations_signature_json: null,
        document_signature_json: null,
        platform_key_fingerprint: null,
      })
      .where('id', '=', affirmationId)
      .execute();
    await db
      .updateTable('attestation')
      .set({ signature_json: null, signed_at: null, signature_canonical_hash: null })
      .where('assessment_id', '=', '00000000-0000-4000-b400-100000000001')
      .execute();

    const repair = await seedDemoData();
    expect(repair).toBe(false);

    const repairedAff = await db
      .selectFrom('affirmation')
      .where('id', '=', affirmationId)
      .select([
        'sealed_at',
        'declarations_signature_json',
        'document_signature_json',
      ])
      .executeTakeFirst();
    expect(repairedAff?.sealed_at).toBeDefined();
    expect(repairedAff?.sealed_at).not.toBeNull();
    expect(repairedAff?.declarations_signature_json).not.toBeNull();
    expect(repairedAff?.document_signature_json).not.toBeNull();

    const repairedSlots = await db
      .selectFrom('affirmation_signatory')
      .where('affirmation_id', '=', affirmationId)
      .select(['signature_json'])
      .execute();
    expect(repairedSlots.length).toBeGreaterThan(0);
    for (const slot of repairedSlots) {
      expect(slot.signature_json).not.toBeNull();
    }
    expect((await verifyDemo()).verified).toBe(true);

    // Sanity checks: at least some core rows should have landed.
    const { count: assessmentCount } = (await db
      .selectFrom('assessment')
      .select(db.fn.count<number>('id').as('count'))
      .executeTakeFirstOrThrow()) as { count: number | string };
    expect(Number(assessmentCount)).toBeGreaterThan(0);

    const { count: claimCount } = (await db
      .selectFrom('claim')
      .select(db.fn.count<number>('id').as('count'))
      .executeTakeFirstOrThrow()) as { count: number | string };
    expect(Number(claimCount)).toBeGreaterThan(0);

    const { count: claimEvidenceCount } = (await db
      .selectFrom('claim_evidence')
      .select(db.fn.count<number>('claim_id').as('count'))
      .executeTakeFirstOrThrow()) as { count: number | string };
    expect(Number(claimEvidenceCount)).toBeGreaterThan(0);

    // End-to-end: exporting the SSDF attestation should produce a
    // BOM that carries (a) definitions.standards with exactly one
    // standard (the attested SSDF standard) using the upstream
    // bom-ref verbatim; (b) attestation.signature; (c)
    // declarations.signature; (d) bom.signature; and (e) at least
    // one affirmation signatory valid against the CycloneDX
    // Signatory oneOf.
    const ssdfAttestation = await db
      .selectFrom('attestation')
      .where('assessment_id', '=', '00000000-0000-4000-b400-100000000001')
      .select(['id'])
      .executeTakeFirst();
    expect(ssdfAttestation).toBeDefined();
    const attestationId = ssdfAttestation?.id as string;

    const adminAgent = await loginAs('admin');
    const exportRes = await adminAgent.get(
      `/api/v1/attestations/${attestationId}/export`,
    );
    expect(exportRes.status).toBe(200);
    const bom = exportRes.body as Record<string, unknown>;

    // (a) Exactly the SSDF standard, bom-ref verbatim.
    const defs = bom.definitions as Record<string, unknown>;
    const standards = defs?.standards as Array<Record<string, unknown>>;
    expect(Array.isArray(standards)).toBe(true);
    expect(standards).toHaveLength(1);
    expect(standards[0]['bom-ref']).toBe('ssdf-1.1');
    const reqs = standards[0].requirements as Array<Record<string, unknown>>;
    // The SSDF feed has 65 requirement rows (groups + leaves).
    expect(reqs.length).toBe(65);
    const firstLeaf = reqs.find((r) => r.identifier === 'PO.1.1');
    expect(firstLeaf?.['bom-ref']).toBe('ssdf-1.1-PO.1.1');

    // (b) attestation.signature
    const declarations = bom.declarations as Record<string, unknown>;
    const attestations = declarations.attestations as Array<Record<string, unknown>>;
    expect(attestations[0].signature).toBeDefined();

    // (c) declarations.signature
    expect(declarations.signature).toBeDefined();

    // (d) bom.signature (root document seal)
    expect(bom.signature).toBeDefined();

    // (e) affirmation signatories
    const affirmation = declarations.affirmation as Record<string, unknown>;
    expect(affirmation).toBeDefined();
    const signatories = affirmation.signatories as Array<Record<string, unknown>>;
    expect(Array.isArray(signatories)).toBe(true);
    expect(signatories.length).toBeGreaterThan(0);
    for (const s of signatories) {
      const hasSignature = Boolean(s.signature);
      const hasExtRefAndOrg = Boolean(s.externalReference) && Boolean(s.organization);
      expect(hasSignature || hasExtRefAndOrg).toBe(true);
    }

    // (f) Every signature object is a JSF signer with only the
    // whitelisted fields (algorithm, keyId, publicKey,
    // certificatePath, excludes, value). Our internal sign path
    // stores the full canonical payload with a nested .signature;
    // the exporter must strip that wrapper or the CycloneDX signer
    // schema (additionalProperties:false) rejects the BOM.
    const JSF_ALLOWED = new Set([
      'algorithm',
      'keyId',
      'publicKey',
      'certificatePath',
      'excludes',
      'value',
    ]);
    const assertJsfSigner = (label: string, sig: unknown) => {
      expect(sig).toBeDefined();
      const obj = sig as Record<string, unknown>;
      expect(typeof obj.algorithm).toBe('string');
      expect(typeof obj.value).toBe('string');
      for (const key of Object.keys(obj)) {
        if (!JSF_ALLOWED.has(key)) {
          throw new Error(`${label} has non-JSF key: ${key}`);
        }
      }
    };
    assertJsfSigner('attestation.signature', attestations[0].signature);
    assertJsfSigner('declarations.signature', declarations.signature);
    assertJsfSigner('bom.signature', bom.signature);
    for (let i = 0; i < signatories.length; i += 1) {
      const s = signatories[i];
      if (s.signature) {
        assertJsfSigner(`signatories[${i}].signature`, s.signature);
      }
    }

    // (g) The whole BOM validates against bom-1.7.schema.json.
    const { validateBom } = await import('../../cdxspec/validator/index.js');
    const validation = validateBom(bom, '1.7');
    if (!validation.valid) {
      console.error(
        'Exported BOM failed schema validation:',
        JSON.stringify(validation.errors).slice(0, 4000),
      );
    }
    expect(validation.valid).toBe(true);

    // Silence unused-import lint on uuidv4 (kept in scope for
    // future fixtures that may need to tack on extra rows before
    // re-seeding).
    void uuidv4;
  });
});
