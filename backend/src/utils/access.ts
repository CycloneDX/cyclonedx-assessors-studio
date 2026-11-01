/**
 * Object-level access rules shared by the route families
 * (security review Z1-Z13).
 *
 * The rule the F4/F02 fix established for evidence, applied everywhere:
 * "read all" never implies "write all". A *.view_all permission lets a
 * user see records; writing a record requires a relationship to it
 * (assigned assessor) or administrator rights (admin.settings).
 */
import type { NextFunction, Response } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { getDatabase } from '../db/connection.js';
import { getPermissionsForRole, type AuthRequest } from '../middleware/auth.js';

type Db = Kysely<Database>;

export async function hasPermission(role: string, key: string): Promise<boolean> {
  return (await getPermissionsForRole(role)).includes(key);
}

async function isAssessmentAssessor(db: Db, userId: string, assessmentId: string): Promise<boolean> {
  const row = await db
    .selectFrom('assessment_assessor')
    .select('assessment_id')
    .where('assessment_id', '=', assessmentId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Boolean(row);
}

export async function isAssessmentParticipant(db: Db, userId: string, assessmentId: string): Promise<boolean> {
  if (await isAssessmentAssessor(db, userId, assessmentId)) return true;
  const row = await db
    .selectFrom('assessment_assessee')
    .select('assessment_id')
    .where('assessment_id', '=', assessmentId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Boolean(row);
}

/** Admin, or an assessor assigned to the assessment. Never view_all alone. */
export async function canWriteAssessment(db: Db, user: { id: string; role: string }, assessmentId: string): Promise<boolean> {
  if (await hasPermission(user.role, 'admin.settings')) return true;
  return isAssessmentAssessor(db, user.id, assessmentId);
}

/** Admin, or any participant (assessor or assessee) on the assessment. */
export async function canParticipateInAssessment(db: Db, user: { id: string; role: string }, assessmentId: string): Promise<boolean> {
  if (await hasPermission(user.role, 'admin.settings')) return true;
  return isAssessmentParticipant(db, user.id, assessmentId);
}

/**
 * Assessment ids the user may read, or null when they may read all
 * (assessments.view_all). Use to scope list and aggregate queries.
 */
export async function readableAssessmentIds(db: Db, user: { id: string; role: string }): Promise<string[] | null> {
  if (await hasPermission(user.role, 'assessments.view_all')) return null;
  const [assessor, assessee] = await Promise.all([
    db.selectFrom('assessment_assessor').select('assessment_id').where('user_id', '=', user.id).execute(),
    db.selectFrom('assessment_assessee').select('assessment_id').where('user_id', '=', user.id).execute(),
  ]);
  return Array.from(new Set([...assessor, ...assessee].map((r) => r.assessment_id)));
}

/** True when `ids` (from readableAssessmentIds) allows `assessmentId`. */
export function allowsAssessment(ids: string[] | null, assessmentId: string | null | undefined): boolean {
  if (ids === null) return true;
  return Boolean(assessmentId) && ids.includes(assessmentId as string);
}

/**
 * Route middleware: the caller must be able to write the assessment named
 * by req.params[param]. Place after requireAuth/requirePermission.
 */
export function requireAssessmentWrite(param = 'id') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const assessmentId = req.params[param] as string;
      if (!(await canWriteAssessment(getDatabase(), req.user, assessmentId))) {
        res.status(403).json({ error: 'Only an assessor assigned to this assessment can change it' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Route middleware: the caller must participate in the assessment (or be admin). */
export function requireAssessmentParticipant(param = 'id') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const assessmentId = req.params[param] as string;
      if (!(await canParticipateInAssessment(getDatabase(), req.user, assessmentId))) {
        res.status(403).json({ error: 'Only participants in this assessment can do this' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Of the given evidence ids, those the user may see, or null when they may
 * see all (evidence.view_all or admin). Without view_all, a user sees only
 * evidence they authored or are assigned to review: participating in an
 * assessment does not expose other people's evidence (security review Z12).
 */
export async function visibleEvidenceIds(db: Db, user: { id: string; role: string }, ids: string[]): Promise<Set<string> | null> {
  const perms = await getPermissionsForRole(user.role);
  if (perms.includes('evidence.view_all') || perms.includes('admin.settings')) return null;
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom('evidence')
    .select('id')
    .where('id', 'in', ids)
    .where((eb) => eb.or([eb('author_id', '=', user.id), eb('reviewer_id', '=', user.id)]))
    .execute();
  return new Set(rows.map((r) => r.id));
}

/** For `where id in (...)`: an empty list cannot be expressed in SQL, so use a uuid that matches nothing. */
export function inList(ids: string[]): string[] {
  return ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
}

/** projects.view_all, or participation in an assessment under the project (the project-list rule). */
async function canReadProject(db: Db, user: { id: string; role: string }, projectId: string): Promise<boolean> {
  if (await hasPermission(user.role, 'projects.view_all')) return true;
  const row = await db
    .selectFrom('assessment')
    .select('id')
    .where('project_id', '=', projectId)
    .where((eb) => eb.or([
      eb('id', 'in', eb.selectFrom('assessment_assessor').select('assessment_id').where('user_id', '=', user.id)),
      eb('id', 'in', eb.selectFrom('assessment_assessee').select('assessment_id').where('user_id', '=', user.id)),
    ]))
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * Route middleware: projects.view plus the project-list scope (security
 * review Z5). Out-of-scope projects answer 404, like missing ones.
 */
export function requireProjectRead(param = 'id') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      if (!(await hasPermission(req.user.role, 'projects.view'))) {
        res.status(403).json({ error: 'Missing required permission: projects.view' });
        return;
      }
      if (!(await canReadProject(getDatabase(), req.user, req.params[param] as string))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Route middleware: the caller may read the assessment named by
 * req.params[param] (view_all or participation); 404 otherwise, like a
 * missing record. For exports and other whole-assessment reads.
 */
export function requireAssessmentRead(param = 'id') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const ids = await readableAssessmentIds(getDatabase(), req.user);
      if (!allowsAssessment(ids, req.params[param] as string)) {
        res.status(404).json({ error: 'Assessment not found' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
