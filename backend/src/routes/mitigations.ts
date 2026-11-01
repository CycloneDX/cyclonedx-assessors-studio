import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { visibleEvidenceIds } from '../utils/access.js';
import { authorizeClaimWrite } from './claims.js';
import { logAudit } from '../utils/audit.js';

const router = Router();

const MitigationSchema = z.object({
  title: z.string().min(1).max(255),
  type: z.enum(['Technical', 'Process', 'Policy', 'Training', 'Physical']),
  category: z.enum(['Preventive', 'Detective', 'Corrective', 'Compensating']).optional().nullable(),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']),
  status: z.enum(['Proposed', 'In Progress', 'Implemented', 'Verified', 'Closed']).optional().default('Proposed'),
  effectiveness: z.enum(['Effective', 'Partially Effective', 'Not Effective', 'Unknown']).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  owner: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  team: z.string().max(255).optional().nullable(),
  reviewer: z.string().max(255).optional().nullable(),
  linked_assessment: z.string().max(100).optional().nullable(),
  target_date: z.string().optional().nullable(),
  completion_date: z.string().optional().nullable(),
  verified_by: z.string().max(255).optional().nullable(),
  effectiveness_rationale: z.string().optional().nullable(),
});

// GET /api/v1/mitigations
router.get('/', requireAuth, requirePermission('claims.view'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const rows = await db
    .selectFrom('mitigation')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
  res.json({ data: rows, total: rows.length });
}));

// GET /api/v1/mitigations/:id
router.get('/:id', requireAuth, requirePermission('claims.view'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = req.params.id as string;

  const row = await db
    .selectFrom('mitigation')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!row) {
    res.status(404).json({ error: 'Mitigation not found' });
    return;
  }

  const linkedClaims = await db
    .selectFrom('mitigation_claim')
    .innerJoin('claim', 'claim.id', 'mitigation_claim.claim_id')
    .select(['claim.id', 'claim.name'])
    .where('mitigation_claim.mitigation_id', '=', id)
    .execute();

  const allLinkedEvidence = await db
    .selectFrom('mitigation_evidence')
    .innerJoin('evidence', 'evidence.id', 'mitigation_evidence.evidence_id')
    .select(['evidence.id', 'evidence.name', 'evidence.state'])
    .where('mitigation_evidence.mitigation_id', '=', id)
    .execute();
  // Only evidence the caller could open directly (security review Z1).
  const visible = await visibleEvidenceIds(db, req.user!, allLinkedEvidence.map((e) => e.id));
  const linkedEvidence = allLinkedEvidence.filter((e) => visible === null || visible.has(e.id));

  res.json({ ...row, linkedClaims, linkedEvidence });
}));

// POST /api/v1/mitigations
router.post('/', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const data = MitigationSchema.parse(req.body);
    const db = getDatabase();
    const id = uuidv4();
    const now = new Date();

    // biome-ignore lint/suspicious/noExplicitAny: Kysely insert type
    await db.insertInto('mitigation').values({ id, ...data, created_by: req.user?.id ?? null, created_at: now, updated_at: now } as any).execute();

    const row = await db.selectFrom('mitigation').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await logAudit(db, { entityType: 'mitigation', entityId: id, action: 'create', userId: req.user?.id ?? null, changes: { title: data.title } });
    logger.info('Mitigation created', { id, userId: req.user?.id });
    res.status(201).json(row);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

// PUT /api/v1/mitigations/:id
router.put('/:id', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const data = MitigationSchema.partial().parse(req.body);
    const db = getDatabase();

    const existing = await db.selectFrom('mitigation').select('id').where('id', '=', id).executeTakeFirst();
    if (!existing) {
      res.status(404).json({ error: 'Mitigation not found' });
      return;
    }

    const before = await db.selectFrom('mitigation').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    await db.updateTable('mitigation').set({ ...data, updated_at: new Date() }).where('id', '=', id).execute();
    const row = await db.selectFrom('mitigation').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

    const changedFields: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      const bVal = (before as Record<string, unknown>)[key as string];
      const aVal = (data as Record<string, unknown>)[key as string];
      if (String(bVal ?? '') !== String(aVal ?? '')) changedFields[key as string] = { from: bVal ?? null, to: aVal ?? null };
    }
    if (data.status && before.status !== data.status) {
      await logAudit(db, { entityType: 'mitigation', entityId: id, action: 'state_change', userId: req.user?.id ?? null, changes: { from: before.status, to: data.status } });
    } else {
      await logAudit(db, { entityType: 'mitigation', entityId: id, action: 'update', userId: req.user?.id ?? null, changes: changedFields });
    }
    logger.info('Mitigation updated', { id, userId: req.user?.id });
    res.json(row);
  } catch (error) {
    if (handleValidationError(res, error)) return;
    throw error;
  }
}));

// DELETE /api/v1/mitigations/:id
router.delete('/:id', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const db = getDatabase();
  const existing = await db.selectFrom('mitigation').select('id').where('id', '=', id).executeTakeFirst();
  if (!existing) {
    res.status(404).json({ error: 'Mitigation not found' });
    return;
  }
  const toDelete = await db.selectFrom('mitigation').select(['title']).where('id', '=', id).executeTakeFirst();
  // Soft delete: `mitigation` is a view hiding deleted rows; the physical row
  // stays in mitigation_raw for restore. Purge removes it permanently.
  await db.updateTable('mitigation').set({ deleted_at: new Date() }).where('id', '=', id).execute();
  await logAudit(db, { entityType: 'mitigation', entityId: id, action: 'delete', userId: req.user?.id ?? null, changes: { title: toDelete?.title ?? null } });
  logger.info('Mitigation deleted', { id, userId: req.user?.id });
  res.status(204).send();
}));

// Restore a soft-deleted mitigation. Targets mitigation_raw because the
// mitigation view hides deleted rows.
router.post('/:id/restore', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = req.params.id as string;
  const row = await db.selectFrom('mitigation_raw').select(['id', 'deleted_at']).where('id', '=', id).executeTakeFirst();
  if (!row) {
    res.status(404).json({ error: 'Mitigation not found' });
    return;
  }
  if (!row.deleted_at) {
    res.status(409).json({ error: 'Mitigation is not deleted' });
    return;
  }
  await db.updateTable('mitigation_raw').set({ deleted_at: null }).where('id', '=', id).execute();
  await logAudit(db, { entityType: 'mitigation', entityId: id, action: 'update', userId: req.user?.id ?? null, changes: { restored: true } });
  logger.info('Mitigation restored', { id, userId: req.user?.id });
  res.json({ message: 'Mitigation restored' });
}));

// POST /api/v1/mitigations/:id/claims/:claimId
router.post('/:id/claims/:claimId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const mitigationId = req.params.id as string;
  const claimId = req.params.claimId as string;
  // Same gate as linking from the claim side: signed claims are frozen and
  // only participants in the claim's assessment may change it (Z1/Z2).
  if (!(await authorizeClaimWrite(db, req, res, claimId))) return;
  await db.insertInto('mitigation_claim').values({ mitigation_id: mitigationId, claim_id: claimId, created_at: new Date() }).onConflict(oc => oc.doNothing()).execute();
  const claim = await db.selectFrom('claim').select('name').where('id', '=', claimId).executeTakeFirst();
  await logAudit(db, { entityType: 'mitigation', entityId: mitigationId, action: 'link', userId: req.user?.id ?? null, changes: { linked: 'claim', claimId, claimName: claim?.name ?? null } });
  res.status(204).send();
}));

// DELETE /api/v1/mitigations/:id/claims/:claimId
router.delete('/:id/claims/:claimId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const mitigationId = req.params.id as string;
  const claimId = req.params.claimId as string;
  // Same gate as linking from the claim side: signed claims are frozen and
  // only participants in the claim's assessment may change it (Z1/Z2).
  if (!(await authorizeClaimWrite(db, req, res, claimId))) return;
  const claim = await db.selectFrom('claim').select('name').where('id', '=', claimId).executeTakeFirst();
  await db.deleteFrom('mitigation_claim').where('mitigation_id', '=', mitigationId).where('claim_id', '=', claimId).execute();
  await logAudit(db, { entityType: 'mitigation', entityId: mitigationId, action: 'unlink', userId: req.user?.id ?? null, changes: { unlinked: 'claim', claimId, claimName: claim?.name ?? null } });
  res.status(204).send();
}));

// POST /api/v1/mitigations/:id/evidence/:evidenceId
router.post('/:id/evidence/:evidenceId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const mitigationId = req.params.id as string;
  const evidenceId = req.params.evidenceId as string;
  const mitigationExists = await db.selectFrom('mitigation').select('id').where('id', '=', mitigationId).executeTakeFirst();
  const evidenceExists = await db.selectFrom('evidence').select('id').where('id', '=', evidenceId).executeTakeFirst();
  const visible = await visibleEvidenceIds(db, req.user!, [evidenceId]);
  if (!mitigationExists || !evidenceExists || (visible !== null && !visible.has(evidenceId))) {
    res.status(404).json({ error: 'Mitigation or evidence not found' });
    return;
  }
  await db.insertInto('mitigation_evidence').values({ mitigation_id: mitigationId, evidence_id: evidenceId, created_at: new Date() }).onConflict(oc => oc.doNothing()).execute();
  const ev = await db.selectFrom('evidence').select('name').where('id', '=', evidenceId).executeTakeFirst();
  await logAudit(db, { entityType: 'mitigation', entityId: mitigationId, action: 'link', userId: req.user?.id ?? null, changes: { linked: 'evidence', evidenceId, evidenceName: ev?.name ?? null } });
  res.status(204).send();
}));

// DELETE /api/v1/mitigations/:id/evidence/:evidenceId
router.delete('/:id/evidence/:evidenceId', requireAuth, requirePermission('claims.edit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const mitigationId = req.params.id as string;
  const evidenceId = req.params.evidenceId as string;
  const ev = await db.selectFrom('evidence').select('name').where('id', '=', evidenceId).executeTakeFirst();
  await db.deleteFrom('mitigation_evidence').where('mitigation_id', '=', mitigationId).where('evidence_id', '=', evidenceId).execute();
  await logAudit(db, { entityType: 'mitigation', entityId: mitigationId, action: 'unlink', userId: req.user?.id ?? null, changes: { unlinked: 'evidence', evidenceId, evidenceName: ev?.name ?? null } });
  res.status(204).send();
}));

// GET /api/v1/mitigations/:id/audit
router.get('/:id/audit', requireAuth, requirePermission('admin.audit'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const db = getDatabase();
  const id = req.params.id as string;
  const rows = await db
    .selectFrom('audit_log')
    .selectAll()
    .where('entity_type', '=', 'mitigation')
    .where('entity_id', '=', id)
    .orderBy('created_at', 'desc')
    .execute();

  const userIds = Array.from(new Set(rows.map(r => r.user_id).filter((u): u is string => u !== null)));
  const userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const users = await db.selectFrom('app_user').select(['id', 'display_name']).where('id', 'in', userIds).execute();
    for (const u of users) userMap.set(u.id, u.display_name);
  }

  const enriched = rows.map(r => ({
    ...r,
    user_display_name: r.user_id ? (userMap.get(r.user_id) ?? r.user_id) : 'System',
  }));
  res.json({ data: enriched });
}));

export default router;
