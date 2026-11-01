import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface SecureRequest extends Request {
  requestId?: string;
}

export function requestIdMiddleware(
  req: SecureRequest,
  res: Response,
  next: NextFunction
): void {
  req.requestId = uuidv4();
  res.setHeader('X-Request-ID', req.requestId as string | string[]);
  next();
}

/**
 * Sprint 6 F12: deny intermediary and browser caching for authenticated
 * JSON.
 *
 * Every response under /api/v1 carries data that is either session
 * scoped (the dashboard, a user profile, an inbox of notifications),
 * tenant scoped, or otherwise tied to the requestor's authorization
 * context. None of it is safe for a shared cache to retain or for a
 * back button replay to expose to a different user on the same
 * device. We therefore stamp `Cache-Control: no-store` on every API
 * response by default. Pragma: no-cache is included for the small
 * population of HTTP/1.0 intermediaries still in the wild that ignore
 * Cache-Control entirely.
 *
 * Static frontend assets are served by the SPA branch in app.ts and
 * keep their long lived `public, max-age=31536000, immutable` policy.
 * The HTML shell already sets `no-store, no-cache, must-revalidate`
 * in the same place. This middleware applies only to the API surface
 * and runs before routes so any specific endpoint that needs a
 * different policy (none today) can override the header from its own
 * handler.
 */
export function noStoreCache(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}


/**
 * Cross-site request guard for state-changing API calls (security review
 * A10). Session cookies are SameSite=Strict, but "same-site" still
 * includes sibling subdomains, so a script on another subdomain could post
 * with the user's cookie. Browsers label every request: when
 * Sec-Fetch-Site or Origin says the request came from somewhere other
 * than this app, refuse it. Clients that send neither header (API-key
 * scripts, curl) are not browsers and cannot carry a victim's cookie, so
 * they pass.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True when the browser says this request came from another site. */
function isCrossSiteRequest(req: Request, allowed: Set<string>): boolean {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return true;
  const origin = req.get('origin');
  if (origin === undefined || origin === '') return false;
  if (origin === 'null') return true;
  return origin !== `${req.protocol}://${req.get('host')}` && !allowed.has(origin);
}

export function rejectCrossSiteMutations(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.filter((o) => o && o !== '*'));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!SAFE_METHODS.has(req.method) && isCrossSiteRequest(req, allowed)) {
      res.status(403).json({ error: 'Cross-site request refused' });
      return;
    }
    next();
  };
}
