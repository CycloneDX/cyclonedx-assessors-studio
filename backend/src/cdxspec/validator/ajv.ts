/**
 * Ajv instance + compiled validators for the supported CycloneDX
 * specification versions. Schemas are loaded from disk at first use
 * and cached for the process lifetime.
 *
 * The schemas ship as JSON files alongside this module so that
 * production deployments (which run from dist/) do not need to look
 * up anything outside the package. The build copy-assets script
 * mirrors .json files from src/ to dist/ on build, so the
 * schemas/ folder follows automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';

import type { CdxSpecVersion } from '../types.js';

// ajv-formats is a CommonJS module that assigns its plugin function
// via `module.exports = formatsPlugin`. Under NodeNext with an ESM
// host, the resulting default import is reported as a namespace
// object by the TypeScript checker even though it is callable at
// runtime. createRequire gets the real callable value without the
// type-layer wrapping; the signature is narrowed explicitly.
const require_ = createRequire(import.meta.url);
const addFormats = require_('ajv-formats') as (ajv: Ajv) => void;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, 'schemas');

/**
 * CycloneDX uses a handful of format names (iri, iri-reference,
 * idn-email, idn-hostname) that ajv-formats does not ship. Register
 * them as pass-through formats so Ajv does not reject the schema
 * outright. URI syntax is already validated by the `uri-reference`
 * format registered by ajv-formats; the additional aliases exist so
 * that schemas which declare the IRI variants still compile.
 */
function registerPassthroughFormats(ajv: Ajv): void {
  const passthrough = ['iri', 'iri-reference', 'idn-email', 'idn-hostname'];
  for (const name of passthrough) {
    if (!ajv.formats[name]) {
      ajv.addFormat(name, { type: 'string', validate: (_value: string) => true });
    }
  }
}

function loadJson(file: string): Record<string, unknown> {
  const full = path.join(schemasDir, file);
  const raw = fs.readFileSync(full, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

let cachedAjv: Ajv | null = null;
const cachedValidators: Map<CdxSpecVersion, ValidateFunction> = new Map();

function createAjv(): Ajv {
  // strict:false is required because the CycloneDX schemas use
  // non-core keywords such as `meta:enum` and `examples` in places
  // ajv's strict mode flags as unknown. strictSchema:false allows the
  // schemas to compile; input validation remains strict.
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  registerPassthroughFormats(ajv);

  // Register the supporting schemas so that $ref resolution inside
  // bom-1.6 / bom-1.7 can find them by the CycloneDX absolute URI.
  ajv.addSchema(loadJson('spdx.schema.json'));
  ajv.addSchema(loadJson('jsf-0.82.schema.json'));
  ajv.addSchema(loadJson('cryptography-defs.schema.json'));
  ajv.addSchema(loadJson('bom-1.6.schema.json'));
  ajv.addSchema(loadJson('bom-1.7.schema.json'));

  return ajv;
}

export function getAjv(): Ajv {
  if (!cachedAjv) cachedAjv = createAjv();
  return cachedAjv;
}

export function getValidator(version: CdxSpecVersion): ValidateFunction {
  const cached = cachedValidators.get(version);
  if (cached) return cached;

  const ajv = getAjv();
  const uri =
    version === '1.6'
      ? 'http://cyclonedx.org/schema/bom-1.6.schema.json'
      : 'http://cyclonedx.org/schema/bom-1.7.schema.json';

  const validator = ajv.getSchema(uri);
  if (!validator) {
    throw new Error(`CycloneDX validator not found for ${uri}`);
  }
  cachedValidators.set(version, validator);
  return validator;
}

/**
 * Exposed for tests that want to exercise a cold Ajv boot.
 * @internal Test seam; not part of the module API.
 */
export function resetAjvCacheForTests(): void {
  cachedAjv = null;
  cachedValidators.clear();
}
