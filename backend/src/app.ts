import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { getConfig } from './config/index.js';
import { getDatabase } from './db/connection.js';
import { logger } from './utils/logger.js';
import { requestIdMiddleware, noStoreCache, rejectCrossSiteMutations } from './middleware/security.js';
import type { AuthRequest } from './middleware/auth.js';
import { requireSetup } from './middleware/setup.js';
import healthRoutes from './routes/health.js';
import { camelCaseResponse } from './middleware/camelCase.js';
import setupRoutes from './routes/setup.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import standardRoutes from './routes/standards.js';
import { checkFeedForUpdates } from './services/standard-feed.js';
import assessmentRoutes from './routes/assessments.js';
import entityRoutes from './routes/entities.js';
import evidenceRoutes from './routes/evidence.js';
import apikeyRoutes from './routes/apikeys.js';
import claimRoutes from './routes/claims.js';
import mitigationRoutes from './routes/mitigations.js';
import attestationRoutes from './routes/attestations.js';
import affirmationRoutes from './routes/affirmations.js';
import meSignatureRoutes from './routes/me-signatures.js';
import userRoutes from './routes/users.js';
import dashboardRoutes from './routes/dashboard.js';
import roleRoutes from './routes/roles.js';
import tagRoutes from './routes/tags.js';
import trashRoutes from './routes/trash.js';
import importRoutes from './routes/import.js';
import exportRoutes from './routes/export.js';
import auditRoutes from './routes/audit.js';
import notificationRoutes from './routes/notifications.js';
import notificationRulesRoutes from './routes/notification-rules.js';
import adminNotificationRulesRoutes from './routes/admin-notification-rules.js';
import assessorRoutes from './routes/assessors.js';
import adminRoutes from './routes/admin.js';
import adminInviteRoutes from './routes/admin-invites.js';
import webhookRoutes from './routes/webhooks.js';
import adminEncryptionRoutes from './routes/admin-encryption.js';
import adminPlatformKeyRoutes from './routes/admin-platform-keys.js';
import chatIntegrationRoutes from './routes/chat-integrations.js';
import metricsRoutes from './routes/metrics.js';
import schedulerRoutes from './routes/scheduler.js';
import { getOpenAPISpec } from './openapi.js';
import { getEventBus } from './events/index.js';
import { metricsMiddleware } from './middleware/metrics.js';

// Helper: Configure security middleware
//
// Content Security Policy notes:
//   scriptSrc / scriptSrcAttr
//     Vite emits every JavaScript bundle as an external, hashed
//     module. The production index.html contains no inline <script>
//     elements and no inline event handlers, so 'unsafe-inline' is
//     not required and is therefore not granted. scriptSrcAttr is
//     pinned to 'none' so injected onclick, onload, and similar
//     attribute XSS payloads are blocked even in modern browsers
//     that respect the granular directive.
//   styleSrc / styleSrcElem / styleSrcAttr
//     The F09 hardening pass migrated every static `style="..."`
//     attribute in the SPA to atomic utility classes under
//     _utilities.scss, so no XSS payload can rely on CSP granting
//     inline style execution. Vue 3's reactive `:style` bindings
//     and Element Plus popper positioning still write to
//     `element.style.*` at runtime, but that path goes through
//     CSSOM property assignment rather than the HTML `style`
//     content attribute, which is not gated by `style-src-attr`
//     in current browsers. Both directives therefore pin to
//     `'self'` only.
//   objectSrc, baseUri, formAction, frameAncestors
//     Added as defense in depth against Flash style plugin
//     injection, <base> hijacking, form hijacking, and
//     clickjacking. frameAncestors 'none' mirrors the X-Frame
//     -Options: DENY header set by frameguard below.
function configureSecurityMiddleware(app: Express): void {
  const config = getConfig();
  app.use(helmet({
    // CSP in every environment: it used to be off unless NODE_ENV was
    // exactly 'production', so a run with NODE_ENV unset had no CSP at all
    // (security review W4). The Vite dev server serves the dev UI with its
    // own headers, so this does not affect development.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        styleSrcElem: ["'self'"],
        styleSrcAttr: ["'none'"],
        fontSrc: ["'self'", 'data:'],
        // No remote images: 'https:' let injected markup beacon anywhere (W10).
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    // includeSubDomains and preload commit every sibling host to HTTPS
    // (preload effectively permanently), so they are operator opt-ins (W10).
    hsts: {
      maxAge: 31536000,
      includeSubDomains: config.HSTS_INCLUDE_SUBDOMAINS,
      preload: config.HSTS_PRELOAD,
    },
    frameguard: {
      action: 'deny',
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
  }));
}

/** Browser origins allowed to make state-changing API calls besides the app's own. */
function allowedBrowserOrigins(): string[] {
  const config = getConfig();
  const origins = [config.CORS_ORIGIN];
  if (config.APP_URL) {
    try {
      origins.push(new URL(config.APP_URL).origin);
    } catch {
      // A malformed APP_URL is reported elsewhere; it simply adds no origin.
    }
  }
  return origins;
}

// Helper: Configure CORS
function configureCORS(app: Express): void {
  const config = getConfig();
  app.use(cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Api-Key'],
  }));
}

// Helper: Configure rate limiters
function configureRateLimiters(app: Express): void {
  const config = getConfig();
  if (config.NODE_ENV === 'test') return;

  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many requests from this IP, please try again later.',
  });

  // Auth limiter: the per-account lockout in routes/auth.ts throttles
  // an attacker who knows a valid username, but it does nothing for an
  // attacker sweeping a username list. This per-IP limiter is that
  // second layer. 10 per 15 minutes is well above a human typo budget
  // and well below a credential-stuffing rate. Counts are per IP, so
  // legitimate users sharing a NAT are effectively bounded but a single
  // misconfigured client cannot use the whole window by itself.
  // The limiter exists to throttle credential-stuffing against
  // POST /auth/login, POST /auth/register, and the password-change
  // endpoints. GET /auth/me and GET /auth/password-policy are
  // idempotent reads that the SPA fires on every navigation (F05
  // re-fetches /me on every route change into an authenticated
  // page, and LoginView fetches the policy on mount), so counting
  // them against the 10 per 15 minute budget kicked authenticated
  // users back to the login screen after ~10 clicks. Skipping GET
  // preserves the credential-stuffing defense that this limiter
  // was built for while leaving the read surface to the general
  // limiter.
  //
  // Per IP this is now a broad cap (60) across every username; the tight
  // per-account budget is loginLimiter below, keyed on IP + username, so
  // one caller can no longer exhaust a shared bucket for everyone behind
  // the same address (security review A2/W1). Both depend on
  // TRUST_PROXY_HOPS matching the real proxy chain.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many authentication attempts, please try again later.',
    skip: (req) => req.method === 'GET',
  });

  // Uploads, imports and exports; plain reads (evidence lists and detail
  // pages) are not heavy and stay under the general limiter.
  const heavyOpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120,
    message: 'Too many resource-intensive requests, please try again later.',
    skip: (req) => req.method === 'GET' && !req.path.includes('/export'),
  });

  const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many setup requests, please try again later.',
  });

  app.use(generalLimiter);
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/v1/import', heavyOpLimiter);
  app.use('/api/v1/export', heavyOpLimiter);
  app.use('/api/v1/evidence', heavyOpLimiter);
  app.use('/api/v1/setup', setupLimiter);
}

/**
 * Rate-limit key for POST /auth/login: client IP plus the attempted
 * username, so a burst of failures against one account (or from one
 * client) cannot spend the budget of everyone sharing that IP.
 */
function loginLimiterKey(req: Request): string {
  const ip = ipKeyGenerator(req.ip ?? '');
  const raw = (req.body as { username?: unknown } | undefined)?.username;
  const username = typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 128) : '';
  return username ? `${ip}|${username}` : ip;
}

// Runs after body parsing so the key can include the username.
function configureLoginLimiter(app: Express): void {
  const config = getConfig();
  if (config.NODE_ENV === 'test') return;
  app.post('/api/v1/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: loginLimiterKey,
    message: 'Too many sign-in attempts, please try again later.',
  }));
}

// Helper: Configure body parsing and cookies
function configureBodyParsing(app: Express): void {
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));
  app.use(cookieParser());
}

// Helper: Configure request-level middleware
function configureRequestMiddleware(app: Express): void {
  const config = getConfig();
  app.use(requestIdMiddleware);

  const metricsConfig = getConfig();
  if (metricsConfig.METRICS_ENABLED) {
    app.use(metricsMiddleware);
  }

  app.use((req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      req.eventBus = getEventBus();
    } catch {
      // Event system may not be initialized yet (e.g., during setup)
    }
    next();
  });

  // Refuse state-changing requests a browser marks as cross-site
  // (security review A10).
  app.use('/api/v1', rejectCrossSiteMutations(allowedBrowserOrigins()));

  // Sprint 6 F12: stamp Cache-Control: no-store on every /api/v1
  // response so shared caches and back button replays cannot leak
  // session scoped JSON across users. Applied before route handlers
  // so specific endpoints can override if they ever need a different
  // policy.
  app.use('/api/v1', noStoreCache);
  app.use('/api/v1', camelCaseResponse);

  if (config.NODE_ENV !== 'test') {
    app.use((req: AuthRequest, res: Response, next: NextFunction) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info('HTTP request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration}ms`,
          requestId: req.requestId,
        });
      });
      next();
    });
  }
}

// Helper: Register API routes
function registerAPIRoutes(app: Express): void {
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1/standards', standardRoutes);
  app.use('/api/v1/assessments', assessmentRoutes);
  app.use('/api/v1/entities', entityRoutes);
  app.use('/api/v1/evidence', evidenceRoutes);
  app.use('/api/v1/apikeys', apikeyRoutes);
  app.use('/api/v1/claims', claimRoutes);
  app.use('/api/v1/mitigations', mitigationRoutes);
  app.use('/api/v1/attestations', attestationRoutes);
  app.use('/api/v1/affirmations', affirmationRoutes);
  app.use('/api/v1/me/signatures', meSignatureRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/roles', roleRoutes);
  app.use('/api/v1/tags', tagRoutes);
  app.use('/api/v1/trash', trashRoutes);
  app.use('/api/v1/import', importRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/notification-rules', notificationRulesRoutes);
  app.use('/api/v1/admin/notification-rules', adminNotificationRulesRoutes);
  app.use('/api/v1/export', exportRoutes);
  app.use('/api/v1/assessors', assessorRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/admin/invites', adminInviteRoutes);
  app.use('/api/v1/webhooks', webhookRoutes);
  app.use('/api/v1/admin/encryption', adminEncryptionRoutes);
  app.use('/api/v1/admin/platform-keys', adminPlatformKeyRoutes);
  app.use('/api/v1/integrations/chat', chatIntegrationRoutes);
  app.use('/api/v1/scheduler', schedulerRoutes);
}

// Helper: Resolve the frontend bundle directory, if one is packaged
// alongside the backend. Returns null when no bundle is present (for
// example during local development when the frontend is served by
// Vite on a separate port).
//
// The production image copies the built Vue 3 bundle to
// /app/frontend/dist. After TypeScript compiles this file to
// dist/app.js, __dirname resolves to /app/backend/dist, so
// ../../frontend/dist points at the bundle.
function resolveFrontendDistPath(): string | null {
  const candidate = path.resolve(__dirname, '../../frontend/dist');
  const indexHtml = path.join(candidate, 'index.html');
  try {
    if (fs.existsSync(indexHtml)) {
      return candidate;
    }
  } catch {
    // fall through
  }
  return null;
}

// Helper: Configure static file serving and 404 handling
//
// When the frontend bundle is packaged with the backend, Express
// serves the SPA shell plus hashed assets at /, and falls back to
// index.html for any non-API GET so that client-side routing works on
// deep links. When no bundle is present (typical in local dev, where
// Vite serves the SPA), only the API 404 handler is installed.
//
// The decision is based on whether index.html exists on disk rather
// than on NODE_ENV, so a misconfigured NODE_ENV can never silently
// disable static serving.
const GENERIC_ERROR_MESSAGES: Record<number, string> = {
  400: 'Malformed request',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  413: 'Payload too large',
  415: 'Unsupported media type',
  429: 'Too many requests',
};

/**
 * SPA fallback: serve index.html for any non-API GET or HEAD that did not
 * match a static asset. HEAD is included so uptime monitors and proxies
 * that probe with HEAD see the page, not a 404. Uses app.use (no path)
 * because Express 5 / path-to-regexp v8 no longer accepts a bare '*'
 * route pattern.
 */
export function spaFallback(frontendDistPath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api/') || req.path === '/metrics') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  };
}

function configureStaticAndErrorRoutes(app: Express): void {
  const frontendDistPath = resolveFrontendDistPath();

  if (frontendDistPath) {
    logger.info('Serving frontend bundle', { path: frontendDistPath });

    app.use(express.static(frontendDistPath, {
      index: false, // index.html is handled explicitly below so we can set cache headers
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          // Hashed Vite assets are safe to cache aggressively
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));

    app.use(spaFallback(frontendDistPath));
  } else {
    logger.info('No frontend bundle found; running API-only');
    app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });
  }
}

// Helper: Configure error handling
function configureErrorHandling(app: Express): void {
  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    // Honor `status` / `statusCode` set by upstream middleware. The
    // built-in body parsers (express.json, express.urlencoded) throw
    // a `PayloadTooLargeError` with `status: 413` when the body
    // exceeds the configured limit. Without surfacing that field the
    // client would see a generic 500 for a perfectly well-defined
    // 413 case and could not distinguish "server bug" from "request
    // too large".
    const e = error as Error & { status?: number; statusCode?: number; type?: string };
    const explicit = typeof e.status === 'number' ? e.status : e.statusCode;
    const status = typeof explicit === 'number' && explicit >= 400 && explicit < 600 ? explicit : 500;

    // A client error (malformed JSON, oversized body) is the caller's
    // problem, not the server's: log it at warn without a stack, so
    // error-level logs and alerts stay meaningful.
    if (status < 500) {
      logger.warn('Request rejected', {
        status,
        reason: e.type ?? error.message,
        method: req.method,
        path: req.path,
      });
    } else {
      logger.error('Unhandled error', {
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        method: req.method,
        path: req.path,
      });
    }

    // A fixed message per status: error.message can carry parser or
    // driver internals (security review I10/W10). Details stay in the log.
    res.status(status).json({ error: GENERIC_ERROR_MESSAGES[status] ?? (status < 500 ? 'Request error' : 'Internal server error') });
  });
}

export function createApp() {
  const app = express();

  // Trust proxy headers from a known number of upstream hops. Defaults
  // to 0 (off). Set TRUST_PROXY_HOPS to the number of reverse proxies
  // that sit in front of Node so Express sees the real client IP and
  // the correct req.protocol when a TLS terminator forwards the
  // request as HTTP. Rate limiting, cookie Secure inference, and
  // audit logging all depend on this value in proxied deployments.
  const config = getConfig();
  if (config.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', config.TRUST_PROXY_HOPS);
  }

  // Configure middleware in order
  configureSecurityMiddleware(app);
  configureCORS(app);
  configureRateLimiters(app);
  configureBodyParsing(app);
  configureLoginLimiter(app);
  configureRequestMiddleware(app);

  // Health check
  app.use('/api/health', healthRoutes);

  // Prometheus metrics endpoint
  app.use('/metrics', metricsRoutes);

  // OpenAPI specification
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(getOpenAPISpec());
  });

  // Setup route
  app.use('/api/v1/setup', setupRoutes);

  // Setup gate
  app.use(requireSetup);

  // Register all API routes
  registerAPIRoutes(app);

  // Configure static files and error routes
  configureStaticAndErrorRoutes(app);

  // Configure error handling
  configureErrorHandling(app);

  // Background: prime the standards feed cache ~5 s after startup so the
  // first user to open the Standards page gets an instant response.
  // Failures are logged but never surfaced to the user at boot time.
  setTimeout(() => {
    checkFeedForUpdates().catch((err) =>
      logger.warn('Background standards feed check failed', { error: (err as Error).message })
    );
  }, 5000);

  // Background: expire evidence whose expires_on date has passed.
  // Runs once at startup then every 24 hours so stale evidence is
  // caught without requiring a server restart.
  const expireEvidence = async () => {
    try {
      const db = getDatabase();
      const result = await db
        .updateTable('evidence')
        .set({ state: 'expired' })
        .where('expires_on', '<', new Date())
        .where('state', '!=', 'expired')
        .executeTakeFirst();
      const count = Number(result.numUpdatedRows ?? 0);
      if (count > 0) logger.info('Evidence expiry job: marked expired', { count });
    } catch (err) {
      logger.warn('Evidence expiry job failed', { error: (err as Error).message });
    }
  };
  setTimeout(() => {
    expireEvidence();
    setInterval(expireEvidence, 24 * 60 * 60 * 1000);
  }, 3000);

  // Soft-delete purge. Rows soft-deleted more than PURGE_RETENTION_DAYS ago are
  // permanently removed from the physical *_raw tables. evidence/claim/
  // mitigation rely on ON DELETE CASCADE foreign keys to clean their children;
  // assessment uses RESTRICT foreign keys (mirroring its old delete handler),
  // so its dependent rows are cleared explicitly before the row is purged.
  const PURGE_RETENTION_DAYS = 30;
  const purgeSoftDeleted = async () => {
    try {
      const db = getDatabase();
      const cutoff = new Date(Date.now() - PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      const staleAssessments = await db
        .selectFrom('assessment_raw')
        .select('id')
        .where('deleted_at', '<', cutoff)
        .execute();
      if (staleAssessments.length > 0) {
        const ids = staleAssessments.map((r) => r.id);
        await db.deleteFrom('work_note').where('assessment_id', 'in', ids).execute();
        await db.deleteFrom('assessment_requirement').where('assessment_id', 'in', ids).execute();
        await db.deleteFrom('assessment_assessor').where('assessment_id', 'in', ids).execute();
        await db.deleteFrom('assessment_assessee').where('assessment_id', 'in', ids).execute();
        await db.deleteFrom('assessment_tag').where('assessment_id', 'in', ids).execute();
        await db.deleteFrom('assessment_raw').where('id', 'in', ids).execute();
        logger.info('Soft-delete purge: assessments removed', { count: ids.length });
      }

      for (const table of ['evidence_raw', 'claim_raw', 'mitigation_raw'] as const) {
        const result = await db
          .deleteFrom(table)
          .where('deleted_at', '<', cutoff)
          .executeTakeFirst();
        const count = Number(result.numDeletedRows ?? 0);
        if (count > 0) logger.info('Soft-delete purge: rows removed', { table, count });
      }
    } catch (err) {
      logger.warn('Soft-delete purge job failed', { error: (err as Error).message });
    }
  };
  setTimeout(() => {
    purgeSoftDeleted();
    setInterval(purgeSoftDeleted, 24 * 60 * 60 * 1000);
  }, 5000);

  return app;
}
