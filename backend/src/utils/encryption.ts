/**
 * Encryption at rest service.
 *
 * Provides envelope encryption with AES-256-GCM, HKDF-SHA-512 key derivation,
 * and quantum-resistant symmetric-only primitives. No RSA, ECDH, or other
 * classically asymmetric primitives are used anywhere in the chain.
 *
 * Architecture:
 *   MASTER_ENCRYPTION_KEY (env, 256-bit)
 *     -> HKDF-SHA-512 (per-version salt) -> Key Encryption Key (KEK)
 *       -> AES-256-GCM wrap -> Data Encryption Key (DEK)
 *         -> AES-256-GCM encrypt -> ciphertext
 */

import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_VERSION = 0x01;
const KEK_SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32; // 256-bit
const ALGORITHM = 'aes-256-gcm';
const HKDF_HASH = 'sha512';
const HKDF_KEY_LENGTH = 32; // 256-bit KEK

/**
 * Minimum header length for a valid envelope:
 * 1 (format) + 1 (key version) + 16 (salt) + 12 (DEK IV) + 16 (DEK tag)
 * + 32 (wrapped DEK) + 12 (data IV) + 16 (data tag) + 0 (min ciphertext)
 */
const MIN_ENVELOPE_LENGTH = 106;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface EncryptionService {
  /** Encrypt a plaintext string. Returns a base64-encoded envelope. */
  encrypt(plaintext: string): string;

  /** Decrypt a base64-encoded envelope back to plaintext. */
  decrypt(envelope: string): string;

  /** Re-wrap all envelopes encrypted under old key versions. */
  rekey(
    read: () => AsyncIterable<{ id: string; value: string }>,
    write: (id: string, value: string) => Promise<void>,
  ): Promise<{ processed: number; rekeyed: number }>;

  /** True if the service has a valid master key and is operational. */
  isAvailable(): boolean;

  /** Get the current active key version. */
  getActiveKeyVersion(): number;
}

// ---------------------------------------------------------------------------
// Key version management
// ---------------------------------------------------------------------------

interface KeyVersion {
  version: number;
  salt: Buffer;
  isActive: boolean;
}

/** In-memory cache of key versions loaded from the database. */
let keyVersions = new Map<number, KeyVersion>();
let activeKeyVersion: number = 0;

/**
 * Load key versions from the database into memory.
 */
async function loadKeyVersions(db: Kysely<Database>): Promise<void> {
  try {
    const rows = await db
      .selectFrom('encryption_key_version')
      .selectAll()
      .execute();

    keyVersions = new Map();
    for (const row of rows) {
      const salt = typeof row.salt === 'string'
        ? Buffer.from(row.salt, 'hex')
        // biome-ignore lint/suspicious/noExplicitAny: BYTEA column type varies by driver
        : Buffer.from(row.salt as any);
      keyVersions.set(row.version as number, {
        version: row.version as number,
        salt,
        isActive: row.is_active as boolean,
      });
      if (row.is_active) {
        activeKeyVersion = row.version as number;
      }
    }
  } catch {
    // Table may not exist yet during initial migration
    keyVersions = new Map();
    activeKeyVersion = 0;
  }
}

/**
 * Ensure at least one key version exists. Creates version 1 if the table
 * is empty. Called during application startup.
 */
async function ensureKeyVersion(db: Kysely<Database>): Promise<void> {
  await loadKeyVersions(db);

  if (keyVersions.size === 0 && getMasterKey() !== null) {
    const salt = crypto.randomBytes(KEK_SALT_LENGTH);

    await db
      .insertInto('encryption_key_version')
      .values({
        version: 1,
        salt: salt.toString('hex'),
        is_active: true,
        created_at: new Date(),
      })
      .execute();

    keyVersions.set(1, { version: 1, salt, isActive: true });
    activeKeyVersion = 1;
    logger.info('Created initial encryption key version 1');
  }
}

/**
 * Create a new key version, marking it active and retiring the old one.
 * Returns the new version number.
 */
export async function rotateKeyVersion(db: Kysely<Database>): Promise<number> {
  const newVersion = activeKeyVersion + 1;
  const newSalt = crypto.randomBytes(KEK_SALT_LENGTH);

  // Mark all existing versions as retired
  await db
    .updateTable('encryption_key_version')
    .set({ is_active: false, retired_at: new Date() })
    .where('is_active', '=', true)
    .execute();

  // Insert new active version
  await db
    .insertInto('encryption_key_version')
    .values({
      version: newVersion,
      salt: newSalt.toString('hex'),
      is_active: true,
      created_at: new Date(),
    })
    .execute();

  // Refresh the in-memory cache
  await loadKeyVersions(db);

  logger.info('Rotated encryption key', { newVersion });
  return newVersion;
}

// ---------------------------------------------------------------------------
// Cryptographic helpers
// ---------------------------------------------------------------------------

function getMasterKey(): Buffer | null {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex) return null;
  // Exactly 64 hex characters. Buffer.from(x, 'hex') silently stops at the
  // first non-hex character, so a passphrase or base64 key used to become
  // a short or empty key that anyone with the database could undo
  // (security review X5). Fail closed instead.
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (256 bits). '
      + 'Generate one with "openssl rand -hex 32".',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Derive a Key Encryption Key (KEK) from the master key using HKDF-SHA-512.
 */
function deriveKEK(masterKey: Buffer, salt: Buffer, keyVersion: number): Buffer {
  const info = `assessors-studio-kek-v${keyVersion}`;
  return crypto.hkdfSync(HKDF_HASH, masterKey, salt, info, HKDF_KEY_LENGTH) as unknown as Buffer;
}

// ---------------------------------------------------------------------------
// Envelope encode / decode
// ---------------------------------------------------------------------------

/**
 * Build and return a base64-encoded encryption envelope.
 *
 * Binary layout:
 * [1: format version] [1: key version] [16: KEK salt]
 * [12: DEK wrap IV] [16: DEK wrap auth tag] [32: wrapped DEK]
 * [12: data IV] [16: data auth tag] [N: ciphertext]
 */
function buildEnvelope(
  keyVersion: number,
  salt: Buffer,
  dekWrapIv: Buffer,
  dekWrapTag: Buffer,
  wrappedDek: Buffer,
  dataIv: Buffer,
  dataTag: Buffer,
  ciphertext: Buffer,
): string {
  const header = Buffer.alloc(2);
  header[0] = FORMAT_VERSION;
  header[1] = keyVersion;

  const envelope = Buffer.concat([
    header,
    salt,
    dekWrapIv,
    dekWrapTag,
    wrappedDek,
    dataIv,
    dataTag,
    ciphertext,
  ]);

  return envelope.toString('base64');
}

interface ParsedEnvelope {
  formatVersion: number;
  keyVersion: number;
  salt: Buffer;
  dekWrapIv: Buffer;
  dekWrapTag: Buffer;
  wrappedDek: Buffer;
  dataIv: Buffer;
  dataTag: Buffer;
  ciphertext: Buffer;
}

function parseEnvelope(encoded: string): ParsedEnvelope | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(encoded, 'base64');
  } catch {
    return null;
  }

  if (buf.length < MIN_ENVELOPE_LENGTH) return null;
  if (buf[0] !== FORMAT_VERSION) return null;

  let offset = 0;
  const formatVersion = buf[offset++];
  const keyVersion = buf[offset++];

  const salt = buf.subarray(offset, offset + KEK_SALT_LENGTH);
  offset += KEK_SALT_LENGTH;

  const dekWrapIv = buf.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  const dekWrapTag = buf.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;

  const wrappedDek = buf.subarray(offset, offset + DEK_LENGTH);
  offset += DEK_LENGTH;

  const dataIv = buf.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  const dataTag = buf.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;

  const ciphertext = buf.subarray(offset);

  return {
    formatVersion,
    keyVersion,
    salt,
    dekWrapIv,
    dekWrapTag,
    wrappedDek,
    dataIv,
    dataTag,
    ciphertext,
  };
}

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

function encryptValue(plaintext: string, masterKey: Buffer): string {
  const version = activeKeyVersion;
  const kv = keyVersions.get(version);
  if (!kv) {
    throw new Error(`Active key version ${version} not found in cache`);
  }

  // Derive KEK
  const kek = deriveKEK(masterKey, kv.salt, version);

  // Generate random DEK
  const dek = crypto.randomBytes(DEK_LENGTH);

  // Wrap DEK with KEK using AES-256-GCM
  const dekWrapIv = crypto.randomBytes(IV_LENGTH);
  const dekWrapCipher = crypto.createCipheriv(ALGORITHM, kek, dekWrapIv);
  const wrappedDek = Buffer.concat([dekWrapCipher.update(dek), dekWrapCipher.final()]);
  const dekWrapTag = dekWrapCipher.getAuthTag();

  // Encrypt plaintext with DEK using AES-256-GCM
  const dataIv = crypto.randomBytes(IV_LENGTH);
  const aad = Buffer.from([FORMAT_VERSION, version]);
  const dataCipher = crypto.createCipheriv(ALGORITHM, dek, dataIv);
  dataCipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    dataCipher.update(plaintext, 'utf8'),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  return buildEnvelope(
    version,
    kv.salt,
    dekWrapIv,
    dekWrapTag,
    wrappedDek,
    dataIv,
    dataTag,
    ciphertext,
  );
}

function decryptValue(envelope: string, masterKey: Buffer): string {
  const parsed = parseEnvelope(envelope);
  if (!parsed) {
    // Not a valid envelope; might be plaintext during migration
    return envelope;
  }

  const { keyVersion, salt, dekWrapIv, dekWrapTag, wrappedDek, dataIv, dataTag, ciphertext } = parsed;

  // Derive KEK from the salt stored in the envelope
  const kek = deriveKEK(masterKey, salt, keyVersion);

  // Unwrap DEK
  const dekUnwrapDecipher = crypto.createDecipheriv(ALGORITHM, kek, dekWrapIv);
  dekUnwrapDecipher.setAuthTag(dekWrapTag);
  let dek: Buffer;
  try {
    dek = Buffer.concat([dekUnwrapDecipher.update(wrappedDek), dekUnwrapDecipher.final()]);
  } catch (err) {
    throw new Error('Decryption failed: unable to unwrap data encryption key (wrong master key or corrupted envelope)');
  }

  // Decrypt data
  const aad = Buffer.from([parsed.formatVersion, keyVersion]);
  const dataDecipher = crypto.createDecipheriv(ALGORITHM, dek, dataIv);
  dataDecipher.setAAD(aad);
  dataDecipher.setAuthTag(dataTag);
  try {
    const plaintext = Buffer.concat([dataDecipher.update(ciphertext), dataDecipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    throw new Error('Decryption failed: data integrity check failed (tampered ciphertext or auth tag)');
  }
}

/**
 * Re-wrap an envelope under a different master key. Used during MEK rotation.
 */
function rekeyEnvelopeWithKeys(
  envelope: string,
  oldMasterKey: Buffer,
  newMasterKey: Buffer,
  newKeyVersion: number,
  newSalt: Buffer,
): string {
  // Decrypt the plaintext using the old key
  const plaintext = decryptValue(envelope, oldMasterKey);

  // Temporarily set the active version and cache entry for the new key
  const savedActive = activeKeyVersion;
  const savedKv = keyVersions.get(newKeyVersion);
  activeKeyVersion = newKeyVersion;
  keyVersions.set(newKeyVersion, { version: newKeyVersion, salt: newSalt, isActive: true });

  const result = encryptValue(plaintext, newMasterKey);

  // Restore
  activeKeyVersion = savedActive;
  if (savedKv) {
    keyVersions.set(newKeyVersion, savedKv);
  } else {
    keyVersions.delete(newKeyVersion);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Re-wrap (rekey) existing envelopes under the current active key version
// ---------------------------------------------------------------------------

async function rekeyEnvelopes(
  masterKey: Buffer,
  read: () => AsyncIterable<{ id: string; value: string }>,
  write: (id: string, value: string) => Promise<void>,
): Promise<{ processed: number; rekeyed: number }> {
  let processed = 0;
  let rekeyed = 0;

  for await (const row of read()) {
    processed++;
    const parsed = parseEnvelope(row.value);

    // Skip plaintext values or values already on the active version
    if (!parsed || parsed.keyVersion === activeKeyVersion) continue;

    // Decrypt with old version's KEK (salt is in the envelope) then re-encrypt
    const plaintext = decryptValue(row.value, masterKey);
    const newEnvelope = encryptValue(plaintext, masterKey);
    await write(row.id, newEnvelope);
    rekeyed++;
  }

  return { processed, rekeyed };
}

// ---------------------------------------------------------------------------
// Check if a value looks like an encrypted envelope
// ---------------------------------------------------------------------------

export function isEncryptedEnvelope(value: string): boolean {
  return parseEnvelope(value) !== null;
}

// ---------------------------------------------------------------------------
// Singleton service
// ---------------------------------------------------------------------------

class EncryptionServiceImpl implements EncryptionService {
  encrypt(plaintext: string): string {
    const mk = getMasterKey();
    if (!mk) return plaintext; // Passthrough mode
    return encryptValue(plaintext, mk);
  }

  decrypt(envelope: string): string {
    const mk = getMasterKey();
    if (!mk) return envelope; // Passthrough mode

    // During migration, detect plaintext values and return them as-is
    const parsed = parseEnvelope(envelope);
    if (!parsed) return envelope;

    return decryptValue(envelope, mk);
  }

  async rekey(
    read: () => AsyncIterable<{ id: string; value: string }>,
    write: (id: string, value: string) => Promise<void>,
  ): Promise<{ processed: number; rekeyed: number }> {
    const mk = getMasterKey();
    if (!mk) throw new Error('Master encryption key is not configured');
    return rekeyEnvelopes(mk, read, write);
  }

  isAvailable(): boolean {
    return getMasterKey() !== null && activeKeyVersion > 0;
  }

  getActiveKeyVersion(): number {
    return activeKeyVersion;
  }
}

/** Singleton encryption service instance. */
export const encryptionService: EncryptionService = new EncryptionServiceImpl();

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the encryption service. Must be called after database
 * migrations have run. If REQUIRE_ENCRYPTION is true, throws if the
 * master key is missing.
 *
 * Passthrough mode (no MASTER_ENCRYPTION_KEY set, REQUIRE_ENCRYPTION
 * unset or false) preserves operational flexibility during local
 * evaluation but writes every value the encryption service is asked
 * to encrypt as plaintext. The startup warning below makes that
 * tradeoff explicit so an operator cannot discover it only by
 * reading the database later. Production deployments should set
 * both MASTER_ENCRYPTION_KEY (a 64 character hex string) and
 * REQUIRE_ENCRYPTION=true so a misconfigured key fails fast
 * instead of silently downgrading protection.
 */
export async function initializeEncryption(db: Kysely<Database>): Promise<void> {
  // Production requires a master key unless the operator explicitly opts
  // out with REQUIRE_ENCRYPTION=false; passthrough stored webhook secrets,
  // chat tokens and the platform signing key in plaintext (security
  // review X6).
  const isProductionEnv = process.env.NODE_ENV === 'production';
  const requireEncryption = process.env.REQUIRE_ENCRYPTION === 'true'
    || (isProductionEnv && process.env.REQUIRE_ENCRYPTION !== 'false');
  const mk = getMasterKey();

  if (requireEncryption && !mk) {
    throw new Error(
      'Encryption at rest is required (REQUIRE_ENCRYPTION=true, or NODE_ENV=production) but MASTER_ENCRYPTION_KEY is not set. '
      + 'To run without it deliberately, set REQUIRE_ENCRYPTION=false. '
      + 'Generate a 256 bit key with "openssl rand -hex 32" and set it as '
      + 'MASTER_ENCRYPTION_KEY (64 hex characters) before restarting.',
    );
  }

  if (mk) {
    await ensureKeyVersion(db);
    logger.info('Encryption at rest initialized', {
      activeKeyVersion,
      totalKeyVersions: keyVersions.size,
    });
    return;
  }

  // Passthrough mode: make the security impact loud so it cannot be
  // missed in a running-server log. Log level escalates in
  // production since that is where leaving encryption off is most
  // likely to surprise a defender. Keep a single line summary at
  // warn level as well so operators who filter for WARN still see
  // something actionable.
  const isProduction = process.env.NODE_ENV === 'production';
  const bannerLog = isProduction ? logger.error.bind(logger) : logger.warn.bind(logger);
  bannerLog(
    'Encryption at rest is disabled: running in passthrough mode',
    {
      impact: [
        'webhook signing secrets are stored as plaintext',
        'integration bearer tokens and SMTP credentials are stored as plaintext',
        'any future field routed through the encryption service will pass through unchanged',
      ],
      howToFix: [
        'generate a key: openssl rand -hex 32',
        'set MASTER_ENCRYPTION_KEY to that value',
        'set REQUIRE_ENCRYPTION=true so a missing key fails fast',
        'restart the backend',
      ],
    },
  );
  logger.warn(
    'MASTER_ENCRYPTION_KEY is not set; encrypted fields will be stored as plaintext. '
    + 'Set MASTER_ENCRYPTION_KEY and REQUIRE_ENCRYPTION=true before using this instance in production.',
  );
}

// ---------------------------------------------------------------------------
// MEK rotation helpers (used by CLI scripts)
// ---------------------------------------------------------------------------

/**
 * Re-key all encrypted values from an old master key to the current one.
 * Used when the master encryption key itself must be changed.
 */
export async function rekeyMaster(
  db: Kysely<Database>,
  oldMasterKeyHex: string,
  read: () => AsyncIterable<{ id: string; value: string }>,
  write: (id: string, value: string) => Promise<void>,
): Promise<{ processed: number; rekeyed: number }> {
  const newMk = getMasterKey();
  if (!newMk) throw new Error('New MASTER_ENCRYPTION_KEY is not configured');

  const oldMk = Buffer.from(oldMasterKeyHex, 'hex');
  if (oldMk.length !== 32) throw new Error('OLD_MASTER_ENCRYPTION_KEY must be 64 hex characters');

  // Create a fresh key version for the new master key
  const newVersion = await rotateKeyVersion(db);
  const newKv = keyVersions.get(newVersion);
  if (!newKv) throw new Error('Failed to create new key version');

  let processed = 0;
  let rekeyed = 0;

  for await (const row of read()) {
    processed++;
    const parsed = parseEnvelope(row.value);
    if (!parsed) continue; // Skip plaintext

    const newEnvelope = rekeyEnvelopeWithKeys(
      row.value,
      oldMk,
      newMk,
      newVersion,
      newKv.salt,
    );
    await write(row.id, newEnvelope);
    rekeyed++;
  }

  return { processed, rekeyed };
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { parseEnvelope, FORMAT_VERSION, MIN_ENVELOPE_LENGTH, keyVersions, activeKeyVersion };

/**
 * Reset internal state (for testing only).
 * @internal Test seam; not part of the module API.
 */
export function _resetForTesting(): void {
  keyVersions.clear();
  activeKeyVersion = 0;
}

/**
 * Manually set a key version in the cache (for testing only).
 * @internal Test seam; not part of the module API.
 */
export function _setKeyVersionForTesting(version: number, salt: Buffer, isActive: boolean): void {
  keyVersions.set(version, { version, salt, isActive });
  if (isActive) {
    activeKeyVersion = version;
  }
}
