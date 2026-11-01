/**
 * SignatureProvider contract tests.
 *
 * These exercise the provider abstraction end-to-end against the JSF
 * provider (CycloneDX 1.x), the JSS provider (CycloneDX 2.x), and
 * confirm the registry behaves as advertised. JSS is no longer a
 * stub — the @cyclonedx/sign 0.4.0 release ships a working JSS / X.590
 * implementation, so the provider is exercised the same way as JSF.
 */

import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  verify,
  type KeyObject,
} from 'node:crypto';

import {
  JsfSignatureProvider,
  JssSignatureProvider,
  SignatureProviderRegistry,
  createRegistry,
  getProviderForCycloneDxMajor,
  getSignatureProviders,
} from '../../signatures/index.js';

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

function ecPair(): KeyPair {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) as unknown as KeyPair;
}

function samplePayload() {
  return {
    id: 'attestation-1',
    summary: 'compliance statement',
    requirements: [
      { id: 'r1', score: 'pass' },
      { id: 'r2', score: 'pass' },
    ],
  };
}

describe('JsfSignatureProvider', () => {
  const provider = new JsfSignatureProvider();

  it('advertises the JSF format and full algorithm set', () => {
    expect(provider.name).toBe('jsf');
    expect(provider.signatureFormat).toBe('jsf');
    expect(provider.supportedAlgorithms).toContain('ES256');
    expect(provider.supportedAlgorithms).toContain('RS256');
    expect(provider.supportedAlgorithms).toContain('Ed25519');
    expect(provider.supportedAlgorithms).toContain('HS256');
  });

  it('produces canonical bytes and a hash for a given payload', () => {
    const payload = samplePayload();
    const { bytes, sha256Hex } = provider.canonicalize(payload, { algorithm: 'ES256' });
    expect(bytes.length).toBeGreaterThan(0);
    expect(sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalize is deterministic across input key order', () => {
    const a = { id: '1', summary: 's', requirements: [] };
    const b = { requirements: [], summary: 's', id: '1' };
    const ca = provider.canonicalize(a, { algorithm: 'ES256' });
    const cb = provider.canonicalize(b, { algorithm: 'ES256' });
    expect(ca.sha256Hex).toBe(cb.sha256Hex);
  });

  it('signs and verifies a JSON payload', async () => {
    const { privateKey } = ecPair();
    const signResult = await provider.sign(samplePayload(), {
      algorithm: 'ES256',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    expect(signResult.algorithm).toBe('ES256');
    expect(signResult.signatureValue.length).toBeGreaterThan(0);
    expect(signResult.canonicalHashSha256).toMatch(/^[0-9a-f]{64}$/);

    const verifyResult = await provider.verify(signResult.envelope);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.algorithm).toBe('ES256');
    expect(verifyResult.reasons).toEqual([]);
  });

  it('returns the canonical bytes the signature covers, embedded public key included', async () => {
    const { privateKey, publicKey } = ecPair();
    const signResult = await provider.sign(samplePayload(), {
      algorithm: 'ES256',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    const embedded = (signResult.envelope.signature as Record<string, unknown>).publicKey;
    expect(embedded).toBeDefined();

    // JWS ES256 signatures are raw r||s, not DER.
    const signed = verify(
      'sha256',
      signResult.canonicalBytes,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signResult.signatureValue, 'base64url'),
    );
    expect(signed).toBe(true);

    // The hash a verifier recomputes from the envelope (affirmation slot
    // drift check) must equal the one sign() reported.
    const recomputed = provider.canonicalize(samplePayload(), {
      algorithm: 'ES256',
      publicKey: embedded as Parameters<typeof provider.canonicalize>[1]['publicKey'],
    });
    expect(signResult.canonicalHashSha256).toBe(recomputed.sha256Hex);
  });

  it('rejects unsupported algorithms at sign time', async () => {
    const { privateKey } = ecPair();
    await expect(
      provider.sign(samplePayload(), {
        algorithm: 'NOT-A-REAL-ALG',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
    ).rejects.toThrow(/does not support/);
  });

  it('honours excludes during sign and verify', async () => {
    const { privateKey } = ecPair();
    const payload = { ...samplePayload(), transient: 'volatile' };
    const signed = await provider.sign(payload, {
      algorithm: 'ES256',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      excludes: ['transient'],
    });
    // Mutating an excluded field must not invalidate the signature.
    const mutated = { ...signed.envelope, transient: 'something else' };
    const verifyResult = await provider.verify(mutated);
    expect(verifyResult.valid).toBe(true);
  });

  it('returns structured reasons when verification fails', async () => {
    const { privateKey } = ecPair();
    const signed = await provider.sign(samplePayload(), {
      algorithm: 'ES256',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const tampered = { ...signed.envelope, summary: 'different text' };
    const result = await provider.verify(tampered);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe('JssSignatureProvider', () => {
  const provider = new JssSignatureProvider();

  it('identifies as jss and advertises the X.590 asymmetric algorithm set', () => {
    expect(provider.name).toBe('jss');
    expect(provider.signatureFormat).toBe('jss');
    expect(provider.supportedAlgorithms).toContain('ES256');
    expect(provider.supportedAlgorithms).toContain('RS256');
    expect(provider.supportedAlgorithms).toContain('Ed25519');
    // JSS is asymmetric only — HMAC is intentionally absent.
    expect(provider.supportedAlgorithms).not.toContain('HS256');
  });

  it('produces canonical bytes and a hash for a given payload', () => {
    const payload = samplePayload();
    const { bytes, sha256Hex } = provider.canonicalize(payload, { algorithm: 'ES256' });
    expect(bytes.length).toBeGreaterThan(0);
    expect(sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs and verifies a JSON payload', async () => {
    const { privateKey } = ecPair();
    const signResult = await provider.sign(samplePayload(), {
      algorithm: 'ES256',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    expect(signResult.algorithm).toBe('ES256');
    expect(signResult.signatureValue.length).toBeGreaterThan(0);
    expect(signResult.canonicalHashSha256).toMatch(/^[0-9a-f]{64}$/);

    const verifyResult = await provider.verify(signResult.envelope);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.algorithm).toBe('ES256');
    expect(verifyResult.reasons).toEqual([]);
  });

  it('rejects unsupported algorithms at sign time', async () => {
    const { privateKey } = ecPair();
    await expect(
      provider.sign(samplePayload(), {
        algorithm: 'NOT-A-REAL-ALG',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
    ).rejects.toThrow(/does not support/);
  });
});

describe('SignatureProviderRegistry', () => {
  it('registers providers and looks them up by name', () => {
    const reg = new SignatureProviderRegistry();
    const jsf = new JsfSignatureProvider();
    reg.register(jsf);
    expect(reg.get('jsf')).toBe(jsf);
    expect(reg.has('jsf')).toBe(true);
    expect(reg.list()).toEqual([jsf]);
  });

  it('throws on require() for a missing provider', () => {
    const reg = new SignatureProviderRegistry();
    expect(() => reg.require('missing')).toThrow(/not registered/);
  });

  it('promotes the first registered provider to default', () => {
    const reg = new SignatureProviderRegistry();
    const jsf = new JsfSignatureProvider();
    const jss = new JssSignatureProvider();
    reg.register(jsf);
    reg.register(jss);
    expect(reg.getDefault()).toBe(jsf);
  });

  it('lets callers override the default explicitly', () => {
    const reg = new SignatureProviderRegistry();
    const jsf = new JsfSignatureProvider();
    const jss = new JssSignatureProvider();
    reg.register(jsf);
    reg.register(jss, { asDefault: true });
    expect(reg.getDefault()).toBe(jss);
  });

  it('unregister removes a provider and fixes up the default', () => {
    const reg = new SignatureProviderRegistry();
    const jsf = new JsfSignatureProvider();
    const jss = new JssSignatureProvider();
    reg.register(jsf);
    reg.register(jss);
    reg.unregister('jsf');
    expect(reg.has('jsf')).toBe(false);
    // Removing the default should bump the next-registered provider up.
    expect(reg.getDefault()).toBe(jss);
  });
});

describe('createRegistry / getSignatureProviders', () => {
  it('createRegistry returns both shipped providers with JSF as default', () => {
    const reg = createRegistry();
    expect(reg.has('jsf')).toBe(true);
    expect(reg.has('jss')).toBe(true);
    expect(reg.getDefault().name).toBe('jsf');
  });

  it('getSignatureProviders caches a process-wide instance', () => {
    const a = getSignatureProviders();
    const b = getSignatureProviders();
    expect(a).toBe(b);
    expect(a.has('jsf')).toBe(true);
  });
});

describe('getProviderForCycloneDxMajor', () => {
  it('returns the JSF provider for CycloneDX 1.x', () => {
    const reg = createRegistry();
    const provider = getProviderForCycloneDxMajor(1, reg);
    expect(provider.name).toBe('jsf');
  });

  it('returns the JSS provider for CycloneDX 2.x', () => {
    const reg = createRegistry();
    const provider = getProviderForCycloneDxMajor(2, reg);
    expect(provider.name).toBe('jss');
  });

  it('throws when the requested provider is missing from the registry', () => {
    const reg = new SignatureProviderRegistry();
    reg.register(new JsfSignatureProvider());
    expect(() => getProviderForCycloneDxMajor(2, reg)).toThrow(/not registered/);
  });
});
