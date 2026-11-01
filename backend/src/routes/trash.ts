import { Router } from 'express';
import type { Response } from 'express';
import { getDatabase } from '../db/connection.js';
import { asyncHandler } from '../utils/route-helpers.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();

// Soft-deleted rows live in the *_raw physical tables (the public name is a
// filtered view that hides them). This endpoint reads those raw tables so the
// Trash UI can list what is recoverable. Restore itself goes through each
// resource's own POST /:id/restore route, which enforces that resource's
// permission.
// Trash is an administrative surface: it enumerates soft-deleted records across
// the platform. Restricted to callers who can act on those records (any of
// assessments.manage / evidence.delete / claims.edit), which admits assessor and
// admin but excludes assessee and standards_manager.
router.get(
  '/',
  requireAuth,
  requirePermission('assessments.manage', 'evidence.delete', 'claims.edit'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const [assessments, evidence, claims, mitigations] = await Promise.all([
      db.selectFrom('assessment_raw').select(['id', 'title as label', 'deleted_at']).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
      db.selectFrom('evidence_raw').select(['id', 'name as label', 'deleted_at']).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
      db.selectFrom('claim_raw').select(['id', 'name as label', 'deleted_at']).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
      db.selectFrom('mitigation_raw').select(['id', 'title as label', 'deleted_at']).where('deleted_at', 'is not', null).orderBy('deleted_at', 'desc').execute(),
    ]);

    const tag = (resource: string) => (row: { id: string; label: string | null; deleted_at: unknown }) => ({
      resource,
      id: row.id,
      label: row.label,
      deletedAt: row.deleted_at,
    });

    const data = [
      ...assessments.map(tag('assessment')),
      ...evidence.map(tag('evidence')),
      ...claims.map(tag('claim')),
      ...mitigations.map(tag('mitigation')),
    ].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));

    res.json({ data });
  })
);

export default router;
