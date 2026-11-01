import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw, NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import axios from 'axios'

// Cache setup status so we don't check on every navigation
let setupChecked = false
let setupComplete = true

// Track whether the initial auth check has completed
let authInitialized = false

// F05: throttle window for /auth/me re-fetch on navigation. Guards
// against a rapid-fire click from spamming the server while still
// surfacing a revoked role or permission within a couple of seconds.
// A test hook overrides this via setPermissionRefreshIntervalForTests.
const DEFAULT_PERMISSION_REFRESH_INTERVAL_MS = 2_000
let permissionRefreshIntervalMs = DEFAULT_PERMISSION_REFRESH_INTERVAL_MS
let lastPermissionRefreshAt = 0
let inFlightPermissionRefresh: Promise<void> | null = null

async function checkSetupStatus(): Promise<boolean> {
  if (setupChecked) return setupComplete
  try {
    const { data } = await axios.get('/api/v1/setup/status')
    setupComplete = data.setupComplete
    setupChecked = true
    return setupComplete
  } catch {
    // If the check fails, assume setup is complete to avoid blocking
    return true
  }
}

// Called after the setup wizard finishes so the guard stops redirecting
export function markSetupDone(): void {
  setupComplete = true
  setupChecked = true
}

// Called after the initial auth check completes
export function markAuthInitialized(): void {
  authInitialized = true
}

/**
 * F05: re-fetch the current user and permissions on navigation so a
 * permission or role revocation takes effect on the next route change
 * rather than persisting until the session cookie expires. Rapid
 * navigations coalesce behind a single in-flight request, and repeat
 * calls inside the throttle window are skipped.
 *
 * Exported for tests and for flows that want to force a refresh after
 * a known state change (for example, after the admin UI edits the
 * current user's role).
 */
export async function refreshPermissionsFromServer(force = false): Promise<void> {
  const authStore = useAuthStore()

  if (inFlightPermissionRefresh) {
    await inFlightPermissionRefresh
    return
  }

  const now = Date.now()
  if (!force && now - lastPermissionRefreshAt < permissionRefreshIntervalMs) {
    return
  }

  inFlightPermissionRefresh = (async () => {
    try {
      await authStore.fetchCurrentUser()
    } finally {
      lastPermissionRefreshAt = Date.now()
      inFlightPermissionRefresh = null
    }
  })()

  await inFlightPermissionRefresh
}

/**
 * Test helper. Production code should not use these.
 * @internal Test seam; not part of the module API.
 */
export function _resetPermissionRefreshStateForTests(): void {
  lastPermissionRefreshAt = 0
  inFlightPermissionRefresh = null
  permissionRefreshIntervalMs = DEFAULT_PERMISSION_REFRESH_INTERVAL_MS
  authInitialized = false
  setupChecked = false
  setupComplete = true
}

/** @internal Test seam; not part of the module API. */
export function setPermissionRefreshIntervalForTests(ms: number): void {
  permissionRefreshIntervalMs = ms
}

// Object ids are UUIDs. Constraining the parameter means route.params can
// never carry '/', '..', '?' or '#': Vue Router decodes %2F, so an
// unconstrained /evidence/:id link could steer the view's API calls to a
// different endpoint with the user's session (client-side path traversal).
const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/views/SetupView.vue'),
    meta: { public: true, setup: true }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true }
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/views/PasswordResetView.vue'),
    meta: { public: true }
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/PasswordResetView.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/progress',
    redirect: '/dashboard'
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('@/views/ProjectsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'projects.view' }
  },
  {
    path: `/projects/:id${UUID}`,
    name: 'ProjectDetail',
    component: () => import('@/views/ProjectDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/schedule',
    name: 'Scheduler',
    component: () => import('@/views/SchedulerView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'assessments.view' }
  },
  {
    path: '/entities',
    name: 'Entities',
    component: () => import('@/views/EntitiesView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'entities.view' }
  },
  {
    path: `/entities/:id${UUID}`,
    name: 'EntityDetail',
    component: () => import('@/views/EntityDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/standards',
    name: 'Standards',
    component: () => import('@/views/StandardsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: `/standards/:id${UUID}`,
    name: 'StandardDetail',
    component: () => import('@/views/StandardDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/assessments',
    name: 'Assessments',
    component: () => import('@/views/AssessmentsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'assessments.view' }
  },
  {
    path: `/assessments/:id${UUID}`,
    name: 'AssessmentDetail',
    component: () => import('@/views/AssessmentDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: `/assessments/:id${UUID}/setup`,
    name: 'TargetedAssessmentSetup',
    component: () => import('@/views/TargetedAssessmentSetupView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: `/assessments/:id${UUID}/requirements/:requirementId${UUID}`,
    name: 'RequirementDetail',
    component: () => import('@/views/RequirementDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: `/assessments/:id${UUID}/declarations`,
    name: 'Declarations',
    component: () => import('@/views/DeclarationsView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/evidence',
    name: 'Evidence',
    component: () => import('@/views/EvidenceView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'evidence.view' }
  },
  {
    path: `/evidence/:id${UUID}`,
    name: 'EvidenceDetail',
    component: () => import('@/views/EvidenceDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/attestations',
    name: 'Attestations',
    component: () => import('@/views/AttestationsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'attestations.view' }
  },
  {
    path: '/mitigations',
    name: 'Mitigations',
    component: () => import('@/views/MitigationsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'claims.view' }
  },
  {
    path: `/mitigations/:id${UUID}`,
    name: 'MitigationDetail',
    component: () => import('@/views/MitigationDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/claims',
    name: 'Claims',
    component: () => import('@/views/ClaimsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'claims.view' }
  },
  {
    path: `/claims/:id${UUID}`,
    name: 'ClaimDetail',
    component: () => import('@/views/ClaimDetailView.vue'),
    meta: { requiresAuth: true }
  },
  {
    // The single consolidated admin surface for user, invitation,
    // role, and assessor management. Each tab is permission gated
    // inside the view, so we gate the route on the union permission
    // to avoid a 403 redirect when the user only has one of the
    // sub-permissions (for example, an Assessments Manager without
    // admin.users should still be able to reach the Assessors tab).
    path: '/admin/user-management',
    name: 'AdminUserManagement',
    component: () => import('@/views/AdminUserManagementView.vue'),
    meta: { requiresAuth: true, requiresAnyPermission: ['admin.users', 'admin.roles', 'assessments.manage'] }
  },
  // Legacy paths redirect into the correct tab so existing bookmarks,
  // email links, and deep links continue to work.
  {
    path: '/admin/users',
    redirect: { path: '/admin/user-management', query: { tab: 'users' } }
  },
  {
    path: '/admin/roles',
    redirect: { path: '/admin/user-management', query: { tab: 'roles' } }
  },
  {
    path: '/admin/webhooks',
    name: 'AdminWebhooks',
    component: () => import('@/views/AdminWebhooksView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.webhooks' }
  },
  {
    path: '/admin/integrations',
    name: 'AdminIntegrations',
    component: () => import('@/views/AdminIntegrationsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.integrations' }
  },
  {
    path: '/admin/chat-integrations',
    name: 'AdminChatIntegrations',
    component: () => import('@/views/AdminChatIntegrationsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.integrations' }
  },
  {
    path: '/admin/notification-rules',
    name: 'AdminNotificationRules',
    component: () => import('@/views/AdminNotificationRulesView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.notification_rules' }
  },
  {
    path: '/admin/audit',
    name: 'AdminAudit',
    component: () => import('@/views/AdminAuditView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.audit' }
  },
  {
    path: '/admin/invitations',
    redirect: { path: '/admin/user-management', query: { tab: 'invitations' } }
  },
  {
    path: '/admin/encryption',
    name: 'AdminEncryption',
    component: () => import('@/views/AdminEncryptionView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.encryption' }
  },
  {
    path: '/admin/platform-keys',
    name: 'AdminPlatformKeys',
    component: () => import('@/views/AdminPlatformKeysView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'platform_keys.rotate' }
  },
  {
    path: '/admin/assessors',
    redirect: { path: '/admin/user-management', query: { tab: 'assessors' } }
  },
  {
    path: '/admin/tags',
    name: 'AdminTags',
    component: () => import('@/views/AdminTagsView.vue'),
    meta: { requiresAuth: true, requiresPermission: 'admin.tags' }
  },
  {
    path: '/admin/trash',
    name: 'Trash',
    component: () => import('@/views/TrashView.vue'),
    meta: { requiresAuth: true, requiresAnyPermission: ['assessments.manage', 'evidence.delete', 'claims.edit'] }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { requiresAuth: true }
  },
  // Unknown paths (including ids that are not UUIDs) go to the dashboard;
  // the guard sends signed-out users on to the login page.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard'
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async (to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const authStore = useAuthStore()

  // Perform initial auth check on first navigation if not already done.
  // Force the refresh so the throttle does not short circuit the very
  // first hydration of the store.
  if (!authInitialized) {
    await refreshPermissionsFromServer(true)
    authInitialized = true
  } else if (to.meta.requiresAuth || to.meta.requiresPermission || to.meta.requiresAnyPermission) {
    // F05: re-fetch /auth/me on every navigation into an authenticated
    // route so permission and role revocations take effect on the next
    // route change. The throttle coalesces rapid navigations.
    await refreshPermissionsFromServer()
  }

  // Check if initial setup is needed
  const isSetup = await checkSetupStatus()

  if (!isSetup && !to.meta.setup) {
    // Setup not complete: redirect everything to the setup wizard
    next('/setup')
    return
  }

  if (isSetup && to.meta.setup) {
    // Setup already done: don't allow revisiting the wizard
    next('/login')
    return
  }

  // Normal auth guards
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // Carry the originally-requested path on the login redirect so the
    // user lands back where they were after re-authenticating. Skip the
    // redirect param when the user is bouncing through /login already
    // (no useful return path) or coming from /dashboard (the default
    // post-login target).
    redirectToLogin(to, next)
  } else if (to.meta.requiresPermission && !authStore.hasPermission(to.meta.requiresPermission as string)) {
    next('/dashboard')
  } else if (
    to.meta.requiresAnyPermission &&
    !authStore.hasAnyPermission(...(to.meta.requiresAnyPermission as string[]))
  ) {
    // requiresAnyPermission allows a route where any one of the listed
    // permissions is sufficient. The consolidated User Management page
    // uses this so that an Assessments Manager (who has
    // assessments.manage but not admin.users) can still reach the
    // Assessors tab.
    next('/dashboard')
  } else if (to.meta.public || authStore.isAuthenticated) {
    next()
  } else {
    redirectToLogin(to, next)
  }
})

function redirectToLogin(
  to: RouteLocationNormalized,
  next: NavigationGuardNext,
): void {
  const path = to.fullPath
  if (path === '/login' || path === '/' || path === '/dashboard') {
    next('/login')
    return
  }
  next({ path: '/login', query: { redirect: path } })
}

export default router
