/**
 * JSS SignatureProvider — thin adapter over the standalone
 * @cyclonedx/sign package (JSS subpath).
 *
 * JSS is the JSON Signature Scheme defined by ITU-T X.590 (October
 * 2023). It is the signature format adopted by CycloneDX 2.x. JSF
 * remains the signature format for CycloneDX 1.x; the two are not
 * interchangeable on the wire.
 *
 * Binding to a CycloneDX major version:
 *
 *   - CycloneDX 2.x  -> JSS  (this provider)
 *   - CycloneDX 1.x  -> JSF  (see jsf-provider.ts)
 *
 * Assessors Studio currently emits CycloneDX 1.6 and 1.7 documents.
 * The JSS provider is registered alongside the JSF provider so the
 * future v2 export path can pick it up by major version without
 * touching the registry contract. All crypto and canonicalization
 * concerns are delegated to @cyclonedx/sign so a future WebCrypto or
 * HSM swap lives in exactly one place: the signing library itself.
 *
 * The library's public sign() / verify() are async (HSM and KMS
 * backed signers are first class in 0.4.0), so the provider methods
 * are async too. The SignatureProvider interface mirrors that.
 */

import { createHash } from 'node:crypto';

import {
  canonicalize,
  type JsonObject as JssJsonObject,
  type KeyInput as JssKeyInput,
} from '@cyclonedx/sign';
import {
  computeCanonicalInputs,
  sign as jssSign,
  verify as jssVerify,
  JssAlgorithms,
  type JssAlgorithm,
  type JssSigner,
  type JssSignerInput,
  type JssSignOptions,
  type JssVerifyOptions,
  type JssVerifyResult,
} from '@cyclonedx/sign/jss';

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

// JSS at X.590 § 6.2.1 covers the same asymmetric algorithm set as JSF
// minus the HMAC family. HMAC is JSF-only because X.590 does not
// specify a symmetric path.
const JSS_ALGORITHMS = [
  JssAlgorithms.RS256, JssAlgorithms.RS384, JssAlgorithms.RS512,
  JssAlgorithms.PS256, JssAlgorithms.PS384, JssAlgorithms.PS512,
  JssAlgorithms.ES256, JssAlgorithms.ES384, JssAlgorithms.ES512,
  JssAlgorithms.Ed25519, JssAlgorithms.Ed448,
] as const;

export class JssSignatureProvider implements SignatureProvider {
  readonly name = 'jss';
  readonly signatureFormat = 'jss';
  readonly supportedAlgorithms = JSS_ALGORITHMS;

  canonicalize(
    payload: JsonObject,
    signer: { algorithm: string; excludes?: string[]; signatureProperty?: string; publicKey?: JsonObject },
  ): CanonicalizedPayload {
    // JSS does not have JSF's `excludes` mechanism. We accept the
    // option in the signature for cross-provider symmetry but ignore
    // its value at canonicalize time; callers that need to omit
    // properties from the canonical input should strip them before
    // handing the payload to this provider.
    const inputs = computeCanonicalInputs(payload as JssJsonObject, {
      signers: [{ algorithm: signer.algorithm }],
      ...(signer.signatureProperty ? { signatureProperty: signer.signatureProperty } : {}),
    });
    const bytes = inputs[0];
    if (!bytes) {
      // Should be impossible: state.signers has exactly one entry.
      throw new Error('JSS computeCanonicalInputs returned no input bytes');
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
    const jssOptions = mapSignOptions(options);
    const envelope = await jssSign(payload as JssJsonObject, jssOptions);

    const property = options.signatureProperty ?? 'signatures';
    const signers = envelope[property] as unknown as JssSigner[] | undefined;
    const signer = signers?.[0];
    if (!signer) {
      throw new Error('JSS sign returned an envelope without a signer');
    }

    const canonical = this.canonicalize(payload, {
      algorithm: options.algorithm,
      ...(options.signatureProperty ? { signatureProperty: options.signatureProperty } : {}),
    });

    const result: ProviderSignResult = {
      envelope: envelope as JsonObject,
      algorithm: signer.algorithm,
      signatureValue: signer.value,
      canonicalBytes: canonical.bytes,
      canonicalHashSha256: canonical.sha256Hex,
    };
    if (signer.public_key) {
      result.publicKey = signer.public_key;
    }
    return result;
  }

  async verify(
    envelope: JsonObject,
    options: ProviderVerifyOptions = {},
  ): Promise<ProviderVerifyResult> {
    const jssOptions: JssVerifyOptions = {};
    if (options.publicKey !== undefined) {
      jssOptions.publicKey = toJssKeyInput(options.publicKey);
    }
    if (options.allowedAlgorithms) {
      jssOptions.allowedAlgorithms = [...options.allowedAlgorithms] as JssAlgorithm[];
    }
    if (options.requireEmbeddedPublicKey) {
      jssOptions.requireEmbeddedKeyMaterial = true;
    }
    if (options.signatureProperty) {
      jssOptions.signatureProperty = options.signatureProperty;
    }

    let jssResult: JssVerifyResult;
    try {
      jssResult = await jssVerify(envelope as JssJsonObject, jssOptions);
    } catch (err) {
      return {
        valid: false,
        reasons: [(err as Error).message],
      };
    }

    const firstSigner = jssResult.signers[0];
    const out: ProviderVerifyResult = {
      valid: jssResult.valid,
      reasons: [
        ...jssResult.errors,
        ...(firstSigner ? firstSigner.errors : []),
      ],
    };
    if (firstSigner?.algorithm !== undefined) {
      out.algorithm = firstSigner.algorithm;
    }
    if (firstSigner?.public_key !== undefined) {
      out.publicKey = firstSigner.public_key;
    }
    if (firstSigner?.thumbprint !== undefined) {
      out.keyId = firstSigner.thumbprint;
    }
    if (firstSigner?.public_cert_chain !== undefined) {
      out.certificatePath = [...firstSigner.public_cert_chain];
    }
    return out;
  }
}

/**
 * Utility exported for tests and the v2 export path. Returns the exact
 * bytes a JSS signer would canonicalize before signing.
 */
export function jssCanonicalBytes(payload: JsonObject): Uint8Array {
  return canonicalize(payload as JssJsonObject);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toJssKeyInput(input: ProviderKeyInput): JssKeyInput {
  return input as unknown as JssKeyInput;
}

function mapSignOptions(options: ProviderSignOptions): JssSignOptions {
  if (!isSupportedAlgorithm(options.algorithm)) {
    throw new Error(`JSS provider does not support algorithm: ${options.algorithm}`);
  }
  const signer: JssSignerInput = {
    algorithm: options.algorithm,
    privateKey: toJssKeyInput(options.privateKey),
  };
  if (options.publicKey !== undefined) {
    if (options.publicKey === false) {
      signer.public_key = false;
    } else if (options.publicKey !== 'auto') {
      signer.public_key = toJssKeyInput(options.publicKey);
    }
  }
  // JSS embeds key identity through `thumbprint` rather than JSF's
  // `keyId`. Map across at the provider boundary so callers see a
  // single API regardless of format.
  if (options.keyId !== undefined) signer.thumbprint = options.keyId;
  if (options.certificatePath !== undefined) {
    signer.public_cert_chain = [...options.certificatePath];
  }

  const jssOptions: JssSignOptions = { signer };
  if (options.signatureProperty !== undefined) {
    jssOptions.signatureProperty = options.signatureProperty;
  }
  return jssOptions;
}

function isSupportedAlgorithm(
  algorithm: string,
): algorithm is (typeof JSS_ALGORITHMS)[number] {
  return (JSS_ALGORITHMS as readonly string[]).includes(algorithm);
}
