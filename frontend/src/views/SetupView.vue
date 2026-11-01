<template>
  <div class="setup-container">
    <div class="setup-card">
      <!-- Step indicator -->
      <div class="setup-steps">
        <div
          v-for="(_s, i) in steps"
          :key="i"
          class="step-dot"
          :class="{ active: i === step, completed: i < step }"
        />
      </div>

      <!-- Step 0: Welcome -->
      <div v-if="step === 0" class="setup-step">
        <div class="setup-header">
          <div class="setup-logo">
            <img :src="logoSrc" alt="CycloneDX" class="setup-logo-img" />
          </div>
          <h1 class="setup-title">Welcome to Assessors Studio</h1>
          <p class="setup-description">
            {{ t('setup.welcomeDescription') }}
          </p>
        </div>
        <el-button type="primary" size="large" class="setup-action" @click="step = 1">
          {{ t('setup.getStarted') }}
        </el-button>
      </div>

      <!-- Step 1: Account details -->
      <div v-if="step === 1" class="setup-step">
        <div class="setup-header">
          <h2 class="step-title">{{ t('setup.createAdmin') }}</h2>
          <p class="setup-description">
            {{ t('setup.createAdminDescription') }}
          </p>
        </div>

        <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="setup-form">
          <el-form-item :label="t('setup.setupToken')" prop="setupToken">
            <el-input
              v-model="form.setupToken"
              :placeholder="t('setup.setupTokenPlaceholder')"
              size="large"
              :prefix-icon="LockIcon"
              autocomplete="off"
            />
          </el-form-item>

          <el-form-item :label="t('setup.username')" prop="username">
            <el-input
              ref="usernameInputRef"
              v-model="form.username"
              :placeholder="t('setup.usernamePlaceholder')"
              size="large"
              :prefix-icon="UserIcon"
            />
          </el-form-item>

          <el-form-item :label="t('setup.email')" prop="email">
            <el-input
              v-model="form.email"
              :placeholder="t('setup.emailPlaceholder')"
              size="large"
              :prefix-icon="MessageIcon"
            />
          </el-form-item>

          <el-form-item :label="t('setup.displayName')" prop="displayName">
            <el-input
              v-model="form.displayName"
              :placeholder="t('setup.displayNamePlaceholder')"
              size="large"
            />
          </el-form-item>

          <el-form-item :label="t('setup.password')" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              :placeholder="passwordPlaceholder"
              size="large"
              show-password
              :prefix-icon="LockIcon"
            />
          </el-form-item>

          <el-form-item :label="t('setup.confirmPassword')" prop="confirmPassword">
            <el-input
              v-model="form.confirmPassword"
              type="password"
              :placeholder="t('setup.confirmPasswordPlaceholder')"
              size="large"
              show-password
              :prefix-icon="LockIcon"
              @keydown.enter="submitSetup"
            />
          </el-form-item>
        </el-form>

        <el-alert v-if="error" type="error" :closable="true" show-icon class="setup-error" @close="error = ''">
          {{ error }}
        </el-alert>

        <div class="setup-actions">
          <el-button size="large" @click="step = 0">{{ t('common.back') }}</el-button>
          <el-button type="primary" size="large" :loading="loading" @click="submitSetup">
            {{ t('setup.createAccount') }}
          </el-button>
        </div>
      </div>

      <!-- Step 2: Import Standards -->
      <div v-if="step === 2" class="setup-step">
        <div class="setup-header">
          <h2 class="step-title">{{ t('setup.importStandards') }}</h2>
          <p class="setup-description">
            {{ t('setup.importStandardsDescription') }}
          </p>
        </div>

        <el-alert v-if="feedError" type="error" show-icon :closable="false" class="setup-error">
          {{ feedError }}
        </el-alert>

        <div v-if="feedLoading && feedItems.length === 0" class="standards-loading">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>{{ t('setup.fetchingFeed') }}</span>
        </div>

        <div v-if="feedItems.length > 0" class="standards-list-container">
          <div class="standards-list" ref="standardsListRef">
            <div
              v-for="item in feedItems"
              :key="item.id"
              class="standard-item"
              :class="{ imported: item.status === 'success', failed: item.status === 'error', importing: item.status === 'importing' }"
            >
              <div class="standard-item-icon">
                <el-icon v-if="item.status === 'success'" color="var(--el-color-success)"><CircleCheckFilled /></el-icon>
                <el-icon v-else-if="item.status === 'error'" color="var(--el-color-danger)"><CircleCloseFilled /></el-icon>
                <el-icon v-else-if="item.status === 'importing'" class="is-loading"><Loading /></el-icon>
                <el-icon v-else color="var(--cat-text-tertiary)"><Document /></el-icon>
              </div>
              <div class="standard-item-content">
                <div class="standard-item-title">{{ item.title }}<span v-if="item.version" class="standard-item-version">v{{ item.version }}</span></div>
                <div class="standard-item-meta" v-if="item.status === 'success' && item.requirementCount !== undefined">
                  {{ item.requirementCount }} {{ t('setup.requirementsImported') }}
                </div>
                <div class="standard-item-meta" v-else-if="item.status === 'error'">
                  {{ item.errorMessage || t('setup.importFailed') }}
                </div>
                <div class="standard-item-meta" v-else-if="item.status === 'importing'">
                  {{ t('setup.importing') }}
                </div>
              </div>
              <el-button
                v-if="item.status === 'error'"
                size="small"
                type="primary"
                link
                class="retry-item-btn"
                @click="retryImportItem(item)"
              >
                Retry
              </el-button>
            </div>
          </div>
        </div>

        <div v-if="importComplete" class="import-summary">
          <span class="import-summary-text">
            {{ t('setup.importSummary', { success: importSuccessCount, total: feedItems.length }) }}
          </span>
        </div>

        <div class="setup-actions">
          <el-button
            v-if="importComplete"
            type="primary"
            size="large"
            @click="step = 3"
          >
            {{ t('common.continue') }}
          </el-button>
          <el-button
            v-else-if="feedError && feedItems.length === 0"
            size="large"
            @click="fetchAndImportStandards"
          >
            {{ t('common.retry') }}
          </el-button>
        </div>
      </div>

      <!-- Step 3: Demo Data -->
      <div v-if="step === 3" class="setup-step">
        <div class="setup-header">
          <h2 class="step-title">Load Demo Data</h2>
          <p class="setup-description">
            Would you like to populate the application with sample data? This includes demo organizations, entities, projects, assessments, evidence, and more. Recommended for evaluation and learning.
          </p>
        </div>

        <el-alert v-if="demoError" type="error" :closable="true" show-icon class="setup-error" @close="demoError = ''">
          {{ demoError }}
        </el-alert>

        <el-alert v-if="demoSuccess" type="success" show-icon :closable="false" class="setup-error">
          Demo data loaded successfully. The application is ready to explore.
        </el-alert>

        <div v-if="!demoSuccess" class="demo-data-options">
          <div class="demo-option" :class="{ selected: demoChoice === 'yes' }" @click="demoChoice = 'yes'">
            <div class="demo-option-radio">
              <div class="radio-outer"><div v-if="demoChoice === 'yes'" class="radio-inner" /></div>
            </div>
            <div class="demo-option-content">
              <div class="demo-option-title">Yes, load demo data</div>
              <div class="demo-option-desc">Includes sample entities, projects, assessments, evidence, claims, and attestations.</div>
            </div>
          </div>
          <div class="demo-option" :class="{ selected: demoChoice === 'no' }" @click="demoChoice = 'no'">
            <div class="demo-option-radio">
              <div class="radio-outer"><div v-if="demoChoice === 'no'" class="radio-inner" /></div>
            </div>
            <div class="demo-option-content">
              <div class="demo-option-title">No, start with a clean slate</div>
              <div class="demo-option-desc">Only the imported standards and your admin account will be present.</div>
            </div>
          </div>
        </div>

        <div class="setup-actions">
          <el-button size="large" @click="step = 2" :disabled="demoLoading">{{ t('common.back') }}</el-button>
          <el-button
            type="primary"
            size="large"
            :loading="demoLoading"
            @click="handleDemoChoice"
          >
            {{ demoSuccess ? t('common.continue') : t('common.continue') }}
          </el-button>
        </div>
      </div>

      <!-- Step 4: Complete -->
      <div v-if="step === 4" class="setup-step">
        <div class="setup-header">
          <div class="success-icon">
            <el-icon :size="48" color="var(--el-color-success)"><CircleCheckFilled /></el-icon>
          </div>
          <h2 class="step-title">{{ t('setup.setupComplete') }}</h2>
          <p class="setup-description">
            {{ t('setup.setupCompleteDescription', { count: importSuccessCount }) }}
          </p>
        </div>

        <el-button type="primary" size="large" class="setup-action" @click="goToDashboard">
          {{ t('setup.goToDashboard') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, watch, onMounted, onUnmounted, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { markSetupDone } from '@/router'
import { useLogo } from '@/composables/useLogo'
import { usePasswordPolicyStore } from '@/stores/passwordPolicy'
import { useAuthStore } from '@/stores/auth'
import apiClient from '@/api/client'
import type { User } from '@/types'
import {
  User as UserIcon,
  Lock as LockIcon,
  Message as MessageIcon,
  CircleCheckFilled,
  CircleCloseFilled,
  Loading,
  Document,
} from '@element-plus/icons-vue'

interface FeedItem {
  id: string
  title: string
  url: string
  version?: string
  summary?: string
  status: 'pending' | 'importing' | 'success' | 'error'
  requirementCount?: number
  errorMessage?: string
}

const { logoSrc } = useLogo()
const { t } = useI18n()

// Password policy is fetched from the server so the placeholder
// copy and the client side length rule reflect the current server
// policy (see PASSWORD_MIN_LENGTH in the backend config). Falls back
// to the documented defaults until the fetch resolves.
const passwordPolicy = usePasswordPolicyStore()
// Populated after the admin is created so the rest of the app sees
// the user as signed in once the wizard finishes.
const authStore = useAuthStore()
const passwordPlaceholder = computed(() =>
  t('setup.passwordPlaceholder', passwordPolicy.i18nParams),
)
const passwordLengthMessage = computed(() =>
  t('setup.validation.passwordLength', passwordPolicy.i18nParams),
)

const router = useRouter()
const formRef = ref<FormInstance>()
const standardsListRef = ref<HTMLElement>()

const usernameInputRef = ref<{ focus: () => void } | null>(null)
const step = ref(0)
const loading = ref(false)
const error = ref('')

const feedLoading = ref(false)
const feedError = ref('')
const feedItems = ref<FeedItem[]>([])
const importComplete = ref(false)
const importSuccessCount = ref(0)

// Default off: demo records are sample data, opt in explicitly.
const demoChoice = ref<'yes' | 'no'>('no')
const demoLoading = ref(false)
const demoError = ref('')
const demoSuccess = ref(false)

const steps = ['Welcome', 'Account', 'Standards', 'Demo Data', 'Complete']

// Auto focus the primary action on each step
const focusStepAction = async () => {
  await nextTick()
  if (step.value === 1 && usernameInputRef.value) {
    usernameInputRef.value.focus()
  }
}

const handleWelcomeKeydown = (e: KeyboardEvent) => {
  if (step.value === 0 && e.key === 'Enter') {
    step.value = 1
  }
}

watch(step, focusStepAction)
onMounted(() => {
  focusStepAction()
  window.addEventListener('keydown', handleWelcomeKeydown)
  // Kick off the policy fetch so the placeholder and Element Plus
  // rule update as soon as possible. Fire and forget: the store
  // leaves its fallback values in place on failure so the form
  // still renders.
  void passwordPolicy.fetchPolicy()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWelcomeKeydown)
})

const form = reactive({
  // One-time token from the server log; proves the person finishing
  // setup controls this server (security review W3).
  setupToken: '',
  username: '',
  email: '',
  displayName: '',
  password: '',
  confirmPassword: '',
})

const validatePasswordMatch = (_rule: Record<string, unknown>, value: string, callback: (error?: Error) => void) => {
  if (value !== form.password) {
    callback(new Error(t('setup.validation.passwordMismatch')))
  } else {
    callback()
  }
}

// Rules are a computed so the password length bounds and error
// message stay in sync with the store once GET /auth/password-policy
// resolves. Element Plus re evaluates validation against whatever
// rules the :rules prop holds at the time of the check, so the form
// always applies the current server policy even if the user opened
// the setup page before the fetch completed.
const rules = computed<FormRules>(() => ({
  setupToken: [
    { required: true, message: t('setup.validation.setupTokenRequired'), trigger: 'blur' },
  ],
  username: [
    { required: true, message: t('setup.validation.usernameRequired'), trigger: 'blur' },
    { min: 3, max: 64, message: t('setup.validation.usernameLength'), trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9._-]+$/, message: t('setup.validation.usernamePattern'), trigger: 'blur' },
  ],
  email: [
    { required: true, message: t('setup.validation.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('setup.validation.emailInvalid'), trigger: 'blur' },
  ],
  displayName: [
    { required: true, message: t('setup.validation.displayNameRequired'), trigger: 'blur' },
  ],
  password: [
    { required: true, message: t('setup.validation.passwordRequired'), trigger: 'blur' },
    {
      min: passwordPolicy.minLength,
      max: passwordPolicy.maxLength,
      message: passwordLengthMessage.value,
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: t('setup.validation.confirmPasswordRequired'), trigger: 'blur' },
    { validator: validatePasswordMatch, trigger: 'blur' },
  ],
}))

const submitSetup = async () => {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  loading.value = true
  error.value = ''

  try {
    // The setup endpoint creates the admin AND issues a session
    // cookie in the same response so the wizard's remaining helper
    // endpoints (standards-feed, import-standard, seed-demo) are
    // reachable after setup flips to complete. Hydrating the auth
    // store here avoids a second round trip to /auth/me to learn
    // what the server already told us.
    const { data } = await apiClient.post<{
      user: User
      permissions?: string[]
    }>('/setup', {
      setupToken: form.setupToken.trim(),
      username: form.username,
      email: form.email,
      displayName: form.displayName,
      password: form.password,
    })
    if (data.user) {
      authStore.setSession(data.user, data.permissions ?? [])
    }
    markSetupDone()
    step.value = 2
    fetchAndImportStandards()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { details?: Array<{ message: string }>; message?: string; error?: string } } }
    const data = e.response?.data
    if (data?.details) {
      error.value = data.details.map((d: { message: string }) => d.message).join('. ')
    } else {
      error.value = data?.message || data?.error || 'Setup failed. Please try again.'
    }
  } finally {
    loading.value = false
  }
}

const fetchAndImportStandards = async () => {
  feedLoading.value = true
  feedError.value = ''
  feedItems.value = []
  importComplete.value = false
  importSuccessCount.value = 0

  try {
    // Fetch the standards feed
    const { data } = await apiClient.get('/setup/standards-feed')
    interface FeedItemData {
      id: string
      title: string
      url?: string
      metadata?: { version?: string }
      summary: string
    }
    const items: FeedItem[] = (data.data || []).map((item: FeedItemData) => ({
      id: item.id,
      title: item.title,
      url: item.url || item.id,
      version: item.metadata?.version || undefined,
      summary: item.summary,
      status: 'pending' as const,
    }))

    feedItems.value = items
    feedLoading.value = false

    // Import each standard sequentially
    for (let i = 0; i < items.length; i++) {
      feedItems.value[i].status = 'importing'

      // Auto scroll to keep the current item visible
      await nextTick()
      scrollToItem(i)

      try {
        const result = await apiClient.post('/setup/import-standard', {
          url: feedItems.value[i].url,
          title: feedItems.value[i].title,
        })

        feedItems.value[i].status = 'success'

        // Sum up requirement counts from all imported standards in the response
        const standards = result.data?.data || []
        const totalReqs = standards.reduce((sum: number, s: Record<string, unknown>) => sum + ((s.requirementCount as number) || 0), 0)
        feedItems.value[i].requirementCount = totalReqs
        importSuccessCount.value++
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } }
        feedItems.value[i].status = 'error'
        feedItems.value[i].errorMessage = e.response?.data?.error || 'Import failed'
      }
    }

    importComplete.value = true
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    feedLoading.value = false
    feedError.value = e.response?.data?.error || t('setup.feedError')
  }
}

const scrollToItem = (index: number) => {
  if (!standardsListRef.value) return
  const items = standardsListRef.value.querySelectorAll('.standard-item')
  if (items[index]) {
    items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

const retryImportItem = async (item: FeedItem) => {
  const index = feedItems.value.findIndex(f => f.id === item.id)
  if (index === -1) return

  feedItems.value[index].status = 'importing'
  feedItems.value[index].errorMessage = undefined

  try {
    const result = await apiClient.post('/setup/import-standard', {
      url: feedItems.value[index].url,
      title: feedItems.value[index].title,
    })

    feedItems.value[index].status = 'success'
    const standards = result.data?.data || []
    const totalReqs = standards.reduce((sum: number, s: Record<string, unknown>) => sum + ((s.requirementCount as number) || 0), 0)
    feedItems.value[index].requirementCount = totalReqs
    importSuccessCount.value++
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    feedItems.value[index].status = 'error'
    feedItems.value[index].errorMessage = e.response?.data?.error || 'Import failed'
  }
}

const handleDemoChoice = async () => {
  if (demoSuccess.value || demoChoice.value === 'no') {
    step.value = 4
    return
  }

  demoLoading.value = true
  demoError.value = ''

  try {
    await apiClient.post('/setup/seed-demo')
    demoSuccess.value = true
    step.value = 4
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    demoError.value = e.response?.data?.error || 'Failed to load demo data. You can skip this step and continue.'
  } finally {
    demoLoading.value = false
  }
}

// The wizard auto-logs the operator in as part of POST /api/v1/setup,
// so once they hit "finish" we send them straight into the app instead
// of bouncing through the login screen.
const goToDashboard = () => {
  router.push('/')
}
</script>

<style scoped lang="scss">
.setup-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  padding: 40px 16px;
  background-color: var(--cat-bg-primary);
}

.setup-card {
  width: 100%;
  max-width: 520px;
  padding: 40px 32px 32px;
  background-color: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.setup-steps {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 32px;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--cat-border-default);
  transition: all 0.2s ease;

  &.active {
    width: 24px;
    border-radius: 4px;
    background-color: var(--cat-brand-primary);
  }

  &.completed {
    background-color: var(--el-color-success);
  }
}

.setup-header {
  text-align: center;
  margin-bottom: 32px;
}

.setup-logo {
  width: 200px;
  margin: 0 auto 16px;
}

.setup-logo-img {
  width: 100%;
  height: auto;
}

.setup-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--cat-text-primary);
  margin: 0 0 8px;
}

.step-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--cat-text-primary);
  margin: 0 0 8px;
}

.setup-description {
  font-size: 14px;
  color: var(--cat-text-secondary);
  margin: 0;
  line-height: 1.5;
}


.setup-form {
  margin-bottom: 8px;

  :deep(.el-form-item__label) {
    font-size: 13px;
    font-weight: 500;
    color: var(--cat-text-secondary);
    padding-bottom: 4px;
  }
}

.setup-error {
  margin-bottom: 16px;
}

.setup-action {
  width: 100%;
  height: 40px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
}

.setup-actions {
  display: flex;
  gap: 12px;

  .el-button {
    flex: 1;
    height: 40px;
    font-size: 14px;
    border-radius: 8px;
  }
}

.success-icon {
  margin-bottom: 16px;
}

// Standards import styles
.standards-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 0;
  color: var(--cat-text-secondary);
  font-size: 14px;
}

.standards-list-container {
  margin-bottom: 20px;
}

.standards-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  background-color: var(--cat-bg-tertiary);

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background-color: var(--cat-border-emphasis);
    border-radius: 3px;
  }
}

.standard-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--cat-border-muted);
  transition: background-color 0.15s ease;

  &:last-child {
    border-bottom: none;
  }

  &.importing {
    background-color: rgba(88, 166, 255, 0.05);
  }

  &.imported {
    background-color: rgba(63, 185, 80, 0.05);
  }

  &.failed {
    background-color: rgba(248, 81, 73, 0.05);
  }
}

.standard-item-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.standard-item-content {
  flex: 1;
  min-width: 0;
}

.standard-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-primary);
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 8px;
}

.standard-item-version {
  font-size: 11px;
  font-weight: 400;
  color: var(--cat-text-tertiary);
  background-color: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.standard-item-meta {
  font-size: 12px;
  color: var(--cat-text-tertiary);
  margin-top: 2px;
}

.import-summary {
  text-align: center;
  margin-bottom: 20px;
}

.import-summary-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--cat-text-secondary);
}

.retry-item-btn {
  flex-shrink: 0;
  margin-left: auto;
}

// Demo data option styles
.demo-data-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.demo-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  background-color: var(--cat-bg-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--cat-border-emphasis);
  }

  &.selected {
    border-color: var(--cat-brand-primary);
    background-color: rgba(47, 129, 247, 0.05);
  }
}

.demo-option-radio {
  flex-shrink: 0;
  margin-top: 2px;
}

.radio-outer {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--cat-border-emphasis);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease;

  .selected & {
    border-color: var(--cat-brand-primary);
  }
}

.radio-inner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--cat-brand-primary);
}

.demo-option-content {
  flex: 1;
}

.demo-option-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--cat-text-primary);
  margin-bottom: 4px;
}

.demo-option-desc {
  font-size: 13px;
  color: var(--cat-text-tertiary);
  line-height: 1.4;
}

.standard-item {
  display: flex;
  align-items: center;
}

.next-steps-guide {
  text-align: left;
  background-color: var(--cat-bg-primary);
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 24px;
}

.next-steps-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--cat-text-primary);
  margin: 0 0 12px;
}

.next-steps-list {
  margin: 0 0 12px;
  padding-left: 20px;
  color: var(--cat-text-secondary);
  font-size: 14px;
  line-height: 1.7;

  li {
    margin-bottom: 4px;
  }

  strong {
    color: var(--cat-text-primary);
  }
}

.next-steps-note {
  margin: 0;
  font-size: 13px;
  color: var(--cat-text-tertiary);
  line-height: 1.5;
}
</style>
