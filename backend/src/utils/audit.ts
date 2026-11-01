import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/connection.js';

export async function logAudit(
  db: Kysely<Database>,
  params: {
    entityType: string;
    entityId: string;
    action: 'create' | 'create_for_other' | 'update' | 'delete' | 'state_change' | 'link' | 'unlink' | 'authz_denied' | 'config_change';
    // Nullable so system-originated events (startup config drift,
    // background job actions) can be recorded without inventing a
    // synthetic service account. Application code running inside a
    // request handler should always pass the authenticated user's id.
    userId: string | null;
    changes?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await db
      .insertInto('audit_log')
      .values({
        id: uuidv4(),
        entity_type: params.entityType,
        entity_id: params.entityId,
        action: params.action,
        user_id: params.userId,
        changes: params.changes || null,
      })
      .execute();
  } catch (error) {
    console.error('Failed to log audit entry', error);
  }
}

/** entity_id for singleton resources (platform key, master key) with no row id. */
const SINGLETON_ENTITY_ID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Router middleware: records an audit row for every successful
 * state-changing request on the router it is mounted on (security review
 * X8). Logs who, which entity, the action and the route; never the
 * request body, which can carry secrets (webhook secrets, chat URLs,
 * keys).
 */
function auditEntityId(paramId: string | undefined, responseId: unknown): string {
  const candidate = typeof paramId === 'string' ? paramId : responseId;
  return typeof candidate === 'string' && UUID_RE.test(candidate) ? candidate : SINGLETON_ENTITY_ID;
}

function auditAction(method: string, paramId: string | undefined, routePath: string): 'delete' | 'create' | 'config_change' {
  if (method === 'DELETE') return 'delete';
  if (method === 'POST' && !paramId && routePath === '/') return 'create';
  return 'config_change';
}

export function auditMutations(entityType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    let responseId: unknown;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const b = body as { id?: unknown; data?: { id?: unknown } } | null;
      responseId = b?.id ?? b?.data?.id;
      return json(body);
    };
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const paramId = (req.params as { id?: string } | undefined)?.id;
      const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
      void logAudit(getDatabase(), {
        entityType,
        entityId: auditEntityId(paramId, responseId),
        action: auditAction(req.method, paramId, routePath),
        userId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
        changes: { method: req.method, route: `${req.baseUrl}${routePath}` },
      });
    });
    next();
  };
}
