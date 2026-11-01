import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateStartupConfig, resetConfig, getConfig } from '../../config/index.js';

/**
 * These tests exercise the startup config guard directly. They do not
 * launch the Express app because the guard is meant to catch unsafe
 * configurations before any route is mounted.
 */
describe('validateStartupConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    // Restore the full environment so a single test does not leak
    // variables into unrelated test files.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
    resetConfig();
  });

  it('passes when METRICS_ENABLED is false, regardless of token', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_ENABLED = 'false';
    process.env.METRICS_TOKEN = '';
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('throws when METRICS_ENABLED=true in production and token is empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = '';
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).toThrow(/METRICS_TOKEN/);
  });

  it('throws when METRICS_ENABLED=true in production and token is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'short';
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).toThrow(/16 characters/);
  });

  it('passes when METRICS_ENABLED=true in production and token is long enough', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-sufficiently-long-metrics-bearer-token';
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('passes in test env even when token is empty', () => {
    process.env.NODE_ENV = 'test';
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = '';
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('throws in development env when token is empty', () => {
    process.env.NODE_ENV = 'development';
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = '';
    expect(() => validateStartupConfig()).toThrow(/METRICS_TOKEN/);
  });

  // F15 — REGISTRATION_MODE=open production gate.
  it('throws when REGISTRATION_MODE=open in production without risk acceptance', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRATION_MODE = 'open';
    delete process.env.ACCEPT_OPEN_REGISTRATION_RISK;
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).toThrow(
      /REGISTRATION_MODE=open.*ACCEPT_OPEN_REGISTRATION_RISK/s,
    );
  });

  it('passes when REGISTRATION_MODE=open in production with risk acceptance', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRATION_MODE = 'open';
    process.env.ACCEPT_OPEN_REGISTRATION_RISK = '1';
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('passes when REGISTRATION_MODE=open outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.REGISTRATION_MODE = 'open';
    delete process.env.ACCEPT_OPEN_REGISTRATION_RISK;
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).not.toThrow();
  });

  it('passes when REGISTRATION_MODE=invite_only in production without the flag', () => {
    process.env.NODE_ENV = 'production';
    process.env.REGISTRATION_MODE = 'invite_only';
    delete process.env.ACCEPT_OPEN_REGISTRATION_RISK;
    process.env.JWT_SECRET = 'x'.repeat(32);
    expect(() => validateStartupConfig()).not.toThrow();
  });

  // F06 — S3 credential gate and _FILE resolution.
  describe('S3 storage provider', () => {
    it('throws when STORAGE_PROVIDER=s3 in production without credentials', () => {
      process.env.NODE_ENV = 'production';
      process.env.STORAGE_PROVIDER = 's3';
      process.env.S3_BUCKET = 'evidence';
      delete process.env.S3_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_ACCESS_KEY;
      process.env.JWT_SECRET = 'x'.repeat(32);
      expect(() => validateStartupConfig()).toThrow(/S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/s);
    });

    it('throws when STORAGE_PROVIDER=s3 without a bucket', () => {
      process.env.NODE_ENV = 'production';
      process.env.STORAGE_PROVIDER = 's3';
      delete process.env.S3_BUCKET;
      process.env.S3_ACCESS_KEY_ID = 'AKIA...';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.JWT_SECRET = 'x'.repeat(32);
      expect(() => validateStartupConfig()).toThrow(/S3_BUCKET/);
    });

    it('passes when STORAGE_PROVIDER=s3 with all three values set', () => {
      process.env.NODE_ENV = 'production';
      process.env.STORAGE_PROVIDER = 's3';
      process.env.S3_BUCKET = 'evidence';
      process.env.S3_ACCESS_KEY_ID = 'AKIA...';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      process.env.JWT_SECRET = 'x'.repeat(32);
      expect(() => validateStartupConfig()).not.toThrow();
    });

    it('reads S3 credentials from a file when S3_*_FILE is set', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdxa-s3-'));
      const keyPath = path.join(tmp, 's3_access_key_id');
      const secretPath = path.join(tmp, 's3_secret_access_key');
      fs.writeFileSync(keyPath, 'file-access-key\n');
      fs.writeFileSync(secretPath, 'file-secret-key\n');

      try {
        process.env.NODE_ENV = 'production';
        process.env.STORAGE_PROVIDER = 's3';
        process.env.S3_BUCKET = 'evidence';
        delete process.env.S3_ACCESS_KEY_ID;
        delete process.env.S3_SECRET_ACCESS_KEY;
        process.env.S3_ACCESS_KEY_ID_FILE = keyPath;
        process.env.S3_SECRET_ACCESS_KEY_FILE = secretPath;
        process.env.JWT_SECRET = 'x'.repeat(32);

        expect(() => validateStartupConfig()).not.toThrow();
        const cfg = getConfig();
        // Trailing newline from echo should be stripped so the signed
        // request uses the exact bytes the operator stored.
        expect(cfg.S3_ACCESS_KEY_ID).toBe('file-access-key');
        expect(cfg.S3_SECRET_ACCESS_KEY).toBe('file-secret-key');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('puts DATABASE_PASSWORD_FILE into DATABASE_URL (W5 compose secrets)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbpw-'));
      try {
        const pwPath = path.join(dir, 'postgres_password');
        fs.writeFileSync(pwPath, 'p@ss/w:rd+1\n');
        process.env.DATABASE_URL = 'postgresql://assessors_studio@db:5432/assessors_studio';
        process.env.DATABASE_PASSWORD_FILE = pwPath;
        const url = new URL(getConfig().DATABASE_URL);
        expect(decodeURIComponent(url.password)).toBe('p@ss/w:rd+1');
        expect(url.username).toBe('assessors_studio');
        expect(url.host).toBe('db:5432');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('leaves DATABASE_URL alone when no DATABASE_PASSWORD is set', () => {
      delete process.env.DATABASE_PASSWORD;
      delete process.env.DATABASE_PASSWORD_FILE;
      process.env.DATABASE_URL = 'postgresql://u:keep@db:5432/x';
      expect(getConfig().DATABASE_URL).toBe('postgresql://u:keep@db:5432/x');
    });

    it('throws when S3_*_FILE points at an unreadable path', () => {
      // getConfig() re-runs the file resolver on every cold start,
      // so pointing at a nonexistent path and clearing the cache is
      // enough to trigger the failure path.
      process.env.S3_ACCESS_KEY_ID_FILE = '/var/empty/this/path/does/not/exist';
      delete process.env.S3_ACCESS_KEY_ID;
      resetConfig();
      expect(() => getConfig()).toThrow(/S3_ACCESS_KEY_ID_FILE/);
    });
  });
});
