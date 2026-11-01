import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config();

/**
 * Environment variables that support a `<NAME>_FILE` companion pointing
 * at a file whose contents are used as the value. This is the standard
 * Docker Compose secrets pattern (`/run/secrets/<name>`), and it lets
 * operators keep credentials out of the environment block and process
 * listings.
 *
 * The companion variable wins when both are set so that a stale env
 * value cannot mask the secret file, and so that troubleshooting a
 * misconfiguration (e.g. wrong file path) is an obvious failure rather
 * than a silent fallback to the environment value.
 */
const FILE_BACKED_ENV_VARS = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  // Every secret can come from a mounted file (Compose secrets) so it is
  // not visible in `docker inspect` or /proc/*/environ (security review W5).
  'DATABASE_URL',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'MASTER_ENCRYPTION_KEY',
  'SMTP_PASS',
  'METRICS_TOKEN',
  'SETUP_TOKEN',
] as const;

/**
 * For each file-backed env var, if the `<NAME>_FILE` variable is set,
 * read that file and use its contents as the value of `<NAME>`. The
 * trailing newline (a common artifact of `echo "secret" > file`) is
 * stripped to reduce operator surprise. Errors while reading are
 * surfaced immediately; silently falling through to the env value
 * would hide a broken secret mount from the operator.
 *
 * Exported so tests that mutate process.env between cases can
 * re-resolve explicitly after changing the `_FILE` variable. In
 * production the first getConfig() call is the single trigger.
 */
function resolveFileBackedEnvVars(): void {
  for (const name of FILE_BACKED_ENV_VARS) {
    const filePath = process.env[`${name}_FILE`];
    if (!filePath) continue;
    try {
      const contents = fs.readFileSync(filePath, 'utf8');
      process.env[name] = contents.replace(/\r?\n$/, '');
    } catch (error) {
      throw new Error(
        `${name}_FILE is set to ${filePath} but the file could not be read: ` +
          `${(error as Error).message}. Check the Docker secret name, the volume ` +
          `mount, and the container user's read permissions.`,
      );
    }
  }
}

/**
 * Boolean coercion that works correctly for environment variables.
 *
 * z.coerce.boolean() uses Boolean(value), which returns true for any
 * non-empty string — including "false", "0", and "no". Since env vars
 * are always strings, that makes every _ENABLED=false flag evaluate
 * to true. This helper recognizes the common textual forms.
 */
const envBoolean = (defaultValue: boolean) =>
  z
    .preprocess((v) => {
      if (typeof v === 'boolean') return v;
      if (v === undefined || v === null) return defaultValue;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === '') return defaultValue;
        if (['true', '1', 'yes', 'on'].includes(s)) return true;
        if (['false', '0', 'no', 'off'].includes(s)) return false;
      }
      return Boolean(v);
    }, z.boolean())
    .default(defaultValue);

const envSchema = z.object({
  DATABASE_PROVIDER: z.enum(['pglite', 'postgres']).default('pglite'),
  DATABASE_URL: z.string().default('postgresql://localhost:5432/assessors_studio'),
  // Optional. Replaces the password in DATABASE_URL, so the URL can stay
  // in plain config while the password comes from a secret file
  // (DATABASE_PASSWORD_FILE) shared with the postgres container.
  DATABASE_PASSWORD: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default('./data/pglite'),
  // Optional. If unset, the backend generates a secret on first run
  // and persists it in the app_config table. Set this in environments
  // that run multiple replicas or that need a specific signing key.
  JWT_SECRET: z.string().default(''),
  JWT_EXPIRY: z.string().default('24h'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // HSTS directives that reach beyond this host: opt in only when every
  // subdomain serves HTTPS (and, for preload, after submitting the domain).
  HSTS_INCLUDE_SUBDOMAINS: envBoolean(false),
  HSTS_PRELOAD: envBoolean(false),

  // Self service registration gate.
  //   disabled    — reject every POST /register request (default).
  //   invite_only — require a valid unused invite token issued by an admin.
  //   open        — accept any well formed registration (legacy behavior).
  // Defaults to disabled so a fresh deployment is closed until the operator
  // makes an explicit choice.
  REGISTRATION_MODE: z.enum(['disabled', 'invite_only', 'open']).default('disabled'),
  // ACCEPT_OPEN_REGISTRATION_RISK: operator acknowledgement required to
  // run REGISTRATION_MODE=open in production. Open mode accepts any well
  // formed registration with no invite token, which is a known path for
  // spam account creation, brute force setup of elevated roles, and
  // trivial reconnaissance of the tenancy. The production boot guard
  // refuses to start unless this flag is explicitly set to 1 (or true),
  // which forces the operator to make a deliberate choice. Non-production
  // environments ignore the flag so local and CI setups remain
  // friction-free.
  ACCEPT_OPEN_REGISTRATION_RISK: envBoolean(false),

  // Evidence storage provider
  STORAGE_PROVIDER: z.enum(['database', 's3']).default('database'),
  UPLOAD_MAX_FILE_SIZE: z.coerce.number().int().positive().default(52428800), // 50 MB

  // S3-compatible storage (required when STORAGE_PROVIDER=s3)
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: envBoolean(false),

  // Application URL (required for external notification channels)
  APP_URL: z.string().default('http://localhost:5173'),

  // Email / SMTP channel
  SMTP_ENABLED: envBoolean(false),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: envBoolean(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),
  SMTP_TLS_REJECT_UNAUTHORIZED: envBoolean(true),

  // Webhook channel
  WEBHOOK_ENABLED: envBoolean(true),
  WEBHOOK_TIMEOUT: z.coerce.number().int().positive().default(10000),
  WEBHOOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Chat channels
  SLACK_ENABLED: envBoolean(false),
  TEAMS_ENABLED: envBoolean(false),
  MATTERMOST_ENABLED: envBoolean(false),
  CHAT_TIMEOUT: z.coerce.number().int().positive().default(10000),
  CHAT_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Encryption at rest
  MASTER_ENCRYPTION_KEY: z.string().default(''),
  REQUIRE_ENCRYPTION: envBoolean(false),

  // Prometheus metrics
  METRICS_ENABLED: envBoolean(false),
  METRICS_TOKEN: z.string().default(''),
  // SETUP_TOKEN: fixed one-time token for the first-run setup wizard.
  // When unset, a random token is generated at boot and printed to the log.
  SETUP_TOKEN: z.string().min(16).optional(),
  METRICS_PREFIX: z.string().default('cdxa_'),
  METRICS_DOMAIN_REFRESH_INTERVAL: z.coerce.number().int().positive().default(60),

  // Authentication throttling and account lockout.
  // LOGIN_MAX_FAILED_ATTEMPTS: number of consecutive failed password
  // verifications that trigger a temporary account lock. Set to 0 to
  // disable lockout (counter is still tracked for auditing).
  // LOGIN_LOCKOUT_DURATION_MINUTES: backoff window applied after the
  // threshold is reached. A successful login before the window expires
  // is still rejected; operators unlock early by clearing locked_until.
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().nonnegative().default(5),
  LOGIN_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),

  // Session and invite cleanup.
  // SESSION_CLEANUP_INTERVAL_MINUTES: how often the background job sweeps
  // expired sessions and stale invites. Set to 0 to disable the job (not
  // recommended outside tests).
  // SESSION_RETAIN_EXPIRED_HOURS: how long expired sessions are kept
  // before they are deleted. A small retention window is useful for
  // forensic auditing when a token was replayed after expiration.
  // INVITE_RETAIN_AFTER_TERMINAL_DAYS: how long consumed or revoked
  // invites stay in the table before they are deleted.
  SESSION_CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().nonnegative().default(15),
  SESSION_RETAIN_EXPIRED_HOURS: z.coerce.number().int().nonnegative().default(24),
  INVITE_RETAIN_AFTER_TERMINAL_DAYS: z.coerce.number().int().nonnegative().default(30),

  // Cookie security hardening.
  // COOKIE_SECURE:
  //   - "auto" (default): infer the Secure flag from APP_URL scheme and
  //     NODE_ENV. Any https:// APP_URL or production NODE_ENV marks
  //     cookies Secure.
  //   - "true" / "false": force the flag on or off regardless of other
  //     signals. Use "true" when the app is deployed behind a TLS
  //     terminator that does not advertise https to the Node process.
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  // TRUST_PROXY_HOPS: number of reverse proxy hops to trust for
  // X-Forwarded-* header parsing. 0 keeps Express's default (disabled).
  // Setting this to 1 is appropriate when a single TLS-terminating
  // ingress (e.g. nginx, ALB, Traefik) sits directly in front of the
  // Node process.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

  // Password policy.
  // PASSWORD_MIN_LENGTH: minimum character length for newly created
  // passwords (registration, setup, admin create, password change).
  // Login path intentionally allows shorter passwords so legacy
  // accounts predating a tightened policy can still authenticate.
  // Default of 12 aligns with OWASP ASVS 5.0 L1 (requirement 2.1.1).
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(12),
  // PASSWORD_HIBP_CHECK_ENABLED: when true, new passwords are checked
  // against the Have I Been Pwned range API using k-anonymity. Only
  // the first five hex characters of the SHA-1 hash ever leave the
  // server. Defaults to false so that standalone or air-gapped
  // deployments and test suites do not make outbound calls.
  PASSWORD_HIBP_CHECK_ENABLED: envBoolean(false),
  // PASSWORD_HIBP_TIMEOUT_MS: hard cap on the HIBP request. The check
  // fails open on timeout or network error so an unreachable service
  // cannot lock users out of password rotation.
  PASSWORD_HIBP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

type Env = z.infer<typeof envSchema>;

let config: Env | null = null;

export function getConfig(): Env {
  if (!config) {
    // Resolve any `<NAME>_FILE` companion variables into the plain
    // env variables the schema reads. Done on every cold start (and
    // after resetConfig) so test helpers that mutate process.env
    // between cases do not need to manually re-invoke the resolver.
    resolveFileBackedEnvVars();

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid environment configuration: ${errors}`);
    }

    config = withDatabasePassword(result.data);
  }

  return config;
}

/** Puts DATABASE_PASSWORD (when set) into DATABASE_URL. */
function withDatabasePassword(env: Env): Env {
  if (!env.DATABASE_PASSWORD) return env;
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Invalid environment configuration: DATABASE_URL must be a URL when DATABASE_PASSWORD is set');
  }
  url.password = encodeURIComponent(env.DATABASE_PASSWORD);
  return { ...env, DATABASE_URL: url.toString() };
}

/**
 * Invalidate the cached config so the next getConfig() call
 * re-reads process.env.  Used by test helpers that override
 * environment variables after the module has been loaded.
 * @internal Test seam; not part of the module API.
 */
export function resetConfig(): void {
  config = null;
}

/**
 * Startup-time configuration guards.
 *
 * These checks refuse to boot the process when a combination of
 * settings would leave the service in an unsafe or clearly
 * misconfigured state. They are intentionally noisy: the operator
 * should see a specific error and know exactly which environment
 * variable to change.
 *
 * Called from the entrypoint after getConfig() returns. Safe to call
 * from tests that want to assert the guard logic directly; callers
 * that only want the cached config should use getConfig().
 */
export function validateStartupConfig(cfg: Env = getConfig()): void {
  // Behind a reverse proxy with TRUST_PROXY_HOPS=0, every request appears
  // to come from the proxy: rate limits become one bucket for the whole
  // organization (one caller can lock everyone out of sign-in) and audit
  // IPs are all the proxy's (security review A2/W1). An https APP_URL in
  // production almost always means a TLS-terminating proxy.
  if (cfg.NODE_ENV === 'production' && cfg.TRUST_PROXY_HOPS === 0 && cfg.APP_URL?.startsWith('https://')) {
    console.warn(
      '[config] TRUST_PROXY_HOPS=0 with an https APP_URL: if a reverse proxy terminates TLS, ' +
        'set TRUST_PROXY_HOPS to the number of proxies in front of the app, or every user ' +
        'shares one rate-limit bucket.',
    );
  }

  // Metrics endpoint is only safe to expose when a bearer token is
  // configured. Without it the endpoint serves internal counters
  // unauthenticated and can leak operational signal to anyone that
  // reaches the container port.
  if (cfg.METRICS_ENABLED && cfg.NODE_ENV !== 'test') {
    if (!cfg.METRICS_TOKEN || cfg.METRICS_TOKEN.length < 16) {
      throw new Error(
        'METRICS_ENABLED=true but METRICS_TOKEN is unset or shorter than 16 characters. ' +
          'Set METRICS_TOKEN to a long random string so the /metrics endpoint is not ' +
          'served unauthenticated, or set METRICS_ENABLED=false to disable the endpoint.',
      );
    }
  }

  // Refuse to boot REGISTRATION_MODE=open in production unless the
  // operator has explicitly acknowledged the risk. Open mode accepts any
  // registration without an invite, which is rarely what a production
  // tenant wants; the acknowledgement flag turns an accidental
  // misconfiguration into a loud failure rather than a silent
  // anyone-can-register window. Non-production environments skip this
  // check so local and CI workflows that want open mode do not need the
  // flag.
  if (
    cfg.REGISTRATION_MODE === 'open' &&
    cfg.NODE_ENV === 'production' &&
    !cfg.ACCEPT_OPEN_REGISTRATION_RISK
  ) {
    throw new Error(
      'REGISTRATION_MODE=open is not permitted in production without ' +
        'ACCEPT_OPEN_REGISTRATION_RISK=1. Open registration accepts any well ' +
        'formed request and should only be enabled when you have other ' +
        'controls (network gating, captcha, email verification) in place. ' +
        'Set ACCEPT_OPEN_REGISTRATION_RISK=1 to acknowledge and continue, ' +
        'or switch to REGISTRATION_MODE=invite_only.',
    );
  }

  // S3 storage requires credentials to be reachable before any route is
  // mounted. Previously the check lived inside initializeStorage(),
  // which runs later in the boot sequence and hides the failure behind
  // event system and encryption init. Validating here surfaces a
  // missing Docker secret mount or a typo in a `_FILE` path as an
  // immediate startup error. The bucket name is not secret, so it
  // continues to be sourced from the environment; only the credentials
  // are expected to come from the secret file path. Skip the check in
  // the test env because the storage factory tests exercise the
  // missing-credential path directly.
  if (cfg.STORAGE_PROVIDER === 's3' && cfg.NODE_ENV !== 'test') {
    const missing: string[] = [];
    if (!cfg.S3_BUCKET) missing.push('S3_BUCKET');
    if (!cfg.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID (or S3_ACCESS_KEY_ID_FILE)');
    if (!cfg.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY (or S3_SECRET_ACCESS_KEY_FILE)');
    if (missing.length > 0) {
      throw new Error(
        `STORAGE_PROVIDER=s3 but the following settings are missing: ${missing.join(', ')}. ` +
          'Either provide the values directly, or mount Docker secrets and point ' +
          '<NAME>_FILE at the mount path (typically /run/secrets/<name>).',
      );
    }
  }
}

/**
 * Install the JWT signing secret into the cached config object.
 *
 * The secret is either sourced from the JWT_SECRET environment
 * variable or generated and persisted by bootstrapJwtSecret() on
 * first run. Because modules holding a reference to the cached
 * config share the same object, mutating the property here is
 * visible to every consumer without requiring a reset.
 */
export function setJwtSecret(secret: string): void {
  if (!secret || secret.length < 32) {
    throw new Error('JWT signing secret must be at least 32 characters');
  }
  const cfg = getConfig();
  (cfg as { JWT_SECRET: string }).JWT_SECRET = secret;
}

export default getConfig();
