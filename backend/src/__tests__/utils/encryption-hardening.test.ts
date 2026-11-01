/**
 * Security regression tests: encryption at rest (security review X5, X6, X7).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptionService, initializeEncryption } from '../../utils/encryption.js';
import { ENCRYPTED_COLUMNS } from '../../utils/encrypted-columns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const saved = { key: process.env.MASTER_ENCRYPTION_KEY, env: process.env.NODE_ENV, require: process.env.REQUIRE_ENCRYPTION };

afterEach(() => {
  for (const [name, value] of [['MASTER_ENCRYPTION_KEY', saved.key], ['NODE_ENV', saved.env], ['REQUIRE_ENCRYPTION', saved.require]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('master key format (X5)', () => {
  it.each([
    'correct horse battery staple correct horse battery staple correct ho', // passphrase, 64+ chars
    'q'.repeat(64),                                                         // not hex
    `${'a'.repeat(63)}`,                                                    // too short
    Buffer.alloc(48, 7).toString('base64'),                                 // base64, 64 chars
  ])('refuses %j instead of deriving a short key', (key) => {
    process.env.MASTER_ENCRYPTION_KEY = key;
    expect(() => encryptionService.encrypt('secret')).toThrow(/64 hexadecimal/);
  });

  it('accepts a 64-character hex key', () => {
    process.env.MASTER_ENCRYPTION_KEY = 'ab'.repeat(32);
    // The key version cache is not initialized in this unit test, so only
    // assert that the format check passes.
    expect(() => encryptionService.encrypt('secret')).not.toThrow(/64 hexadecimal/);
  });
});

describe('production requires a master key (X6)', () => {
  // No key means passthrough, which never touches the database.
  const noDb = {} as Parameters<typeof initializeEncryption>[0];

  it('refuses to start in production without a key', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.REQUIRE_ENCRYPTION;
    await expect(initializeEncryption(noDb)).rejects.toThrow(/MASTER_ENCRYPTION_KEY is not set/);
  });

  it('allows an explicit opt-out', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MASTER_ENCRYPTION_KEY;
    process.env.REQUIRE_ENCRYPTION = 'false';
    await expect(initializeEncryption(noDb)).resolves.toBeUndefined();
  });
});

describe('rotation coverage (X7)', () => {
  it('re-keys every encrypted column declared in the schema', () => {
    // Columns written through encryptionService.encrypt(), found by name in
    // the migration (…_encrypted) plus the two legacy names.
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrate.ts'), 'utf8');
    const declared = new Set<string>();
    let table = '';
    for (const line of sql.split('\n')) {
      const t = line.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (t?.[1]) table = t[1];
      const c = line.match(/^\s+(\w+_encrypted)\s/);
      if (c?.[1] && table) declared.add(`${table}.${c[1]}`);
    }
    declared.add('webhook.secret');
    declared.add('chat_integration.webhook_url');
    const covered = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`));
    for (const col of declared) expect(covered.has(col), `${col} is not re-keyed on rotation`).toBe(true);
  });
});
