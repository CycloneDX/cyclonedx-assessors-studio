import { Router } from 'express';
import { queryString } from '../utils/query.js';
import type { Response } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';
import { getDatabase } from '../db/connection.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { readableAssessmentIds, inList, canWriteAssessment, hasPermission } from '../utils/access.js';

const router = Router();

const ScheduledAssessmentSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  assessorId: z.string().uuid().optional().nullable(),
  standardId: z.string().uuid().optional().nullable(),
  assessmentId: z.string().uuid().optional().nullable(),
  scheduledDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'quarterly', 'yearly']).default('none'),
  status: z.enum(['scheduled', 'in_progress', 'on_hold', 'complete', 'failed', 'warning']).default('scheduled'),
  notes: z.string().optional().nullable(),
});

/** Creator, assigned assessor, or admin (security review Z7). */
async function canChangeSchedule(
  req: AuthRequest,
  row: { created_by?: string | null; assessor_id?: string | null },
): Promise<boolean> {
  const me = req.user!.id;
  if (row.created_by === me || row.assessor_id === me) return true;
  return hasPermission(req.user!.role, 'admin.settings');
}

router.get('/', requireAuth, requirePermission('assessments.view'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const projectId = queryString(req.query.projectId);
  const assessorId = queryString(req.query.assessorId);

  let query = db
    .selectFrom('scheduled_assessment as sa')
    .leftJoin('project as p', 'p.id', 'sa.project_id')
    .leftJoin('app_user as u', 'u.id', 'sa.assessor_id')
    .leftJoin('standard as s', 's.id', 'sa.standard_id')
    .select([
      'sa.id',
      'sa.title',
      'sa.description',
      'sa.project_id',
      'p.name as project_name',
      'sa.assessor_id',
      'u.display_name as assessor_name',
      'sa.standard_id',
      's.name as standard_name',
      'sa.assessment_id',
      'sa.scheduled_date',
      'sa.due_date',
      'sa.recurrence',
      'sa.status',
      'sa.notes',
      'sa.created_by',
      'sa.created_at',
      'sa.updated_at',
    ])
    .where(sql<boolean>`EXTRACT(YEAR FROM sa.scheduled_date) = ${year}`);

  if (projectId) {
    query = query.where('sa.project_id', '=', projectId);
  }
  if (assessorId) {
    query = query.where('sa.assessor_id', '=', assessorId);
  }

  // Without assessments.view_all: only schedules the caller created, is
  // assigned to, or whose assessment they can read (security review Z7).
  const readable = await readableAssessmentIds(db, req.user!);
  if (readable !== null) {
    const me = req.user!.id;
    query = query.where((eb) => eb.or([
      eb('sa.created_by', '=', me),
      eb('sa.assessor_id', '=', me),
      eb('sa.assessment_id', 'in', inList(readable)),
    ]));
  }

  const items = await query.orderBy('sa.scheduled_date', 'asc').execute();
  res.json(items);
}));

router.post('/', requireAuth, requirePermission('assessments.manage'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const result = ScheduledAssessmentSchema.safeParse(req.body);
  if (!result.success) {
    handleValidationError(res, result.error);
    return;
  }

  const db = getDatabase();
  const data = result.data;

  if (data.assessmentId && !(await canWriteAssessment(db, req.user!, data.assessmentId))) {
    res.status(403).json({ error: 'Only an assessor assigned to that assessment can schedule it' });
    return;
  }

  const [row] = await db
    .insertInto('scheduled_assessment')
    .values({
      title: data.title,
      description: data.description ?? null,
      project_id: data.projectId ?? null,
      assessor_id: data.assessorId ?? null,
      standard_id: data.standardId ?? null,
      assessment_id: data.assessmentId ?? null,
      scheduled_date: new Date(data.scheduledDate),
      due_date: data.dueDate ? new Date(data.dueDate) : null,
      recurrence: data.recurrence,
      status: data.status,
      notes: data.notes ?? null,
      created_by: req.user!.id,
    })
    .returningAll()
    .execute();

  res.status(201).json(row);
}));

router.put('/:id', requireAuth, requirePermission('assessments.manage'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const result = ScheduledAssessmentSchema.partial().safeParse(req.body);
  if (!result.success) {
    handleValidationError(res, result.error);
    return;
  }

  const db = getDatabase();
  const data = result.data;

  const existing = await db
    .selectFrom('scheduled_assessment')
    .selectAll()
    .where('id', '=', req.params.id)
    .executeTakeFirst();

  if (!existing) {
    res.status(404).json({ error: 'Scheduled assessment not found' });
    return;
  }
  if (!(await canChangeSchedule(req, existing))) {
    res.status(403).json({ error: 'Only the creator, the assigned assessor or an administrator can change this schedule' });
    return;
  }
  if (data.assessmentId && !(await canWriteAssessment(db, req.user!, data.assessmentId))) {
    res.status(403).json({ error: 'Only an assessor assigned to that assessment can schedule it' });
    return;
  }

  const updateValues: Record<string, unknown> = { updated_at: new Date() };
  if (data.title !== undefined) updateValues.title = data.title;
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.projectId !== undefined) updateValues.project_id = data.projectId;
  if (data.assessorId !== undefined) updateValues.assessor_id = data.assessorId;
  if (data.standardId !== undefined) updateValues.standard_id = data.standardId;
  if (data.assessmentId !== undefined) updateValues.assessment_id = data.assessmentId;
  if (data.scheduledDate !== undefined) updateValues.scheduled_date = new Date(data.scheduledDate);
  if (data.dueDate !== undefined) updateValues.due_date = data.dueDate ? new Date(data.dueDate) : null;
  if (data.recurrence !== undefined) updateValues.recurrence = data.recurrence;
  if (data.status !== undefined) updateValues.status = data.status;
  if (data.notes !== undefined) updateValues.notes = data.notes;

  const [updated] = await db
    .updateTable('scheduled_assessment')
    .set(updateValues)
    .where('id', '=', req.params.id)
    .returningAll()
    .execute();

  res.json(updated);
}));

router.delete('/:id', requireAuth, requirePermission('assessments.manage'), asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const existing = await db
    .selectFrom('scheduled_assessment')
    .select(['id', 'created_by', 'assessor_id'])
    .where('id', '=', req.params.id)
    .executeTakeFirst();

  if (!existing) {
    res.status(404).json({ error: 'Scheduled assessment not found' });
    return;
  }
  if (!(await canChangeSchedule(req, existing))) {
    res.status(403).json({ error: 'Only the creator, the assigned assessor or an administrator can delete this schedule' });
    return;
  }

  await db.deleteFrom('scheduled_assessment').where('id', '=', req.params.id).execute();
  res.status(204).send();
}));

export default router;
