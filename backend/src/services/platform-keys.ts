/**
 * Platform signing key service.
 *
 * The Sprint 9 affirmation seal ceremony signs two JSF envelopes with
 * a server held keypair:
 *
 *   1. The declarations subtree, embedded as declarations.signature in
 *      the exported BOM.
 *   2. The entire BOM document, emitted as the top level signature.
 *
 * This service owns that keypair. Exactly one row in
 * platform_signing_key has is_active true at any time. Historic rows
 * are kept so signatures produced before a rotation can still be
 * verified by fingerprint lookup. Private key material is stored
 * envelope encrypted and never leaves the process in plaintext.
 *
 * Bootstrap is lazy: if getActiveKey is called and no active key
 * exists, a fresh Ed25519 keypair is generated and inserted as the
 * active row. This keeps the migration runner pure SQL and lets the
 * first sign attempt seed the keypair atomically.
 */

import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import { getDatabase } from '../db/connection.js';
import type { Database } from '../db/types.js';
import { encryptionService } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';

/** Public facing record of a platform signing key. Never carries the private material. */
export interface PlatformKeyPublic {
  id: string;
  fingerprint: string;
  algorithm: string;
  publicKeyPem: string;
  isActive: boolean;
  rotatedAt: Date | null;
  rotatedBy: string | null;
  createdAt: Date;
}

/** Full key material returned by the sign path. Private PEM is in memory only. */
export interface PlatformKeyMaterial extends PlatformKeyPublic {
  privateKeyPem: string;
}

/**
 * Default algorithm for the platform key. Ed25519 is the cheapest
 * sensible default: small key size, fast sign, no curve parameters
 * to configure, and widely supported by JSF verifiers.
 */
const DEFAULT_ALGORITHM = 'Ed25519';

function sha256Fingerprint(pem: string): string {
  return crypto.createHash('sha256').update(pem).digest('hex');
}

function generateKeyPairForAlgorithm(algorithm: string): { publicKeyPem: string; privateKeyPem: string } {
  if (algorithm === 'Ed25519' || algorithm === 'Ed448') {
    const curve = algorithm === 'Ed25519' ? 'ed25519' : 'ed448';
    // biome-ignore lint/suspicious/noExplicitAny: Node type defs for named curves are loose
    const { publicKey, privateKey } = crypto.generateKeyPairSync(curve as any);
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }
  if (algorithm.startsWith('ES')) {
    const namedCurve =
      algorithm === 'ES256' ? 'prime256v1'
        : algorithm === 'ES384' ? 'secp384r1'
          : algorithm === 'ES512' ? 'secp521r1'
            : null;
    if (!namedCurve) throw new Error(`Unsupported ECDSA algorithm: ${algorithm}`);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve });
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }
  if (algorithm.startsWith('RS') || algorithm.startsWith('PS')) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    return {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }
  throw new Error(`Unsupported platform key algorithm: ${algorithm}`);
}

function rowToPublic(row: Record<string, unknown>): PlatformKeyPublic {
  return {
    id: row.id as string,
    fingerprint: row.fingerprint as string,
    algorithm: row.algorithm as string,
    publicKeyPem: row.public_key_pem as string,
    isActive: Boolean(row.is_active),
    rotatedAt: (row.rotated_at as Date | null) ?? null,
    rotatedBy: (row.rotated_by as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

async function insertKey(
  db: Kysely<Database>,
  opts: { algorithm: string; rotatedBy?: string | null },
): Promise<PlatformKeyMaterial> {
  const { publicKeyPem, privateKeyPem } = generateKeyPairForAlgorithm(opts.algorithm);
  const fingerprint = sha256Fingerprint(publicKeyPem);
  const privateKeyEncrypted = encryptionService.encrypt(privateKeyPem);

  const inserted = await db
    .insertInto('platform_signing_key')
    .values({
      fingerprint,
      algorithm: opts.algorithm,
      public_key_pem: publicKeyPem,
      private_key_encrypted: privateKeyEncrypted,
      is_active: true,
      rotated_at: opts.rotatedBy ? new Date() : null,
      rotated_by: opts.rotatedBy ?? null,
      // biome-ignore lint/suspicious/noExplicitAny: created_at is Generated
    } as any)
    .returningAll()
    .executeTakeFirstOrThrow();

  logger.info('Platform signing key generated', {
    fingerprint,
    algorithm: opts.algorithm,
    rotatedBy: opts.rotatedBy ?? null,
  });

  return {
    ...rowToPublic(inserted as unknown as Record<string, unknown>),
    privateKeyPem,
  };
}

/**
 * Fetch the currently active key. If none exists, lazily bootstraps
 * a fresh Ed25519 key and makes it active. Callers that need the
 * private material (to sign) get it decrypted once per call.
 */
export async function getActiveKey(): Promise<PlatformKeyMaterial> {
  const db = getDatabase();
  const existing = await db
    .selectFrom('platform_signing_key')
    .where('is_active', '=', true)
    .selectAll()
    .executeTakeFirst();

  if (existing) {
    const privateKeyPem = encryptionService.decrypt(existing.private_key_encrypted);
    return {
      ...rowToPublic(existing as unknown as Record<string, unknown>),
      privateKeyPem,
    };
  }

  return insertKey(db, { algorithm: DEFAULT_ALGORITHM, rotatedBy: null });
}

/**
 * Fetch a key by fingerprint regardless of active state. Used by the
 * verify path to find the key that produced a given envelope.
 */
export async function getKeyByFingerprint(fingerprint: string): Promise<PlatformKeyPublic | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('platform_signing_key')
    .where('fingerprint', '=', fingerprint)
    .selectAll()
    .executeTakeFirst();
  return row ? rowToPublic(row as unknown as Record<string, unknown>) : null;
}

/**
 * List all keys, active first then most recent rotations.
 */
export async function listKeys(): Promise<PlatformKeyPublic[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('platform_signing_key')
    .selectAll()
    .orderBy('is_active', 'desc')
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => rowToPublic(r as unknown as Record<string, unknown>));
}

/**
 * Generate a new keypair, mark it active, and flip the old active
 * row (if any) to inactive. Runs inside a transaction so the active
 * singleton partial index is never violated.
 */
export async function rotateKey(opts: {
  algorithm?: string;
  rotatedBy: string;
}): Promise<PlatformKeyMaterial> {
  const db = getDatabase();
  const algorithm = opts.algorithm ?? DEFAULT_ALGORITHM;

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('platform_signing_key')
      .set({ is_active: false })
      .where('is_active', '=', true)
      .execute();
    return insertKey(trx as unknown as Kysely<Database>, { algorithm, rotatedBy: opts.rotatedBy });
  });
}

