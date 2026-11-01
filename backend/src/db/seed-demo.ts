import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'node:crypto';
import { getDatabase } from './connection.js';
import { hashPassword } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Kysely } from 'kysely';
import type { Database } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper: Load demo data JSON
async function loadDemoDataJSON(): Promise<DemoData> {
  const demoDataPath = path.join(__dirname, 'demo-data.json');
  const raw = readFileSync(demoDataPath, 'utf-8');
  return JSON.parse(raw);
}

// Helper: Resolve placeholder IDs to actual IDs
function createIdResolver(
  adminUserId: string,
  firstStandardId: string | null,
  secondStandardId: string | null,
  ssdfStandardId: string | null
): (val: string) => string | null {
  return (val: string): string | null => {
    if (val === '__ADMIN_USER__') return adminUserId;
    if (val === '__FIRST_STANDARD__') return firstStandardId;
    if (val === '__SECOND_STANDARD__') return secondStandardId;
    if (val === '__SSDF_STANDARD__') return ssdfStandardId;
    return val;
  };
}

// Helper: Seed basic entities (organizations, contacts, tags)
async function seedBasicEntities(db: Kysely<Database>, data: DemoData): Promise<void> {
  for (const org of data.organizations) {
    await db.insertInto('organization').values(org).execute();
  }
  logger.info(`Seeded ${data.organizations.length} organizations`);

  for (const contact of data.contacts) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('contact').values(contact as any).execute();
  }
  logger.info(`Seeded ${data.contacts.length} contacts`);

  for (const tag of data.tags) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('tag').values(tag as any).execute();
  }
  logger.info(`Seeded ${data.tags.length} tags`);
}

// Helper: Seed users with password hashing
async function seedUsers(db: Kysely<Database>, data: DemoData, adminRole: { id: string } | undefined, adminUser: { id: string } | undefined, userPassword: string | undefined): Promise<void> {
  const roleMap = new Map<string, string>();
  const roles = await db.selectFrom('role').select(['id', 'key']).execute();
  for (const role of roles) {
    roleMap.set(role.key, role.id);
  }

  for (const user of data.users) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const userData = user as any;
    // The password in demo-data.json is published in the repo, so it is
    // never used. Without an operator-supplied password the account gets
    // a hash of random bytes nobody knows: the demo records load, but no
    // one can sign in as a demo user (security review A1).
    const passwordHash = await hashPassword(userPassword ?? randomBytes(32).toString('base64url'));
    await db
      .insertInto('app_user')
      .values({
        id: userData.id as string,
        username: userData.username as string,
        email: userData.email as string,
        password_hash: passwordHash,
        display_name: userData.display_name as string,
        role: userData.role as string,
        role_id: roleMap.get(userData.role) || null,
        is_active: true,
        has_completed_onboarding: true,
      })
      .execute();
  }
  logger.info(`Seeded ${data.users.length} demo users`);

  if (adminRole && adminUser) {
    await db
      .updateTable('app_user')
      .set({ role_id: adminRole.id, has_completed_onboarding: true })
      .where('id', '=', adminUser.id)
      .execute();
  }
}

// Helper: Seed entities, relationships, and tags
async function seedEntitiesAndRelationships(db: Kysely<Database>, data: DemoData, firstStandardId: string | null, secondStandardId: string | null, ssdfStandardId: string | null): Promise<void> {
  for (const entity of data.entities) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const entityData = entity as any;
    const bomRef = entityData.bom_ref || `${entityData.entity_type}-${(entityData.id as string).substring(0, 8)}`;
    await db.insertInto('entity').values({
      ...entity,
      bom_ref: bomRef,
      // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    } as any).execute();
  }
  logger.info(`Seeded ${data.entities.length} entities`);

  for (const rel of data.entity_relationships) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _comment, ...relData } = rel;
    // biome-ignore lint/suspicious/noExplicitAny: Seed data shape does not match DB row type exactly
    await db.insertInto('entity_relationship').values(relData as any).execute();
  }
  logger.info(`Seeded ${data.entity_relationships.length} entity relationships`);

  for (const et of data.entity_tags) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('entity_tag').values({ ...et, created_at: new Date() } as any).execute();
  }

  // Entity Standards
  if (firstStandardId) {
    const entityStandardPairs = [
      { entity_id: '00000000-0000-4000-a100-000000000007', standard_id: firstStandardId },
      { entity_id: '00000000-0000-4000-a100-000000000009', standard_id: firstStandardId },
    ];
    if (secondStandardId && secondStandardId !== firstStandardId) {
      entityStandardPairs.push(
        { entity_id: '00000000-0000-4000-a100-000000000006', standard_id: secondStandardId },
        { entity_id: '00000000-0000-4000-a100-000000000001', standard_id: secondStandardId },
      );
    }
    for (const es of entityStandardPairs) {
      await db.insertInto('entity_standard').values({ ...es, created_at: new Date() }).execute();
    }
    logger.info(`Seeded ${entityStandardPairs.length} entity-standard associations`);
  }

  if (ssdfStandardId) {
    await db.insertInto('entity_standard').values({
      entity_id: '00000000-0000-4000-a100-000000000006',
      standard_id: ssdfStandardId,
      created_at: new Date(),
    }).execute();
    logger.info('Linked Supplier A to SSDF standard');
  }
}

// Helper: Seed compliance policies
async function seedCompliancePolicies(db: Kysely<Database>, _data: DemoData, firstStandardId: string | null, secondStandardId: string | null): Promise<void> {
  if (!firstStandardId) return;

  const policies = [
    {
      id: uuidv4(),
      entity_id: '00000000-0000-4000-a100-000000000001',
      standard_id: firstStandardId,
      description: 'All Acme products must comply with ASVS Level 2 requirements.',
      is_inherited: false,
    },
  ];
  if (secondStandardId && secondStandardId !== firstStandardId) {
    policies.push({
      id: uuidv4(),
      entity_id: '00000000-0000-4000-a100-000000000006',
      standard_id: secondStandardId,
      description: 'Suppliers must demonstrate compliance with applicable security maturity standards.',
      is_inherited: false,
    });
  }
  for (const p of policies) {
    await db.insertInto('compliance_policy').values(p).execute();
  }
  logger.info(`Seeded ${policies.length} compliance policies`);
}

// Helper: Seed signatories and projects
async function seedSignatoriesAndProjects(db: Kysely<Database>, data: DemoData, firstStandardId: string | null, secondStandardId: string | null): Promise<void> {
  for (const sig of data.signatories) {
    await db.insertInto('signatory').values(sig).execute();
  }
  logger.info(`Seeded ${data.signatories.length} signatories`);

  for (const project of data.projects) {
    await db.insertInto('project').values(project).execute();
  }
  logger.info(`Seeded ${data.projects.length} projects`);

  for (const pt of data.project_tags) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('project_tag').values({ ...pt, created_at: new Date() } as any).execute();
  }

  if (firstStandardId) {
    const projectStandards = [
      { project_id: '00000000-0000-4000-b100-000000000001', standard_id: firstStandardId },
    ];
    if (secondStandardId && secondStandardId !== firstStandardId) {
      projectStandards.push(
        { project_id: '00000000-0000-4000-b100-000000000002', standard_id: secondStandardId },
      );
    }
    for (const ps of projectStandards) {
      await db.insertInto('project_standard').values({ ...ps, created_at: new Date() }).execute();
    }
  }
}

// Helper: Seed affirmations
async function seedAffirmations(db: Kysely<Database>, data: DemoData): Promise<void> {
  for (const aff of data.affirmations) {
    await db.insertInto('affirmation').values({
      ...aff,
      entity_id: aff.entity_id || null,
    }).execute();
  }
  logger.info(`Seeded ${data.affirmations.length} affirmations`);

  // Sprint 9 shape: affirmation_signatory rows are slot rows with a
  // required_title. Seed data comes from the legacy two column layout,
  // so we look up the signatory's role or name and use it as the title
  // to keep the demo realistic without hand editing the JSON.
  const seenTitlesByAffirmation = new Map<string, Set<string>>();
  for (const as_ of data.affirmation_signatories) {
    // biome-ignore lint/suspicious/noExplicitAny: seed data is loose JSON
    const row = as_ as any;
    const affirmationId = row.affirmation_id as string;
    const signatoryId = row.signatory_id as string;
    const sigRow = await db.selectFrom('signatory').where('id', '=', signatoryId).selectAll().executeTakeFirst();
    const baseTitle = (sigRow?.role || sigRow?.name || 'Signatory').toString().trim();
    const used = seenTitlesByAffirmation.get(affirmationId) ?? new Set<string>();
    let title = baseTitle;
    let suffix = 1;
    while (used.has(title)) {
      suffix += 1;
      title = `${baseTitle} (${suffix})`;
    }
    used.add(title);
    seenTitlesByAffirmation.set(affirmationId, used);
    await db.insertInto('affirmation_signatory').values({
      affirmation_id: affirmationId,
      required_title: title,
      signatory_id: signatoryId,
      created_at: new Date(),
      updated_at: new Date(),
      // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    } as any).execute();
  }
}

// Helper: Seed assessments and related data
async function seedAssessments(db: Kysely<Database>, data: DemoData, resolveId: (val: string) => string | null): Promise<void> {
  for (const assessment of data.assessments) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const assessmentData = assessment as any;
    await db.insertInto('assessment').values({
      id: assessmentData.id as string,
      title: assessmentData.title as string,
      description: assessmentData.description as string,
      project_id: resolveId(assessmentData.project_id as string) || undefined,
      entity_id: assessmentData.entity_id || undefined,
      standard_id: resolveId(assessmentData.standard_id as string) || undefined,
      state: assessmentData.state as string,
      start_date: assessmentData.start_date || undefined,
      due_date: assessmentData.due_date || undefined,
      assessment_type: (assessmentData.assessment_type as string) || 'standards',
      task_label: assessmentData.task_label || undefined,
    }).execute();
  }
  logger.info(`Seeded ${data.assessments.length} assessments`);

  for (const aa of data.assessment_assessors) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const aaData = aa as any;
    const resolved = resolveId(aaData.user_id as string);
    if (!resolved) {
      throw new Error(`Failed to resolve user_id: ${aaData.user_id}`);
    }
    await db.insertInto('assessment_assessor').values({
      assessment_id: aaData.assessment_id as string,
      user_id: resolved,
      created_at: new Date(),
    }).execute();
  }

  for (const aa of data.assessment_assessees) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const aaData = aa as any;
    const resolved = resolveId(aaData.user_id as string);
    if (!resolved) {
      throw new Error(`Failed to resolve user_id: ${aaData.user_id}`);
    }
    await db.insertInto('assessment_assessee').values({
      assessment_id: aaData.assessment_id as string,
      user_id: resolved,
      created_at: new Date(),
    }).execute();
  }

  for (const at of data.assessment_tags) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('assessment_tag').values({ ...at, created_at: new Date() } as any).execute();
  }
}

// Helper: Seed evidence and attachments
async function seedEvidence(db: Kysely<Database>, data: DemoData, resolveId: (val: string) => string | null): Promise<void> {
  for (const ev of data.evidence) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const evData = ev as any;
    await db.insertInto('evidence').values({
      id: evData.id as string,
      name: evData.name as string,
      description: evData.description as string,
      state: evData.state as string,
      author_id: resolveId(evData.author_id as string)!,
      reviewer_id: evData.reviewer_id ? resolveId(evData.reviewer_id as string) : undefined,
      is_counter_evidence: evData.is_counter_evidence as boolean,
      classification: evData.classification as string,
      expires_on: evData.expires_on || undefined,
    }).execute();
  }
  logger.info(`Seeded ${data.evidence.length} evidence items`);

  for (const et of data.evidence_tags) {
    // biome-ignore lint/suspicious/noExplicitAny: Seed data shape does not match DB row type exactly
    await db.insertInto('evidence_tag').values({ ...et, created_at: new Date() } as any).execute();
  }

  for (const en of data.evidence_notes) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('evidence_note').values(en as any).execute();
  }
  logger.info(`Seeded ${data.evidence_notes.length} evidence notes`);

  for (const ea of data.evidence_attachments) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const row = { ...ea, storage_provider: 'database' } as any;
    if (typeof row.binary_content === 'string') {
      row.binary_content = Buffer.from(row.binary_content, 'base64');
    }
    await db.insertInto('evidence_attachment').values(row).execute();
  }
  logger.info(`Seeded ${data.evidence_attachments.length} evidence attachments`);
}

// Helper: Seed assessment requirements and work notes
async function seedAssessmentRequirements(db: Kysely<Database>, _data: DemoData, firstStandardId: string | null, _adminUserId: string): Promise<void> {
  if (!firstStandardId) return;

  const requirements = await db
    .selectFrom('requirement')
    .where('standard_id', '=', firstStandardId)
    .select(['id'])
    .orderBy('identifier', 'asc')
    .limit(10)
    .execute();

  const assessmentReqIds: string[] = [];
  for (let i = 0; i < requirements.length; i++) {
    const arId = uuidv4();
    assessmentReqIds.push(arId);
    const results: Array<'yes' | 'no' | 'partial' | 'not_applicable' | null> = [
      'yes', 'yes', 'partial', 'yes', 'not_applicable',
      'yes', 'no', null, null, null,
    ];
    const rationales = [
      'Verified through penetration test and code review.',
      'MFA enforced for all user authentication paths.',
      'Partially implemented. API access paths still use single factor.',
      'Session management follows OWASP recommendations.',
      'Not applicable to this component architecture.',
      'Input validation implemented on all user facing endpoints.',
      'Password policy does not meet minimum complexity requirements.',
      null, null, null,
    ];

    await db.insertInto('assessment_requirement').values({
      id: arId,
      assessment_id: '00000000-0000-4000-b400-000000000001',
      // eslint-disable-next-line security/detect-object-injection
      requirement_id: requirements[i].id,
      // eslint-disable-next-line security/detect-object-injection
      result: results[i] || undefined,
      // eslint-disable-next-line security/detect-object-injection
      rationale: rationales[i] || undefined,
    }).execute();
  }

  const workNotes = [
    {
      id: uuidv4(),
      assessment_id: '00000000-0000-4000-b400-000000000001',
      user_id: '00000000-0000-4000-8000-000000000002',
      content: 'Reviewed pentest report section 4.2 which covers authentication requirements. All findings remediated. @spatil can you verify the remediation on your end?',
    },
    {
      id: uuidv4(),
      assessment_id: '00000000-0000-4000-b400-000000000001',
      user_id: '00000000-0000-4000-8000-000000000002',
      content: 'API MFA enforcement is on the roadmap for Q2 2026. Currently only web UI enforces MFA. @mwilson need to follow up with API gateway team on timeline.',
    },
    {
      id: uuidv4(),
      assessment_id: '00000000-0000-4000-b400-000000000001',
      user_id: '00000000-0000-4000-8000-000000000004',
      content: 'The API gateway team has started work on MFA enforcement. Expected completion: 2026-05-15. @jthompson updating you as requested.',
    },
    {
      id: uuidv4(),
      assessment_id: '00000000-0000-4000-b400-000000000001',
      user_id: '00000000-0000-4000-8000-000000000003',
      content: 'Current password policy: 8 chars minimum, no complexity. Need to upgrade to 12 chars with complexity rules per ASVS requirement.',
    },
  ];
  for (const wn of workNotes) {
    await db.insertInto('work_note').values({ ...wn, created_at: new Date(), updated_at: new Date() }).execute();
  }
  logger.info(`Seeded ${workNotes.length} work notes`);

  await db.insertInto('assessment_requirement_evidence').values({
    assessment_requirement_id: assessmentReqIds[0],
    evidence_id: '00000000-0000-4000-b500-000000000001',
    created_at: new Date(),
  }).execute();
  await db.insertInto('assessment_requirement_evidence').values({
    assessment_requirement_id: assessmentReqIds[1],
    evidence_id: '00000000-0000-4000-b500-000000000003',
    created_at: new Date(),
  }).execute();

  logger.info(`Seeded ${requirements.length} assessment requirements`);
}

// Helper: Seed claims and related data
async function seedClaims(db: Kysely<Database>, data: DemoData): Promise<void> {
  for (const claim of data.claims) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const claimData = claim as any;
    await db.insertInto('claim').values({
      ...claim,
      target_entity_id: claimData.target_entity_id || null,
      // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    } as any).execute();
  }
  logger.info(`Seeded ${data.claims.length} claims`);

  for (const ce of data.claim_evidence) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('claim_evidence').values({ ...ce, created_at: new Date() } as any).execute();
  }

  for (const cce of data.claim_counter_evidence) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('claim_counter_evidence').values({ ...cce, created_at: new Date() } as any).execute();
  }

  for (const cms of data.claim_mitigation_strategies) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('claim_mitigation_strategy').values({ ...cms, created_at: new Date() } as any).execute();
  }
}

// Helper: Seed assessors and claim external references
async function seedAssessorsAndReferences(db: Kysely<Database>): Promise<{ internalAssessorId: string; externalAssessorId: string }> {
  const internalAssessorId = uuidv4();
  const externalAssessorId = uuidv4();
  await db.insertInto('assessor').values({
    id: internalAssessorId,
    bom_ref: `assessor-${internalAssessorId.substring(0, 8)}`,
    third_party: false,
    entity_id: '00000000-0000-4000-a100-000000000004',
    user_id: null,
  }).execute();
  await db.insertInto('assessor').values({
    id: externalAssessorId,
    bom_ref: `assessor-${externalAssessorId.substring(0, 8)}`,
    third_party: true,
    entity_id: '00000000-0000-4000-a100-000000000013',
    user_id: null,
  }).execute();
  logger.info('Seeded 2 assessors (1 internal, 1 external)');

  await db.insertInto('claim_external_reference').values({
    id: uuidv4(),
    claim_id: '00000000-0000-4000-b600-000000000001',
    type: 'issue-tracker',
    url: 'https://jira.acme.example.com/browse/SEC-1234',
    comment: 'Authentication hardening tracking ticket',
  }).execute();
  await db.insertInto('claim_external_reference').values({
    id: uuidv4(),
    claim_id: '00000000-0000-4000-b600-000000000002',
    type: 'pentest-report',
    url: 'https://docs.acme.example.com/security/pentest-2026-q1.pdf',
    comment: 'Q1 2026 penetration test identifying session fixation',
  }).execute();
  await db.insertInto('claim_external_reference').values({
    id: uuidv4(),
    claim_id: '00000000-0000-4000-b600-000000000003',
    type: 'certification-report',
    url: 'https://compliance.suppliera.example.com/soc2-type2-2025.pdf',
    comment: 'Supplier A SOC 2 Type II report',
  }).execute();
  logger.info('Seeded 3 claim external references');

  return { internalAssessorId, externalAssessorId };
}

// Helper: Seed attestations
//
// The SSDF assessment's single, fully populated attestation is seeded
// by seedSSDF() from `data.ssdf_assessment_data`. An earlier iteration
// also seeded a hardcoded second attestation on the same assessment
// with five cherry-picked requirements; that duplicate has been
// removed per the "one fully populated SSDF attestation" demo shape.
async function seedAttestations(_db: Kysely<Database>, _firstStandardId: string | null, _ssdfStandardId: string | null, _internalAssessorId: string): Promise<void> {
  // Intentionally empty. Kept as a stub so the call graph in
  // seedDemoData stays symmetric with other seed helpers. Remove the
  // stub once the call site is also removed if the demo grows more
  // attestation variants later.
}

// Helper: Seed SSDF data
async function seedSSDF(db: Kysely<Database>, data: DemoData, ssdfStandardId: string | null, externalAssessorId: string, adminUserId: string): Promise<void> {
  if (!data.ssdf_assessment_data || !ssdfStandardId) {
    if (data.ssdf_assessment_data && !ssdfStandardId) {
      logger.warn('SSDF assessment data found but SSDF standard (ssdf-1.1) not imported. Skipping SSDF seeding.');
    }
    return;
  }

  const ssdf = data.ssdf_assessment_data;
  const ssdfRequirements = await db
    .selectFrom('requirement')
    .where('standard_id', '=', ssdfStandardId)
    .select(['id', 'identifier'])
    .execute();
  const ssdfReqMap = new Map<string, string>();
  for (const r of ssdfRequirements) {
    ssdfReqMap.set(r.identifier, r.id);
  }

  const ssdfAssessmentId = '00000000-0000-4000-b400-100000000001';
  const ssdfAssessmentReqMap = new Map<string, string>();

  for (const ar of ssdf.assessment_requirements) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const arData = ar as any;
    const requirementId = ssdfReqMap.get(arData.requirement_identifier as string);
    if (!requirementId) {
      logger.warn(`SSDF requirement not found: ${arData.requirement_identifier}`);
      continue;
    }

    const arId = uuidv4();
    ssdfAssessmentReqMap.set(arData.requirement_identifier as string, arId);

    await db.insertInto('assessment_requirement').values({
      id: arId,
      assessment_id: ssdfAssessmentId,
      requirement_id: requirementId,
      result: arData.result || undefined,
      rationale: arData.rationale || undefined,
      conformance_score: arData.conformance_score ?? undefined,
      conformance_rationale: arData.conformance_rationale || undefined,
      confidence_score: arData.confidence_score ?? undefined,
      confidence_rationale: arData.confidence_rationale || undefined,
    }).execute();

    if (arData.evidence_ids && (arData.evidence_ids as unknown[]).length > 0) {
      for (const evidenceId of arData.evidence_ids as string[]) {
        try {
          await db.insertInto('assessment_requirement_evidence').values({
            assessment_requirement_id: arId,
            evidence_id: evidenceId,
            created_at: new Date(),
          }).execute();
        } catch (e: unknown) {
          const err = e as Record<string, unknown>;
          const msg = err?.message as string | undefined;
          if (!msg?.includes('duplicate') && !msg?.includes('unique') && !msg?.includes('foreign')) {
            throw e;
          }
        }
      }
    }

    if (arData.work_notes && (arData.work_notes as unknown[]).length > 0) {
      for (const wn of arData.work_notes as Array<Record<string, unknown>>) {
        // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
        const wnData = wn as any;
        await db.insertInto('work_note').values({
          id: uuidv4(),
          assessment_id: ssdfAssessmentId,
          user_id: wnData.user_id as string || adminUserId,
          content: wnData.content as string,
          created_at: new Date(),
          updated_at: new Date(),
        }).execute();
      }
    }
  }
  logger.info(`Seeded ${ssdfAssessmentReqMap.size} SSDF assessment requirements`);

  const ssdfAttestationId = uuidv4();
  // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
  const attestationData = ssdf.attestation as any;
  await db.insertInto('attestation').values({
    id: ssdfAttestationId,
    summary: attestationData.summary as string,
    assessment_id: ssdfAssessmentId,
    signatory_id: attestationData.signatory_id as string,
    assessor_id: externalAssessorId,
  }).execute();

  const ssdfTargetEntityMap: Record<string, string> = {
    'Acme Corporation SDLC': '00000000-0000-4000-a100-000000000001',
    'Acme Corporation': '00000000-0000-4000-a100-000000000001',
    'Acme Corporation Development Infrastructure': '00000000-0000-4000-a100-000000000001',
    'Acme Corporation Development Process': '00000000-0000-4000-a100-000000000001',
    'Product A v2.1 Source Repositories': '00000000-0000-4000-a100-000000000008',
    'Product A v2.1 Build and Release': '00000000-0000-4000-a100-000000000008',
    'Product A v2.1 Releases': '00000000-0000-4000-a100-000000000008',
    'Product A v2.1 Supply Chain': '00000000-0000-4000-a100-000000000008',
    'Product A v2.1 Development': '00000000-0000-4000-a100-000000000008',
    'Product A v2.1 Architecture': '00000000-0000-4000-a100-000000000008',
  };

  for (const claim of data.claims) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const claimData = claim as any;
    const claimId = claimData.id as string;
    if (claimId.startsWith('00000000-0000-4000-b600-1000')) {
      const targetEntityId = ssdfTargetEntityMap[claimData.target as string] || null;
      await db
        .updateTable('claim')
        .set({
          attestation_id: ssdfAttestationId,
          ...(targetEntityId ? { target_entity_id: targetEntityId } : {}),
        })
        .where('id', '=', claimId)
        .execute();
    }
  }

  const ssdfAttReqMap = new Map<string, string>();
  for (const atReq of ssdf.attestation_requirements) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const atReqData = atReq as any;
    const requirementId = ssdfReqMap.get(atReqData.requirement_identifier as string);
    if (!requirementId) {
      logger.warn(`SSDF attestation requirement not found: ${atReqData.requirement_identifier}`);
      continue;
    }

    const atReqId = uuidv4();
    ssdfAttReqMap.set(atReqData.requirement_identifier as string, atReqId);

    await db.insertInto('attestation_requirement').values({
      id: atReqId,
      attestation_id: ssdfAttestationId,
      requirement_id: requirementId,
      conformance_score: atReqData.conformance_score as number,
      conformance_rationale: atReqData.conformance_rationale as string,
      confidence_score: atReqData.confidence_score as number,
      confidence_rationale: atReqData.confidence_rationale as string,
    }).execute();

    // Attach per-requirement claims and counterClaims so the CycloneDX
    // export's declarations.attestations[].map[].claims / counterClaims
    // arrays are populated from structured data rather than the
    // legacy "all claims on this attestation" fallback. Each entry
    // must reference a claim that was appended to the top-level
    // claims array; we skip gracefully if the claim row is missing
    // so a partial demo file still loads.
    const linkClaims = async (ids: string[], table: 'attestation_requirement_claim' | 'attestation_requirement_counter_claim') => {
      for (const claimId of ids) {
        try {
          await db
            // biome-ignore lint/suspicious/noExplicitAny: dynamic table
            .insertInto(table as any)
            .values({
              attestation_requirement_id: atReqId,
              claim_id: claimId,
              created_at: new Date(),
              // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
            } as any)
            .execute();
        } catch (e: unknown) {
          const err = e as Record<string, unknown>;
          const msg = err?.message as string | undefined;
          if (!msg?.includes('duplicate') && !msg?.includes('unique') && !msg?.includes('foreign')) {
            throw e;
          }
        }
      }
    };
    if (Array.isArray(atReqData.claim_ids)) {
      await linkClaims(atReqData.claim_ids as string[], 'attestation_requirement_claim');
    }
    if (Array.isArray(atReqData.counter_claim_ids)) {
      await linkClaims(
        atReqData.counter_claim_ids as string[],
        'attestation_requirement_counter_claim',
      );
    }
  }
  logger.info(`Seeded ${ssdfAttReqMap.size} SSDF attestation requirements`);

  for (const mit of ssdf.attestation_requirement_mitigations) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const mitData = mit as any;
    const atReqId = ssdfAttReqMap.get(mitData.requirement_identifier as string);
    if (!atReqId) {
      logger.warn(`SSDF mitigation: attestation requirement not found for ${mitData.requirement_identifier}`);
      continue;
    }

    await db.insertInto('attestation_requirement_mitigation').values({
      attestation_requirement_id: atReqId,
      evidence_id: mit.evidence_id,
      description: mit.description || null,
      target_completion: mit.target_completion || null,
    }).execute();
  }
  logger.info(`Seeded ${ssdf.attestation_requirement_mitigations.length} SSDF attestation requirement mitigations`);
}

// Helper: Seed notifications and audit logs
async function seedFinalEntities(db: Kysely<Database>, data: DemoData, resolveId: (val: string) => string | null): Promise<void> {
  for (const notif of data.notifications) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const notifData = notif as any;
    const resolved = resolveId(notifData.user_id as string);
    if (!resolved) {
      throw new Error(`Failed to resolve user_id: ${notifData.user_id}`);
    }
    await db.insertInto('notification').values({
      ...notif,
      user_id: resolved,
      // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    } as any).execute();
  }
  logger.info(`Seeded ${data.notifications.length} notifications`);

  for (const log of data.audit_logs) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    const logData = log as any;
    const resolved = resolveId(logData.user_id as string);
    if (!resolved) {
      throw new Error(`Failed to resolve user_id: ${logData.user_id}`);
    }
    // Honor optional `created_at` from the JSON so demo data can spread
    // audit events across a realistic time window rather than clustering
    // every entry at seed time. When omitted, Postgres applies the
    // CURRENT_TIMESTAMP default on the column.
    const row: {
      id: string;
      entity_type: string;
      entity_id: string;
      action: string;
      user_id: string;
      changes: string;
      created_at?: Date;
    } = {
      id: uuidv4(),
      entity_type: logData.entity_type as string,
      entity_id: logData.entity_id as string,
      action: logData.action as string,
      user_id: resolved,
      changes: JSON.stringify(logData.changes),
    };
    if (typeof logData.created_at === 'string') {
      const parsed = new Date(logData.created_at);
      if (!Number.isNaN(parsed.getTime())) {
        row.created_at = parsed;
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: Kysely Insertable for audit_log has created_at as optional
    await db.insertInto('audit_log').values(row as any).execute();
  }
  logger.info(`Seeded ${data.audit_logs.length} audit log entries`);
}

// DemoData interface: loaded from JSON, properties are loosely typed
// Each array contains objects with structure matching database tables
// Properties are accessed via destructuring/spreading and may be unknown until narrowed
// biome-ignore lint/suspicious/noExplicitAny: Seed data from JSON file has dynamic structure
interface DemoData {
  organizations: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  users: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  entity_relationships: Record<string, unknown>[];
  entity_tags: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  project_tags: Record<string, unknown>[];
  signatories: Record<string, unknown>[];
  affirmations: Record<string, unknown>[];
  affirmation_signatories: Record<string, unknown>[];
  assessments: Record<string, unknown>[];
  assessment_assessors: Record<string, unknown>[];
  assessment_assessees: Record<string, unknown>[];
  assessment_tags: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  evidence_tags: Record<string, unknown>[];
  evidence_notes: Record<string, unknown>[];
  evidence_attachments: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  claim_evidence: Record<string, unknown>[];
  claim_counter_evidence: Record<string, unknown>[];
  claim_mitigation_strategies: Record<string, unknown>[];
  mitigations?: Record<string, unknown>[];
  mitigation_claim?: Record<string, unknown>[];
  mitigation_evidence?: Record<string, unknown>[];
  assessment_evidence?: Record<string, unknown>[];
  scheduled_assessments?: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  audit_logs: Record<string, unknown>[];
  ssdf_assessment_data?: {
    assessment_requirements: Record<string, unknown>[];
    attestation: Record<string, unknown>;
    attestation_requirements: Record<string, unknown>[];
    attestation_requirement_mitigations: Record<string, unknown>[];
  };
}

/**
 * Seed the standalone mitigation register, the scheduler, and the
 * assessment/mitigation link tables. These tables have no bespoke seeding
 * elsewhere; the rows come straight from the demo-data arrays. All sections are
 * optional so older demo-data.json files (without them) still seed cleanly.
 * Runs after projects, assessments, evidence, and claims exist.
 */
async function seedMitigationsAndScheduler(
  db: Kysely<Database>,
  data: DemoData,
  resolveId: (val: string) => string | null,
): Promise<void> {
  const adminId = resolveId('__ADMIN_USER__') || undefined;

  for (const m of data.mitigations ?? []) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('mitigation').values({ ...(m as any), created_by: adminId, created_at: new Date(), updated_at: new Date() } as any).execute();
  }
  if (data.mitigations?.length) logger.info(`Seeded ${data.mitigations.length} mitigations`);

  for (const ae of data.assessment_evidence ?? []) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('assessment_evidence').values({ ...(ae as any), created_at: new Date() } as any).execute();
  }
  for (const mc of data.mitigation_claim ?? []) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('mitigation_claim').values({ ...(mc as any), created_at: new Date() } as any).execute();
  }
  for (const me of data.mitigation_evidence ?? []) {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely seed data requires dynamic types
    await db.insertInto('mitigation_evidence').values({ ...(me as any), created_at: new Date() } as any).execute();
  }

  for (const s of data.scheduled_assessments ?? []) {
    const sd = s as Record<string, unknown>;
    await db.insertInto('scheduled_assessment').values({
      id: sd.id as string,
      title: sd.title as string,
      description: (sd.description as string) || undefined,
      project_id: (sd.project_id as string) || undefined,
      assessor_id: sd.assessor_id ? (resolveId(sd.assessor_id as string) || undefined) : undefined,
      standard_id: sd.standard_id ? (resolveId(sd.standard_id as string) || undefined) : undefined,
      assessment_id: (sd.assessment_id as string) || undefined,
      scheduled_date: sd.scheduled_date as string,
      due_date: (sd.due_date as string) || undefined,
      recurrence: (sd.recurrence as string) || 'none',
      status: (sd.status as string) || 'scheduled',
      created_by: adminId,
      created_at: new Date(),
      updated_at: new Date(),
      // biome-ignore lint/suspicious/noExplicitAny: dynamic seed row
    } as any).execute();
  }
  if (data.scheduled_assessments?.length) logger.info(`Seeded ${data.scheduled_assessments.length} scheduled assessments`);
}

/**
 * Seeds the database with comprehensive demo data.
 * Requires that:
 *   1. Migrations have been run
 *   2. Default roles/permissions have been seeded
 *   3. An admin user already exists (created during setup)
 *   4. Standards have been imported from the CycloneDX feed
 *
 * Returns true if demo data was seeded, false if skipped (data already present).
 */
export interface SeedDemoOptions {
  /** Sign-in password for every demo user. Omit to make them unable to sign in. */
  userPassword?: string;
}

export async function seedDemoData(options: SeedDemoOptions = {}): Promise<boolean> {
  const db = getDatabase();

  // Guard: skip if demo data already exists
  const existingEntities = await db
    .selectFrom('entity')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow();

  if (Number(existingEntities.count) > 0) {
    // The data-seed phase is a no-op when the demo is already in the
    // database, but the seal step is cheap and now step-idempotent,
    // so run it anyway. That way a DB that was seeded before the
    // sealer worked (or before the admin lookup was fixed) picks up
    // the missing signatures on the next server start without a wipe.
    logger.info('Demo data already present, skipping row seed; running seal repair pass');
    try {
      const { sealSsdfDemoAffirmation } = await import('./seed-demo-seal.js');
      const repaired = await sealSsdfDemoAffirmation();
      logger.info('Demo SSDF seal repair result', { repaired });
    } catch (err) {
      logger.warn('Demo SSDF seal repair pass failed', {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
    }
    return false;
  }

  logger.info('Seeding demo data...');

  // Load demo data
  const data = await loadDemoDataJSON();

  // Resolve IDs for placeholders
  const adminUser = await db
    .selectFrom('app_user')
    .where('role', '=', 'admin')
    .select(['id'])
    .executeTakeFirst();
  const adminUserId = adminUser?.id || uuidv4();

  const importedStandards = await db
    .selectFrom('standard')
    .select(['id', 'name'])
    .orderBy('created_at', 'asc')
    .execute();
  const firstStandardId = importedStandards[0]?.id || null;
  const secondStandardId = importedStandards[1]?.id || firstStandardId || null;

  const ssdfStandard = await db
    .selectFrom('standard')
    .where('identifier', '=', 'ssdf-1.1')
    .select(['id', 'name'])
    .executeTakeFirst();
  const ssdfStandardId = ssdfStandard?.id || null;

  const resolveId = createIdResolver(adminUserId, firstStandardId, secondStandardId, ssdfStandardId);

  const adminRole = await db
    .selectFrom('role')
    .where('key', '=', 'admin')
    .select('id')
    .executeTakeFirst();

  // Seed in FK dependency order
  await seedBasicEntities(db, data);
  await seedUsers(db, data, adminRole, adminUser, options.userPassword);
  await seedEntitiesAndRelationships(db, data, firstStandardId, secondStandardId, ssdfStandardId);
  await seedCompliancePolicies(db, data, firstStandardId, secondStandardId);
  await seedSignatoriesAndProjects(db, data, firstStandardId, secondStandardId);
  // Assessments must be seeded before affirmations now that
  // demo-data.json scopes at least one affirmation to a specific
  // assessment via affirmation.assessment_id (FK).
  await seedAssessments(db, data, resolveId);
  await seedAffirmations(db, data);
  await seedEvidence(db, data, resolveId);
  await seedAssessmentRequirements(db, data, firstStandardId, adminUserId);
  await seedClaims(db, data);

  const { internalAssessorId, externalAssessorId } = await seedAssessorsAndReferences(db);
  await seedAttestations(db, firstStandardId, ssdfStandardId, internalAssessorId);
  await seedSSDF(db, data, ssdfStandardId, externalAssessorId, adminUserId);

  await seedFinalEntities(db, data, resolveId);

  await seedMitigationsAndScheduler(db, data, resolveId);

  // Seal the SSDF demo affirmation end-to-end. Uses a freshly
  // generated RSA key for the digital signatory and the platform
  // key (auto-provisioned on first seed run) to produce the
  // declarations and document envelopes. Skipped silently if the
  // affirmation or admin user is not in place yet so non-demo
  // reseeds stay idempotent.
  try {
    const { sealSsdfDemoAffirmation } = await import('./seed-demo-seal.js');
    const sealed = await sealSsdfDemoAffirmation();
    logger.info('Demo SSDF seal result', { sealed });
  } catch (err) {
    // Surface the seal failure at warn level but do not throw so a
    // partial demo (unsigned) still ends up in the DB for inspection.
    logger.warn('Demo SSDF affirmation seal failed — demo data is still seeded, just unsigned', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }

  logger.info('Demo data seeded successfully');
  return true;
}
