/**
 * Seal the Supplier A SSDF demo affirmation end-to-end so the demo
 * ships with a working signed export. The flow mirrors the production
 * /api/v1/affirmations/:id/seal route:
 *
 *   1. Generate a deterministic RSA keypair for the digital signer,
 *      plant a `user_signature` row of type `digital` for the admin
 *      user, and sign the first slot with it. The slot envelope has
 *      the same shape the runtime /sign route produces.
 *   2. Plant a second `user_signature` row of type `electronic` for
 *      the second signatory, sign the second slot with an
 *      electronic-shaped envelope (no cryptographic value — name +
 *      legal intent only). Also populate the underlying
 *      `signatory.external_reference_*` columns so the exported
 *      Signatory block satisfies the CycloneDX 1.7 oneOf through the
 *      externalReference branch.
 *   3. Pull the platform key via `getActiveKey()` (auto-creates on
 *      first run), canonicalise the declarations subtree + document
 *      envelope payload, and sign both with the platform key.
 *   4. Persist the envelopes, canonical hash, sealed_at / sealed_by,
 *      and platform key fingerprint onto the affirmation row.
 *
 * Deliberate design notes:
 *   - The RSA keypair is generated fresh on every seed run so we
 *     never commit real private key material into the repo. The
 *     envelope values therefore vary run-to-run, which is fine for
 *     the demo because verification walks the embedded JWK public
 *     key on each verify.
 *   - The electronic signatory's `external_reference_*` fields are
 *     what ultimately drive the schema-valid Signatory shape in the
 *     attestation export — they do not flow through the JSF envelope.
 */

import { logger } from '../utils/logger.js';
import { getDatabase } from './connection.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { encryptionService } from '../utils/encryption.js';
import { getSignatureProviders } from '../signatures/index.js';
import { getActiveKey } from '../services/platform-keys.js';
import { exportPublicJwk } from '@cyclonedx/sign';
import {
  buildSlotCanonicalPayload,
  buildDeclarationsSubtree,
  buildDocumentEnvelopePayload,
  extractIdentityFromSignatureEnvelope,
  type AffirmationRow,
  type SlotRow,
  type StoredSignatoryIdentity,
  type StoredDigitalPayload,
  type StoredElectronicPayload,
} from '../routes/affirmations.js';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

const SSDF_AFFIRMATION_ID = '00000000-0000-4000-b300-000000000002';

/**
 * Pull an admin user id so user_signature rows and sealed_by columns
 * can be attributed to a real account. Falls back to null if no
 * admin has been provisioned yet, in which case the seal step is a
 * no-op (demo data can reseed later).
 */
async function findAdminUserId(): Promise<string | null> {
  const db = getDatabase();
  // The admin role's `name` column is "Administrator" (see
  // DEFAULT_ROLES in db/seed.ts). Look up by the stable `key` column
  // instead so a display-name change does not silently break the
  // seal step. Fall back to the legacy `app_user.role = 'admin'`
  // column for installs that predate the role_id RBAC migration.
  const admin = await db
    .selectFrom('app_user')
    .innerJoin('role', 'role.id', 'app_user.role_id')
    .where('role.key', '=', 'admin')
    .select('app_user.id')
    .executeTakeFirst();
  if (admin) return admin.id;

  const legacy = await db
    .selectFrom('app_user')
    // biome-ignore lint/suspicious/noExplicitAny: legacy `role` column
    .where('role' as any, '=', 'admin')
    .select('id')
    .executeTakeFirst();
  return legacy?.id ?? null;
}

/**
 * Inline fingerprint helper. me-signatures.ts has its own private
 * version; duplicating here keeps the seed module self contained so
 * a refactor of that route doesn't silently break the seed.
 */
function computeFingerprintPem(pem: string): string {
  const key = crypto.createPublicKey(pem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

/**
 * Insert a user_signature row of the requested type and return its
 * id. The payload is encrypted with the live encryption service so
 * the row is indistinguishable from a runtime-created signature.
 */
async function createUserSignature(
  userId: string,
  args:
    | { type: 'digital'; label: string; payload: StoredDigitalPayload }
    | { type: 'electronic'; label: string; payload: StoredElectronicPayload; fingerprint?: string },
): Promise<string> {
  const db = getDatabase();

  // Reuse any existing user_signature row with the same (user, label)
  // pair so the sealer's repair pass does not trip the
  // `user_signature_user_id_label_key` unique constraint.
  const existing = await db
    .selectFrom('user_signature')
    .where('user_id', '=', userId)
    .where('label', '=', args.label)
    .select('id')
    .executeTakeFirst();
  if (existing) return existing.id;

  const id = uuidv4();

  const payloadEncrypted = encryptionService.encrypt(JSON.stringify(args.payload));
  const row: Record<string, unknown> = {
    id,
    user_id: userId,
    label: args.label,
    signature_type: args.type,
    signature_format: args.type === 'digital' ? 'jsf' : null,
    backend_type: 'local',
    payload_encrypted: payloadEncrypted,
    key_fingerprint: null,
  };
  if (args.type === 'digital') {
    row.key_fingerprint = computeFingerprintPem(args.payload.publicKeyPem);
  }
  await db.insertInto('user_signature').values(row).execute();
  return id;
}

/**
 * Stand up a digital slot envelope equivalent to what the runtime
 * /sign route produces. Signs the canonical slot payload with the
 * supplied private key and returns the envelope + canonical hash
 * bundle ready to persist.
 */
async function buildDigitalSlotEnvelope(args: {
  affirmation: AffirmationRow;
  slot: SlotRow;
  identity: StoredSignatoryIdentity;
  privateKeyPem: string;
  publicKeyPem: string;
  algorithm: string;
}): Promise<{ envelope: Record<string, unknown>; canonicalHash: string }> {
  const canonicalPayload = buildSlotCanonicalPayload({
    affirmation: args.affirmation,
    slot: args.slot,
    identity: args.identity,
  });
  const provider = getSignatureProviders().getDefault();
  const result = await provider.sign(
    canonicalPayload as unknown as Parameters<typeof provider.sign>[0],
    {
      algorithm: args.algorithm,
      privateKey: args.privateKeyPem,
      publicKey: args.publicKeyPem,
    },
  );
  const embeddedPublicJwk = exportPublicJwk(args.publicKeyPem);
  // Mirror the route's slot envelope shape: signature object holds
  // only JSF signaturecore fields. Application bookkeeping
  // (signature_type, canonical_hash, signed_at) lives on the
  // affirmation_signatory row.
  const envelope: Record<string, unknown> = {
    ...canonicalPayload,
    signature: {
      algorithm: args.algorithm,
      publicKey: embeddedPublicJwk,
      value: result.signatureValue,
    },
  };
  return { envelope, canonicalHash: result.canonicalHashSha256 };
}

/**
 * Build the electronic slot envelope. Electronic signatures are not
 * cryptographic, so the envelope echoes the canonical payload and
 * attaches a named legal intent block. The platform seal over the
 * declarations subtree is what ultimately binds these rows.
 */
function buildElectronicSlotEnvelope(args: {
  affirmation: AffirmationRow;
  slot: SlotRow;
  identity: StoredSignatoryIdentity;
  signedName: string;
  jurisdiction: string | null;
  legalIntent: string | null;
}): { envelope: Record<string, unknown>; canonicalHash: string } {
  const canonicalPayload = buildSlotCanonicalPayload({
    affirmation: args.affirmation,
    slot: args.slot,
    identity: args.identity,
  });
  const provider = getSignatureProviders().getDefault();
  const { sha256Hex: canonicalHash } = provider.canonicalize(
    canonicalPayload as unknown as Parameters<typeof provider.canonicalize>[0],
    { algorithm: 'ES256' },
  );
  const envelope: Record<string, unknown> = {
    ...canonicalPayload,
    signature: {
      type: 'electronic',
      signedName: args.signedName,
      signedAt: new Date().toISOString(),
      jurisdiction: args.jurisdiction,
      legalIntent: args.legalIntent,
      imageDataUri: null,
      canonicalPayloadHash: canonicalHash,
    },
  };
  return { envelope, canonicalHash };
}

/** The envelope and JSF signer of a signed digital slot, or null. */
function parseDigitalSlotEnvelope(signatureJson: unknown): {
  envelope: Record<string, unknown>;
  signature: { algorithm: string; publicKey?: unknown; value: string };
} | null {
  const envelope = (typeof signatureJson === 'string' ? JSON.parse(signatureJson) : signatureJson) as
    | Record<string, unknown>
    | null;
  const signature = envelope?.signature as { algorithm?: unknown; publicKey?: unknown; value?: unknown } | undefined;
  if (!envelope || typeof signature?.value !== 'string' || typeof signature.algorithm !== 'string') return null;
  return { envelope, signature: signature as { algorithm: string; publicKey?: unknown; value: string } };
}

/**
 * Seeds before the JSF provider fix stored a digital slot hash computed
 * without the embedded public key, so verify reported the slot as
 * drifted although its signature is valid. When the signature verifies,
 * replace the stored hash with the one verify recomputes. A slot whose
 * signature does not verify is left alone.
 */
async function repairDigitalSlotHash(
  db: ReturnType<typeof getDatabase>,
  affirmation: AffirmationRow,
  slot: SlotRow,
): Promise<void> {
  const parsed = parseDigitalSlotEnvelope(slot.signature_json);
  if (!parsed) return;
  const { envelope, signature } = parsed;
  const identity = extractIdentityFromSignatureEnvelope(envelope);
  if (!identity) return;
  const provider = getSignatureProviders().getDefault();
  const { sha256Hex } = provider.canonicalize(
    buildSlotCanonicalPayload({ affirmation, slot, identity }) as unknown as Parameters<typeof provider.canonicalize>[0],
    {
      algorithm: signature.algorithm,
      ...(signature.publicKey ? { publicKey: signature.publicKey as Record<string, unknown> } : {}),
    } as Parameters<typeof provider.canonicalize>[1],
  );
  if (sha256Hex === slot.canonical_hash) return;

  const check = await provider.verify(envelope as unknown as Parameters<typeof provider.verify>[0], {
    requireEmbeddedPublicKey: false,
  });
  if (!check.valid) {
    logger.warn('Demo seal: digital slot hash differs and its signature does not verify; leaving it', {
      slotId: slot.id,
      reasons: check.reasons,
    });
    return;
  }
  await db
    .updateTable('affirmation_signatory')
    .set({ canonical_hash: sha256Hex, updated_at: new Date() })
    .where('id', '=', slot.id)
    .execute();
  logger.info('Demo seal: repaired digital slot canonical hash', { slotId: slot.id });
}

export async function sealSsdfDemoAffirmation(): Promise<boolean> {
  const db = getDatabase();
  const adminUserId = await findAdminUserId();
  if (!adminUserId) {
    logger.warn('Demo seal skipped: no admin user found yet');
    return false;
  }

  const affirmation = (await db
    .selectFrom('affirmation')
    .where('id', '=', SSDF_AFFIRMATION_ID)
    .selectAll()
    .executeTakeFirst()) as AffirmationRow | undefined;
  if (!affirmation) {
    logger.warn('Demo seal skipped: SSDF affirmation row not present', {
      affirmationId: SSDF_AFFIRMATION_ID,
    });
    return false;
  }
  // The sealer used to early-return whenever `sealed_at` was set.
  // That blocked repair: a half-completed prior run could leave the
  // affirmation sealed (declarations + document envelopes present)
  // but the signatory slots unsigned, and there was no path back to
  // a full seal short of wiping the DB. Now we step through each
  // layer independently and only do work that is missing.
  const slots = (await db
    .selectFrom('affirmation_signatory')
    .where('affirmation_id', '=', affirmation.id)
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute()) as SlotRow[];
  if (slots.length === 0) {
    logger.warn('Demo seal skipped: no slots on SSDF affirmation');
    return false;
  }

  // Resolve the signatory identity rows + their organizations so we
  // can construct StoredSignatoryIdentity payloads.
  const slotIdentityMap = new Map<string, StoredSignatoryIdentity>();
  for (const slot of slots) {
    if (!slot.signatory_id) continue;
    const sig = await db
      .selectFrom('signatory')
      .where('id', '=', slot.signatory_id)
      .selectAll()
      .executeTakeFirst();
    if (!sig) continue;
    const org = sig.organization_id
      ? await db
          .selectFrom('organization')
          .where('id', '=', sig.organization_id)
          .selectAll()
          .executeTakeFirst()
      : null;
    slotIdentityMap.set(slot.id, {
      name: sig.name ?? '',
      role: sig.role ?? undefined,
      organization: { name: org?.name ?? '' },
    });
  }

  // --- Slot 0: digital signature ---
  //
  // Skip when the slot has already been signed in a prior run so
  // the seed can complete a partial seal without regenerating keys
  // (re-signing would produce a new envelope whose canonical bytes
  // differ, invalidating any downstream declarations seal that
  // covered the prior envelope).
  const firstSlot = slots[0];
  const firstIdentity = slotIdentityMap.get(firstSlot.id);
  if (!firstIdentity) {
    logger.warn('Demo seal aborted: missing identity on first slot');
    return false;
  }
  let digitalSignatureId: string | null = null;
  if (!firstSlot.signature_json) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const digitalPayload: StoredDigitalPayload = {
      name: firstIdentity.name,
      role: firstIdentity.role,
      organization: firstIdentity.organization,
      signatureFormat: 'jsf',
      signatureAlgorithm: 'RS256',
      publicKeyPem,
    };
    digitalSignatureId = await createUserSignature(adminUserId, {
      type: 'digital',
      label: 'Demo Digital Signature (SSDF)',
      payload: digitalPayload,
    });
    const firstSlotResult = await buildDigitalSlotEnvelope({
      affirmation,
      slot: firstSlot,
      identity: firstIdentity,
      privateKeyPem,
      publicKeyPem,
      algorithm: 'RS256',
    });
    await db
      .updateTable('affirmation_signatory')
      .set(
        toSnakeCase({
          signatureJson: JSON.stringify(firstSlotResult.envelope),
          canonicalHash: firstSlotResult.canonicalHash,
          signedAt: new Date(),
          signedBy: adminUserId,
          updatedAt: new Date(),
        }),
      )
      .where('id', '=', firstSlot.id)
      .execute();
  } else {
    logger.info('Demo seal: digital slot already signed, skipping', {
      slotId: firstSlot.id,
    });
    await repairDigitalSlotHash(db, affirmation, firstSlot);
  }

  // --- Slot 1 (if present): electronic signature ---
  let electronicSignatureId: string | null = null;
  if (slots.length > 1) {
    const secondSlot = slots[1];
    const secondIdentity = slotIdentityMap.get(secondSlot.id);
    if (secondIdentity) {
      if (!secondSlot.signature_json) {
        const electronicPayload: StoredElectronicPayload = {
          name: secondIdentity.name,
          role: secondIdentity.role,
          organization: secondIdentity.organization,
          signedName: secondIdentity.name,
          jurisdiction: 'US',
          legalIntent: 'I intend to sign this attestation',
        };
        electronicSignatureId = await createUserSignature(adminUserId, {
          type: 'electronic',
          label: 'Demo Electronic Signature (SSDF)',
          payload: electronicPayload,
        });
        const electronicResult = buildElectronicSlotEnvelope({
          affirmation,
          slot: secondSlot,
          identity: secondIdentity,
          signedName: secondIdentity.name,
          jurisdiction: 'US',
          legalIntent: 'I intend to sign this attestation',
        });
        await db
          .updateTable('affirmation_signatory')
          .set(
            toSnakeCase({
              signatureJson: JSON.stringify(electronicResult.envelope),
              canonicalHash: electronicResult.canonicalHash,
              signedAt: new Date(),
              signedBy: adminUserId,
              updatedAt: new Date(),
            }),
          )
          .where('id', '=', secondSlot.id)
          .execute();
      }

      // Populate the signatory's external_reference_* columns so the
      // CycloneDX Signatory object emitted at export time carries an
      // externalReference that satisfies the oneOf electronic branch.
      // Idempotent on its own (UPDATE is a no-op if the values match).
      if (secondSlot.signatory_id) {
        await db
          .updateTable('signatory')
          .set({
            external_reference_type: 'electronic-signature',
            external_reference_url:
              'https://example.com/demo/electronic-signatures/' + secondSlot.signatory_id,
            updated_at: new Date(),
          })
          .where('id', '=', secondSlot.signatory_id)
          .execute();
      }
    }
  }

  // --- Per-attestation signatures ---
  //
  // CycloneDX 1.7 allows each declarations.attestations[i] to carry
  // its own JSF signature, distinct from the affirmation signatory
  // signatures and the platform document seal. Seal every attestation
  // on the assessment BEFORE the platform seal below so the platform
  // envelope covers the attestation signatures as part of its own
  // canonical input (tampering with an attestation signature
  // invalidates the outer declarations seal).
  if (affirmation.assessment_id) {
    await sealAssessmentAttestations(db, affirmation.assessment_id, adminUserId);
  }

  // --- Platform seal ---
  // Skip when the affirmation already carries both envelopes so
  // a second seal pass does not overwrite them with a fresh signature
  // whose canonical bytes differ.
  if (!affirmation.sealed_at) {
    const refreshedSlots = (await db
      .selectFrom('affirmation_signatory')
      .where('affirmation_id', '=', affirmation.id)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute()) as SlotRow[];

    const declarationsSubtree = buildDeclarationsSubtree({
      affirmation,
      slots: refreshedSlots,
      slotIdentities: slotIdentityMap,
    });
    const platformKey = await getActiveKey();
    const provider = getSignatureProviders().getDefault();
    const declarationsSign = await provider.sign(
      declarationsSubtree as unknown as Parameters<typeof provider.sign>[0],
      {
        algorithm: platformKey.algorithm,
        privateKey: platformKey.privateKeyPem,
        publicKey: platformKey.publicKeyPem,
      },
    );
    const sealedAt = new Date();
    const documentPayload = buildDocumentEnvelopePayload({
      affirmation,
      declarationsSignatureValue: declarationsSign.signatureValue,
      declarationsCanonicalHash: declarationsSign.canonicalHashSha256,
      platformKeyFingerprint: platformKey.fingerprint,
      sealedAtIso: sealedAt.toISOString(),
    });
    const documentSign = await provider.sign(
      documentPayload as unknown as Parameters<typeof provider.sign>[0],
      {
        algorithm: platformKey.algorithm,
        privateKey: platformKey.privateKeyPem,
        publicKey: platformKey.publicKeyPem,
      },
    );

    await db
      .updateTable('affirmation')
      .set(
        toSnakeCase({
          sealedAt,
          sealedBy: adminUserId,
          canonicalHash: declarationsSign.canonicalHashSha256,
          platformKeyFingerprint: platformKey.fingerprint,
          declarationsSignatureJson: JSON.stringify(declarationsSign.envelope),
          documentSignatureJson: JSON.stringify(documentSign.envelope),
          updatedAt: new Date(),
        }),
      )
      .where('id', '=', affirmation.id)
      .execute();

    logger.info('Demo SSDF affirmation sealed', {
      affirmationId: affirmation.id,
      digitalSignatureId,
      electronicSignatureId,
      platformKeyFingerprint: platformKey.fingerprint,
    });
  } else {
    logger.info('Demo SSDF affirmation already sealed; completed any missing sub-layers', {
      affirmationId: affirmation.id,
    });
  }

  return true;
}

/**
 * Sign every attestation on the given assessment with a freshly
 * generated RSA keypair (the "assessor key"). The canonical payload
 * is exactly what the exporter emits under
 * `declarations.attestations[i]`, sans the `signature` field itself.
 * Stores the envelope on `attestation.signature_json` so the runtime
 * export path can round trip it without regenerating.
 *
 * The private key is discarded after signing; only the envelope
 * (which embeds the public JWK) is persisted. Verifiers walk the
 * embedded key on each verify, so this is self contained.
 */
async function sealAssessmentAttestations(
  db: ReturnType<typeof getDatabase>,
  assessmentId: string,
  adminUserId: string,
): Promise<void> {
  const { attestationFromRow, claimFromRow, isCounterClaim } = await import(
    '../cdxspec/writer/index.js'
  );
  const { TargetResolver } = await import('../cdxspec/writer/targets.js');
  const { refFor } = await import('../cdxspec/bomref.js');

  const attestations = await db
    .selectFrom('attestation')
    .where('assessment_id', '=', assessmentId)
    .selectAll()
    .execute();
  if (attestations.length === 0) return;

  // Skip attestations that were already signed in a prior run so
  // we do not overwrite a signature the outer declarations seal
  // may already have covered.
  const unsigned = attestations.filter((a) => !a.signature_json);
  if (unsigned.length === 0) {
    logger.info('Demo seal: per-attestation signatures already present, skipping', {
      assessmentId,
      count: attestations.length,
    });
    return;
  }

  // Generate one assessor keypair per batch. In a real deployment
  // each assessor would bring their own key; for the demo a single
  // key signs every attestation on the assessment, which is the
  // simplest shape that still demonstrates the CycloneDX 1.7
  // per-attestation signature layer.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const provider = getSignatureProviders().getDefault();
  const algorithm = 'RS256';

  for (const att of unsigned) {
    // Rebuild the exported attestation object from DB rows so the
    // canonical hash matches what the exporter will later compute.
    const requirements = await db
      .selectFrom('attestation_requirement')
      .innerJoin('requirement', 'requirement.id', 'attestation_requirement.requirement_id')
      .where('attestation_requirement.attestation_id', '=', att.id)
      .select([
        'attestation_requirement.requirement_id',
        'attestation_requirement.conformance_score',
        'attestation_requirement.conformance_rationale',
        'attestation_requirement.confidence_score',
        'attestation_requirement.confidence_rationale',
        'requirement.imported_bom_ref as requirement_imported_bom_ref',
      ])
      .execute();

    const claimRows = await db
      .selectFrom('claim')
      .where('attestation_id', '=', att.id)
      .selectAll()
      .execute();

    const resolver = new TargetResolver();
    const claimRefs = new Map<
      string,
      { claims: string[]; counterClaims: string[] }
    >();
    const allClaims: string[] = [];
    const allCounterClaims: string[] = [];
    for (const row of claimRows) {
      const bomRef =
        typeof row.bom_ref === 'string' && row.bom_ref.length > 0
          ? row.bom_ref
          : refFor('claim', row.id as string);
      if (isCounterClaim(row as { is_counter_claim?: boolean })) {
        allCounterClaims.push(bomRef);
      } else {
        allClaims.push(bomRef);
      }
    }
    // Avoid "unused" lint on imports that only matter in the
    // exporter's broader path. claimFromRow and resolver are kept
    // imported so the signing side stays structurally aligned with
    // the export side; any future per-requirement claim linkage
    // will reuse them here.
    void claimFromRow;
    void resolver;

    // Pull the assessor bom-ref if one is linked to the attestation
    // so the canonical form matches the export.
    let assessorRef: string | undefined;
    if (att.assessor_id) {
      const assessor = await db
        .selectFrom('assessor')
        .where('id', '=', att.assessor_id)
        .select(['bom_ref', 'id'])
        .executeTakeFirst();
      if (assessor) {
        assessorRef =
          typeof assessor.bom_ref === 'string' && assessor.bom_ref.length > 0
            ? assessor.bom_ref
            : refFor('assessor', assessor.id as string);
      }
    }

    const cdxAttestation = attestationFromRow({
      row: { id: att.id as string, summary: (att.summary as string) ?? null },
      requirements: requirements.map((ar) => ({
        requirement_id: ar.requirement_id as string,
        requirement_imported_bom_ref:
          (ar.requirement_imported_bom_ref as string | null) ?? null,
        conformance_score: ar.conformance_score,
        conformance_rationale: (ar.conformance_rationale as string) ?? null,
        confidence_score: ar.confidence_score ?? null,
        confidence_rationale: (ar.confidence_rationale as string) ?? null,
      })),
      claimRefs: {
        byRequirementId: claimRefs,
        allClaims,
        allCounterClaims,
      },
      assessorRef,
    });

    const signResult = await provider.sign(
      cdxAttestation as unknown as Parameters<typeof provider.sign>[0],
      { algorithm, privateKey: privateKeyPem, publicKey: publicKeyPem },
    );

    await db
      .updateTable('attestation')
      .set(
        toSnakeCase({
          signatureJson: JSON.stringify(signResult.envelope),
          signedAt: new Date(),
          signatureCanonicalHash: signResult.canonicalHashSha256,
          updatedAt: new Date(),
        }),
      )
      .where('id', '=', att.id as string)
      .execute();
  }

  void adminUserId; // signed_by on attestation table not tracked per-row
  logger.info('Demo per-attestation signatures produced', {
    assessmentId,
    count: attestations.length,
  });
}
