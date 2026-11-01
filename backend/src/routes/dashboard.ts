import { Router } from 'express';
import { queryString } from '../utils/query.js';
import type { Response } from 'express';
import { getDatabase } from '../db/connection.js';
import type { AuditLog } from '../db/types.js';
import { enrichWithNames } from './audit.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { AuthRequest, requireAuth } from '../middleware/auth.js';
import { countWhere } from '../utils/count-queries.js';
import { calculateAssessmentScore } from '../utils/assessment-scoring.js';
import { hasPermission, inList, readableAssessmentIds } from '../utils/access.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

const router = Router();

// =============================================================================
// Aggregate scope (security review Z6)
// =============================================================================
//
// Callers holding assessments.view_all (admin, assessor) get org-wide
// aggregates, exactly as before. Everyone else gets aggregates computed
// only over data reachable from the assessments they participate in:
//   assessments          id in their readable ids
//   projects             projects with at least one readable assessment
//   evidence             evidence they authored or are assigned to review
//   attestations         attestation.assessment_id in readable ids
//   claims               claims on an in-scope attestation
//   mitigations          mitigations linked to an in-scope claim
//   assessment results   assessment_requirement.assessment_id in readable ids
// The standards / requirements catalog stays global (public catalog).

/** null = org-wide; otherwise the caller's id and readable assessment ids (never empty: see inList). */
type Scope = { userId: string; ids: string[] } | null;

// biome-ignore lint/suspicious/noExplicitAny: predicates are applied to several query shapes, like count-queries.ts
type Pred = (eb: any) => any;

async function dashboardScope(db: Kysely<Database>, user: { id: string; role: string }): Promise<Scope> {
  const ids = await readableAssessmentIds(db, user);
  return ids === null ? null : { userId: user.id, ids: inList(ids) };
}

/**
 * Scope predicates: each returns null when the caller is org-wide, else a
 * `where` callback restricting `col` (a column holding that kind of id).
 */
const inScope = {
  assessment: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', s.ids)),
  project: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', eb.selectFrom('assessment').select('assessment.project_id').where('assessment.id', 'in', s.ids))),
  evidence: (s: Scope, table = 'evidence'): Pred | null =>
    s && ((eb) => eb.or([eb(`${table}.author_id`, '=', s.userId), eb(`${table}.reviewer_id`, '=', s.userId)])),
  attestation: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', scopedAttestationIds(eb, s.ids))),
  attestationRequirement: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', eb.selectFrom('attestation_requirement').select('attestation_requirement.id')
      .where('attestation_requirement.attestation_id', 'in', scopedAttestationIds(eb, s.ids)))),
  claim: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', scopedClaimIds(eb, s.ids))),
  mitigation: (s: Scope, col: string): Pred | null =>
    s && ((eb) => eb(col, 'in', eb.selectFrom('mitigation_claim').select('mitigation_claim.mitigation_id')
      .where('mitigation_claim.claim_id', 'in', scopedClaimIds(eb, s.ids)))),
};

// biome-ignore lint/suspicious/noExplicitAny: see Pred
function scopedAttestationIds(eb: any, ids: string[]) {
  return eb.selectFrom('attestation').select('attestation.id').where('attestation.assessment_id', 'in', ids);
}

// biome-ignore lint/suspicious/noExplicitAny: see Pred
function scopedClaimIds(eb: any, ids: string[]) {
  return eb.selectFrom('claim').select('claim.id').where('claim.attestation_id', 'in', scopedAttestationIds(eb, ids));
}

/** Apply a scope predicate to a query builder (no-op when org-wide). Use with `.$call`. */
// biome-ignore lint/suspicious/noExplicitAny: generic over Kysely query builders
function scoped<QB extends { where: (...args: any[]) => any }>(qb: QB, pred: Pred | null): QB {
  return pred ? (qb.where(pred) as QB) : qb;
}

/** count(id) over `table`, restricted by an optional scope predicate and an optional condition. */
function countScoped(db: Kysely<Database>, table: keyof Database, scope: Pred | null, cond?: Pred): Promise<number> {
  const preds = [scope, cond].filter((p): p is Pred => Boolean(p));
  return countWhere(db, table, preds.length ? (eb) => eb.and(preds.map((p) => p(eb))) : undefined);
}

const notExpiredWithinDays = (days: number): Pred => (eb) => eb.and([
  eb('expires_on', '>', new Date()),
  eb('expires_on', '<', new Date(Date.now() + days * 24 * 60 * 60 * 1000)),
  eb('state', '!=', 'expired'),
]);

/**
 * Approved (claimed) evidence that no claim cites as supporting, counter
 * or mitigation evidence. Drafts are left out: they are uncited by nature.
 */
const CLAIM_EVIDENCE_LINKS = ['claim_evidence', 'claim_counter_evidence', 'claim_mitigation_strategy'] as const;
const approvedButUncited: Pred = (eb) => eb.and([
  eb('evidence.state', '=', 'claimed'),
  ...CLAIM_EVIDENCE_LINKS.map((link) => eb.not(eb.exists(
    eb.selectFrom(link)
      .innerJoin('claim', 'claim.id', `${link}.claim_id`)
      .select(`${link}.claim_id`)
      .whereRef(`${link}.evidence_id`, '=', 'evidence.id'),
  ))),
]);

const overdueAssessment: Pred = (eb) => eb.and([
  eb('due_date', '<', new Date()),
  eb('state', '!=', 'complete'),
  eb('state', '!=', 'cancelled'),
]);

// Scoped stats: projects/assessments/evidence/claims/attestations narrow to
// the caller's scope; the standards count is the public catalog (Z6).
router.get('/stats', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);
  const projectScope = inScope.project(scope, 'id');
  const assessmentScope = inScope.assessment(scope, 'id');
  const evidenceScope = inScope.evidence(scope);

  const [
    totalProjects,
    projectsInProgress,
    totalAssessments,
    assessmentsInProgress,
    assessmentsComplete,
    totalEvidence,
    totalClaims,
    totalAttestations,
    totalStandards,
    evidenceExpiringSoon,
    assessmentsOverdue,
    evidenceUncited,
  ] = await Promise.all([
    countScoped(db, 'project', projectScope),
    countScoped(db, 'project', projectScope, (eb) => eb('state', '=', 'in_progress')),
    countScoped(db, 'assessment', assessmentScope),
    countScoped(db, 'assessment', assessmentScope, (eb) => eb('state', '=', 'in_progress')),
    countScoped(db, 'assessment', assessmentScope, (eb) => eb('state', '=', 'complete')),
    countScoped(db, 'evidence', evidenceScope),
    countScoped(db, 'claim', inScope.claim(scope, 'id')),
    countScoped(db, 'attestation', inScope.attestation(scope, 'id')),
    countScoped(db, 'standard', null),
    countScoped(db, 'evidence', evidenceScope, notExpiredWithinDays(30)),
    countScoped(db, 'assessment', assessmentScope, overdueAssessment),
    countScoped(db, 'evidence', evidenceScope, approvedButUncited),
  ]);

  const completionRate = totalAssessments > 0
    ? Math.round((assessmentsComplete / totalAssessments) * 100)
    : 0;

  res.json({
    totalProjects,
    projectsInProgress,
    totalAssessments,
    assessmentsInProgress,
    assessmentsComplete,
    totalEvidence,
    totalClaims,
    totalAttestations,
    totalStandards,
    evidenceExpiringSoon,
    assessmentsOverdue,
    evidenceUncited,
    completionRate,
  });
}));

// Assessment lists (recent, due dates): only readable assessments (Z6).
router.get('/recent-assessments', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);

  const recentAssessments = await db
    .selectFrom('assessment')
    .innerJoin('project', 'project.id', 'assessment.project_id')
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.state',
      'assessment.due_date',
      'assessment.created_at',
      'project.name as project_name',
    ])
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .orderBy('assessment.created_at', 'desc')
    .limit(5)
    .execute();

  res.json({
    data: recentAssessments,
  });
}));

router.get('/upcoming-due-dates', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);
  const now = new Date();
  // Compare on calendar-day boundaries so "due today" reads as 0 days
  // (not overdue) regardless of the current wall-clock time.
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // Deadline feed: every open assessment that carries a due date,
  // whether it is already overdue or still ahead. Overdue work is the
  // most urgent deadline signal, so it must be included here — the
  // previous `due_date > now` filter hid it entirely. Ordered soonest
  // (most overdue) first so callers can bucket by urgency.
  const assessmentsWithDueDates = await db
    .selectFrom('assessment')
    .innerJoin('project', 'project.id', 'assessment.project_id')
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.due_date',
      'assessment.state',
      'project.name as project_name',
    ])
    .where('assessment.due_date', 'is not', null)
    .where('assessment.state', 'not in', ['complete', 'cancelled', 'archived'])
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .orderBy('assessment.due_date', 'asc')
    .limit(20)
    .execute();

  res.json({
    data: assessmentsWithDueDates.map(a => {
      const dueDate = new Date(String(a.due_date));
      const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
      const daysUntilDue = Math.round((dueDay - startOfToday) / (1000 * 60 * 60 * 24));
      return {
        ...a,
        days_until_due: daysUntilDue,
        overdue: daysUntilDue < 0,
      };
    }),
  });
}));

// Compliance coverage: per-standard breakdown of how many requirements are assessed.
// Requirement totals are the public catalog; assessed counts use only
// in-scope assessment results (Z6).
router.get('/compliance-coverage', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);

  const standards = await db
    .selectFrom('standard')
    .selectAll()
    .execute();

  const coverage = await Promise.all(
    standards.map(async (standard) => {
      const totalReqs = await db
        .selectFrom('requirement')
        .where('standard_id', '=', standard.id)
        .select(db.fn.count<number>('id').as('count'))
        .executeTakeFirstOrThrow()
        .then(r => Number(r.count));

      // Requirements that have at least one assessment_requirement with a result
      const assessedReqs = await db
        .selectFrom('assessment_requirement')
        .innerJoin('requirement', 'requirement.id', 'assessment_requirement.requirement_id')
        .where('requirement.standard_id', '=', standard.id)
        .where('assessment_requirement.result', 'is not', null)
        .$call((q) => scoped(q, inScope.assessment(scope, 'assessment_requirement.assessment_id')))
        .select(db.fn.count<number>('assessment_requirement.id').as('count'))
        .executeTakeFirstOrThrow()
        .then(r => Number(r.count));

      const coveragePercent = totalReqs > 0 ? Math.round((assessedReqs / totalReqs) * 100) : 0;

      return {
        standardId: standard.id,
        standardName: standard.name,
        version: standard.version,
        totalRequirements: totalReqs,
        assessedRequirements: assessedReqs,
        coveragePercent,
      };
    })
  );

  res.json({ data: coverage });
}));

// Assessment state distribution over readable assessments (Z6).
router.get('/assessment-distribution', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const assessmentScope = inScope.assessment(await dashboardScope(db, req.user!), 'id');

  const states = ['new', 'pending', 'in_progress', 'on_hold', 'cancelled', 'complete', 'archived'] as const;
  const distribution = await Promise.all(
    states.map(async (state) => ({
      state,
      count: await countScoped(db, 'assessment', assessmentScope, (eb) => eb('state', '=', state)),
    }))
  );

  res.json({ data: distribution });
}));

// Evidence health: breakdown by state, over evidence the caller authored
// or reviews unless org-wide (Z6).
router.get('/evidence-health', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const evidenceScope = inScope.evidence(await dashboardScope(db, req.user!));

  const states = ['in_review', 'in_progress', 'claimed', 'expired'] as const;
  const health = await Promise.all(
    states.map(async (state) => ({
      state,
      count: await countScoped(db, 'evidence', evidenceScope, (eb) => eb('state', '=', state)),
    }))
  );

  const now = new Date();
  const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = await db
    .selectFrom('evidence')
    .where('expires_on', '>', now)
    .where('expires_on', '<', expiryDate)
    .where('state', '!=', 'expired')
    .$call((q) => scoped(q, evidenceScope))
    .selectAll()
    .execute();

  res.json({
    data: health,
    expiringSoon: expiringSoon.map(e => ({
      id: e.id,
      name: e.name,
      expiresOn: e.expires_on,
      state: e.state,
    })),
  });
}));

// Requirement conformance breakdown (pass/fail/NA across in-scope assessment requirements, Z6)
router.get('/conformance-breakdown', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const resultScope = inScope.assessment(await dashboardScope(db, req.user!), 'assessment_id');

  const results = ['yes', 'no', 'partial', 'not_applicable'] as const;
  const breakdown: { result: string; count: number }[] = await Promise.all(
    results.map(async (result) => ({
      result,
      count: await countScoped(db, 'assessment_requirement', resultScope, (eb) => eb('result', '=', result)),
    }))
  );

  const unassessed = await countScoped(db, 'assessment_requirement', resultScope, (eb) =>
    eb('result', 'is', null),
  );
  breakdown.push({ result: 'unassessed', count: unassessed });

  res.json({ data: breakdown });
}));

/** Gap insight for approved evidence that no claim cites; empty when there is none. */
async function uncitedEvidenceInsights(db: Kysely<Database>, scope: Scope) {
  const count = await countScoped(db, 'evidence', inScope.evidence(scope), approvedButUncited);
  if (count === 0) return [];
  const items = count === 1 ? '1 approved evidence item is' : `${count} approved evidence items are`;
  return [{
    type: 'gap',
    severity: 'low',
    title: `${items} not cited by any claim`,
    detail: 'Link each item to the claim it backs, or retire it if it is no longer needed.',
  }];
}

// Risk insights: blind spots, gaps, and warnings. Every source query is
// narrowed to the caller's projects / assessments / evidence (Z6), so no
// out-of-scope title or name reaches an insight string.
router.get('/risk-insights', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);
  const insights: { type: string; severity: string; title: string; detail: string }[] = [];

  // Blind spots: standards linked to projects but with 0% assessment coverage
  const standards = await db
    .selectFrom('standard')
    .innerJoin('project_standard', 'project_standard.standard_id', 'standard.id')
    .$call((q) => scoped(q, inScope.project(scope, 'project_standard.project_id')))
    .select(['standard.id', 'standard.name', 'standard.version'])
    .groupBy(['standard.id', 'standard.name', 'standard.version'])
    .execute();

  for (const std of standards) {
    const totalReqs = await db
      .selectFrom('requirement')
      .where('standard_id', '=', std.id)
      .select(db.fn.count<number>('id').as('count'))
      .executeTakeFirstOrThrow()
      .then(r => Number(r.count));

    const assessedReqs = await db
      .selectFrom('assessment_requirement')
      .innerJoin('requirement', 'requirement.id', 'assessment_requirement.requirement_id')
      .where('requirement.standard_id', '=', std.id)
      .where('assessment_requirement.result', 'is not', null)
      .$call((q) => scoped(q, inScope.assessment(scope, 'assessment_requirement.assessment_id')))
      .select(db.fn.count<number>('assessment_requirement.id').as('count'))
      .executeTakeFirstOrThrow()
      .then(r => Number(r.count));

    if (totalReqs > 0 && assessedReqs === 0) {
      insights.push({
        type: 'blind_spot',
        severity: 'high',
        title: `${std.name}${std.version ? ' v' + std.version : ''} has no assessed requirements`,
        detail: `${totalReqs} requirements exist but none have been evaluated in any assessment.`,
      });
    }
  }

  // Overdue assessments that are still active
  const overdueAssessments = await db
    .selectFrom('assessment')
    .innerJoin('project', 'project.id', 'assessment.project_id')
    .where('assessment.due_date', '<', new Date())
    .where('assessment.state', '!=', 'complete')
    .where('assessment.state', '!=', 'cancelled')
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.due_date',
      'project.name as project_name',
    ])
    .execute();

  for (const a of overdueAssessments) {
    const daysOverdue = Math.ceil((Date.now() - new Date(String(a.due_date)).getTime()) / (1000 * 60 * 60 * 24));
    insights.push({
      type: 'overdue',
      severity: daysOverdue > 30 ? 'critical' : 'high',
      title: `"${a.title}" is ${daysOverdue} days overdue`,
      detail: `Project: ${a.project_name}. This assessment has missed its target completion date.`,
    });
  }

  // Completed assessments without attestations
  const completedWithoutAttestation = await db
    .selectFrom('assessment')
    .leftJoin('attestation', 'attestation.assessment_id', 'assessment.id')
    .innerJoin('project', 'project.id', 'assessment.project_id')
    .where('assessment.state', '=', 'complete')
    .where('attestation.id', 'is', null)
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .select([
      'assessment.id',
      'assessment.title',
      'project.name as project_name',
    ])
    .execute();

  for (const a of completedWithoutAttestation) {
    insights.push({
      type: 'gap',
      severity: 'medium',
      title: `"${a.title}" completed but not attested`,
      detail: `Project: ${a.project_name}. This assessment was completed but no attestation has been created yet.`,
    });
  }

  // Evidence approaching expiration (within 30 days)
  const expiringEvidence = await db
    .selectFrom('evidence')
    .where('expires_on', '>', new Date())
    .where('expires_on', '<', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    .where('state', '!=', 'expired')
    .$call((q) => scoped(q, inScope.evidence(scope)))
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow()
    .then(r => Number(r.count));

  if (expiringEvidence > 0) {
    insights.push({
      type: 'expiring',
      severity: 'medium',
      title: `${expiringEvidence} evidence item${expiringEvidence > 1 ? 's' : ''} expiring within 30 days`,
      detail: 'Expired evidence may invalidate assessment results and attestations that depend on it.',
    });
  }

  insights.push(...(await uncitedEvidenceInsights(db, scope)));

  // Projects with no assessments at all
  const projectsWithoutAssessments = await db
    .selectFrom('project')
    .leftJoin('assessment', 'assessment.project_id', 'project.id')
    .where('assessment.id', 'is', null)
    .where('project.state', '!=', 'retired')
    .$call((q) => scoped(q, inScope.project(scope, 'project.id')))
    .select(['project.id', 'project.name'])
    .execute();

  for (const p of projectsWithoutAssessments) {
    insights.push({
      type: 'blind_spot',
      severity: 'medium',
      title: `Project "${p.name}" has no assessments`,
      detail: 'This project exists but has not been assessed against any standard.',
    });
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

  res.json({ data: insights });
}));

// Project health overview: per-project summary for CISO view. Scoped
// callers see only projects holding a readable assessment, and each
// project's numbers count only their readable assessments (Z6).
router.get('/project-health', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);
  // biome-ignore lint/suspicious/noExplicitAny: generic over Kysely query builders
  const inAssessments = (col: string) => <QB extends { where: (...args: any[]) => any }>(q: QB) => scoped(q, inScope.assessment(scope, col));

  const projects = await db
    .selectFrom('project')
    .where('state', '!=', 'retired')
    .$call((q) => scoped(q, inScope.project(scope, 'project.id')))
    .select(['id', 'name', 'state', 'start_date', 'due_date', 'archived_at'])
    .execute();

  const projectHealth = await Promise.all(
    projects.map(async (project) => {
      const [
        totalAssessments,
        completedAssessments,
        overdueAssessments,
        inProgressAssessments,
        attestationCount,
        requirementsCompleted,
      ] = await Promise.all([
        db.selectFrom('assessment').where('project_id', '=', project.id).$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
        db.selectFrom('assessment').where('project_id', '=', project.id).where('state', '=', 'complete').$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
        db.selectFrom('assessment').where('project_id', '=', project.id)
          .where('due_date', '<', new Date()).where('state', '!=', 'complete').where('state', '!=', 'cancelled').$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
        db.selectFrom('assessment').where('project_id', '=', project.id).where('state', '=', 'in_progress').$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
        db.selectFrom('attestation').innerJoin('assessment', 'assessment.id', 'attestation.assessment_id')
          .where('assessment.project_id', '=', project.id).$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('attestation.id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
        db.selectFrom('assessment_requirement')
          .innerJoin('assessment', 'assessment.id', 'assessment_requirement.assessment_id')
          .where('assessment.project_id', '=', project.id)
          .where('assessment_requirement.result', 'is not', null).$call(inAssessments('assessment.id'))
          .select(db.fn.count<number>('assessment_requirement.id').as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
      ]);

      // First assessor listed on any assessment in this project
      const assessorRow = await db
        .selectFrom('assessment_assessor')
        .innerJoin('assessment', 'assessment.id', 'assessment_assessor.assessment_id')
        .innerJoin('app_user', 'app_user.id', 'assessment_assessor.user_id')
        .where('assessment.project_id', '=', project.id)
        .$call(inAssessments('assessment.id'))
        .select('app_user.display_name')
        .limit(1)
        .executeTakeFirst();

      const completionRate = totalAssessments > 0
        ? Math.round((completedAssessments / totalAssessments) * 100)
        : 0;

      return {
        id: project.id,
        name: project.name,
        state: project.state,
        startDate: project.start_date,
        dueDate: project.due_date,
        closedAt: project.archived_at,
        assessor: assessorRow?.display_name ?? null,
        totalAssessments,
        completedAssessments,
        overdueAssessments,
        inProgressAssessments,
        attestationCount,
        requirementsCompleted,
        completionRate,
      };
    })
  );

  res.json({ data: projectHealth });
}));

// Quarterly assessment schedule: all readable assessments for the current
// year grouped by quarter (Z6).
router.get('/quarterly-schedule', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const scope = await dashboardScope(db, req.user!);
  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01`);
  const yearEnd = new Date(`${year}-12-31T23:59:59`);

  const assessments = await db
    .selectFrom('assessment')
    .leftJoin('project', 'project.id', 'assessment.project_id')
    .leftJoin('standard', 'standard.id', 'assessment.standard_id')
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.state',
      'assessment.start_date',
      'assessment.due_date',
      'assessment.end_date',
      'assessment.conformance_score',
      'project.name as project_name',
      'standard.name as standard_name',
    ])
    .where((eb) => eb.or([
      eb.and([eb('assessment.due_date', '>=', yearStart), eb('assessment.due_date', '<=', yearEnd)]),
      eb('assessment.state', 'in', ['new', 'pending', 'in_progress', 'on_hold']),
    ]))
    .where('assessment.state', '!=', 'cancelled')
    .where('assessment.state', '!=', 'archived')
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .orderBy('assessment.due_date', 'asc')
    .execute();

  const quarters: Record<string, typeof assessments> = { Q1: [], Q2: [], Q3: [], Q4: [] };
  const unscheduled: typeof assessments = [];

  for (const a of assessments) {
    const ref = a.due_date ?? a.start_date;
    if (!ref) { unscheduled.push(a); continue; }
    const m = new Date(String(ref)).getMonth(); // 0-indexed
    if (m <= 2) quarters.Q1.push(a);
    else if (m <= 5) quarters.Q2.push(a);
    else if (m <= 8) quarters.Q3.push(a);
    else quarters.Q4.push(a);
  }

  res.json({
    year,
    quarters: {
      Q1: { label: 'Q1 — Jan–Mar', assessments: quarters.Q1 },
      Q2: { label: 'Q2 — Apr–Jun', assessments: quarters.Q2 },
      Q3: { label: 'Q3 — Jul–Sep', assessments: quarters.Q3 },
      Q4: { label: 'Q4 — Oct–Dec', assessments: quarters.Q4 },
    },
    unscheduled,
  });
}));

// =============================================================================
// Progress Tab Data
// =============================================================================

/**
 * GET /progress
 * Returns all data needed by the Progress tab:
 *   - summaryStats: aggregate counts and average conformance
 *   - standardsData: per-standard conformance bars with assessment history
 *   - timelineAssessments: flat list of assessments for the timeline table
 *
 * Optional query param: entityId (filter to a single entity)
 */
//
// Scoped callers (Z6): every assessment query is restricted to readable
// assessments, the average uses only their results, and the entity
// selector lists only entities those assessments cover.
router.get('/progress', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const entityId = queryString(req.query.entityId);
  const scope = await dashboardScope(db, req.user!);

  // ---- Summary Stats ----

  // Distinct entities that have at least one assessment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entitiesAssessedQuery = db
    .selectFrom('assessment')
    .where('assessment.entity_id', 'is not', null)
    .select(db.fn.count<number>(
      // biome-ignore lint/suspicious/noExplicitAny: Kysely fn() requires any for DISTINCT wrapper
      db.fn('DISTINCT', ['assessment.entity_id'] as any) as any
    ).as('count'))
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')));
  if (entityId) {
    entitiesAssessedQuery = entitiesAssessedQuery.where('assessment.entity_id', '=', entityId);
  }
  const totalEntitiesAssessed = await entitiesAssessedQuery
    .executeTakeFirstOrThrow()
    .then(r => Number(r.count));

  // Active assessments (in_progress or pending)
  let activeQuery = db
    .selectFrom('assessment')
    .where('state', 'in', ['in_progress', 'pending', 'new'])
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')));
  if (entityId) {
    activeQuery = activeQuery.where('entity_id', '=', entityId);
  }
  const activeAssessments = await activeQuery
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow()
    .then(r => Number(r.count));

  // Completed this quarter
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  let completedQuery = db
    .selectFrom('assessment')
    .where('state', '=', 'complete')
    .where('updated_at', '>=', quarterStart)
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')));
  if (entityId) {
    completedQuery = completedQuery.where('entity_id', '=', entityId);
  }
  const completedThisQuarter = await completedQuery
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow()
    .then(r => Number(r.count));

  // Average conformance: compute from assessment_requirement results
  const averageConformance = await averageConformanceInScope(db, entityId, scope);

  // ---- Conformance by Standard ----

  // Get standards that have at least one assessment requirement result
  const standardsWithAssessments = await db
    .selectFrom('standard')
    .innerJoin('assessment', 'assessment.standard_id', 'standard.id')
    .innerJoin('assessment_requirement', 'assessment_requirement.assessment_id', 'assessment.id')
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .select(['standard.id', 'standard.name', 'standard.version'])
    .groupBy(['standard.id', 'standard.name', 'standard.version'])
    .execute();

  const standardsData = await Promise.all(
    standardsWithAssessments.map(async (std) => {
      // Get assessments for this standard
      let assessmentQuery = db
        .selectFrom('assessment')
        .leftJoin('entity', 'entity.id', 'assessment.entity_id')
        .where('assessment.standard_id', '=', std.id)
        .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')));
      if (entityId) {
        assessmentQuery = assessmentQuery.where('assessment.entity_id', '=', entityId);
      }

      const assessments = await assessmentQuery
        .select([
          'assessment.id',
          'assessment.title',
          'assessment.state',
          'assessment.updated_at',
          'entity.name as entity_name',
        ])
        .orderBy('assessment.updated_at', 'desc')
        .execute();

      // Compute per-assessment conformance scores
      const assessmentResults = await Promise.all(
        assessments.map(async (a) => {
          const reqs = await db
            .selectFrom('assessment_requirement')
            .where('assessment_id', '=', a.id)
            .where('result', 'is not', null)
            .where('result', '!=', 'not_applicable')
            .select('result')
            .execute();

          const score = await calculateAssessmentScore(db, a.id);

          return {
            id: a.id,
            title: a.title,
            entityName: a.entity_name || 'Unknown',
            score,
            hasResults: reqs.length > 0,
            completedDate: a.updated_at,
            state: a.state,
          };
        })
      );

      // Latest score is from the most recent assessment that has at least one scored requirement.
      // Assessments with no requirements evaluated yet are excluded from the headline score.
      const scoredResults = assessmentResults.filter(a => a.hasResults);
      const latestScore = scoredResults.length > 0 ? scoredResults[0].score : 0;

      return {
        id: std.id,
        name: std.name,
        version: std.version,
        latestScore,
        assessments: assessmentResults,
      };
    })
  );

  // Filter out standards with no assessments after entity filtering
  const filteredStandards = standardsData.filter(s => s.assessments.length > 0);

  // ---- Timeline Assessments ----

  let timelineQuery = db
    .selectFrom('assessment')
    .leftJoin('entity', 'entity.id', 'assessment.entity_id')
    .leftJoin('standard', 'standard.id', 'assessment.standard_id')
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')));
  if (entityId) {
    timelineQuery = timelineQuery.where('assessment.entity_id', '=', entityId);
  }

  const timelineRows = await timelineQuery
    .select([
      'assessment.id',
      'assessment.title',
      'assessment.state',
      'assessment.updated_at',
      'assessment.due_date',
      'entity.name as entity_name',
      'standard.name as standard_name',
      'standard.version as standard_version',
    ])
    .orderBy('assessment.updated_at', 'desc')
    .limit(20)
    .execute();

  const timelineAssessments = await Promise.all(
    timelineRows.map(async (a) => {
      const score = await calculateAssessmentScore(db, a.id);

      const stdLabel = a.standard_name
        ? `${a.standard_name}${a.standard_version ? ` ${a.standard_version}` : ''}`
        : 'Unknown';

      return {
        id: a.id,
        title: a.title,
        entityName: a.entity_name || 'Unknown',
        standardName: stdLabel,
        score,
        state: a.state,
        completedDate: a.updated_at,
      };
    })
  );

  // ---- Entities list for selector ----

  const entityList = await db
    .selectFrom('entity')
    .select(['id', 'name'])
    .$call((q) => scoped(q, scope && ((eb) => eb('entity.id', 'in',
      eb.selectFrom('assessment').select('assessment.entity_id').where('assessment.id', 'in', scope.ids)))))
    .orderBy('name', 'asc')
    .execute();

  res.json({
    summaryStats: {
      totalEntitiesAssessed,
      averageConformance,
      activeAssessments,
      completedThisQuarter,
    },
    standardsData: filteredStandards,
    timelineAssessments,
    entities: entityList,
  });
}));

/**
 * Average conformance across answered requirements, restricted to the
 * caller's readable assessments when scoped (Z6). Each result scores
 * yes = 100, partial = 50, no = 0; not_applicable and unanswered
 * requirements are excluded. Returns a rounded 0-100 average, or 0 when
 * nothing is answered.
 */
async function averageConformanceInScope(db: Kysely<Database>, entityId: string | undefined, scope: Scope): Promise<number> {
  const RESULT_SCORES: Record<string, number> = { yes: 100, partial: 50, no: 0 };
  const rows = await db
    .selectFrom('assessment_requirement')
    .innerJoin('assessment', 'assessment.id', 'assessment_requirement.assessment_id')
    .where('assessment_requirement.result', 'is not', null)
    .where('assessment_requirement.result', '!=', 'not_applicable')
    .$if(Boolean(entityId), (q) => q.where('assessment.entity_id', '=', entityId as string))
    .$call((q) => scoped(q, inScope.assessment(scope, 'assessment.id')))
    .select(['assessment_requirement.result'])
    .execute();
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, r) => sum + (RESULT_SCORES[r.result as string] ?? 0), 0);
  return Math.round(total / rows.length);
}

// Claims & Mitigations summary for dashboard widget. Scoped callers (Z6)
// see claims/attestations of their readable assessments, mitigations
// linked to those claims, and evidence they authored or review.
router.get('/claims-mitigations', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const now = new Date();
  const scope = await dashboardScope(db, req.user!);
  const claimScope = inScope.claim(scope, 'id');
  const mitigationScope = inScope.mitigation(scope, 'id');
  const count = (table: keyof Database, pred: Pred | null, cond?: Pred) => countScoped(db, table, pred, cond);

  const claimStatuses = ['Draft', 'Under Review', 'Accepted', 'Rejected'] as const;
  const mitStatuses = ['Proposed', 'In Progress', 'Implemented', 'Verified', 'Closed'] as const;

  const [
    totalClaims,
    totalMitigations,
    counterClaims,
    ...rest
  ] = await Promise.all([
    count('claim', claimScope),
    count('mitigation', mitigationScope),
    count('claim', claimScope, (eb) => eb('is_counter_claim', '=', true)),
    ...claimStatuses.map(st => count('claim', claimScope, (eb) => eb('status', '=', st))),
    ...mitStatuses.map(st => count('mitigation', mitigationScope, (eb) => eb('status', '=', st))),
  ]);

  const [draftClaims, underReviewClaims, acceptedClaims, rejectedClaims,
         proposedMits, inProgressMits, implementedMits, verifiedMits, closedMits] = rest;

  // Attestation / requirement linkage stats
  const [totalAttestations, attestedRequirements, claimedRequirements, mitigatedRequirements] = await Promise.all([
    count('attestation', inScope.attestation(scope, 'id')),
    db.selectFrom('attestation_requirement')
      .$call((q) => scoped(q, inScope.attestation(scope, 'attestation_requirement.attestation_id')))
      .select(db.fn.countAll<number>().as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
    db.selectFrom('attestation_requirement_claim')
      .$call((q) => scoped(q, inScope.attestationRequirement(scope, 'attestation_requirement_claim.attestation_requirement_id')))
      .select(db.fn.countAll<number>().as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
    db.selectFrom('attestation_requirement_mitigation')
      .$call((q) => scoped(q, inScope.attestationRequirement(scope, 'attestation_requirement_mitigation.attestation_requirement_id')))
      .select(db.fn.countAll<number>().as('count')).executeTakeFirstOrThrow().then(r => Number(r.count)),
  ]);

  // Evidence states
  const evidenceStateRaw = await db
    .selectFrom('evidence')
    .$call((q) => scoped(q, inScope.evidence(scope)))
    .select([db.fn.count<number>('id').as('count'), 'state'])
    .groupBy('state')
    .execute();
  const stateKeyMap: Record<string, string> = { in_review: 'inReview', in_progress: 'inProgress', claimed: 'claimed', expired: 'expired' };
  const evidenceByState: Record<string, number> = { inReview: 0, inProgress: 0, claimed: 0, expired: 0 };
  for (const row of evidenceStateRaw) {
    const key = stateKeyMap[row.state];
    if (key) evidenceByState[key] = Number(row.count);
  }

  // Claims under review — link out
  const claimsUnderReview = await db
    .selectFrom('claim')
    .where('status', '=', 'Under Review')
    .$call((q) => scoped(q, claimScope))
    .select(['id', 'display_id', 'name', 'status', 'claim_type'])
    .orderBy('created_at', 'asc')
    .limit(5)
    .execute();

  // Evidence awaiting review
  const evidenceUnderReview = await db
    .selectFrom('evidence')
    .where('state', '=', 'in_review')
    .$call((q) => scoped(q, inScope.evidence(scope)))
    .select(['id', 'display_id', 'name', 'state', 'created_at'])
    .orderBy('created_at', 'asc')
    .limit(5)
    .execute();

  // Counter-claims list (active)
  const counterClaimsList = await db
    .selectFrom('claim')
    .where('is_counter_claim', '=', true)
    .$call((q) => scoped(q, claimScope))
    .select(['id', 'display_id', 'name', 'status', 'claim_type'])
    .orderBy('created_at', 'desc')
    .limit(5)
    .execute();

  // Overdue mitigations: target_date in the past, not yet Verified or Closed
  const overdueMitigations = await db
    .selectFrom('mitigation')
    .where('target_date', 'is not', null)
    .where('target_date', '<', now.toISOString().slice(0, 10))
    .where('status', 'not in', ['Verified', 'Closed'])
    .$call((q) => scoped(q, mitigationScope))
    .select(['id', 'display_id', 'title', 'status', 'priority', 'target_date'])
    .orderBy('target_date', 'asc')
    .limit(5)
    .execute();

  // Open mitigations by priority (anything not yet Verified or Closed),
  // so the dashboard can show remediation urgency, not just volume.
  const openByPriorityRaw = await db
    .selectFrom('mitigation')
    .where('status', 'not in', ['Verified', 'Closed'])
    .$call((q) => scoped(q, mitigationScope))
    .select([db.fn.count<number>('id').as('count'), 'priority'])
    .groupBy('priority')
    .execute();
  const openByPriority: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of openByPriorityRaw) {
    const key = String(row.priority ?? '').toLowerCase();
    if (key in openByPriority) openByPriority[key] = Number(row.count);
  }

  // Recently closed: accepted claims + verified/closed mitigations in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recentlyAcceptedClaims, recentlyClosedMits] = await Promise.all([
    db.selectFrom('claim')
      .where('status', '=', 'Accepted')
      .where('updated_at', '>=', sevenDaysAgo)
      .$call((q) => scoped(q, claimScope))
      .select(['id', 'display_id', 'name', 'status', 'updated_at'])
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute(),
    db.selectFrom('mitigation')
      .where('status', 'in', ['Verified', 'Closed'])
      .where('updated_at', '>=', sevenDaysAgo)
      .$call((q) => scoped(q, mitigationScope))
      .select(['id', 'display_id', 'title', 'status', 'updated_at'])
      .orderBy('updated_at', 'desc')
      .limit(5)
      .execute(),
  ]);

  res.json({
    claims: {
      total: totalClaims,
      counterClaims,
      byStatus: {
        draft: draftClaims,
        underReview: underReviewClaims,
        accepted: acceptedClaims,
        rejected: rejectedClaims,
      },
    },
    mitigations: {
      total: totalMitigations,
      byStatus: {
        proposed: proposedMits,
        inProgress: inProgressMits,
        implemented: implementedMits,
        verified: verifiedMits,
        closed: closedMits,
      },
      openByPriority,
    },
    evidence: evidenceByState,
    requirements: {
      attested: attestedRequirements,
      claimed: claimedRequirements,
      mitigated: mitigatedRequirements,
      attestations: totalAttestations,
    },
    attention: {
      claimsUnderReview: claimsUnderReview.map(c => ({
        id: c.id,
        displayId: c.display_id,
        name: c.name,
        status: c.status,
        claimType: c.claim_type,
      })),
      evidenceUnderReview: evidenceUnderReview.map(e => ({
        id: e.id,
        displayId: e.display_id,
        name: e.name,
        state: e.state,
      })),
      counterClaims: counterClaimsList.map(c => ({
        id: c.id,
        displayId: c.display_id,
        name: c.name,
        status: c.status,
        claimType: c.claim_type,
      })),
      overdueMitigations: overdueMitigations.map(m => ({
        id: m.id,
        displayId: m.display_id,
        title: m.title,
        status: m.status,
        priority: m.priority,
        targetDate: m.target_date,
      })),
      recentlyClosed: [
        ...recentlyAcceptedClaims.map(c => ({ id: c.id, displayId: c.display_id, label: c.name, kind: 'claim' as const, status: c.status, updatedAt: c.updated_at })),
        ...recentlyClosedMits.map(m => ({ id: m.id, displayId: m.display_id, label: m.title, kind: 'mitigation' as const, status: m.status, updatedAt: m.updated_at })),
      ].sort((a, b) => new Date(String(b.updatedAt)).getTime() - new Date(String(a.updatedAt)).getTime()).slice(0, 5),
    },
  });
}));

/**
 * Recent domain activity for the dashboard Activity tab. Unlike the
 * admin audit route (which requires the admin.audit permission and
 * exposes everything, including auth events and permission denials),
 * this feed is deliberately scoped to the domain entity types whose
 * names every authenticated user can already see through the other
 * dashboard endpoints, and to substantive actions only. Keep both
 * whitelists in sync with that exposure, not with the audit schema.
 *
 * Security review Z6: callers with admin.audit see the whole feed.
 * Everyone else sees only their own actions plus actions on assessments
 * they may read, never other actors' activity on out-of-scope entities.
 */
const ACTIVITY_ENTITY_TYPES = [
  'project',
  'assessment',
  'claim',
  'evidence',
  'mitigation',
  'attestation',
  'standard',
  'entity',
];

const ACTIVITY_ACTIONS: AuditLog['action'][] = [
  'create',
  'create_for_other',
  'update',
  'delete',
  'state_change',
  'link',
  'unlink',
];

router.get('/recent-activity', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 20;

  const fullFeed = await hasPermission(req.user!.role, 'admin.audit');
  const readable = fullFeed ? null : await readableAssessmentIds(db, req.user!);

  const rows = await db
    .selectFrom('audit_log')
    .selectAll()
    .where('entity_type', 'in', ACTIVITY_ENTITY_TYPES)
    .where('action', 'in', ACTIVITY_ACTIONS)
    .$if(!fullFeed, (q) => q.where((eb) => eb.or([
      eb('user_id', '=', req.user!.id),
      readable === null
        ? eb('entity_type', '=', 'assessment')
        : eb.and([eb('entity_type', '=', 'assessment'), eb('entity_id', 'in', inList(readable))]),
    ])))
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  const enriched = await enrichWithNames(rows);

  res.json({
    data: enriched.map(r => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      userName: r.user_display_name,
      // Deleted (or soft-deleted) entities no longer resolve to a live
      // row; fall back to the name captured in the audit row itself.
      entityName: r.entity_name
        ?? (typeof r.changes?.name === 'string' ? r.changes.name : null)
        ?? (typeof r.changes?.title === 'string' ? r.changes.title : null),
      createdAt: r.created_at,
    })),
  });
}));

export default router;
