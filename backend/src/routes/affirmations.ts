/**
 * Affirmation routes.
 *
 * Sprint 9 introduces a single affirmation primitive per assessment
 * that ties together a statement, one or more required-signatory
 * slots, a per slot JSF envelope (the signer binds their identity to
 * the statement), and a pair of platform signed envelopes produced at
 * seal time:
 *
 *   declarations.signature  covers the declarations subtree
 *                           (statement + signatories + slot signatures)
 *                           and is platform signed.
 *   document.signature      covers a document identity payload
 *                           (affirmation id, assessment id, sealed at
 *                           timestamp, declarations signature value)
 *                           and is also platform signed.
 *
 * The cascade is intentional: a malicious edit to the declarations
 * subtree breaks the declarations signature, which in turn breaks the
 * document identity signature because the latter binds to the former's
 * signatureValue.
 *
 * Authorisation uses permission keys only:
 *
 *   affirmations.manage  create, update, delete, slot management,
 *                        seal, rescind, verify, delete.
 *   signatures.sign      sign a slot. Slot pinning (required_user_id)
 *                        additionally restricts who can sign.
 *
 * Sealed affirmations are immutable for everyone, including admins;
 * the only mutation path post seal is rescind, which leaves the row
 * intact but marks it rescinded.
 */

import type { JsonObject } from '../signatures/types.js';
import { canParticipateInAssessment } from '../utils/access.js';
import { auditMutations } from '../utils/audit.js';
import { Router, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDatabase } from '../db/connection.js';
import { requireAuth, requireSession, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { toSnakeCase } from '../middleware/camelCase.js';
import { encryptionService } from '../utils/encryption.js';
import { getStorageProvider } from '../storage/index.js';
import { getSignatureProviders } from '../signatures/index.js';
import { exportPublicJwk } from '@cyclonedx/sign';
import { getActiveKey, getKeyByFingerprint } from '../services/platform-keys.js';
import { logger } from '../utils/logger.js';
import {
  AFFIRMATION_CREATED,
  AFFIRMATION_SIGNATORY_ASSIGNED,
  AFFIRMATION_SIGNED,
  AFFIRMATION_SEAL_READY,
  AFFIRMATION_SEALED,
  AFFIRMATION_RESCINDED,
} from '../events/catalog.js';

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createAffirmationSchema = z.object({
  assessmentId: z.string().uuid('Invalid assessment ID'),
  statement: z.string().min(1, 'statement is required'),
});

const updateAffirmationSchema = z.object({
  statement: z.string().min(1, 'statement is required'),
});

const addSlotSchema = z.object({
  requiredTitle: z.string().min(1, 'requiredTitle is required'),
  // Optional pin: when set, only this user can sign the slot.
  requiredUserId: z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional()),
});

const updateSlotSchema = z.object({
  requiredTitle: z.string().min(1).optional(),
  requiredUserId: z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().nullable().optional()),
});

// Sign a slot: users reference one of their own /me/signatures entries.
// The digital branch additionally requires a detached signatureValue
// computed locally against the canonical payload hash returned by
// /sign/prepare.
const signSlotSchema = z.object({
  userSignatureId: z.string().uuid('userSignatureId is required'),
  signatureValue: z.string().optional(),
  canonicalPayloadHash: z.string().optional(),
});

const rescindSchema = z.object({
  reason: z.string().min(1, 'reason is required'),
});

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface AffirmationRow {
  id: string;
  statement: string;
  project_id: string | null;
  entity_id: string | null;
  assessment_id: string | null;
  sealed_at: Date | null;
  sealed_by: string | null;
  canonical_hash: string | null;
  declarations_signature_json: unknown;
  document_signature_json: unknown;
  platform_key_fingerprint: string | null;
  rescinded_at: Date | null;
  rescinded_by: string | null;
  rescind_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SlotRow {
  id: string;
  affirmation_id: string;
  required_title: string;
  required_user_id: string | null;
  signatory_id: string | null;
  signature_json: unknown;
  canonical_hash: string | null;
  signed_at: Date | null;
  signed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface StoredSignatureRow {
  id: string;
  user_id: string;
  signature_type: 'electronic' | 'digital';
  signature_format: 'jsf' | 'x509' | null;
  payload_encrypted: string;
  key_fingerprint: string | null;
  signature_image_filename: string | null;
  signature_image_content_type: string | null;
  signature_image_storage_path: string | null;
  signature_image_binary_content: Buffer | null;
  signature_image_storage_provider: string | null;
}

export interface StoredSignatoryIdentity {
  name: string;
  role?: string;
  organization: {
    name: string;
    address?: {
      country?: string;
      region?: string;
      locality?: string;
      postOfficeBoxNumber?: string;
      postalCode?: string;
      streetAddress?: string;
    };
    url?: string[];
  };
}

export interface StoredElectronicPayload extends StoredSignatoryIdentity {
  signedName?: string;
  jurisdiction?: string;
  legalIntent?: string;
}

export interface StoredDigitalPayload extends StoredSignatoryIdentity {
  signatureFormat: 'jsf' | 'x509';
  signatureAlgorithm: string;
  publicKeyPem: string;
  certificateChain?: string;
}

// ---------------------------------------------------------------------------
// Queries and small helpers
// ---------------------------------------------------------------------------

async function fetchAffirmationById(
  db: ReturnType<typeof getDatabase>,
  id: string,
): Promise<AffirmationRow | undefined> {
  return (await db
    .selectFrom('affirmation')
    .where('id', '=', id)
    .selectAll()
    .executeTakeFirst()) as AffirmationRow | undefined;
}

async function fetchAffirmationByAssessment(
  db: ReturnType<typeof getDatabase>,
  assessmentId: string,
): Promise<AffirmationRow | undefined> {
  return (await db
    .selectFrom('affirmation')
    .where('assessment_id', '=', assessmentId)
    .selectAll()
    .executeTakeFirst()) as AffirmationRow | undefined;
}

async function fetchSlots(
  db: ReturnType<typeof getDatabase>,
  affirmationId: string,
): Promise<SlotRow[]> {
  return (await db
    .selectFrom('affirmation_signatory')
    .where('affirmation_id', '=', affirmationId)
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute()) as SlotRow[];
}

async function fetchSlot(
  db: ReturnType<typeof getDatabase>,
  slotId: string,
): Promise<SlotRow | undefined> {
  return (await db
    .selectFrom('affirmation_signatory')
    .where('id', '=', slotId)
    .selectAll()
    .executeTakeFirst()) as SlotRow | undefined;
}

function rejectIfSealed(affirmation: AffirmationRow, res: Response): boolean {
  if (affirmation.sealed_at) {
    res.status(409).json({
      error: 'Affirmation is immutable once sealed',
      reason: 'sealed',
    });
    return true;
  }
  return false;
}

function rejectIfRescinded(affirmation: AffirmationRow, res: Response): boolean {
  if (affirmation.rescinded_at) {
    res.status(409).json({
      error: 'Affirmation has been rescinded',
      reason: 'rescinded',
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Stored-signature helpers (mirrored from routes/attestations.ts). Keep the
// two modules independent so a future change to one sign path does not
// silently alter the other.
// ---------------------------------------------------------------------------

async function fetchOwnedStoredSignature(
  db: ReturnType<typeof getDatabase>,
  userSignatureId: string,
  userId: string,
): Promise<StoredSignatureRow | undefined> {
  return (await db
    .selectFrom('user_signature')
    .where('id', '=', userSignatureId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()) as StoredSignatureRow | undefined;
}

async function findOrCreateOrganizationByName(
  db: ReturnType<typeof getDatabase>,
  organization: StoredSignatoryIdentity['organization'],
): Promise<string> {
  const existing = await db
    .selectFrom('organization')
    .where('name', '=', organization.name)
    .select(['id'])
    .executeTakeFirst();
  if (existing) {
    return existing.id as string;
  }

  const id = uuidv4();
  const address = organization.address ?? {};
  const website = Array.isArray(organization.url) && organization.url.length > 0
    ? organization.url[0]
    : null;

  await db
    .insertInto('organization')
    .values({
      id,
      name: organization.name,
      country: address.country ?? null,
      region: address.region ?? null,
      locality: address.locality ?? null,
      post_office_box_number: address.postOfficeBoxNumber ?? null,
      postal_code: address.postalCode ?? null,
      street_address: address.streetAddress ?? null,
      website,
    })
    .execute();
  return id;
}

async function materializeSignatoryFromStored(
  db: ReturnType<typeof getDatabase>,
  identity: StoredSignatoryIdentity,
  imageDataUri: string | null,
): Promise<string> {
  const organizationId = await findOrCreateOrganizationByName(db, identity.organization);
  const signatoryId = uuidv4();
  await db
    .insertInto('signatory')
    .values({
      id: signatoryId,
      name: identity.name,
      role: identity.role ?? null,
      organization_id: organizationId,
      external_reference_type: imageDataUri ? 'electronic-signature' : null,
      external_reference_url: imageDataUri,
    })
    .execute();
  return signatoryId;
}

async function loadStoredSignatureImageDataUri(
  row: StoredSignatureRow,
): Promise<string | null> {
  if (!row.signature_image_filename) {
    return null;
  }
  const providerName = row.signature_image_storage_provider || 'database';
  const contentType = row.signature_image_content_type || 'application/octet-stream';
  try {
    if (providerName === 'database') {
      const buf = row.signature_image_binary_content;
      if (!buf) return null;
      const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
    const provider = getStorageProvider();
    const result = await provider.get(row.signature_image_storage_path || '');
    const buffer = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    logger.warn('Failed to load stored signature image; signing slot without image', {
      signatureId: row.id,
      providerName,
      error: (err as Error).message,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/**
 * Canonical payload a slot signature binds to. Pins the signer identity
 * to the exact statement and assessment the slot sits under, so a
 * replay into a different assessment or under a different required
 * title would fail verification.
 */
export function buildSlotCanonicalPayload(args: {
  affirmation: AffirmationRow;
  slot: Pick<SlotRow, 'id' | 'required_title'>;
  identity: StoredSignatoryIdentity;
}): Record<string, unknown> {
  return {
    affirmationId: args.affirmation.id,
    assessmentId: args.affirmation.assessment_id,
    statement: args.affirmation.statement,
    slot: {
      id: args.slot.id,
      requiredTitle: args.slot.required_title,
    },
    signatory: {
      name: args.identity.name,
      role: args.identity.role ?? null,
      organization: { name: args.identity.organization.name },
    },
  };
}

/**
 * Canonical declarations subtree that the platform seals. Mirrors the
 * shape the exporter will emit under declarations.affirmation: a
 * statement plus an ordered list of signatories each carrying its
 * detached JSF signature. Order is stable by slot creation time so
 * re-canonicalization at verify time always lines up.
 */
export function buildDeclarationsSubtree(args: {
  affirmation: AffirmationRow;
  slots: SlotRow[];
  slotIdentities: Map<string, StoredSignatoryIdentity>;
}): Record<string, unknown> {
  const signatories = args.slots.map((slot) => {
    const identity = args.slotIdentities.get(slot.id);
    const name = identity?.name ?? '';
    const entry: Record<string, unknown> = {
      slotId: slot.id,
      requiredTitle: slot.required_title,
      name,
    };
    if (identity?.role) entry.role = identity.role;
    if (identity?.organization) {
      entry.organization = { name: identity.organization.name };
    }
    if (slot.signature_json) {
      entry.signature = slot.signature_json;
    }
    return entry;
  });

  return {
    affirmationId: args.affirmation.id,
    assessmentId: args.affirmation.assessment_id,
    statement: args.affirmation.statement,
    signatories,
  };
}

/**
 * Canonical document identity payload the platform seals after the
 * declarations envelope is produced. Binds the document to the
 * declarations signature value so a re-seal over tampered declarations
 * would not pass document verify even if the tamperer re-signed the
 * subtree with a different key.
 */
export function buildDocumentEnvelopePayload(args: {
  affirmation: AffirmationRow;
  declarationsSignatureValue: string;
  declarationsCanonicalHash: string;
  platformKeyFingerprint: string;
  sealedAtIso: string;
}): Record<string, unknown> {
  return {
    affirmationId: args.affirmation.id,
    assessmentId: args.affirmation.assessment_id,
    platformKeyFingerprint: args.platformKeyFingerprint,
    declarationsSignatureValue: args.declarationsSignatureValue,
    declarationsCanonicalHash: args.declarationsCanonicalHash,
    sealedAt: args.sealedAtIso,
  };
}

/**
 * Hydrate the identity (name/role/org) that sits embedded in each
 * already-signed slot's signature_json envelope. The envelope was
 * produced from a canonical payload that carried the signatory sub
 * object verbatim, so it is the stable home of the identity used at
 * sign time and therefore what declarations canonicalisation must echo.
 */
export function extractIdentityFromSignatureEnvelope(
  signatureJson: unknown,
): StoredSignatoryIdentity | null {
  if (!signatureJson || typeof signatureJson !== 'object') return null;
  const envelope = signatureJson as Record<string, unknown>;
  const signatory = envelope.signatory as Record<string, unknown> | undefined;
  if (!signatory || typeof signatory.name !== 'string') return null;
  const org = signatory.organization as Record<string, unknown> | undefined;
  const organizationName = org && typeof org.name === 'string' ? org.name : '';
  return {
    name: signatory.name,
    role: typeof signatory.role === 'string' ? signatory.role : undefined,
    organization: { name: organizationName },
  };
}

// ---------------------------------------------------------------------------
// Shaping responses
// ---------------------------------------------------------------------------

function toAffirmationResponse(affirmation: AffirmationRow, slots: SlotRow[]): Record<string, unknown> {
  return {
    id: affirmation.id,
    assessmentId: affirmation.assessment_id,
    projectId: affirmation.project_id,
    entityId: affirmation.entity_id,
    statement: affirmation.statement,
    sealedAt: affirmation.sealed_at,
    sealedBy: affirmation.sealed_by,
    canonicalHash: affirmation.canonical_hash,
    platformKeyFingerprint: affirmation.platform_key_fingerprint,
    declarationsSignature: affirmation.declarations_signature_json,
    documentSignature: affirmation.document_signature_json,
    rescindedAt: affirmation.rescinded_at,
    rescindedBy: affirmation.rescinded_by,
    rescindReason: affirmation.rescind_reason,
    createdAt: affirmation.created_at,
    updatedAt: affirmation.updated_at,
    signatories: slots.map((s) => toSlotResponse(s)),
  };
}

/**
 * Map a raw affirmation_signatory row to the slot response shape used
 * by the slot CRUD and sign endpoints. The DB column signature_json
 * is renamed to `signature` so consumers see the JSF envelope in the
 * natural place, rather than under a snake-shaped field name.
 */
function toSlotResponse(s: SlotRow): Record<string, unknown> {
  return {
    id: s.id,
    requiredTitle: s.required_title,
    requiredUserId: s.required_user_id,
    signatoryId: s.signatory_id,
    signedAt: s.signed_at,
    signedBy: s.signed_by,
    canonicalHash: s.canonical_hash,
    signature: s.signature_json,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /affirmations/by-assessment/:assessmentId
 * Read the affirmation for an assessment, or 404 if one has not been
 * created. Readable by any authenticated caller; the sensitive action
 * gates live on the mutation routes.
 */
router.get(
  '/by-assessment/:assessmentId',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const assessmentId = req.params.assessmentId as string;
    const db = getDatabase();
    const affirmation = await fetchAffirmationByAssessment(db, assessmentId);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found for this assessment' });
      return;
    }
    const slots = await fetchSlots(db, affirmation.id);
    res.json({ data: toAffirmationResponse(affirmation, slots) });
  }),
);

/**
 * GET /affirmations/:id
 * Read an affirmation directly by its id. Same read surface as the
 * assessment scoped endpoint, but useful for the declarations view
 * which already holds an affirmation id.
 */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    const slots = await fetchSlots(db, affirmation.id);
    res.json({ data: toAffirmationResponse(affirmation, slots) });
  }),
);

/**
 * POST /affirmations
 * Create an affirmation for an assessment. Exactly one affirmation is
 * allowed per assessment; a second create returns 409 so the client is
 * forced into update/rescind semantics.
 */
router.post(
  '/',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createAffirmationSchema.parse(req.body);
      const db = getDatabase();

      const assessment = await db
        .selectFrom('assessment')
        .where('id', '=', data.assessmentId)
        .select(['id', 'project_id', 'entity_id'])
        .executeTakeFirst();
      if (!assessment) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }

      const existing = await fetchAffirmationByAssessment(db, data.assessmentId);
      if (existing) {
        res.status(409).json({
          error: 'Assessment already has an affirmation',
          reason: 'already_exists',
          affirmationId: existing.id,
        });
        return;
      }

      const id = uuidv4();
      await db
        .insertInto('affirmation')
        .values({
          id,
          statement: data.statement,
          assessment_id: data.assessmentId,
          project_id: assessment.project_id ?? null,
          entity_id: assessment.entity_id ?? null,
        })
        .execute();

      const created = await fetchAffirmationById(db, id);
      const slots = await fetchSlots(db, id);

      if (req.user) {
        req.eventBus?.emit(
          AFFIRMATION_CREATED,
          {
            affirmationId: id,
            assessmentId: data.assessmentId,
            statement: data.statement,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      logger.info('Affirmation created', {
        affirmationId: id,
        assessmentId: data.assessmentId,
        requestId: req.requestId,
      });

      res.status(201).json({
        data: created ? toAffirmationResponse(created, slots) : { id },
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * PUT /affirmations/:id
 * Update the statement while the affirmation is not sealed. A sealed
 * affirmation is immutable; clients must rescind and create a new one
 * if the statement needs to change.
 */
router.put(
  '/:id',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateAffirmationSchema.parse(req.body);
      const db = getDatabase();
      const affirmation = await fetchAffirmationById(db, req.params.id as string);
      if (!affirmation) {
        res.status(404).json({ error: 'Affirmation not found' });
        return;
      }
      if (rejectIfSealed(affirmation, res)) return;
      if (rejectIfRescinded(affirmation, res)) return;

      await db
        .updateTable('affirmation')
        .set({ statement: data.statement, updated_at: new Date() })
        .where('id', '=', affirmation.id)
        .execute();

      const updated = await fetchAffirmationById(db, affirmation.id);
      const slots = await fetchSlots(db, affirmation.id);
      res.json({ data: updated ? toAffirmationResponse(updated, slots) : null });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * DELETE /affirmations/:id
 * Delete an unsealed affirmation and all of its slots. Sealed and
 * rescinded affirmations cannot be deleted; the rescind path is the
 * only way to invalidate a sealed affirmation.
 */
router.delete(
  '/:id',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    if (rejectIfSealed(affirmation, res)) return;
    if (rejectIfRescinded(affirmation, res)) return;

    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('affirmation_signatory')
        .where('affirmation_id', '=', affirmation.id)
        .execute();
      await trx
        .deleteFrom('affirmation')
        .where('id', '=', affirmation.id)
        .execute();
    });

    res.status(204).send();
  }),
);

/**
 * POST /affirmations/:id/signatories
 * Add a required signatory slot. requiredTitle is the role label the
 * slot advertises (for example "Chief Information Security Officer")
 * and requiredUserId optionally pins the slot to one user. An unpinned
 * slot can be signed by any user holding signatures.sign; a pinned
 * slot rejects all other users with 403.
 */
router.post(
  '/:id/signatories',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = addSlotSchema.parse(req.body);
      const db = getDatabase();
      const affirmation = await fetchAffirmationById(db, req.params.id as string);
      if (!affirmation) {
        res.status(404).json({ error: 'Affirmation not found' });
        return;
      }
      if (rejectIfSealed(affirmation, res)) return;
      if (rejectIfRescinded(affirmation, res)) return;

      if (data.requiredUserId) {
        const user = await db
          .selectFrom('app_user')
          .where('id', '=', data.requiredUserId)
          .select(['id'])
          .executeTakeFirst();
        if (!user) {
          // 404 (not 400) matches the rest of this file's referential
          // checks — POST /affirmations returns 404 when assessmentId
          // references a missing assessment (see line 585). A missing
          // foreign-key target is uniformly "not found" rather than
          // "bad request", so a single category of failure has one
          // status code across the resource.
          res.status(404).json({ error: 'requiredUserId references a user that does not exist' });
          return;
        }
      }

      const slotId = uuidv4();
      await db
        .insertInto('affirmation_signatory')
        .values({
          id: slotId,
          affirmation_id: affirmation.id,
          required_title: data.requiredTitle,
          required_user_id: data.requiredUserId ?? null,
        })
        .execute();

      if (req.user) {
        req.eventBus?.emit(
          AFFIRMATION_SIGNATORY_ASSIGNED,
          {
            affirmationId: affirmation.id,
            assessmentId: affirmation.assessment_id,
            slotId,
            requiredTitle: data.requiredTitle,
            requiredUserId: data.requiredUserId ?? null,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      const slot = await fetchSlot(db, slotId);
      res.status(201).json({ data: slot ? toSlotResponse(slot) : null });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * PUT /affirmations/:id/signatories/:slotId
 * Update the role title or pinning on a slot while the affirmation is
 * unsealed. A slot that has already been signed cannot be edited; if a
 * reviewer needs a different person, delete the slot (and its
 * signature) and add a new one.
 */
router.put(
  '/:id/signatories/:slotId',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateSlotSchema.parse(req.body);
      const db = getDatabase();
      const affirmation = await fetchAffirmationById(db, req.params.id as string);
      if (!affirmation) {
        res.status(404).json({ error: 'Affirmation not found' });
        return;
      }
      if (rejectIfSealed(affirmation, res)) return;
      if (rejectIfRescinded(affirmation, res)) return;

      const slot = await fetchSlot(db, req.params.slotId as string);
      if (!slot || slot.affirmation_id !== affirmation.id) {
        res.status(404).json({ error: 'Slot not found' });
        return;
      }
      if (slot.signed_at) {
        res.status(409).json({
          error: 'Signed slots cannot be edited; delete the slot and add a new one',
          reason: 'slot_signed',
        });
        return;
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (data.requiredTitle !== undefined) updates.required_title = data.requiredTitle;
      if (data.requiredUserId !== undefined) updates.required_user_id = data.requiredUserId ?? null;

      await db
        .updateTable('affirmation_signatory')
        .set(updates)
        .where('id', '=', slot.id)
        .execute();

      const updated = await fetchSlot(db, slot.id);
      res.json({ data: updated ? toSlotResponse(updated) : null });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * DELETE /affirmations/:id/signatories/:slotId
 * Remove a slot from an unsealed affirmation. Removing a signed slot
 * is allowed (the affirmation has not yet been sealed), but the slot's
 * signature_json payload is discarded along with the row. The
 * materialised signatory record on the signatory table is left intact
 * so prior exports and audit trails remain verifiable.
 */
router.delete(
  '/:id/signatories/:slotId',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    if (rejectIfSealed(affirmation, res)) return;
    if (rejectIfRescinded(affirmation, res)) return;

    const slot = await fetchSlot(db, req.params.slotId as string);
    if (!slot || slot.affirmation_id !== affirmation.id) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }

    await db
      .deleteFrom('affirmation_signatory')
      .where('id', '=', slot.id)
      .execute();

    res.status(204).send();
  }),
);

/**
 * POST /affirmations/:id/signatories/:slotId/sign
 * Sign a slot using one of the caller's stored signatures. The server
 * decrypts the stored payload, materialises a signatory row, builds
 * the canonical slot payload, and delegates signing to the configured
 * SignatureProvider. The resulting JSF envelope is stored on the slot
 * and becomes part of the declarations subtree at seal time.
 *
 * Ownership rules: if the slot is pinned (required_user_id is set)
 * only that user can sign; otherwise a participant in the assessment
 * (or an admin) with signatures.sign can sign. A slot can only be
 * signed once.
 */
router.post(
  '/:id/signatories/:slotId/sign',
  requireAuth,
  requirePermission('signatures.sign'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }
      const data = signSlotSchema.parse(req.body);

      const db = getDatabase();
      const affirmation = await fetchAffirmationById(db, req.params.id as string);
      if (!affirmation) {
        res.status(404).json({ error: 'Affirmation not found' });
        return;
      }
      if (rejectIfSealed(affirmation, res)) return;
      if (rejectIfRescinded(affirmation, res)) return;

      const slot = await fetchSlot(db, req.params.slotId as string);
      if (!slot || slot.affirmation_id !== affirmation.id) {
        res.status(404).json({ error: 'Slot not found' });
        return;
      }
      if (slot.signed_at) {
        res.status(409).json({ error: 'Slot has already been signed' });
        return;
      }
      if (slot.required_user_id && slot.required_user_id !== userId) {
        res.status(403).json({
          error: 'This slot is reserved for a specific user',
          reason: 'slot_pinned',
        });
        return;
      }

      const sigRow = await fetchOwnedStoredSignature(db, data.userSignatureId, userId);
      if (!sigRow) {
        res.status(404).json({ error: 'Signature not found in your inventory' });
        return;
      }
      // An unpinned slot is open to participants in the assessment, not to
      // every holder of signatures.sign (security review Z13).
      if (!slot.required_user_id && !(await canParticipateInAssessment(db, req.user!, affirmation.assessment_id as string))) {
        res.status(403).json({ error: 'Only participants in this assessment can sign this slot', reason: 'not_participant' });
        return;
      }

      let payload: StoredElectronicPayload | StoredDigitalPayload;
      try {
        const plaintext = encryptionService.decrypt(sigRow.payload_encrypted);
        payload = plaintext ? JSON.parse(plaintext) : null;
      } catch (err) {
        logger.error('Failed to decrypt stored signature payload at affirmation sign time', {
          signatureId: sigRow.id,
          error: (err as Error).message,
        });
        res.status(500).json({ error: 'Stored signature payload could not be decrypted' });
        return;
      }
      if (!payload) {
        res.status(500).json({ error: 'Stored signature payload is empty' });
        return;
      }

      const identity: StoredSignatoryIdentity = {
        name: payload.name,
        role: payload.role,
        organization: payload.organization,
      };

      const canonicalPayload = buildSlotCanonicalPayload({
        affirmation,
        slot,
        identity,
      });
      const provider = getSignatureProviders().getDefault();

      // Canonicalise with ES256 as the metadata-only algorithm stamp,
      // same pattern used by attestations; the actual signing algorithm
      // is decided by the stored signature payload below.
      const { sha256Hex: canonicalHash } = provider.canonicalize(
        canonicalPayload as unknown as Parameters<typeof provider.canonicalize>[0],
        slotSigner(sigRow.signature_type, payload),
      );

      let signatureEnvelope: Record<string, unknown>;

      if (sigRow.signature_type === 'electronic') {
        // Electronic slot signatures are not cryptographic. We still
        // emit a JSF-shaped envelope for a uniform declarations
        // subtree, but the signature block carries the typed name,
        // jurisdiction, and an optional image data URI rather than an
        // algorithm-backed value. Declarations sealing still covers it
        // via the platform signature.
        const electronic = payload as StoredElectronicPayload;
        const imageDataUri = await loadStoredSignatureImageDataUri(sigRow);
        const signatoryId = await materializeSignatoryFromStored(db, electronic, imageDataUri);
        signatureEnvelope = {
          ...canonicalPayload,
          signature: {
            type: 'electronic',
            signedName: electronic.signedName ?? electronic.name,
            signedAt: new Date().toISOString(),
            jurisdiction: electronic.jurisdiction ?? null,
            legalIntent: electronic.legalIntent ?? null,
            imageDataUri: imageDataUri ?? null,
            canonicalPayloadHash: canonicalHash,
          },
        };

        await db
          .updateTable('affirmation_signatory')
          .set(
            toSnakeCase({
              signatoryId,
              signatureJson: JSON.stringify(signatureEnvelope),
              canonicalHash,
              signedAt: new Date(),
              signedBy: userId,
              updatedAt: new Date(),
            }),
          )
          .where('id', '=', slot.id)
          .execute();
      } else {
        // Digital: the caller signs the canonical payload hash locally
        // and resubmits signatureValue. publicKeyPem comes from the
        // stored payload; the stored row captured the algorithm at
        // inventory time.
        const digital = payload as StoredDigitalPayload;
        if (!data.signatureValue) {
          res.status(400).json({
            error:
              'signatureValue is required when signing a slot with a stored digital signature. Call /prepare to obtain the canonical payload hash.',
          });
          return;
        }
        const digitalSignatoryId = await materializeSignatoryFromStored(db, digital, null);
        // Embed the public key as a JWK so the stored envelope is a
        // valid JSF envelope. The JSF verifier only understands JWK
        // shapes for the embedded publicKey; a `{ pem: ... }` wrapper
        // throws "Unsupported public key input" during verify.
        const embeddedPublicJwk = exportPublicJwk(digital.publicKeyPem);
        // Keep the signature object to JSF signaturecore fields only
        // (algorithm, publicKey, value). Application bookkeeping
        // (signature_type, canonical_hash, signed_at, signed_by)
        // lives on the affirmation_signatory row.
        signatureEnvelope = {
          ...canonicalPayload,
          signature: {
            algorithm: digital.signatureAlgorithm,
            publicKey: embeddedPublicJwk,
            value: data.signatureValue,
          },
        };

        // The submitted value must verify against the signer's registered
        // key and algorithm before it is stored; it used to be stored as-is
        // and later sealed by the platform (security review X2).
        const check = await provider.verify(
          signatureEnvelope as unknown as Parameters<typeof provider.verify>[0],
          { allowedAlgorithms: [digital.signatureAlgorithm] },
        );
        if (!check.valid) {
          res.status(400).json({
            error: 'The signature does not verify against your registered public key. Sign the canonicalPayload returned by /sign/prepare.',
            reasons: check.reasons,
          });
          return;
        }

        await db
          .updateTable('affirmation_signatory')
          .set(
            toSnakeCase({
              signatoryId: digitalSignatoryId,
              signatureJson: JSON.stringify(signatureEnvelope),
              // Always the server's hash; a client-supplied value is ignored.
              canonicalHash,
              signedAt: new Date(),
              signedBy: userId,
              updatedAt: new Date(),
            }),
          )
          .where('id', '=', slot.id)
          .execute();
      }

      logger.info('Affirmation slot signed', {
        affirmationId: affirmation.id,
        slotId: slot.id,
        userSignatureId: sigRow.id,
        signatureType: sigRow.signature_type,
        requestId: req.requestId,
      });

      if (req.user) {
        req.eventBus?.emit(
          AFFIRMATION_SIGNED,
          {
            affirmationId: affirmation.id,
            assessmentId: affirmation.assessment_id,
            slotId: slot.id,
            requiredTitle: slot.required_title,
            signatureType: sigRow.signature_type,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      // If this was the last unsigned slot, emit seal_ready so the
      // affirmation administrators are nudged to seal.
      const remaining = await db
        .selectFrom('affirmation_signatory')
        .where('affirmation_id', '=', affirmation.id)
        .where('signed_at', 'is', null)
        .select(db.fn.count<number>('id').as('count'))
        .executeTakeFirstOrThrow();
      if (Number(remaining.count) === 0 && req.user) {
        req.eventBus?.emit(
          AFFIRMATION_SEAL_READY,
          {
            affirmationId: affirmation.id,
            assessmentId: affirmation.assessment_id,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      const refreshed = await fetchSlot(db, slot.id);
      res.json({ data: refreshed ? toSlotResponse(refreshed) : null });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

/**
 * POST /affirmations/:id/signatories/:slotId/sign/prepare
 * Two-step digital signing: returns the canonical payload hash the
 * client must sign locally with the private key matching their stored
 * digital signature. The caller then posts signatureValue back to
 * /sign. Electronic slots may also call /prepare as a dry-run of the
 * payload they will commit to.
 */
router.post(
  '/:id/signatories/:slotId/sign/prepare',
  requireAuth,
  requirePermission('signatures.sign'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const userSignatureIdRaw = (req.body as { userSignatureId?: unknown })?.userSignatureId;
    // A UUID, not any string: anything else reached the database and 500'd (I9).
    if (typeof userSignatureIdRaw !== 'string' || !z.string().uuid().safeParse(userSignatureIdRaw).success) {
      res.status(400).json({ error: 'userSignatureId must be a signature id' });
      return;
    }

    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    if (rejectIfSealed(affirmation, res)) return;
    if (rejectIfRescinded(affirmation, res)) return;

    const slot = await fetchSlot(db, req.params.slotId as string);
    if (!slot || slot.affirmation_id !== affirmation.id) {
      res.status(404).json({ error: 'Slot not found' });
      return;
    }
    if (slot.signed_at) {
      res.status(409).json({ error: 'Slot has already been signed' });
      return;
    }
    if (slot.required_user_id && slot.required_user_id !== userId) {
      res.status(403).json({ error: 'This slot is reserved for a specific user' });
      return;
    }

    const sigRow = await fetchOwnedStoredSignature(db, userSignatureIdRaw, userId);
    if (!sigRow) {
      res.status(404).json({ error: 'Signature not found in your inventory' });
      return;
    }
    if (!slot.required_user_id && !(await canParticipateInAssessment(db, req.user!, affirmation.assessment_id as string))) {
      res.status(403).json({ error: 'Only participants in this assessment can sign this slot' });
      return;
    }

    let payload: StoredElectronicPayload | StoredDigitalPayload;
    try {
      const plaintext = encryptionService.decrypt(sigRow.payload_encrypted);
      payload = plaintext ? JSON.parse(plaintext) : null;
    } catch (err) {
      logger.error('Failed to decrypt stored signature payload at prepare time', {
        signatureId: sigRow.id,
        error: (err as Error).message,
      });
      res.status(500).json({ error: 'Stored signature payload could not be decrypted' });
      return;
    }
    if (!payload) {
      res.status(500).json({ error: 'Stored signature payload is empty' });
      return;
    }

    const identity: StoredSignatoryIdentity = {
      name: payload.name,
      role: payload.role,
      organization: payload.organization,
    };

    const canonicalPayload = buildSlotCanonicalPayload({ affirmation, slot, identity });
    const provider = getSignatureProviders().getDefault();
    // Digital: the bytes /sign will verify, i.e. the signer descriptor with
    // the algorithm and embedded public key (security review X2).
    const signer = slotSigner(sigRow.signature_type, payload);
    const { sha256Hex, bytes } = provider.canonicalize(
      canonicalPayload as unknown as Parameters<typeof provider.canonicalize>[0],
      signer,
    );

    res.json({
      affirmationId: affirmation.id,
      slotId: slot.id,
      // Sign these bytes (base64url) with the registered private key.
      canonicalPayload: Buffer.from(bytes).toString('base64url'),
      canonicalPayloadHash: sha256Hex,
      hashAlgorithm: 'sha256',
      signatureAlgorithm: signer.algorithm,
    });
  }),
);

/**
 * The JSF signer descriptor a slot is canonicalised with. Digital slots
 * embed the signer's public key (as JWK) in the envelope, so it is part of
 * the signed bytes; electronic slots use the platform's ES256 stamp.
 */
function slotSigner(
  signatureType: string,
  payload: StoredElectronicPayload | StoredDigitalPayload,
): { algorithm: string; publicKey?: JsonObject } {
  if (signatureType === 'digital') {
    const digital = payload as StoredDigitalPayload;
    return {
      algorithm: digital.signatureAlgorithm,
      publicKey: exportPublicJwk(digital.publicKeyPem) as unknown as JsonObject,
    };
  }
  return { algorithm: 'ES256' };
}

/**
 * POST /affirmations/:id/seal
 * Produce the declarations and document envelopes under the active
 * platform key, atomically. Requires every slot to already be signed
 * and fails with 409 otherwise.
 *
 * The stored envelopes are what the exporter emits verbatim in
 * declarations.signature and (for the document identity payload)
 * /signature. Re-sealing a sealed affirmation is rejected; rescind and
 * create a new one instead.
 */
router.post(
  '/:id/seal',
  // Platform-signed, irreversible: interactive session only (security review X8).
  requireSession,
  auditMutations('affirmation'),
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    if (affirmation.sealed_at) {
      res.status(409).json({ error: 'Affirmation is already sealed', reason: 'sealed' });
      return;
    }
    if (affirmation.rescinded_at) {
      res.status(409).json({ error: 'Affirmation has been rescinded', reason: 'rescinded' });
      return;
    }

    const slots = await fetchSlots(db, affirmation.id);
    if (slots.length === 0) {
      res.status(409).json({
        error: 'Affirmation must have at least one required signatory before sealing',
        reason: 'no_slots',
      });
      return;
    }
    const unsigned = slots.filter((s) => !s.signed_at);
    if (unsigned.length > 0) {
      res.status(409).json({
        error: 'All signatory slots must be signed before sealing',
        reason: 'unsigned_slots',
        unsignedSlotIds: unsigned.map((s) => s.id),
      });
      return;
    }

    // The platform signature vouches for every slot it seals, so each
    // digital slot is re-verified first; a slot stored before signature
    // verification existed must not be sealed unchecked (security review X2).
    const sealProvider = getSignatureProviders().getDefault();
    const failedSlotIds: string[] = [];
    for (const slot of slots) {
      const envelope = slot.signature_json as Record<string, unknown> | null;
      const block = envelope?.signature as Record<string, unknown> | undefined;
      if (typeof block?.value === 'string' && block.value.length > 0) {
        const result = await sealProvider.verify(envelope as unknown as Parameters<typeof sealProvider.verify>[0], {});
        if (!result.valid) failedSlotIds.push(slot.id);
      }
    }
    if (failedSlotIds.length > 0) {
      res.status(409).json({
        error: 'One or more digital signatures do not verify; they must be re-signed before sealing',
        reason: 'invalid_slot_signatures',
        slotIds: failedSlotIds,
      });
      return;
    }

    // Build the declarations subtree from the signed slots. Identity is
    // pulled from each slot's signature envelope so the canonical form
    // is self contained; a later rename on the signatory row cannot
    // drift the canonical hash.
    const slotIdentities = new Map<string, StoredSignatoryIdentity>();
    for (const slot of slots) {
      const identity = extractIdentityFromSignatureEnvelope(slot.signature_json);
      if (!identity) {
        res.status(500).json({
          error: 'Slot signature is missing identity material',
          slotId: slot.id,
        });
        return;
      }
      slotIdentities.set(slot.id, identity);
    }

    const declarationsSubtree = buildDeclarationsSubtree({
      affirmation,
      slots,
      slotIdentities,
    });

    const platformKey = await getActiveKey();
    const provider = getSignatureProviders().getDefault();

    const declarationsSign = await provider.sign(
      declarationsSubtree as unknown as Parameters<typeof provider.sign>[0],
      {
        algorithm: platformKey.algorithm,
        // The JSF provider accepts the PEM string directly. Wrapping
        // it in { pem: ... } is not a recognised key input shape and
        // throws JsfKeyError: Unsupported private key input.
        privateKey: platformKey.privateKeyPem,
        publicKey: platformKey.publicKeyPem,
        // signatureProperty default is "signature"; exclude it so
        // the canonicalisation never folds the signature field into
        // its own input.
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
          sealedBy: req.user?.id ?? null,
          canonicalHash: declarationsSign.canonicalHashSha256,
          platformKeyFingerprint: platformKey.fingerprint,
          declarationsSignatureJson: JSON.stringify(declarationsSign.envelope),
          documentSignatureJson: JSON.stringify(documentSign.envelope),
          updatedAt: new Date(),
        }),
      )
      .where('id', '=', affirmation.id)
      .execute();

    logger.info('Affirmation sealed', {
      affirmationId: affirmation.id,
      assessmentId: affirmation.assessment_id,
      platformKeyFingerprint: platformKey.fingerprint,
      requestId: req.requestId,
    });

    if (req.user) {
      req.eventBus?.emit(
        AFFIRMATION_SEALED,
        {
          affirmationId: affirmation.id,
          assessmentId: affirmation.assessment_id,
          platformKeyFingerprint: platformKey.fingerprint,
        },
        { userId: req.user.id, displayName: req.user.displayName },
      );
    }

    const refreshed = await fetchAffirmationById(db, affirmation.id);
    const refreshedSlots = await fetchSlots(db, affirmation.id);
    res.json({
      data: refreshed ? toAffirmationResponse(refreshed, refreshedSlots) : null,
    });
  }),
);

export interface AffirmationVerifyResult {
  verified: boolean;
  rescinded: boolean;
  platformKeyFingerprint: string | null;
  slots: Array<Record<string, unknown>>;
  declarations: { valid: boolean };
  document: { valid: boolean };
  issues: string[];
}

/**
 * Verify a sealed affirmation's three layers: each signatory slot,
 * the declarations envelope and the document envelope. Shared by the
 * verify route and the assessment PDF report.
 */
export async function verifyAffirmation(
  db: ReturnType<typeof getDatabase>,
  affirmation: AffirmationRow,
): Promise<AffirmationVerifyResult> {
  const slots = await fetchSlots(db, affirmation.id);
  const provider = getSignatureProviders().getDefault();
  const issues: string[] = [];
  const slotResults: Array<Record<string, unknown>> = [];

  // Layer 1: per slot signatures. Electronic slots only recompute
  // the canonical hash; digital slots verify cryptographically.
  for (const slot of slots) {
    const identity = extractIdentityFromSignatureEnvelope(slot.signature_json);
    if (!slot.signature_json || !identity) {
      issues.push(`Slot ${slot.id} has no recoverable signature envelope`);
      slotResults.push({ slotId: slot.id, valid: false, reason: 'no_envelope' });
      continue;
    }

    const canonicalPayload = buildSlotCanonicalPayload({
      affirmation,
      slot,
      identity,
    });
    const envelope = slot.signature_json as Record<string, unknown>;
    const signatureBlock = envelope.signature as Record<string, unknown> | undefined;
    // A digital signaturecore is identifiable by the JSF `value`
    // field carrying a non-empty string (the base64url signature).
    // Electronic envelopes never populate `value`; they carry
    // signedName, jurisdiction, legalIntent, etc. instead. Using
    // shape detection instead of an envelope `type` field keeps the
    // signature object spec-clean (JSF signaturecore fields only).
    const isDigital =
      typeof signatureBlock?.value === 'string' && signatureBlock.value.length > 0;
    const sigType: 'digital' | 'electronic' = isDigital ? 'digital' : 'electronic';
    // Drift detection must re-canonicalize with the same algorithm
    // that was used when the slot was signed. Digital slots carry
    // the algorithm inside the envelope (the caller chose it when
    // computing signatureValue). Electronic slots have no signing
    // algorithm, so we fall back to the platform's stable stamp.
    const hashAlgorithm =
      isDigital && typeof signatureBlock?.algorithm === 'string'
        ? (signatureBlock.algorithm as string)
        : 'ES256';
    // Same signer descriptor the slot was signed with: digital slots
    // embed the public key, which is part of the signed bytes (X2).
    const embeddedKey = isDigital && signatureBlock?.publicKey && typeof signatureBlock.publicKey === 'object'
      ? (signatureBlock.publicKey as JsonObject)
      : undefined;
    const { sha256Hex } = provider.canonicalize(
      canonicalPayload as unknown as Parameters<typeof provider.canonicalize>[0],
      embeddedKey ? { algorithm: hashAlgorithm, publicKey: embeddedKey } : { algorithm: hashAlgorithm },
    );
    const drifted = sha256Hex !== (slot.canonical_hash ?? '');

    if (drifted) {
      issues.push(`Slot ${slot.id} canonical payload has drifted since signing`);
    }

    if (isDigital) {
      // For digital slots, use the SignatureProvider's verify via
      // the full envelope. The envelope carries publicKey.pem and
      // value, which JSF can walk directly.
      const result = await provider.verify(envelope as unknown as Parameters<typeof provider.verify>[0], {
        requireEmbeddedPublicKey: false,
      });
      if (!result.valid) {
        issues.push(`Slot ${slot.id} digital signature did not verify: ${result.reasons.join('; ')}`);
      }
      slotResults.push({
        slotId: slot.id,
        valid: result.valid && !drifted,
        drifted,
        signatureType: 'digital',
        reasons: result.reasons,
      });
    } else {
      // Electronic slots: the signature is a record of intent; we
      // only report drift.
      slotResults.push({
        slotId: slot.id,
        valid: !drifted,
        drifted,
        signatureType: sigType,
      });
    }
  }

  // Layer 2: declarations envelope. Verify with the historic key.
  const platformKey = affirmation.platform_key_fingerprint
    ? await getKeyByFingerprint(affirmation.platform_key_fingerprint)
    : null;
  let declarationsValid = false;
  if (!platformKey) {
    issues.push('Platform key that sealed this affirmation could not be located by fingerprint');
  } else if (affirmation.declarations_signature_json) {
    const envelope = affirmation.declarations_signature_json as Record<string, unknown>;
    const result = await provider.verify(envelope as unknown as Parameters<typeof provider.verify>[0], {
      publicKey: platformKey.publicKeyPem,
    });
    declarationsValid = result.valid;
    if (!result.valid) {
      issues.push(`Declarations signature did not verify: ${result.reasons.join('; ')}`);
    }
  } else {
    issues.push('Declarations signature envelope is missing on a sealed affirmation');
  }

  // Layer 3: document envelope.
  let documentValid = false;
  if (platformKey && affirmation.document_signature_json) {
    const envelope = affirmation.document_signature_json as Record<string, unknown>;
    const result = await provider.verify(envelope as unknown as Parameters<typeof provider.verify>[0], {
      publicKey: platformKey.publicKeyPem,
    });
    documentValid = result.valid;
    if (!result.valid) {
      issues.push(`Document signature did not verify: ${result.reasons.join('; ')}`);
    }
  } else if (!affirmation.document_signature_json) {
    issues.push('Document signature envelope is missing on a sealed affirmation');
  }

  const allSlotsValid = slotResults.every((r) => r.valid === true);
  const verified =
    allSlotsValid && declarationsValid && documentValid && !affirmation.rescinded_at;

  if (affirmation.rescinded_at) {
    issues.push('Affirmation has been rescinded');
  }

  return {
    verified,
    rescinded: Boolean(affirmation.rescinded_at),
    platformKeyFingerprint: affirmation.platform_key_fingerprint,
    slots: slotResults,
    declarations: { valid: declarationsValid },
    document: { valid: documentValid },
    issues,
  };
}

/**
 * POST /affirmations/:id/verify
 * Three-layer verification: each slot signature, the declarations
 * envelope, and the document identity envelope. Returns a structured
 * report rather than a boolean so the UI can render a per layer
 * status.
 *
 * Verification looks up the historic platform key by fingerprint so
 * post rotation affirmations still verify cleanly against whichever
 * key sealed them.
 */
router.post(
  '/:id/verify',
  requireAuth,
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const affirmation = await fetchAffirmationById(db, req.params.id as string);
    if (!affirmation) {
      res.status(404).json({ error: 'Affirmation not found' });
      return;
    }
    if (!affirmation.sealed_at) {
      res.status(400).json({ error: 'Affirmation has not been sealed', verified: false });
      return;
    }

    res.json(await verifyAffirmation(db, affirmation));
  }),
);

/**
 * POST /affirmations/:id/rescind
 * Mark a sealed affirmation rescinded. The row stays; exports continue
 * to advertise the rescinded state. Unsealed affirmations cannot be
 * rescinded; use DELETE while still editable.
 */
router.post(
  '/:id/rescind',
  // Platform-signed, irreversible: interactive session only (security review X8).
  requireSession,
  auditMutations('affirmation'),
  requirePermission('affirmations.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { reason } = rescindSchema.parse(req.body);
      const db = getDatabase();
      const affirmation = await fetchAffirmationById(db, req.params.id as string);
      if (!affirmation) {
        res.status(404).json({ error: 'Affirmation not found' });
        return;
      }
      if (!affirmation.sealed_at) {
        res.status(400).json({ error: 'Only sealed affirmations can be rescinded' });
        return;
      }
      if (affirmation.rescinded_at) {
        res.status(409).json({ error: 'Affirmation has already been rescinded' });
        return;
      }

      await db
        .updateTable('affirmation')
        .set(
          toSnakeCase({
            rescindedAt: new Date(),
            rescindedBy: req.user?.id ?? null,
            rescindReason: reason,
            updatedAt: new Date(),
          }),
        )
        .where('id', '=', affirmation.id)
        .execute();

      if (req.user) {
        req.eventBus?.emit(
          AFFIRMATION_RESCINDED,
          {
            affirmationId: affirmation.id,
            assessmentId: affirmation.assessment_id,
            reason,
          },
          { userId: req.user.id, displayName: req.user.displayName },
        );
      }

      logger.info('Affirmation rescinded', {
        affirmationId: affirmation.id,
        rescindedBy: req.user?.id ?? null,
        requestId: req.requestId,
      });

      res.json({ message: 'Affirmation rescinded' });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  }),
);

export default router;
