/**
 * SignatureProvider abstraction.
 *
 * Assessors Studio supports both CycloneDX signature formats through
 * one provider interface. JSF (the CycloneDX jsf-0.82 subschema) is
 * the format for CycloneDX 1.x. JSS (ITU-T X.590, the JSON signature
 * scheme) is the format for CycloneDX 2.x. Route code never talks to
 * a concrete library: it asks a SignatureProvider to canonicalize,
 * sign, and verify, and the registry decides which implementation
 * answers. The mapping from spec version to provider lives in
 * `signatures/index.ts`.
 *
 * A provider owns:
 *   1. Canonicalization of the JSON payload (for JSF: JCS / RFC 8785;
 *      for JSS: the canonical JSON form defined by ITU-T X.590).
 *   2. The list of algorithm identifiers it can produce or consume.
 *   3. The sign step, which returns a signed envelope plus the raw
 *      material the audit log needs to store.
 *   4. The verify step, which returns a structured outcome suitable
 *      for rendering to an end user.
 *
 * The interface is intentionally thin. Both shipped formats are
 * JSON-native and can carry the verifying key inside the envelope, so
 * providers are free to embed public keys, defer to an external trust
 * anchor, or store them out of band as appropriate for their format.
 */

import type { JsonObject } from '@cyclonedx/sign';

export type { JsonObject, JsonValue } from '@cyclonedx/sign';

/**
 * A key the caller passes in. Providers decide how to parse it:
 *   - string: a PEM-encoded key or a JWK-serialized JSON document
 *   - Buffer / Uint8Array: raw HMAC material for symmetric algorithms
 *   - Record<string, unknown>: an already-parsed JWK object
 *
 * Providers that accept certificate chains or hardware tokens may
 * extend this union via provider-specific KeyInput subtypes.
 */
export type ProviderKeyInput =
  | string
  | Buffer
  | Uint8Array
  | Record<string, unknown>;

/**
 * Options the route can hand to any provider. Providers are expected
 * to ignore fields that do not apply to their format (for example a
 * provider whose canonical form fixes the signer property name would
 * ignore `signatureProperty`).
 */
export interface ProviderSignOptions {
  /** Algorithm identifier recognized by this provider. */
  algorithm: string;

  /** The signing key. */
  privateKey: ProviderKeyInput;

  /**
   * The public key to bind into the envelope, when applicable.
   * Passing `false` tells asymmetric providers to omit the embedded
   * key (useful when the verifier has the key out of band). Passing
   * `'auto'` or omitting the field derives the public key from the
   * private key where possible.
   */
  publicKey?: ProviderKeyInput | false | 'auto';

  /** Application-specific key identifier. */
  keyId?: string;

  /**
   * Ordered certificate chain to bind into the envelope, encoded in
   * the format the target signature scheme expects (base64-DER for
   * the formats that travel inside JSON envelopes today).
   */
  certificatePath?: string[];

  /**
   * Top-level property names to exclude from the canonical payload
   * before signing. Format-specific; JSF treats the list as part of
   * the signer object per JSF 0.82 § 3.4.
   */
  excludes?: string[];

  /**
   * Where to attach the signer in the envelope. JSF defaults to
   * `"signature"`. Other formats whose canonical form fixes the
   * property name may ignore this.
   */
  signatureProperty?: string;
}

export interface ProviderVerifyOptions {
  /**
   * The verifying key, when the envelope does not carry one. HMAC
   * providers always require this.
   */
  publicKey?: ProviderKeyInput;

  /** Restrict the set of algorithms accepted by this call. */
  allowedAlgorithms?: string[];

  /**
   * Refuse envelopes whose signer does not carry its own verifying
   * key. Useful when the caller does not want to trust an out-of-band
   * key lookup.
   */
  requireEmbeddedPublicKey?: boolean;

  /** Where to find the signer in the envelope. JSF default: "signature". */
  signatureProperty?: string;
}

/**
 * The bytes a provider would feed into its sign primitive. Returning
 * these separately lets the caller pre-display a hash to the user and
 * pairs well with two-phase client-side signing flows (the caller
 * signs the bytes locally and resubmits the signature).
 */
export interface CanonicalizedPayload {
  /** The exact bytes the provider will sign. */
  bytes: Uint8Array;
  /** SHA-256 of `bytes`, lowercase hex. */
  sha256Hex: string;
}

export interface ProviderSignResult {
  /** The complete signed envelope the provider returned. */
  envelope: JsonObject;
  /** Algorithm that was actually used. */
  algorithm: string;
  /** Encoded signature value in the format the provider produces (base64url for JSF / JSS). */
  signatureValue: string;
  /** Canonical bytes that were signed. */
  canonicalBytes: Uint8Array;
  /** SHA-256 of `canonicalBytes`, lowercase hex. */
  canonicalHashSha256: string;
  /**
   * Public key that should be retained for later verification, in the
   * shape the provider's verify step accepts. May be undefined for
   * HMAC or when the caller explicitly omitted key embedding.
   */
  publicKey?: unknown;
}

export interface ProviderVerifyResult {
  /** True when the signature cryptographically verifies. */
  valid: boolean;
  /** Algorithm recorded in the envelope (if recoverable). */
  algorithm?: string;
  /** Public key recorded in the envelope (if any). */
  publicKey?: unknown;
  /** keyId recorded in the envelope (if any). */
  keyId?: string;
  /** Certificate chain recorded in the envelope (if any). */
  certificatePath?: string[];
  /** Excluded properties recorded in the envelope (if any). */
  excludes?: string[];
  /** Human-readable reasons the verify failed. Empty when valid. */
  reasons: string[];
}

export interface SignatureProvider {
  /** Provider identifier: 'jsf' for JSF 0.82, 'jss' for ITU-T X.590. */
  readonly name: string;

  /** Canonical label for the signature format (used in DB rows). */
  readonly signatureFormat: string;

  /** Algorithms this provider can produce or consume. */
  readonly supportedAlgorithms: readonly string[];

  /**
   * Return the exact bytes that a sign call would feed into its
   * cryptographic primitive, plus their SHA-256 hash. The `signer`
   * argument lets providers include algorithm and other signer metadata
   * in the canonical form (JSF binds them into the envelope; other
   * schemes may bind them via the canonical input itself).
   */
  canonicalize(
    payload: JsonObject,
    signer: { algorithm: string; excludes?: string[]; signatureProperty?: string; publicKey?: JsonObject },
  ): CanonicalizedPayload;

  /**
   * Sign a JSON payload and return the resulting envelope. Async so
   * provider implementations are free to delegate to async crypto
   * primitives (the bundled @cyclonedx/sign package switched to an
   * async surface in 0.4.0 to support HSM and KMS backed signers).
   */
  sign(payload: JsonObject, options: ProviderSignOptions): Promise<ProviderSignResult>;

  /** Verify a signed envelope. */
  verify(envelope: JsonObject, options?: ProviderVerifyOptions): Promise<ProviderVerifyResult>;
}
