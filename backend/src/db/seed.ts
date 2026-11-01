import { v4 as uuidv4 } from 'uuid';
import type { Kysely } from 'kysely';
import { getDatabase } from './connection.js';
import type { Database } from './types.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PERMISSIONS = [
  // Projects
  { key: 'projects.view', name: 'View Projects', description: 'View project list and details', category: 'projects' },
  { key: 'projects.view_all', name: 'View All Projects', description: 'View all projects regardless of assessment participation', category: 'projects' },
  { key: 'projects.create', name: 'Create Projects', description: 'Create new projects', category: 'projects' },
  { key: 'projects.edit', name: 'Edit Projects', description: 'Edit existing projects', category: 'projects' },
  { key: 'projects.delete', name: 'Delete Projects', description: 'Delete or retire projects', category: 'projects' },
  // Standards
  { key: 'standards.view', name: 'View Standards', description: 'View standards and requirements', category: 'standards' },
  { key: 'standards.import', name: 'Import Standards', description: 'Import standards from CycloneDX feed', category: 'standards' },
  { key: 'standards.create', name: 'Create Standards', description: 'Create new draft standards', category: 'standards' },
  { key: 'standards.edit', name: 'Edit Standards', description: 'Edit draft standards', category: 'standards' },
  { key: 'standards.submit', name: 'Submit Standards', description: 'Submit standards for approval', category: 'standards' },
  { key: 'standards.approve', name: 'Approve Standards', description: 'Approve or reject submitted standards', category: 'standards' },
  { key: 'standards.duplicate', name: 'Duplicate Standards', description: 'Duplicate an existing standard to create a new version', category: 'standards' },
  // Assessments
  { key: 'assessments.view', name: 'View Assessments', description: 'View assessment list and details', category: 'assessments' },
  { key: 'assessments.view_all', name: 'View All Assessments', description: 'View all assessments regardless of participation', category: 'assessments' },
  { key: 'assessments.create', name: 'Create Assessments', description: 'Create new assessments', category: 'assessments' },
  { key: 'assessments.edit', name: 'Edit Assessments', description: 'Edit assessments', category: 'assessments' },
  { key: 'assessments.manage', name: 'Manage Assessments', description: 'Start, complete, and manage assessment lifecycle', category: 'assessments' },
  { key: 'assessments.notes', name: 'Work Notes', description: 'Add work notes to assessment requirements', category: 'assessments' },
  // Evidence
  { key: 'evidence.view', name: 'View Evidence', description: 'View evidence items', category: 'evidence' },
  { key: 'evidence.view_all', name: 'View All Evidence', description: 'View all evidence items regardless of assessment participation', category: 'evidence' },
  { key: 'evidence.create', name: 'Create Evidence', description: 'Create new evidence', category: 'evidence' },
  { key: 'evidence.edit', name: 'Edit Evidence', description: 'Edit evidence items', category: 'evidence' },
  { key: 'evidence.review', name: 'Review Evidence', description: 'Review and approve evidence', category: 'evidence' },
  { key: 'evidence.submit', name: 'Submit Evidence', description: 'Submit evidence for review', category: 'evidence' },
  { key: 'evidence.delete', name: 'Delete Evidence', description: 'Delete or expire evidence', category: 'evidence' },
  // Claims
  { key: 'claims.view', name: 'View Claims', description: 'View claims', category: 'claims' },
  { key: 'claims.view_all', name: 'View All Claims', description: 'View all claims regardless of assessment participation', category: 'claims' },
  { key: 'claims.create', name: 'Create Claims', description: 'Create new claims', category: 'claims' },
  { key: 'claims.edit', name: 'Edit Claims', description: 'Edit claims', category: 'claims' },
  // Attestations
  { key: 'attestations.view', name: 'View Attestations', description: 'View attestations', category: 'attestations' },
  { key: 'attestations.create', name: 'Create Attestations', description: 'Create attestations', category: 'attestations' },
  { key: 'attestations.edit', name: 'Edit Attestations', description: 'Edit attestations that are not yet signed', category: 'attestations' },
  { key: 'attestations.sign', name: 'Sign Attestations', description: 'Sign attestations as signatory', category: 'attestations' },
  { key: 'attestations.export', name: 'Export Attestations', description: 'Export attestations as CycloneDX or PDF', category: 'attestations' },
  // Signatures
  { key: 'signatures.manage', name: 'Manage Own Signatures', description: 'Manage signatures on your own user profile', category: 'signatures' },
  { key: 'signatures.sign', name: 'Sign Attestations', description: 'Sign attestations using your personal signature inventory', category: 'signatures' },
  // Affirmations. The cascade sign ceremony is gated behind its own
  // permission because sealing an affirmation is a high trust action
  // that spans the declarations and document envelopes.
  { key: 'affirmations.manage', name: 'Manage Affirmations', description: 'Create, edit, seal, and rescind affirmations for an assessment', category: 'affirmations' },
  // Platform signing keys. Rotating the server held keypair used to
  // seal affirmations is even more sensitive than managing the
  // affirmations themselves, so it is grantable separately.
  { key: 'platform_keys.rotate', name: 'Rotate Platform Signing Key', description: 'Generate a new platform signing key and retire the old one', category: 'platform' },
  // Export
  { key: 'export.pdf', name: 'Export PDF', description: 'Export assessment reports as PDF', category: 'export' },
  { key: 'export.cyclonedx', name: 'Export CycloneDX', description: 'Export CycloneDX BOM documents', category: 'export' },
  // Entities
  { key: 'entities.view', name: 'View Entities', description: 'View entity list and details', category: 'entities' },
  { key: 'entities.create', name: 'Create Entities', description: 'Create new entities', category: 'entities' },
  { key: 'entities.edit', name: 'Edit Entities', description: 'Edit existing entities', category: 'entities' },
  { key: 'entities.delete', name: 'Delete Entities', description: 'Delete entities', category: 'entities' },
  // Admin
  { key: 'admin.users', name: 'Manage Users', description: 'Create, edit, and manage user accounts', category: 'admin' },
  { key: 'admin.roles', name: 'Manage Roles', description: 'Create, edit, and manage roles and permissions', category: 'admin' },
  { key: 'admin.settings', name: 'Manage Settings', description: 'Manage application settings', category: 'admin' },
  { key: 'admin.webhooks', name: 'Manage Webhooks', description: 'Create, edit, and manage webhooks', category: 'admin' },
  { key: 'admin.integrations', name: 'Manage Integrations', description: 'Manage chat and external integrations', category: 'admin' },
  { key: 'admin.encryption', name: 'Manage Encryption', description: 'Manage encryption keys and settings', category: 'admin' },
  { key: 'admin.notification_rules', name: 'Manage Notification Rules', description: 'Manage global notification rules', category: 'admin' },
  { key: 'admin.tags', name: 'Manage Tags', description: 'Create, edit, and manage tags', category: 'admin' },
  { key: 'admin.import', name: 'Import Data', description: 'Import CycloneDX attestation documents', category: 'admin' },
  { key: 'admin.audit', name: 'View Audit Logs', description: 'View system audit logs', category: 'admin' },
];

const DEFAULT_ROLES = [
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full access to all features and settings',
    permissions: DEFAULT_PERMISSIONS.map(p => p.key),
  },
  {
    key: 'assessor',
    name: 'Assessor',
    description: 'Can conduct assessments, manage evidence, create claims and attestations',
    permissions: [
      // Assessors see all data across the platform (but no admin panels), so
      // they hold every *.view_all key alongside the base view permissions.
      'projects.view', 'projects.view_all', 'standards.view', 'entities.view',
      'assessments.view', 'assessments.view_all', 'assessments.create', 'assessments.edit', 'assessments.manage', 'assessments.notes',
      'evidence.view', 'evidence.view_all', 'evidence.create', 'evidence.edit', 'evidence.review',
      'claims.view', 'claims.view_all', 'claims.create', 'claims.edit',
      'attestations.view', 'attestations.create', 'attestations.edit', 'attestations.sign', 'attestations.export',
      'signatures.manage', 'signatures.sign',
      'export.pdf', 'export.cyclonedx',
    ],
  },
  {
    key: 'assessee',
    name: 'Assessee',
    description: 'Can view assessments, submit evidence, and view attestations',
    permissions: [
      'projects.view', 'standards.view', 'entities.view',
      'assessments.view', 'assessments.notes',
      'evidence.view', 'evidence.create', 'evidence.submit',
      'claims.view',
      'attestations.view',
    ],
  },
  {
    key: 'standards_manager',
    name: 'Standards Manager',
    description: 'Can author, edit, and submit draft standards for approval',
    is_system: true,
    permissions: [
      'standards.view', 'standards.create', 'standards.edit', 'standards.submit', 'standards.duplicate',
    ],
  },
  {
    key: 'standards_approver',
    name: 'Standards Approver',
    description: 'Can approve or reject submitted standards',
    is_system: true,
    permissions: [
      'standards.view', 'standards.approve',
    ],
  },
];

export async function seedDefaultRolesAndPermissions(
  dbOverride?: Kysely<Database>,
): Promise<void> {
  // Tests bring their own PGlite instance and want to seed it without
  // going through the connection.ts singleton. Production callers rely
  // on the default of pulling from getDatabase().
  const db = dbOverride ?? getDatabase();

  // Idempotency check: skip only if roles have been seeded. Roles are
  // only ever inserted by this seeder, so their presence is a reliable
  // "already done" signal across re-runs.
  const existingRoles = await db
    .selectFrom('role')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow();

  if (Number(existingRoles.count) > 0) {
    logger.info('Default roles already seeded, skipping');
    return;
  }

  logger.info('Seeding default permissions and roles...');

  // Insert permissions. ON CONFLICT DO NOTHING keeps the seed
  // idempotent across re-runs and across test suites that pre-create
  // a subset of the permission set.
  const permissionMap = new Map<string, string>();
  for (const perm of DEFAULT_PERMISSIONS) {
    const id = uuidv4();
    await db
      .insertInto('permission')
      .values({
        id,
        key: perm.key,
        name: perm.name,
        description: perm.description,
        category: perm.category,
      })
      .onConflict((oc) => oc.column('key').doNothing())
      .execute();
  }

  const persistedPermissions = await db
    .selectFrom('permission')
    .select(['id', 'key'])
    .execute();
  for (const row of persistedPermissions) {
    permissionMap.set(row.key, row.id);
  }

  // Insert roles and role_permission associations
  for (const role of DEFAULT_ROLES) {
    const roleId = uuidv4();
    await db
      .insertInto('role')
      .values({
        id: roleId,
        key: role.key,
        name: role.name,
        description: role.description,
        is_system: true,
      })
      .execute();

    for (const permKey of role.permissions) {
      const permId = permissionMap.get(permKey);
      if (permId) {
        await db
          .insertInto('role_permission')
          .values({
            role_id: roleId,
            permission_id: permId,
            created_at: new Date(),
          })
          .execute();
      }
    }
  }

  logger.info('Default permissions and roles seeded successfully');
}
