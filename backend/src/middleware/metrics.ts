/**
 * Express middleware for HTTP request metrics instrumentation.
 *
 * Wraps every request to collect counters and histograms for request
 * rate, latency, and body sizes. The `route` label uses the Express
 * route pattern (e.g., `/api/v1/projects/:id`) to keep cardinality bounded.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpResponseSize,
} from '../metrics/index.js';

/**
 * Normalize a request path to its Express route pattern.
 *
 * Uses req.route.path when available (Express matched routes), otherwise
 * falls back to the base path. Unmatched paths (404s) are grouped under
 * "unmatched" to prevent label cardinality explosion.
 */
function normalizeRoute(req: Request, res: Response): string {
  // If Express matched a route, use the full mounted path + route pattern
  if (req.route?.path) {
    const basePath = req.baseUrl || '';
    return `${basePath}${req.route.path}`;
  }

  // For unmatched routes (404, static files, etc.) group them
  if (res.statusCode === 404) {
    return 'unmatched';
  }

  // Fallback: use the base URL path (for middleware-level routes like /api/health)
  return req.baseUrl || req.path || 'unknown';
}

/**
 * Metrics middleware. Register early in the middleware stack
 * (after CORS/Helmet, before routes).
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  // Track request size
  const reqSize = req.headers['content-length']
    ? parseInt(req.headers['content-length'], 10)
    : 0;

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = normalizeRoute(req, res);
    const method = req.method;
    const statusCode = String(res.statusCode);

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSec);

    if (reqSize > 0) {
      httpRequestSize.observe({ method, route }, reqSize);
    }

    // Track response size
    const resSize = res.getHeader('content-length');
    if (resSize) {
      httpResponseSize.observe({ method, route }, parseInt(String(resSize), 10));
    }
  });

  next();
}
