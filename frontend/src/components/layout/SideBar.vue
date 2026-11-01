<template>
  <aside class="sidebar" :class="{ collapsed: uiStore.sidebarCollapsed, 'mobile-open': uiStore.mobileSidebarOpen }">
    <nav class="sidebar-nav">
      <!-- Overview -->
      <div class="nav-group">
        <div v-if="!uiStore.sidebarCollapsed" class="nav-group-label">{{ t('nav.overview') }}</div>
        <div v-for="item in navItems.slice(0, 1)" :key="item.name" class="nav-item-wrapper">
          <RouterLink
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
            :title="uiStore.sidebarCollapsed ? item.label : ''"
            :aria-label="item.label"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon">
              <component :is="item.icon" />
            </el-icon>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </div>

      <!-- Manage -->
      <div class="nav-group">
        <div v-if="!uiStore.sidebarCollapsed" class="nav-group-label">{{ t('nav.manage') }}</div>
        <div v-for="item in navItems.slice(1)" :key="item.name" class="nav-item-wrapper">
          <RouterLink
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
            :title="uiStore.sidebarCollapsed ? item.label : ''"
            :aria-label="item.label"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon">
              <component :is="item.icon" />
            </el-icon>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </div>

      <!-- Activity -->
      <div class="nav-group">
        <div v-if="!uiStore.sidebarCollapsed" class="nav-group-label">{{ t('nav.activity') }}</div>
        <div v-for="item in activityItems" :key="item.name" class="nav-item-wrapper">
          <RouterLink
            :to="item.path"
            class="nav-item"
            :class="{ active: isActive(item.path) }"
            :title="uiStore.sidebarCollapsed ? item.label : ''"
            :aria-label="item.label"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon">
              <component :is="item.icon" />
            </el-icon>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </div>

      <!-- Admin -->
      <div v-if="authStore.hasAnyPermission('admin.users', 'admin.roles', 'admin.settings', 'admin.webhooks', 'admin.integrations', 'admin.notification_rules', 'admin.audit', 'admin.encryption', 'admin.tags', 'assessments.manage', 'platform_keys.rotate')" class="nav-group">
        <div v-if="!uiStore.sidebarCollapsed" class="nav-group-label">{{ t('nav.admin') }}</div>
        <div
          v-if="authStore.hasAnyPermission('admin.users', 'admin.roles', 'assessments.manage')"
          class="nav-item-wrapper"
        >
          <RouterLink
            to="/admin/user-management"
            class="nav-item"
            :class="{ active: isActive('/admin/user-management') }"
            :title="uiStore.sidebarCollapsed ? t('nav.userManagement') : ''"
            :aria-label="t('nav.userManagement')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><UserFilled /></el-icon>
            <span class="nav-label">{{ t('nav.userManagement') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('admin.tags')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/tags"
            class="nav-item"
            :class="{ active: isActive('/admin/tags') }"
            :title="uiStore.sidebarCollapsed ? t('nav.tagsAdmin') : ''"
            :aria-label="t('nav.tagsAdmin')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><CollectionTag /></el-icon>
            <span class="nav-label">{{ t('nav.tagsAdmin') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasAnyPermission('assessments.manage', 'evidence.delete', 'claims.edit')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/trash"
            class="nav-item"
            :class="{ active: isActive('/admin/trash') }"
            :title="uiStore.sidebarCollapsed ? t('nav.trash') : ''"
            :aria-label="t('nav.trash')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><Delete /></el-icon>
            <span class="nav-label">{{ t('nav.trash') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('admin.integrations')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/integrations"
            class="nav-item"
            :class="{ active: isActive('/admin/integrations') }"
            :title="uiStore.sidebarCollapsed ? t('nav.integrations') : ''"
            :aria-label="t('nav.integrations')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><Setting /></el-icon>
            <span class="nav-label">{{ t('nav.integrations') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('admin.notification_rules')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/notification-rules"
            class="nav-item"
            :class="{ active: isActive('/admin/notification-rules') }"
            :title="uiStore.sidebarCollapsed ? t('nav.notificationRules') : ''"
            :aria-label="t('nav.notificationRules')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><Bell /></el-icon>
            <span class="nav-label">{{ t('nav.notificationRules') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('admin.encryption')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/encryption"
            class="nav-item"
            :class="{ active: isActive('/admin/encryption') }"
            :title="uiStore.sidebarCollapsed ? t('nav.encryption') : ''"
            :aria-label="t('nav.encryption')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><Lock /></el-icon>
            <span class="nav-label">{{ t('nav.encryption') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('platform_keys.rotate')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/platform-keys"
            class="nav-item"
            :class="{ active: isActive('/admin/platform-keys') }"
            :title="uiStore.sidebarCollapsed ? t('nav.platformKeys') : ''"
            :aria-label="t('nav.platformKeys')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><Key /></el-icon>
            <span class="nav-label">{{ t('nav.platformKeys') }}</span>
          </RouterLink>
        </div>

        <div v-if="authStore.hasPermission('admin.audit')" class="nav-item-wrapper">
          <RouterLink
            to="/admin/audit"
            class="nav-item"
            :class="{ active: isActive('/admin/audit') }"
            :title="uiStore.sidebarCollapsed ? t('nav.audit') : ''"
            :aria-label="t('nav.audit')"
            @click="closeMobileMenu"
          >
            <el-icon class="nav-icon"><List /></el-icon>
            <span class="nav-label">{{ t('nav.audit') }}</span>
          </RouterLink>
        </div>
      </div>

    </nav>

    <button class="sidebar-toggle" @click="uiStore.toggleSidebar()" :aria-label="uiStore.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'">
      <el-icon><DArrowLeft v-if="!uiStore.sidebarCollapsed" /><DArrowRight v-else /></el-icon>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import {
  Odometer,
  OfficeBuilding,
  FolderOpened,
  Document,
  DocumentChecked,
  Collection,
  CollectionTag,
  Delete,
  List,
  Lock,
  Key,
  Stamp,
  Bell,
  UserFilled,
  Setting,
  DArrowLeft,
  DArrowRight,
  FirstAidKit,
  Memo,
  Calendar,
} from '@element-plus/icons-vue'

const route = useRoute()
const { t } = useI18n()
const authStore = useAuthStore()
const uiStore = useUIStore()

interface NavItem {
  name: string
  label: string
  path: string
  icon: Record<string, unknown>
  badge?: string | number
  /** Permission the page's list endpoint requires; hidden without it. */
  permission?: string
}

const visible = (items: NavItem[]) =>
  items.filter((item) => !item.permission || authStore.hasPermission(item.permission))

const navItems = computed<NavItem[]>(() => visible([
  { name: 'dashboard', label: t('nav.dashboard'), path: '/dashboard', icon: Odometer },
  { name: 'entities', label: t('nav.entities', 'Entities'), path: '/entities', icon: OfficeBuilding, permission: 'entities.view' },
  { name: 'projects', label: t('nav.projects'), path: '/projects', icon: FolderOpened, permission: 'projects.view' },
  { name: 'schedule', label: 'Schedule', path: '/schedule', icon: Calendar, permission: 'assessments.view' },
  { name: 'standards', label: t('nav.standards'), path: '/standards', icon: Document },
]))

// Activity: primary workflow items
const activityItems = computed<NavItem[]>(() => visible([
  { name: 'assessments', label: t('nav.assessments'), path: '/assessments', icon: DocumentChecked, permission: 'assessments.view' },
  { name: 'evidence', label: t('nav.evidence'), path: '/evidence', icon: Collection, permission: 'evidence.view' },
  { name: 'mitigations', label: 'Mitigations', path: '/mitigations', icon: FirstAidKit, permission: 'claims.view' },
  { name: 'claims', label: 'Claims', path: '/claims', icon: Memo, permission: 'claims.view' },
  { name: 'attestations', label: t('nav.attestations'), path: '/attestations', icon: Stamp, permission: 'attestations.view' },
]))

const isActive = (path: string) => {
  return route.path.startsWith(path)
}

const closeMobileMenu = () => {
  if (uiStore.mobileSidebarOpen) {
    uiStore.closeMobileSidebar()
  }
}
</script>

<style scoped lang="scss">
@use "@/assets/styles/mixins" as mixins;

.sidebar {
  position: fixed;
  left: 0;
  top: var(--cat-topbar-height);
  width: var(--cat-sidebar-width);
  height: calc(100vh - var(--cat-topbar-height) - var(--cat-statusbar-height));
  background-color: var(--cat-bg-sidebar);
  border-right: 1px solid var(--cat-border-default);
  display: flex;
  flex-direction: column;
  transition: width 200ms ease;
  overflow: hidden;
  z-index: var(--cat-z-sticky);

  &.collapsed {
    width: var(--cat-sidebar-collapsed);

    .nav-label,
    .nav-badge {
      display: none;
    }

    .nav-item {
      justify-content: center;
      padding-left: 0;
      padding-right: 0;
    }

    .sidebar-toggle {
      justify-content: center;
    }
  }
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--cat-spacing-3) 0;
}

.nav-item-wrapper {
  padding: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  color: var(--cat-text-secondary);
  text-decoration: none;
  position: relative;
  transition: background 200ms ease, color 200ms ease;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
    text-decoration: none;
  }

  &.active {
    background-color: var(--cat-bg-active);
    color: var(--cat-text-primary);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--cat-accent-primary);
    }

    .nav-icon {
      color: var(--cat-accent-primary);
    }

    .nav-label {
      font-weight: var(--cat-font-weight-semibold);
    }
  }
}

.nav-icon {
  flex-shrink: 0;
  font-size: var(--cat-font-size-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 200ms ease;
}

.nav-label {
  flex: 1;
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 200ms ease;
}

.nav-badge {
  flex-shrink: 0;

  :deep(.el-badge__content) {
    background-color: var(--cat-accent-primary);
    color: #ffffff;
    font-size: var(--cat-font-size-2xs);
    padding: 2px 6px;
    border-radius: var(--cat-radius-full);
  }
}

.nav-group {
  &:not(:last-child) {
    border-bottom: 1px solid var(--cat-border-default);
  }
}

.nav-group-label {
  padding: 16px 16px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-tertiary);
}

.nav-divider {
  height: 1px;
  background-color: var(--cat-border-default);
  margin: var(--cat-spacing-3) 0;
}

.sidebar-toggle {
  @include mixins.button-reset;
  padding: var(--cat-spacing-2);
  border-top: 1px solid var(--cat-border-default);
  color: var(--cat-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transition: color 200ms ease;

  &:hover {
    color: var(--cat-text-primary);
  }

  :deep(.el-icon) {
    font-size: var(--cat-font-size-sm);
  }
}
</style>
