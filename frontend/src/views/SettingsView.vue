<template>
  <div class="settings-container">
    <PageHeader :title="t('settings.title')" />

    <div class="settings-content">
      <!-- Profile Section -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('settings.profileSettings') }}</span>
        </template>

        <el-form :model="profileForm" label-width="150px">
          <el-form-item :label="t('settings.username')">
            <el-input v-model="profileForm.username" disabled></el-input>
          </el-form-item>

          <el-form-item :label="t('settings.email')">
            <el-input v-model="profileForm.email" disabled></el-input>
          </el-form-item>

          <el-form-item :label="t('settings.displayName')">
            <el-input v-model="profileForm.displayName"></el-input>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="savingProfile" @click="handleSaveProfile">{{ t('settings.saveProfile') }}</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- Password Section -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('settings.changePassword') }}</span>
        </template>

        <el-form :model="passwordForm" label-width="150px">
          <el-form-item :label="t('settings.currentPassword')">
            <el-input v-model="passwordForm.currentPassword" type="password" show-password></el-input>
          </el-form-item>

          <el-form-item :label="t('settings.newPassword')">
            <el-input v-model="passwordForm.newPassword" type="password" show-password></el-input>
          </el-form-item>

          <el-form-item :label="t('settings.confirmPassword')">
            <el-input v-model="passwordForm.confirmPassword" type="password" show-password></el-input>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="savingPassword" @click="handleChangePassword">{{ t('settings.updatePassword') }}</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- Preferences Section -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('settings.preferences') }}</span>
        </template>

        <el-form :model="preferences" label-width="150px">
          <el-form-item :label="t('settings.theme')">
            <el-radio-group v-model="preferences.theme">
              <el-radio value="dark">{{ t('settings.dark') }}</el-radio>
              <el-radio value="light">{{ t('settings.light') }}</el-radio>
              <el-radio value="auto">{{ t('settings.auto') }}</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item :label="t('settings.language')">
            <el-select v-model="preferences.language" class="w-200">
              <el-option v-for="locale in AVAILABLE_LOCALES" :key="locale.code" :label="locale.nativeName" :value="locale.code"></el-option>
            </el-select>
          </el-form-item>

          <el-form-item>
            <span class="preferences-auto-save-note">Preferences are applied immediately and saved automatically.</span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- Chat Identities Section -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('settings.chatIdentities.title') }}</span>
        </template>

        <el-form :model="chatIdentities" label-width="150px">
          <el-form-item :label="t('settings.chatIdentities.slackMemberId')">
            <div class="help-input-wrapper">
              <el-input
                v-model="chatIdentities.slackUserId"
                :placeholder="t('settings.chatIdentities.slackMemberIdPlaceholder')"
              />
              <el-popover trigger="hover" :width="280" :content="t('settings.chatIdentities.slackMemberIdHelp')" />
              <el-button link type="info" class="help-button-spacing">?</el-button>
            </div>
          </el-form-item>

          <el-form-item :label="t('settings.chatIdentities.teamUserId')">
            <div class="help-input-wrapper">
              <el-input
                v-model="chatIdentities.teamsUserId"
                :placeholder="t('settings.chatIdentities.teamUserIdPlaceholder')"
              />
              <el-button link type="info" class="help-button-spacing">?</el-button>
            </div>
          </el-form-item>

          <el-form-item :label="t('settings.chatIdentities.mattermostUsername')">
            <div class="help-input-wrapper">
              <el-input
                v-model="chatIdentities.mattermostUsername"
                :placeholder="t('settings.chatIdentities.mattermostUsernamePlaceholder')"
              />
              <el-button link type="info" class="help-button-spacing">?</el-button>
            </div>
          </el-form-item>

          <el-form-item :label="t('settings.chatIdentities.emailNotifications')">
            <el-switch
              v-model="chatIdentities.emailNotificationsEnabled"
              :aria-label="t('settings.chatIdentities.emailNotifications')"
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="savingChatIdentities" @click="handleSaveChatIdentities">{{ t('common.save') }}</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- Notification Rules Section -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('notificationRules.title') }}</span>
        </template>

        <div class="notification-rules-wrapper">
          <!-- Warning banner if Slack DM selected but no Slack ID -->
          <el-alert
            v-if="showSlackWarning"
            :title="t('notificationRules.slackWarning')"
            type="warning"
            :closable="false"
            class="mb-token-4"
          >
            <RouterLink to="/settings">{{ t('notificationRules.configureChatIdentities') }}</RouterLink>
          </el-alert>

          <div class="rules-header">
            <el-button type="primary" size="small" @click="openUserRuleDialog">{{ t('notificationRules.addRule') }}</el-button>
          </div>

          <div v-if="userRulesLoading" class="loading-container">
            <el-icon class="is-loading" :size="20"><Loading /></el-icon>
            <span>{{ t('common.loading') }}</span>
          </div>

          <div v-else-if="userRules.length === 0" class="empty-state-small">
            <p>{{ t('notificationRules.noRules') }}</p>
          </div>

          <el-table v-else :data="userRules" stripe border class="mt-token-3">
            <el-table-column prop="name" :label="t('common.name')" min-width="140" />
            <el-table-column :label="t('notificationRules.channel')" min-width="100">
              <template #default="{ row }">
                <el-tag>{{ t(`notificationRules.channels.${row.channel}`) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('notificationRules.eventTypes')" min-width="150">
              <template #default="{ row }">
                <div class="event-types-cell">
                  <el-tag
                    v-for="eventType in (row.eventTypes || row.event_types || []).slice(0, 2)"
                    :key="eventType"
                    size="small"
                    class="mr-2"
                  >
                    {{ eventType }}
                  </el-tag>
                  <el-tag
                    v-if="(row.eventTypes || row.event_types || []).length > 2"
                    size="small"
                  >
                    +{{ (row.eventTypes || row.event_types || []).length - 2 }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="t('notificationRules.filters')" min-width="120">
              <template #default="{ row }">
                {{ formatUserRuleFilters(row) }}
              </template>
            </el-table-column>
            <el-table-column :label="t('common.status')" min-width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row.enabled"
                  :aria-label="t('common.status')"
                  @change="handleToggleUserRuleEnabled(row)"
                />
              </template>
            </el-table-column>
            <el-table-column :label="t('common.actions')" min-width="140">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openUserRuleDialog(row)">{{ t('common.edit') }}</el-button>
                <el-button link type="danger" size="small" @click="handleDeleteUserRule(row)">{{ t('common.delete') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <!-- My Signatures -->
      <SignaturesCard v-if="canManageSignatures" />

      <!-- API Keys -->
      <ApiKeysCard />

      <!-- Session Management -->
      <el-card class="settings-card">
        <template #header>
          <span>{{ t('settings.sessionManagement') }}</span>
        </template>

        <div class="session-info">
          <p>{{ t('settings.currentSession') }}</p>
          <el-descriptions :column="2" border>
            <el-descriptions-item :label="t('settings.loginTime')">{{ sessionInfo.loginTime || t('common.na') }}</el-descriptions-item>
            <el-descriptions-item :label="t('settings.ipAddress')">{{ sessionInfo.ipAddress || t('common.na') }}</el-descriptions-item>
            <el-descriptions-item :label="t('settings.browser')">{{ sessionInfo.browser || t('common.na') }}</el-descriptions-item>
            <el-descriptions-item :label="t('common.status')">{{ t('common.active') }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <el-button type="danger" class="mt-token-4" @click="handleLogoutAll">{{ t('settings.logoutAllSessions') }}</el-button>
      </el-card>
    </div>

    <!-- User Notification Rule Dialog -->
    <el-dialog
      v-model="showUserRuleDialog"
      :title="editingUserRuleId ? t('notificationRules.editRule') : t('notificationRules.createRule')"
      width="650px"
      @close="editingUserRuleId = null"
    >
      <el-form :model="userRuleForm" label-width="140px">
        <!-- Rule Name -->
        <el-form-item :label="t('common.name')" required>
          <el-input
            v-model="userRuleForm.name"
            :placeholder="t('notificationRules.namePlaceholder')"
          />
        </el-form-item>

        <!-- Channel -->
        <el-form-item :label="t('notificationRules.channel')" required>
          <el-select v-model="userRuleForm.channel">
            <el-option label="In App" value="in-app" />
            <el-option label="Email" value="email" />
            <el-option label="Slack DM" value="slack-dm" />
            <el-option label="Teams DM" value="teams-dm" />
            <el-option label="Mattermost DM" value="mattermost-dm" />
          </el-select>
        </el-form-item>

        <!-- Event Types -->
        <el-form-item :label="t('notificationRules.eventTypes')" required>
          <el-select v-model="userRuleForm.eventTypes" multiple placeholder="Select event types">
            <el-option-group
              v-for="(eventTypeGroup, category) in userRuleEventTypes"
              :key="category"
              :label="category"
            >
              <el-option
                v-for="eventType in eventTypeGroup"
                :key="eventType"
                :label="eventType"
                :value="eventType"
              />
            </el-option-group>
          </el-select>
        </el-form-item>

        <!-- Content Filters -->
        <el-form-item :label="t('notificationRules.filterMyContent')">
          <div class="filter-toggles">
            <el-checkbox v-model="userRuleForm.onlyMyAssessments">{{ t('notificationRules.onlyMyAssessments') }}</el-checkbox>
            <el-checkbox v-model="userRuleForm.onlyMyEvidence">{{ t('notificationRules.onlyMyEvidence') }}</el-checkbox>
            <el-checkbox v-model="userRuleForm.onlyMyProjects">{{ t('notificationRules.onlyMyProjects') }}</el-checkbox>
          </div>
        </el-form-item>

        <!-- Scope Filters -->
        <el-form-item :label="t('notificationRules.filters')">
          <div class="filters-section">
            <el-form-item :label="t('notificationRules.filterProject')">
              <SearchSelect
                v-model="userRuleForm.filterProjectId"
                :options="projectOptionsUserRule"
                :placeholder="t('notificationRules.selectProject')"
                :loading="projectsLoadingUserRule"
              />
            </el-form-item>

            <el-form-item :label="t('notificationRules.filterStandard')">
              <SearchSelect
                v-model="userRuleForm.filterStandardId"
                :options="standardOptionsUserRule"
                :placeholder="t('notificationRules.selectStandard')"
                :loading="standardsLoadingUserRule"
              />
            </el-form-item>

            <el-form-item :label="t('notificationRules.filterAssessment')">
              <SearchSelect
                v-model="userRuleForm.filterAssessmentId"
                :options="assessmentOptionsUserRule"
                :placeholder="t('notificationRules.selectAssessment')"
                :loading="assessmentsLoadingUserRule"
              />
            </el-form-item>
          </div>
        </el-form-item>

        <!-- Enabled -->
        <el-form-item :label="t('notificationRules.enabled')">
          <el-switch
            v-model="userRuleForm.enabled"
            :aria-label="t('notificationRules.enabled')"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showUserRuleDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="savingUserRule" @click="handleSaveUserRule">{{ t('common.save') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useUIStore } from '@/stores/ui'
import { usePasswordPolicyStore } from '@/stores/passwordPolicy'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import client from '@/api/client'
import { AVAILABLE_LOCALES, loadLocaleMessages } from '@/i18n'
import PageHeader from '@/components/shared/PageHeader.vue'
import SearchSelect from '@/components/shared/SearchSelect.vue'
import type { SelectOption } from '@/components/shared/SearchSelect.vue'
import ApiKeysCard from '@/components/shared/ApiKeysCard.vue'
import SignaturesCard from '@/components/shared/SignaturesCard.vue'

const { t } = useI18n()
const router = useRouter()

const authStore = useAuthStore()

const canManageSignatures = computed(() => authStore.hasPermission('signatures.manage'))
const uiStore = useUIStore()
// Password policy store drives the minimum length check and error
// copy in the change password flow. Fetched on mount so the UI
// side gate matches the server side enforcement.
const passwordPolicy = usePasswordPolicyStore()

const profileForm = ref({
  username: authStore.user?.username || '',
  email: authStore.user?.email || '',
  displayName: authStore.user?.displayName || ''
})

const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const savingPassword = ref(false)
const savingProfile = ref(false)

const preferences = ref({
  theme: uiStore.theme,
  language: uiStore.locale
})

const sessionInfo = ref({
  loginTime: authStore.user?.lastLogin
    ? new Date(authStore.user.lastLogin).toLocaleString()
    : null,
  ipAddress: null as string | null,
  browser: navigator.userAgent.includes('Chrome')
    ? `Chrome ${navigator.userAgent.match(/Chrome\/(\d+\.\d+)/)?.[1] || ''}`
    : navigator.userAgent.includes('Firefox')
      ? `Firefox ${navigator.userAgent.match(/Firefox\/(\d+\.\d+)/)?.[1] || ''}`
      : navigator.userAgent.includes('Safari')
        ? `Safari ${navigator.userAgent.match(/Version\/(\d+\.\d+)/)?.[1] || ''}`
        : 'Unknown',
})

// Apply theme changes immediately
watch(() => preferences.value.theme, (newTheme) => {
  if (newTheme === 'auto') {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    uiStore.setTheme(systemDark ? 'dark' : 'light')
  } else if (newTheme === 'dark' || newTheme === 'light') {
    uiStore.setTheme(newTheme)
  }
})

// Apply language changes immediately
watch(() => preferences.value.language, (newLocale) => {
  loadLocaleMessages(newLocale)
  uiStore.setLocale(newLocale)
})

const handleSaveProfile = async () => {
  savingProfile.value = true
  try {
    await client.put('/auth/profile', {
      displayName: profileForm.value.displayName
    })
    ElMessage.success('Profile updated successfully')
    if (authStore.user) {
      authStore.user.displayName = profileForm.value.displayName
    }
  } catch (error: unknown) {
    const e = error as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to update profile')
  } finally {
    savingProfile.value = false
  }
}

const handleChangePassword = async () => {
  if (!passwordForm.value.currentPassword) {
    ElMessage.error(t('settings.currentPasswordRequired'))
    return
  }
  if (!passwordForm.value.newPassword) {
    ElMessage.error(t('settings.currentPasswordRequired'))
    return
  }
  if (passwordForm.value.newPassword.length < passwordPolicy.minLength) {
    ElMessage.error(t('settings.passwordTooShort', passwordPolicy.i18nParams))
    return
  }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    ElMessage.error(t('settings.passwordMismatch'))
    return
  }

  savingPassword.value = true
  try {
    await client.put('/auth/change-password', {
      currentPassword: passwordForm.value.currentPassword,
      newPassword: passwordForm.value.newPassword
    })
    ElMessage.success(t('settings.passwordChanged'))
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  } catch (error: unknown) {
    const e = error as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to change password')
  } finally {
    savingPassword.value = false
  }
}

// Chat Identities
const savingChatIdentities = ref(false)
const chatIdentities = ref({
  slackUserId: '',
  teamsUserId: '',
  mattermostUsername: '',
  emailNotificationsEnabled: true
})

const handleSaveChatIdentities = async () => {
  savingChatIdentities.value = true
  try {
    await client.patch('/auth/profile/chat-identities', {
      slackUserId: chatIdentities.value.slackUserId || null,
      teamsUserId: chatIdentities.value.teamsUserId || null,
      mattermostUsername: chatIdentities.value.mattermostUsername || null,
      emailNotificationsEnabled: chatIdentities.value.emailNotificationsEnabled
    })
    ElMessage.success(t('settings.chatIdentities.saved'))
  } catch (error: unknown) {
    const e = error as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to save chat identities')
  } finally {
    savingChatIdentities.value = false
  }
}

// User Notification Rules
interface UserNotificationRule {
  id: string
  name: string
  channel: string
  eventTypes?: string[]
  event_types?: string[]
  onlyMyAssessments?: boolean
  only_my_assessments?: boolean
  onlyMyEvidence?: boolean
  only_my_evidence?: boolean
  onlyMyProjects?: boolean
  only_my_projects?: boolean
  filterProjectId?: string
  filter_project_id?: string
  filterStandardId?: string
  filter_standard_id?: string
  filterAssessmentId?: string
  filter_assessment_id?: string
  enabled: boolean
}

const userRules = ref<UserNotificationRule[]>([])
const userRulesLoading = ref(false)
const showUserRuleDialog = ref(false)
const editingUserRuleId = ref<string | null>(null)
const savingUserRule = ref(false)

const userRuleForm = ref({
  name: '',
  channel: 'in-app',
  eventTypes: [] as string[],
  onlyMyAssessments: false,
  onlyMyEvidence: false,
  onlyMyProjects: false,
  filterProjectId: '',
  filterStandardId: '',
  filterAssessmentId: '',
  enabled: true
})

const userRuleEventTypes = ref({
  'Assessment': ['assessment.created', 'assessment.state_changed', 'assessment.deleted', 'assessment.assigned'],
  'Evidence': ['evidence.created', 'evidence.state_changed', 'evidence.attachment_added', 'evidence.attachment_removed'],
  'Claim': ['claim.created', 'claim.updated'],
  'Attestation': ['attestation.created', 'attestation.signed', 'attestation.exported'],
  'Project': ['project.created', 'project.state_changed', 'project.archived'],
  'Standard': ['standard.imported', 'standard.state_changed'],
  'System': ['user.created', 'user.deactivated', 'apikey.created']
})

const projectOptionsUserRule = ref<SelectOption[]>([])
const projectsLoadingUserRule = ref(false)

const standardOptionsUserRule = ref<SelectOption[]>([])
const standardsLoadingUserRule = ref(false)

const assessmentOptionsUserRule = ref<SelectOption[]>([])
const assessmentsLoadingUserRule = ref(false)

const showSlackWarning = computed(() => {
  return userRuleForm.value.channel === 'slack-dm' && !chatIdentities.value.slackUserId
})

const fetchUserRules = async () => {
  userRulesLoading.value = true
  try {
    const { data } = await client.get('/notification-rules')
    userRules.value = data.rules || data
  } catch (err: unknown) {
    ElMessage.error('Failed to load notification rules')
  } finally {
    userRulesLoading.value = false
  }
}

const fetchProjectOptionsUserRule = async () => {
  projectsLoadingUserRule.value = true
  try {
    const { data } = await client.get('/projects', {
      params: { limit: 100 }
    })
    projectOptionsUserRule.value = (data.data || []).map((project: Record<string, unknown>) => ({
      value: project.id as string,
      label: project.name as string
    }))
  } catch (err: unknown) {
    ElMessage.error('Failed to load projects')
  } finally {
    projectsLoadingUserRule.value = false
  }
}

const fetchStandardOptionsUserRule = async () => {
  standardsLoadingUserRule.value = true
  try {
    const { data } = await client.get('/standards', {
      params: { limit: 100 }
    })
    standardOptionsUserRule.value = (data.data || []).map((standard: Record<string, unknown>) => ({
      value: standard.id as string,
      label: standard.name as string
    }))
  } catch (err: unknown) {
    ElMessage.error('Failed to load standards')
  } finally {
    standardsLoadingUserRule.value = false
  }
}

const fetchAssessmentOptionsUserRule = async () => {
  assessmentsLoadingUserRule.value = true
  try {
    const { data } = await client.get('/assessments', {
      params: { limit: 100 }
    })
    assessmentOptionsUserRule.value = (data.data || []).map((assessment: Record<string, unknown>) => ({
      value: assessment.id as string,
      label: (assessment.name || assessment.title) as string
    }))
  } catch (err: unknown) {
    ElMessage.error('Failed to load assessments')
  } finally {
    assessmentsLoadingUserRule.value = false
  }
}

const openUserRuleDialog = (rule?: UserNotificationRule) => {
  if (rule) {
    editingUserRuleId.value = rule.id
    userRuleForm.value = {
      name: rule.name,
      channel: rule.channel,
      eventTypes: rule.eventTypes || rule.event_types || [],
      onlyMyAssessments: rule.onlyMyAssessments || rule.only_my_assessments || false,
      onlyMyEvidence: rule.onlyMyEvidence || rule.only_my_evidence || false,
      onlyMyProjects: rule.onlyMyProjects || rule.only_my_projects || false,
      filterProjectId: rule.filterProjectId || rule.filter_project_id || '',
      filterStandardId: rule.filterStandardId || rule.filter_standard_id || '',
      filterAssessmentId: rule.filterAssessmentId || rule.filter_assessment_id || '',
      enabled: rule.enabled
    }
  } else {
    editingUserRuleId.value = null
    userRuleForm.value = {
      name: '',
      channel: 'in-app',
      eventTypes: [],
      onlyMyAssessments: false,
      onlyMyEvidence: false,
      onlyMyProjects: false,
      filterProjectId: '',
      filterStandardId: '',
      filterAssessmentId: '',
      enabled: true
    }
  }
  fetchProjectOptionsUserRule()
  fetchStandardOptionsUserRule()
  fetchAssessmentOptionsUserRule()
  showUserRuleDialog.value = true
}

const handleSaveUserRule = async () => {
  if (!userRuleForm.value.name || !userRuleForm.value.channel || userRuleForm.value.eventTypes.length === 0) {
    ElMessage.error('Please fill in all required fields')
    return
  }

  savingUserRule.value = true
  try {
    const payload = {
      name: userRuleForm.value.name,
      channel: userRuleForm.value.channel,
      eventTypes: userRuleForm.value.eventTypes,
      onlyMyAssessments: userRuleForm.value.onlyMyAssessments,
      onlyMyEvidence: userRuleForm.value.onlyMyEvidence,
      onlyMyProjects: userRuleForm.value.onlyMyProjects,
      filterProjectId: userRuleForm.value.filterProjectId || null,
      filterStandardId: userRuleForm.value.filterStandardId || null,
      filterAssessmentId: userRuleForm.value.filterAssessmentId || null,
      enabled: userRuleForm.value.enabled
    }

    if (editingUserRuleId.value) {
      await client.put(`/notification-rules/${editingUserRuleId.value}`, payload)
      ElMessage.success('Rule updated successfully')
    } else {
      await client.post('/notification-rules', payload)
      ElMessage.success('Rule created successfully')
    }

    showUserRuleDialog.value = false
    await fetchUserRules()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to save rule')
  } finally {
    savingUserRule.value = false
  }
}

const handleToggleUserRuleEnabled = async (rule: UserNotificationRule) => {
  try {
    await client.patch(`/notification-rules/${rule.id}`, {
      enabled: rule.enabled
    })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to update rule')
    rule.enabled = !rule.enabled
  }
}

const handleDeleteUserRule = async (rule: UserNotificationRule) => {
  try {
    await ElMessageBox.confirm(
      t('common.confirmDelete'),
      t('common.delete'),
      { confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel'), type: 'warning' }
    )
    await client.delete(`/notification-rules/${rule.id}`)
    ElMessage.success('Rule deleted successfully')
    await fetchUserRules()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    if (err !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to delete rule')
    }
  }
}

const formatUserRuleFilters = (rule: UserNotificationRule): string => {
  const filters: string[] = []
  if (rule.onlyMyAssessments || rule.only_my_assessments) filters.push('My assessments')
  if (rule.onlyMyEvidence || rule.only_my_evidence) filters.push('My evidence')
  if (rule.onlyMyProjects || rule.only_my_projects) filters.push('My projects')
  if (rule.filterProjectId || rule.filter_project_id) filters.push('Project')
  if (rule.filterStandardId || rule.filter_standard_id) filters.push('Standard')
  if (rule.filterAssessmentId || rule.filter_assessment_id) filters.push('Assessment')
  return filters.length > 0 ? filters.join(', ') : 'None'
}

const handleLogoutAll = async () => {
  try {
    await ElMessageBox.confirm(
      'This will log you out of all devices. You will need to sign in again.',
      'Logout All Sessions',
      { confirmButtonText: 'Logout All', cancelButtonText: 'Cancel', type: 'warning' }
    )
    await client.post('/auth/logout-all')
    ElMessage.success('All sessions logged out')
    authStore.logout()
    router.push('/login')
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error('Failed to logout all sessions')
    }
  }
}

onMounted(async () => {
  await fetchUserRules()
  // Kick off the policy fetch without awaiting so rule loading is
  // not blocked on it. The store keeps its fallback values in
  // place on failure, and the server is authoritative at submit.
  void passwordPolicy.fetchPolicy()
})
</script>

<style scoped lang="scss">
.settings-container {
  padding: 0;
}

.settings-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
  max-width: 720px;
}

.settings-card {
  width: 100%;
}

.session-info {
  margin-bottom: var(--cat-spacing-4);

  p {
    margin: 0 0 var(--cat-spacing-3) 0;
    font-weight: var(--cat-font-weight-medium);
    color: var(--cat-text-primary);
  }
}

:deep(.el-form-item) {
  margin-bottom: var(--cat-spacing-4);

  &:last-of-type {
    margin-bottom: 0;
  }
}

:deep(.el-descriptions) {
  margin: var(--cat-spacing-3) 0;
}

.preferences-auto-save-note {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-tertiary);
  font-style: italic;
}

.help-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  width: 100%;

  :deep(.el-input) {
    flex: 1;
  }
}

.notification-rules-wrapper {
  width: 100%;
}

.rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--cat-spacing-4);
}

.loading-container {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-4);
  color: var(--cat-text-secondary);
}

.empty-state-small {
  padding: var(--cat-spacing-4);
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-sm);

  p {
    margin: 0;
  }
}

.event-types-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filter-toggles {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);

  :deep(.el-checkbox) {
    margin: 0;
  }
}

.filters-section {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
  width: 100%;

  :deep(.el-form-item) {
    margin-bottom: 0;
  }

  :deep(.search-select) {
    width: 100%;
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--cat-spacing-2);
}

.help-button-spacing {
  margin-left: var(--cat-spacing-2);
}
</style>
