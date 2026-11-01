/**
 * Centralized E2E credentials.
 *
 * The admin user is provisioned via the in-browser setup wizard in
 * global-setup.ts. Demo users come from backend/src/db/demo-data.json via
 * /api/v1/setup/seed-demo. They can only sign in because global-setup
 * passes `demoUserPassword: DEMO_PASSWORD`; without it the backend gives
 * them an unusable password (the one in demo-data.json is never used).
 *
 * If demo-data.json is edited, update the username list. The role keys must stay in lockstep with
 * backend/src/utils/roles.ts.
 */

export const ADMIN_USERNAME = 'e2e_admin';
export const ADMIN_EMAIL = 'e2e_admin@example.test';
export const ADMIN_DISPLAY_NAME = 'E2E Admin';
export const ADMIN_PASSWORD = 'E2eAdminPassword!2026';

export const DEMO_PASSWORD = 'DemoPass123!';

export interface DemoUser {
  username: string;
  displayName: string;
  email: string;
  role: 'assessor' | 'assessee' | 'standards_manager' | 'standards_approver';
}

/**
 * Mirrors backend/src/db/demo-data.json `users` array.
 * Keep in sync when the seed file changes.
 */
export const DEMO_USERS: Record<string, DemoUser> = {
  jthompson: {
    username: 'jthompson',
    displayName: 'Jane Thompson',
    email: 'jane.thompson@acme-corp.example.com',
    role: 'assessor',
  },
  mwilson: {
    username: 'mwilson',
    displayName: 'Mark Wilson',
    email: 'mark.wilson@acme-corp.example.com',
    role: 'assessor',
  },
  spatil: {
    username: 'spatil',
    displayName: 'Sara Patil',
    email: 'sara.patil@acme-corp.example.com',
    role: 'assessee',
  },
  rgarcia: {
    username: 'rgarcia',
    displayName: 'Roberto Garcia',
    email: 'roberto.garcia@acme-corp.example.com',
    role: 'assessee',
  },
  lkumar: {
    username: 'lkumar',
    displayName: 'Lena Kumar',
    email: 'lena.kumar@acme-corp.example.com',
    role: 'standards_manager',
  },
  dokafor: {
    username: 'dokafor',
    displayName: 'David Okafor',
    email: 'david.okafor@trustbridge-audit.example.com',
    role: 'standards_approver',
  },
};

/**
 * Canonical role name used by storage-state file naming and the auth
 * fixture's `role` parameter. The `admin` role is the wizard-created
 * E2E_ADMIN credential, not a demo user.
 */
export type RoleKey =
  | 'admin'
  | 'assessor'
  | 'assessee'
  | 'standards_manager'
  | 'standards_approver';

/**
 * Returns the demo username that should be logged in to obtain a
 * storage state for the given role. The admin role is special-cased
 * because the wizard-created admin is the canonical admin storage
 * state, not a demo user.
 */
export function demoUserForRole(role: Exclude<RoleKey, 'admin'>): DemoUser {
  switch (role) {
    case 'assessor':
      return DEMO_USERS.jthompson;
    case 'assessee':
      return DEMO_USERS.spatil;
    case 'standards_manager':
      return DEMO_USERS.lkumar;
    case 'standards_approver':
      return DEMO_USERS.dokafor;
  }
}

export const ALL_ROLES: RoleKey[] = [
  'admin',
  'assessor',
  'assessee',
  'standards_manager',
  'standards_approver',
];
