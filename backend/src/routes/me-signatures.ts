/**
 * /api/v1/me/signatures — the authenticated caller's own signature
 * inventory.
 *
 * The payload covers two distinct signing concerns that CycloneDX
 * models separately:
 *
 *   1. Legal affirmation. The "electronic" signature type carries the
 *      signer's name, role, and organization (as a full CycloneDX
 *      organizationalEntity), plus optional jurisdiction/legalIntent
 *      text and an optional image of the drawn signature. At export
 *      time this materializes as a `signatory` entry under
 *      `declarations.affirmation.signatories[]`, where the image is
 *      emitted as an externalReference of type "electronic-signature"
 *      (the DocuSign-style flow). The oneOf rule in the schema lets us
 *      satisfy it via externalReference + organization.
 *
 *   2. Document integrity. The "digital" signature type carries
 *      cryptographic public-key material (JSF for CycloneDX 1.x, X.509
 *      for 2.x) that binds the signed payload. Only the public key and
 *      optional cert chain live on the server; the private key stays
 *      with the signer and does the actual signing in the client.
 *
 * Common guarantees:
 *   - Every endpoint is scoped to req.user.id. A user can only manage
 *     their own inventory; admins have no override. The /sign path also
 *     re-verifies ownership before consuming a stored signature.
 *   - Payloads are envelope-encrypted at rest via encryptionService.
 *     When MASTER_ENCRYPTION_KEY is not configured we fall back to
 *     passthrough and surface a warning in the response body rather
 *     than blocking writes.
 *   - backend_type is always 'local' today. The column exists so
 *     future HSM / signing-server backends attach the same record
 *     shape without a schema migration.
 *   - Signature images go through the same storage provider
 *     abstraction evidence uses. Database provider: bytes live in
 *     signature_image_binary_content. S3 provider: bytes live in the
 *     bucket at storage_path, binary_content is null.
 */

import { contentDisposition } from '../utils/content-disposition.js';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { encryptionService } from '../utils/encryption.js';
import {
  getStorageProvider,
  getStorageProviderName,
  getMaxFileSize,
} from '../storage/index.js';
import type { StorageProviderName } from '../storage/types.js';
import { verifyAttachmentMimeType } from '../utils/attachment-mime.js';
import { JSF_ASYMMETRIC_ALGORITHMS } from '@cyclonedx/sign/jsf';

const router = Router();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

// Sub-shapes that mirror the CycloneDX organizationalEntity tree. Kept
// permissive at the field level (all optional within nested objects)
// so the UI can collect data progressively, but the top-level
// organization object itself requires at least a name because
// CycloneDX's oneOf on signatory demands organization when the
// external reference branch is used.
const postalAddressSchema = z.object({
  bomRef: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  locality: z.string().optional(),
  postOfficeBoxNumber: z.string().optional(),
  postalCode: z.string().optional(),
  streetAddress: z.string().optional(),
});

const organizationalContactSchema = z.object({
  bomRef: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const organizationalEntitySchema = z.object({
  bomRef: z.string().optional(),
  name: z.string().min(1, 'organization.name is required'),
  address: postalAddressSchema.optional(),
  url: z.array(z.string().url()).optional(),
  contact: z.array(organizationalContactSchema).optional(),
});

// Electronic (legal affirmation) payload. name/role/organization come
// straight from the CycloneDX signatory shape. signedName is the typed
// signature (ESIGN style) and can differ from name (e.g. "S. Springett"
// vs "Steve Springett"). jurisdiction and legalIntent carry the
// compliance context. The image itself is attached via a separate
// endpoint so it lands in the storage provider rather than the
// encrypted payload blob.
const electronicPayloadSchema = z.object({
  name: z.string().min(1, 'name is required'),
  role: z.string().optional(),
  organization: organizationalEntitySchema,
  signedName: z.string().min(1, 'signedName is required').optional(),
  jurisdiction: z.string().optional(),
  legalIntent: z.string().optional(),
});

// Digital (document integrity) payload. CycloneDX 1.x uses JSF; 2.x
// uses X.509. publicKeyPem is required — we do not accept bare keys
// because PEM is what crypto.createPublicKey can parse and what
// downstream exports serialize. The signatureAlgorithm enum is the
// JSF asymmetric set; HMAC algorithms are rejected because symmetric
// keys cannot attribute a signature to a specific signatory.
//
// name, role, and organization mirror the CycloneDX signatory identity
// fields that electronic payloads already carry. They are populated on
// the digital payload so a digital stored signature can materialize a
// spec conformant signatory row at sign time without relying on a
// parallel electronic record. organization.name is required because
// CycloneDX's oneOf on signatory demands organization under both the
// externalReference (electronic) and signature (digital) branches.
const digitalPayloadSchema = z.object({
  signatureFormat: z.enum(['jsf', 'x509']),
  signatureAlgorithm: z.enum(JSF_ASYMMETRIC_ALGORITHMS),
  publicKeyPem: z.string().min(1, 'publicKeyPem is required'),
  certificateChain: z.string().optional(),
  name: z.string().min(1, 'name is required'),
  role: z.string().optional(),
  organization: organizationalEntitySchema,
});

const createSchema = z.discriminatedUnion('signatureType', [
  z.object({
    signatureType: z.literal('electronic'),
    label: z.string().min(1, 'label is required').max(255),
    backendType: z.enum(['local', 'hsm', 'signing_server']).default('local'),
    payload: electronicPayloadSchema,
  }),
  z.object({
    signatureType: z.literal('digital'),
    label: z.string().min(1, 'label is required').max(255),
    backendType: z.enum(['local', 'hsm', 'signing_server']).default('local'),
    payload: digitalPayloadSchema,
  }),
]);

// The payload is validated against the schema of the signature's own
// type in the handler (strict, then the merged result in full). A
// type-blind union of passthrough partials accepted anything, e.g. an
// HMAC algorithm or a non-string key (security review I5).
const updateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// Base64 image upload schema. Kept narrow on purpose: we expect small
// PNG/JPEG/SVG files. Any larger file should be routed through the
// evidence attachment pipeline instead.
const uploadImageSchema = z.object({
  filename: z.string().min(1, 'filename is required').max(512),
  contentType: z.string().min(1, 'contentType is required').max(128),
  binaryContent: z.string().min(1, 'binaryContent is required (base64)'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a PEM public key and return a SHA-256 fingerprint of its DER
 * encoding. Throws if the PEM is not a valid public key.
 */
function fingerprintPublicKey(pem: string): string {
  const key = crypto.createPublicKey(pem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function computeContentHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

interface SignatureRowShape {
  id: string;
  user_id: string;
  label: string;
  signature_type: 'electronic' | 'digital';
  signature_format: 'jsf' | 'x509' | null;
  backend_type: 'local' | 'hsm' | 'signing_server';
  payload_encrypted: string;
  key_fingerprint: string | null;
  signature_image_filename: string | null;
  signature_image_content_type: string | null;
  signature_image_size_bytes: number | null;
  signature_image_storage_path: string | null;
  signature_image_binary_content: Buffer | null;
  signature_image_content_hash: string | null;
  signature_image_storage_provider: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Shape returned to the client. The encrypted payload blob is never
 * returned; only the decrypted JSON. The image bytes are not inlined
 * in list/get responses — callers fetch them from the dedicated image
 * endpoint to keep response sizes reasonable.
 */
function serializeSignature(row: SignatureRowShape): Record<string, unknown> {
  let payload: unknown = null;
  try {
    const plaintext = encryptionService.decrypt(row.payload_encrypted);
    payload = plaintext ? JSON.parse(plaintext) : null;
  } catch (err) {
    logger.warn('Failed to decrypt user_signature payload', {
      signatureId: row.id,
      error: (err as Error).message,
    });
    payload = { error: 'payload_unreadable' };
  }

  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    signatureType: row.signature_type,
    signatureFormat: row.signature_format ?? null,
    backendType: row.backend_type,
    keyFingerprint: row.key_fingerprint ?? null,
    payload,
    image: row.signature_image_filename
      ? {
          filename: row.signature_image_filename,
          contentType: row.signature_image_content_type,
          sizeBytes: row.signature_image_size_bytes,
          contentHash: row.signature_image_content_hash,
          storageProvider: row.signature_image_storage_provider,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function encryptionWarning(): string | null {
  return encryptionService.isAvailable()
    ? null
    : 'Encryption at rest is not configured. Signature payloads are stored in plaintext. Set MASTER_ENCRYPTION_KEY and REQUIRE_ENCRYPTION=true before using this instance in production.';
}

async function fetchOwnedSignature(
  userId: string,
  id: string
): Promise<SignatureRowShape | undefined> {
  const db = getDatabase();
  return (await db
    .selectFrom('user_signature')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()) as SignatureRowShape | undefined;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * List the caller's signatures. Decrypted payloads are embedded in
 * the response; the image bytes are not (fetch via GET /:id/image).
 */
router.get(
  '/',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const rows = (await db
      .selectFrom('user_signature')
      .where('user_id', '=', userId)
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()) as SignatureRowShape[];

    res.json({
      data: rows.map(serializeSignature),
      warning: encryptionWarning(),
    });
  })
);

/**
 * Fetch a single signature by id. 404 if it does not belong to the
 * caller so a crafted id cannot probe another user's inventory.
 */
router.get(
  '/:id',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    const row = await fetchOwnedSignature(userId, req.params.id as string);
    if (!row) {
      res.status(404).json({ error: 'Signature not found' });
      return;
    }
    res.json({ ...serializeSignature(row), warning: encryptionWarning() });
  })
);

/**
 * Create a new signature in the caller's inventory.
 *
 * Electronic path: payload stores the signatory identity (name, role,
 * organization) plus optional affirmation context (jurisdiction,
 * legalIntent). The image is attached later via POST /:id/image.
 *
 * Digital path: the uploaded PEM is parsed with
 * crypto.createPublicKey so malformed or private-key material is
 * rejected here rather than at sign time. We fingerprint the parsed
 * DER form and store only the public material.
 */
router.post(
  '/',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createSchema.parse(req.body);
      const db = getDatabase();
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      let signatureFormat: 'jsf' | 'x509' | null = null;
      let fingerprint: string | null = null;

      if (data.signatureType === 'digital') {
        const payload = data.payload;
        if (/PRIVATE KEY/.test(payload.publicKeyPem)) {
          res.status(400).json({
            error: 'Private key material is not accepted. Upload the public key only.',
          });
          return;
        }
        try {
          fingerprint = fingerprintPublicKey(payload.publicKeyPem);
        } catch (err) {
          res.status(400).json({
            error: `Invalid public key PEM: ${(err as Error).message}`,
          });
          return;
        }
        signatureFormat = payload.signatureFormat;
      }

      const id = uuidv4();
      const payloadJson = JSON.stringify(data.payload);
      const payloadEncrypted = encryptionService.encrypt(payloadJson);

      try {
        await db
          .insertInto('user_signature')
          .values({
            id,
            user_id: userId,
            label: data.label,
            signature_type: data.signatureType,
            signature_format: signatureFormat,
            backend_type: data.backendType,
            payload_encrypted: payloadEncrypted,
            key_fingerprint: fingerprint,
          })
          .execute();
      } catch (insertError: unknown) {
        // user_signature carries UNIQUE(user_id, label). Mapping the
        // constraint violation to 409 lets the caller distinguish "this
        // label is already taken" from a real server error and matches
        // what /tags does for the same class of failure.
        const err = insertError as Record<string, unknown> | null;
        const msg = (err?.message as string | undefined)?.toLowerCase();
        if (msg?.includes('duplicate') || msg?.includes('unique')) {
          res.status(409).json({ error: 'A signature with this label already exists' });
          return;
        }
        throw insertError;
      }

      const created = (await db
        .selectFrom('user_signature')
        .where('id', '=', id)
        .selectAll()
        .executeTakeFirstOrThrow()) as SignatureRowShape;

      logger.info('User signature created', {
        signatureId: id,
        userId,
        signatureType: data.signatureType,
        backendType: data.backendType,
        requestId: req.requestId,
      });

      res.status(201).json({
        ...serializeSignature(created),
        warning: encryptionWarning(),
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

/**
 * Update an existing signature. Only the caller's own rows are
 * reachable. Label and payload may be changed; signatureType/backendType/
 * format are immutable (delete + recreate to change those).
 */
router.put(
  '/:id',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateSchema.parse(req.body);
      const db = getDatabase();
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      const existing = await fetchOwnedSignature(userId, req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: 'Signature not found' });
        return;
      }

      const updates: Record<string, unknown> = { updated_at: new Date() };

      if (data.label !== undefined) {
        updates.label = data.label;
      }

      let newFingerprint = existing.key_fingerprint;

      if (data.payload !== undefined) {
        const typeSchema = existing.signature_type === 'digital' ? digitalPayloadSchema : electronicPayloadSchema;
        const partial = typeSchema.partial().strict().safeParse(data.payload);
        if (!partial.success) {
          res.status(400).json({ error: 'Invalid signature payload', details: partial.error.issues });
          return;
        }
        const plaintext = encryptionService.decrypt(existing.payload_encrypted);
        const existingPayload = plaintext ? JSON.parse(plaintext) : {};
        const merged: Record<string, unknown> = {
          ...existingPayload,
          ...partial.data,
        };
        if (!typeSchema.safeParse(merged).success) {
          res.status(400).json({ error: 'Invalid signature payload' });
          return;
        }

        if (
          existing.signature_type === 'digital' &&
          typeof merged.publicKeyPem === 'string' &&
          merged.publicKeyPem !== existingPayload.publicKeyPem
        ) {
          if (/PRIVATE KEY/.test(merged.publicKeyPem)) {
            res.status(400).json({
              error: 'Private key material is not accepted. Upload the public key only.',
            });
            return;
          }
          try {
            newFingerprint = fingerprintPublicKey(merged.publicKeyPem);
          } catch (err) {
            res.status(400).json({
              error: `Invalid public key PEM: ${(err as Error).message}`,
            });
            return;
          }
        }

        updates.payload_encrypted = encryptionService.encrypt(JSON.stringify(merged));
        updates.key_fingerprint = newFingerprint;
      }

      await db
        .updateTable('user_signature')
        .set(updates)
        .where('id', '=', req.params.id as string)
        .where('user_id', '=', userId)
        .execute();

      const updated = (await db
        .selectFrom('user_signature')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirstOrThrow()) as SignatureRowShape;

      logger.info('User signature updated', {
        signatureId: req.params.id,
        userId,
        requestId: req.requestId,
      });

      res.json({
        ...serializeSignature(updated),
        warning: encryptionWarning(),
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

/**
 * Delete a signature from the caller's inventory.
 *
 * Hard delete. Attestations that were signed using this entry copied
 * name/role/organization into a `signatory` row at sign time, so
 * deletion does not break historical exports or verification.
 */
router.delete(
  '/:id',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    // Fetch the row first so we can 404 consistently before touching
    // storage, and keep the ownership check centralized in
    // fetchOwnedSignature. Using numDeletedRows off of the DELETE
    // result would also work on PostgreSQL but is unreliable under
    // PGlite in some builds.
    const existing = await fetchOwnedSignature(userId, req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: 'Signature not found' });
      return;
    }

    // If the row has an S3-hosted image we want to best-effort clean
    // up the object. Missing/failed deletes are not fatal because the
    // row itself is going away and orphaned bytes can be reaped by a
    // housekeeping job.
    if (existing.signature_image_storage_path && existing.signature_image_storage_provider === 's3') {
      try {
        const provider = getStorageProvider();
        await provider.delete(existing.signature_image_storage_path);
      } catch (err) {
        logger.warn('Failed to delete signature image from S3', {
          signatureId: req.params.id,
          error: (err as Error).message,
        });
      }
    }

    await db
      .deleteFrom('user_signature')
      .where('id', '=', req.params.id as string)
      .where('user_id', '=', userId)
      .execute();

    logger.info('User signature deleted', {
      signatureId: req.params.id,
      userId,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

// ---------------------------------------------------------------------------
// Signature image upload/fetch/delete
// ---------------------------------------------------------------------------

/**
 * Upload the signature image. Replaces any existing image on the
 * record. Images are stored via the active storage provider:
 *
 *   - Database provider: bytes in signature_image_binary_content,
 *     storage_path set to a stable key for reference.
 *   - S3 provider: bytes in the bucket, binary_content is NULL.
 *
 * Accepts JSON bodies with base64-encoded content. Keeps the surface
 * narrow — signatures are small (typically <50 KB), so a full
 * multipart path is overkill. Falls back to the same MIME allowlist
 * that evidence uses so operators who restrict upload types stay
 * consistent.
 */
router.post(
  '/:id/image',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = uploadImageSchema.parse(req.body);
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      const existing = await fetchOwnedSignature(userId, req.params.id as string);
      if (!existing) {
        res.status(404).json({ error: 'Signature not found' });
        return;
      }
      if (existing.signature_type !== 'electronic') {
        res.status(400).json({
          error: 'Signature images only apply to electronic signatures',
        });
        return;
      }

      const buffer = Buffer.from(data.binaryContent, 'base64');
      const maxFileSize = getMaxFileSize();
      if (buffer.length > maxFileSize) {
        res.status(413).json({ error: `File exceeds maximum size of ${maxFileSize} bytes` });
        return;
      }

      const mimeDecision = verifyAttachmentMimeType(buffer, data.filename, data.contentType);
      if (!mimeDecision.allowed) {
        res.status(415).json({
          error: mimeDecision.reason ?? 'Unsupported media type',
          detectedType: mimeDecision.resolvedType,
        });
        return;
      }

      // The evidence-wide allowlist accepts things like text/plain and
      // application/pdf that do not belong on a signature image. Gate
      // the upload further to raster image types so a crafted non-image
      // payload cannot land here and then be rendered inline elsewhere.
      const imageOnlyAllowed = new Set([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ]);
      if (!imageOnlyAllowed.has(mimeDecision.resolvedType)) {
        res.status(415).json({
          error: `Signature images must be PNG, JPEG, GIF, or WebP. Detected ${mimeDecision.resolvedType}.`,
          detectedType: mimeDecision.resolvedType,
        });
        return;
      }

      const storageProviderName = getStorageProviderName();
      const storageProvider = getStorageProvider();
      // Ids only: the client filename stays in the row (security review I6).
      const storageKey = `signatures/${userId}/${req.params.id}`;
      const contentHash = computeContentHash(buffer);
      const resolvedContentType = mimeDecision.resolvedType;

      const updates: Record<string, unknown> = {
        signature_image_filename: data.filename,
        signature_image_content_type: resolvedContentType,
        signature_image_size_bytes: buffer.length,
        signature_image_storage_path: storageKey,
        signature_image_content_hash: contentHash,
        signature_image_storage_provider: storageProviderName,
        updated_at: new Date(),
      };

      if (storageProviderName === 'database') {
        updates.signature_image_binary_content = buffer;
      } else {
        // Push to object storage; leave binary_content null so we do
        // not double-store the bytes.
        await storageProvider.put(storageKey, buffer, { contentType: resolvedContentType });
        updates.signature_image_binary_content = null;
      }

      const db = getDatabase();
      await db
        .updateTable('user_signature')
        .set(updates)
        .where('id', '=', req.params.id as string)
        .where('user_id', '=', userId)
        .execute();

      logger.info('Signature image uploaded', {
        signatureId: req.params.id,
        userId,
        filename: data.filename,
        sizeBytes: buffer.length,
        storageProvider: storageProviderName,
        requestId: req.requestId,
      });

      res.status(201).json({
        message: 'Image uploaded',
        image: {
          filename: data.filename,
          contentType: resolvedContentType,
          sizeBytes: buffer.length,
          contentHash,
          storageProvider: storageProviderName,
        },
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

/**
 * Fetch the image bytes. The image round-trips through the storage
 * provider that originally saved it so switching providers does not
 * break historical signatures.
 */
router.get(
  '/:id/image',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    const row = await fetchOwnedSignature(userId, req.params.id as string);
    if (!row || !row.signature_image_filename) {
      res.status(404).json({ error: 'Signature image not found' });
      return;
    }

    const providerName = (row.signature_image_storage_provider || 'database') as StorageProviderName;
    let buffer: Buffer | null = null;

    if (providerName === 'database') {
      buffer = row.signature_image_binary_content
        ? Buffer.isBuffer(row.signature_image_binary_content)
          ? row.signature_image_binary_content
          : Buffer.from(row.signature_image_binary_content)
        : null;
    } else {
      // S3: pull bytes back through the provider abstraction.
      try {
        const provider = getStorageProvider();
        const result = await provider.get(row.signature_image_storage_path || '');
        buffer = Buffer.isBuffer(result.data) ? result.data : Buffer.from(result.data);
      } catch (err) {
        logger.error('Failed to fetch signature image from storage', {
          signatureId: req.params.id,
          error: (err as Error).message,
        });
      }
    }

    if (!buffer) {
      res.status(404).json({ error: 'Signature image not found' });
      return;
    }

    res.setHeader('Content-Type', row.signature_image_content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('inline', row.signature_image_filename));
    res.send(buffer);
  })
);

/**
 * Remove the image from a signature record. S3-hosted bytes are
 * deleted from the bucket; DB-hosted bytes are cleared on the row.
 */
router.delete(
  '/:id/image',
  requireAuth,
  requirePermission('signatures.manage'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    const existing = await fetchOwnedSignature(userId, req.params.id as string);
    if (!existing || !existing.signature_image_filename) {
      res.status(404).json({ error: 'Signature image not found' });
      return;
    }

    if (
      existing.signature_image_storage_provider === 's3' &&
      existing.signature_image_storage_path
    ) {
      try {
        const provider = getStorageProvider();
        await provider.delete(existing.signature_image_storage_path);
      } catch (err) {
        logger.warn('Failed to delete signature image from S3', {
          signatureId: req.params.id,
          error: (err as Error).message,
        });
      }
    }

    await db
      .updateTable('user_signature')
      .set({
        signature_image_filename: null,
        signature_image_content_type: null,
        signature_image_size_bytes: null,
        signature_image_storage_path: null,
        signature_image_binary_content: null,
        signature_image_content_hash: null,
        signature_image_storage_provider: null,
        updated_at: new Date(),
      })
      .where('id', '=', req.params.id as string)
      .where('user_id', '=', userId)
      .execute();

    logger.info('Signature image deleted', {
      signatureId: req.params.id,
      userId,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

export default router;
