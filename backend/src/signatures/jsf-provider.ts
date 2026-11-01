/**
 * JSF SignatureProvider — thin adapter over the standalone
 * @cyclonedx/sign package (JSF subpath). The adapter keeps the route
 * layer free of JSF-specific imports and pins a predictable shape for
 * DB storage.
 *
 * The implementation defers every crypto and canonicalization concern
 * to @cyclonedx/sign so that a future WebCrypto or HSM swap lives in
 * exactly one place: the signing library itself.
 *
 * The library's public sign() / verify() are async (HSM and KMS
 * backed signers are first class in 0.4.0), so the provider methods
 * are async too. The SignatureProvider interface mirrors that.
 */

import { createHash } from 'node:crypto';

import {
  canonicalize,
  type JsonObject as JsfJsonObject,
  type KeyInput as JsfKeyInput,
} from '@cyclonedx/sign';
import {
  computeCanonicalInputs,
  sign as jsfSign,
  verify as jsfVerify,
  type JsfAlgorithm,
  type JsfCanonicalInputState,
  type JsfSigner,
  type JsfSignerInput,
  type JsfSignOptions,
  type JsfVerifyOptions,
  type JsfVerifyResult,
} from '@cyclonedx/sign/jsf';

import type {
  CanonicalizedPayload,
  JsonObject,
  ProviderKeyInput,
  ProviderSignOptions,
  ProviderSignResult,
  ProviderVerifyOptions,
  ProviderVerifyResult,
  SignatureProvider,
} from './types.js';

const JSF_ALGORITHMS = [
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
  'Ed25519', 'Ed448',
  'HS256', 'HS384', 'HS512',
] as const;

export class JsfSignatureProvider implements SignatureProvider {
  readonly name = 'jsf';
  readonly signatureFormat = 'jsf';
  readonly supportedAlgorithms = JSF_ALGORITHMS;

  canonicalize(
    payload: JsonObject,
    signer: { algorithm: string; excludes?: string[]; signatureProperty?: string; publicKey?: JsonObject },
  ): CanonicalizedPayload {
    // When the envelope will embed the signer's public key, it is part of
    // the signed bytes; include it here or /prepare hashes different bytes
    // than verify checks (security review X2).
    const descriptor: Omit<JsfSigner, 'value'> = {
      algorithm: signer.algorithm as JsfAlgorithm,
      ...(signer.publicKey ? { publicKey: signer.publicKey as unknown as JsfSigner['publicKey'] } : {}),
      ...(signer.excludes ? { excludes: [...signer.excludes] } : {}),
    };
    const state: JsfCanonicalInputState = {
      mode: 'single',
      signers: [descriptor],
      finalized: [false],
      ...(signer.excludes ? { excludes: [...signer.excludes] } : {}),
    };
    const inputs = computeCanonicalInputs(
      payload as JsfJsonObject,
      state,
      signer.signatureProperty,
    );
    const bytes = inputs[0];
    if (!bytes) {
      // Should be impossible: state.signers has exactly one entry.
      throw new Error('JSF computeCanonicalInputs returned no input bytes');
    }
    return {
      bytes,
      sha256Hex: sha256Hex(bytes),
    };
  }

  async sign(
    payload: JsonObject,
    options: ProviderSignOptions,
  ): Promise<ProviderSignResult> {
    const jsfOptions = mapSignOptions(options);
    const envelope = await jsfSign(payload as JsfJsonObject, jsfOptions);

    const property = options.signatureProperty ?? 'signature';
    const signer = envelope[property] as unknown as JsfSigner | undefined;
    if (!signer) {
      // Should be impossible: jsfSign only returns on success.
      throw new Error('JSF sign returned an envelope without a signer');
    }

    // Recompute the canonical bytes so we can return them to the caller
    // alongside the envelope. Both callers and audit logs benefit from
    // having the pre-signature input persisted next to the signature.
    // The public key jsfSign embedded is part of the signed bytes, so it
    // must be part of these too; without it the returned hash never
    // matched what verify recomputes (demo seal "drift").
    const canonical = this.canonicalize(payload, {
      algorithm: options.algorithm,
      ...(signer.publicKey ? { publicKey: signer.publicKey as unknown as JsonObject } : {}),
      ...(options.excludes ? { excludes: options.excludes } : {}),
      ...(options.signatureProperty ? { signatureProperty: options.signatureProperty } : {}),
    });

    const result: ProviderSignResult = {
      envelope: envelope as JsonObject,
      algorithm: signer.algorithm,
      signatureValue: signer.value,
      canonicalBytes: canonical.bytes,
      canonicalHashSha256: canonical.sha256Hex,
    };
    if (signer.publicKey) {
      result.publicKey = signer.publicKey;
    }
    return result;
  }

  async verify(
    envelope: JsonObject,
    options: ProviderVerifyOptions = {},
  ): Promise<ProviderVerifyResult> {
    const jsfOptions: JsfVerifyOptions = {};
    if (options.publicKey !== undefined) {
      jsfOptions.publicKey = toJsfKeyInput(options.publicKey);
    }
    if (options.allowedAlgorithms) {
      // Trust caller-supplied identifiers as JSF algorithm strings;
      // unknown values fail closed during verify.
      jsfOptions.allowedAlgorithms = [...options.allowedAlgorithms] as JsfAlgorithm[];
    }
    if (options.requireEmbeddedPublicKey) {
      jsfOptions.requireEmbeddedPublicKey = true;
    }
    if (options.signatureProperty) {
      jsfOptions.signatureProperty = options.signatureProperty;
    }

    let jsfResult: JsfVerifyResult;
    try {
      jsfResult = await jsfVerify(envelope as JsfJsonObject, jsfOptions);
    } catch (err) {
      // The JSF library throws on caller bugs (malformed envelope,
      // missing key, unknown algorithm). Surface those as a structured
      // failure so the route layer can render a reason without
      // unwrapping a thrown Error.
      return {
        valid: false,
        reasons: [(err as Error).message],
      };
    }

    // Single-mode is what the provider supports, so map the first
    // signer's per-signer fields to the flat ProviderVerifyResult
    // shape and concatenate envelope-level errors with that signer's
    // errors so the caller sees a unified reason list.
    const firstSigner = jsfResult.signers[0];
    const out: ProviderVerifyResult = {
      valid: jsfResult.valid,
      reasons: [
        ...jsfResult.errors,
        ...(firstSigner ? firstSigner.errors : []),
      ],
    };
    if (firstSigner?.algorithm !== undefined) {
      out.algorithm = firstSigner.algorithm;
    }
    if (firstSigner?.publicKey !== undefined) {
      out.publicKey = firstSigner.publicKey;
    }
    if (firstSigner?.keyId !== undefined) {
      out.keyId = firstSigner.keyId;
    }
    if (firstSigner?.certificatePath !== undefined) {
      out.certificatePath = [...firstSigner.certificatePath];
    }
    if (jsfResult.excludes !== undefined) {
      out.excludes = [...jsfResult.excludes];
    }
    return out;
  }
}

/**
 * Utility exported for tests and the attestations route. Returns the
 * exact bytes a JSF signer would canonicalize before signing.
 */
export function jsfCanonicalBytes(payload: JsonObject): Uint8Array {
  return canonicalize(payload as JsfJsonObject);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toJsfKeyInput(input: ProviderKeyInput): JsfKeyInput {
  // ProviderKeyInput is intentionally a narrower union than JSF's
  // native KeyInput (we do not surface KeyObject in the public
  // provider API). The runtime values are compatible for the shapes
  // the provider accepts.
  return input as unknown as JsfKeyInput;
}

function mapSignOptions(options: ProviderSignOptions): JsfSignOptions {
  if (!isSupportedAlgorithm(options.algorithm)) {
    throw new Error(`JSF provider does not support algorithm: ${options.algorithm}`);
  }
  // 0.4.0 nests per-signer fields under a `signer` object on
  // JsfSignOptions. Top-level options on JsfSignOptions cover wrapper
  // concerns that apply across signers (excludes, extensions,
  // signatureProperty, mode).
  const signer: JsfSignerInput = {
    algorithm: options.algorithm,
    privateKey: toJsfKeyInput(options.privateKey),
  };
  if (options.publicKey !== undefined) {
    if (options.publicKey === false) {
      signer.publicKey = false;
    } else if (options.publicKey !== 'auto') {
      // 'auto' is the library default when publicKey is unset; we
      // omit the field rather than passing a sentinel string.
      signer.publicKey = toJsfKeyInput(options.publicKey);
    }
  }
  if (options.keyId !== undefined) signer.keyId = options.keyId;
  if (options.certificatePath !== undefined) {
    signer.certificatePath = [...options.certificatePath];
  }

  const jsfOptions: JsfSignOptions = { signer };
  if (options.excludes !== undefined) jsfOptions.excludes = [...options.excludes];
  if (options.signatureProperty !== undefined) {
    jsfOptions.signatureProperty = options.signatureProperty;
  }
  return jsfOptions;
}

function isSupportedAlgorithm(
  algorithm: string,
): algorithm is (typeof JSF_ALGORITHMS)[number] {
  return (JSF_ALGORITHMS as readonly string[]).includes(algorithm);
}
