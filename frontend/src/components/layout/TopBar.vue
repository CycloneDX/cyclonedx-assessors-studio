<template>
  <header class="top-bar">
    <div class="top-bar-left">
      <button class="hamburger-menu" @click="uiStore.toggleMobileSidebar()" :title="t('topbar.menu')" :aria-label="t('topbar.menu')">
        <el-icon><component :is="uiStore.mobileSidebarOpen ? Close : Menu" /></el-icon>
      </button>

      <div class="logo-section">
        <img :src="logoSrc" alt="CycloneDX" class="logo" />
        <span class="logo-text">Assessors Studio v{{ version }}</span>
      </div>
    </div>

    <div class="top-bar-right">
      <el-popover :visible="showNotifications" @update:visible="showNotifications = $event" trigger="click" placement="bottom" :width="320">
        <template #reference>
          <button class="notification-bell" :title="t('notifications.title')" :aria-label="t('notifications.title')">
            <el-icon><component :is="Bell" /></el-icon>
            <el-badge v-if="notificationCount > 0" :value="notificationCount" :max="99" class="notification-badge" />
          </button>
        </template>
        <div class="notifications-popover">
          <div class="notifications-header">
            <span class="notifications-title">{{ t('notifications.title') }}</span>
            <el-button v-if="notifications.length > 0" link text size="small" @click="handleMarkAllRead">{{ t('notifications.markAllRead') }}</el-button>
          </div>
          <div v-if="notifications.length === 0" class="notifications-empty">
            You're all caught up. Notifications appear here when evidence is submitted for review, approved, or rejected, and when assessments are started or completed.
          </div>
          <div v-else class="notifications-list">
            <div v-for="notif in notifications" :key="notif.id" class="notification-item" @click="handleNotificationClick(notif)">
              <div class="notification-content">
                <div class="notification-title">{{ notif.title }}</div>
                <div class="notification-message">{{ notif.message }}</div>
              </div>
              <div class="notification-time">{{ formatNotificationTime(notif.createdAt) }}</div>
            </div>
          </div>
        </div>
      </el-popover>

      <button class="about-toggle" :title="t('topbar.about')" :aria-label="t('topbar.about')" @click="showAbout = true">
        <el-icon><InfoFilled /></el-icon>
      </button>

      <el-select
        :model-value="uiStore.locale"
        @change="changeLocale"
        class="lang-selector"
        size="small"
        aria-label="Select language"
      >
        <el-option
          v-for="locale in AVAILABLE_LOCALES"
          :key="locale.code"
          :label="locale.nativeName"
          :value="locale.code"
        />
      </el-select>

      <button class="theme-toggle" @click="uiStore.toggleTheme()" :title="uiStore.theme === 'dark' ? t('topbar.lightMode') : t('topbar.darkMode')" :aria-label="uiStore.theme === 'dark' ? t('topbar.lightMode') : t('topbar.darkMode')">
        <el-icon><Sunny v-if="uiStore.theme === 'dark'" /><Moon v-else /></el-icon>
      </button>

      <el-dropdown @command="handleUserCommand" aria-label="User menu" popper-class="user-dropdown-popper">
        <div class="user-menu" role="button" tabindex="0">
          <el-avatar :size="32" :icon="UserFilled"></el-avatar>
          <div class="user-info">
            <div class="user-name">{{ authStore.user?.displayName }}</div>
            <div class="user-role">{{ authStore.user?.role }}</div>
          </div>
          <el-icon><CaretBottom /></el-icon>
        </div>

        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">{{ $t('topbar.profile') }}</el-dropdown-item>
            <el-dropdown-item command="logout" divided>{{ $t('topbar.logout') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <el-dialog v-model="showAbout" :title="t('topbar.about')" width="600px" class="about-dialog">
      <div class="about-content">
        <div class="about-header">
          <img :src="logoSrc" alt="CycloneDX" class="about-logo-img" />
          <div class="about-header-text">
            <span class="about-app-name">Assessors Studio</span>
            <span class="about-version">v{{ version }}</span>
          </div>
        </div>

        <p class="about-description">{{ t('topbar.aboutDescription') }}</p>

        <div class="about-links">
          <div class="about-link-row">
            <span class="about-link-label">{{ t('topbar.website') }}</span>
            <a href="https://assessors.studio" target="_blank" rel="noopener noreferrer" class="about-link-value" aria-label="Website">assessors.studio</a>
          </div>
          <div class="about-link-row">
            <span class="about-link-label">{{ t('topbar.documentation') }}</span>
            <a href="https://docs.assessors.studio" target="_blank" rel="noopener noreferrer" class="about-link-value" aria-label="Documentation">docs.assessors.studio</a>
          </div>
          <div class="about-link-row">
            <span class="about-link-label">{{ t('topbar.source') }}</span>
            <a href="https://github.com/CycloneDX/cyclonedx-assessors-studio" target="_blank" rel="noopener noreferrer" class="about-link-value" aria-label="Open source code on GitHub">github.com/CycloneDX/cyclonedx-assessors-studio</a>
          </div>
          <div class="about-link-row">
            <span class="about-link-label">{{ t('topbar.license') }}</span>
            <span class="about-link-value">Apache-2.0</span>
          </div>
        </div>

        <div class="about-footer">
          &copy; OWASP Foundation. All Rights Reserved.
        </div>
      </div>
    </el-dialog>
  </header>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { useLogo } from '@/composables/useLogo'
import { AVAILABLE_LOCALES, loadLocaleMessages } from '@/i18n'
import { ref, onMounted, onUnmounted } from 'vue'
import { Sunny, Moon, CaretBottom, UserFilled, InfoFilled, Menu, Close, Bell } from '@element-plus/icons-vue'
import client from '@/api/client'
import { version } from '../../../package.json'

const { logoSrc } = useLogo()
const { t } = useI18n()
interface Notification {
  id: string
  title: string
  message: string
  createdAt: string
  link?: string
}

const showAbout = ref(false)
const showNotifications = ref(false)
const notifications = ref<Notification[]>([])
const notificationCount = ref(0)
let notificationPollInterval: ReturnType<typeof setInterval> | null = null

const router = useRouter()
const authStore = useAuthStore()
const uiStore = useUIStore()

const changeLocale = (locale: string) => {
  loadLocaleMessages(locale)
  uiStore.setLocale(locale)
}

const handleUserCommand = (command: string) => {
  if (command === 'logout') {
    authStore.logout()
    router.push('/login')
  } else if (command === 'profile') {
    router.push('/settings')
  }
}

const fetchNotificationCount = async () => {
  try {
    const response = await client.get('/notifications/count')
    notificationCount.value = response.data.count || 0
  } catch (error) {
    console.error('Failed to fetch notification count:', error)
  }
}

const fetchNotifications = async () => {
  try {
    const response = await client.get('/notifications')
    notifications.value = Array.isArray(response.data) ? response.data : response.data.data || []
  } catch (error) {
    console.error('Failed to fetch notifications:', error)
  }
}

const formatNotificationTime = (timestamp: string): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  const locale = document.documentElement.lang || navigator.language || 'en-US'
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

const handleNotificationClick = async (notification: Notification) => {
  try {
    // The API defines PUT /notifications/:id/read and PUT /notifications/read-all;
    // the POST paths used before were 404s.
    await client.put(`/notifications/${encodeURIComponent(String(notification.id))}/read`)
    if (notification.link) {
      router.push(notification.link)
    }
    showNotifications.value = false
    await fetchNotifications()
    await fetchNotificationCount()
  } catch (error) {
    console.error('Failed to mark notification as read:', error)
  }
}

const handleMarkAllRead = async () => {
  try {
    await client.put('/notifications/read-all')
    await fetchNotifications()
    await fetchNotificationCount()
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error)
  }
}

onMounted(() => {
  fetchNotificationCount()
  fetchNotifications()
  notificationPollInterval = setInterval(() => {
    fetchNotificationCount()
  }, 60000)
})

onUnmounted(() => {
  if (notificationPollInterval) {
    clearInterval(notificationPollInterval)
  }
})
</script>

<style scoped lang="scss">
@use "@/assets/styles/mixins" as mixins;

.top-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--cat-topbar-height);
  background-color: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--cat-spacing-4);
  z-index: var(--cat-z-fixed);
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
}

.logo-section {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  color: var(--cat-brand-secondary);
}

.logo {
  height: 20px;
  width: auto;
}

.logo-text {
  font-size: var(--cat-font-size-lg);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-4);
}

.theme-toggle {
  @include mixins.button-reset;
  width: 32px;
  height: 32px;
  @include mixins.flex-center;
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-secondary);
  transition: all var(--cat-transition-base) ease;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
  }
}

.user-menu {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  cursor: pointer;
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  border-radius: var(--cat-radius-md);
  transition: background-color var(--cat-transition-base) ease;

  &:hover {
    background-color: var(--cat-bg-hover);
  }
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-name {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

.user-role {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  text-transform: capitalize;
}


.about-toggle {
  @include mixins.button-reset;
  width: 32px;
  height: 32px;
  @include mixins.flex-center;
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-secondary);
  transition: all var(--cat-transition-base) ease;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
  }
}

.about-content {
  text-align: center;
}

.about-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--cat-border-default);
}

.about-logo-img {
  height: 36px;
  width: auto;
}

.about-header-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.about-app-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--cat-text-primary);
}

.about-version {
  font-size: 13px;
  color: var(--cat-text-tertiary);
}

.about-description {
  font-size: 14px;
  color: var(--cat-text-secondary);
  line-height: 1.6;
  margin: 0 0 20px;
  text-align: left;
}

.about-links {
  text-align: left;
  margin-bottom: 20px;
}

.about-link-row {
  display: flex;
  gap: 16px;
  padding: 8px 0;
}

.about-link-label {
  width: 100px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-secondary);
}

.about-link-value {
  font-size: 13px;
  color: var(--cat-brand-secondary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.about-footer {
  padding-top: 16px;
  border-top: 1px solid var(--cat-border-default);
  font-size: 12px;
  color: var(--cat-text-tertiary);
}

.hamburger-menu {
  @include mixins.button-reset;
  width: 32px;
  height: 32px;
  @include mixins.flex-center;
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-secondary);
  transition: all var(--cat-transition-base) ease;
  display: none;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
  }

  :deep(.el-icon) {
    font-size: var(--cat-font-size-lg);
  }
}

.notification-bell {
  @include mixins.button-reset;
  width: 32px;
  height: 32px;
  @include mixins.flex-center;
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-secondary);
  transition: all var(--cat-transition-base) ease;
  position: relative;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
  }
}

.notification-badge {
  :deep(.el-badge__content) {
    background-color: #ef4444;
  }
}

.notifications-popover {
  max-width: 100%;
  padding: 0;
}

.notifications-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--cat-spacing-3);
  border-bottom: 1px solid var(--cat-border-default);
}

.notifications-title {
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

.notifications-empty {
  padding: var(--cat-spacing-4);
  text-align: center;
  color: var(--cat-text-secondary);
  font-size: var(--cat-font-size-sm);
}

.notifications-list {
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.notification-item {
  padding: var(--cat-spacing-3);
  border-bottom: 1px solid var(--cat-border-muted);
  cursor: pointer;
  transition: background-color var(--cat-transition-base) ease;
  display: flex;
  justify-content: space-between;
  gap: var(--cat-spacing-2);

  &:hover {
    background-color: var(--cat-bg-hover);
  }

  &:last-child {
    border-bottom: none;
  }
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-title {
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
  font-size: var(--cat-font-size-sm);
  margin-bottom: var(--cat-spacing-1);
}

.notification-message {
  color: var(--cat-text-secondary);
  font-size: var(--cat-font-size-xs);
  line-height: 1.4;
}

.notification-time {
  flex-shrink: 0;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-xs);
  white-space: nowrap;
}

.lang-selector {
  width: 120px;

  :deep(.el-input__wrapper) {
    background-color: var(--cat-bg-elevated);
    border-color: var(--cat-border-default);
    padding: var(--cat-spacing-1) var(--cat-spacing-2);
  }

  :deep(.el-input__inner) {
    color: var(--cat-text-primary);
    font-size: var(--cat-font-size-sm);
  }

  :deep(.el-icon) {
    color: var(--cat-text-secondary);
  }

  &:hover :deep(.el-input__wrapper) {
    background-color: var(--cat-bg-hover);
  }
}
</style>

