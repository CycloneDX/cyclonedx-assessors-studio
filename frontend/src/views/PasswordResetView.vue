<template>
  <div class="reset-container">
    <div class="reset-card">
      <h1 class="reset-title">{{ isResetMode ? t('passwordReset.resetTitle') : t('passwordReset.forgotTitle') }}</h1>

      <!-- Request a link -->
      <template v-if="!isResetMode">
        <p v-if="requested" class="reset-text" role="status">{{ t('passwordReset.requestSent') }}</p>
        <form v-else class="reset-form" aria-label="Request password reset form" @submit.prevent="handleRequest">
          <p class="reset-text">{{ t('passwordReset.forgotIntro') }}</p>
          <label for="reset-email" class="reset-label">{{ t('passwordReset.email') }}</label>
          <el-input id="reset-email" v-model="email" type="email" size="large" autocomplete="email" aria-required="true" />
          <el-alert v-if="error" type="error" :closable="false" show-icon class="reset-error">{{ error }}</el-alert>
          <el-button native-type="submit" type="primary" size="large" class="reset-button" :loading="loading">
            {{ t('passwordReset.sendLink') }}
          </el-button>
        </form>
      </template>

      <!-- Choose a new password -->
      <template v-else>
        <p v-if="!token" class="reset-text" role="alert">{{ t('passwordReset.missingToken') }}</p>
        <form v-else class="reset-form" aria-label="Choose new password form" @submit.prevent="handleReset">
          <label for="reset-new" class="reset-label">{{ t('passwordReset.newPassword') }}</label>
          <el-input id="reset-new" v-model="newPassword" type="password" show-password size="large" autocomplete="new-password" aria-required="true" />
          <p class="reset-hint">{{ t('passwordReset.minLength', { n: minLength }) }}</p>
          <label for="reset-confirm" class="reset-label">{{ t('passwordReset.confirmPassword') }}</label>
          <el-input id="reset-confirm" v-model="confirmPassword" type="password" show-password size="large" autocomplete="new-password" aria-required="true" />
          <el-alert v-if="error" type="error" :closable="false" show-icon class="reset-error">{{ error }}</el-alert>
          <el-button native-type="submit" type="primary" size="large" class="reset-button" :loading="loading">
            {{ t('passwordReset.setPassword') }}
          </el-button>
        </form>
      </template>

      <div class="reset-footer">
        <router-link to="/login">{{ t('passwordReset.backToLogin') }}</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getPasswordPolicy, requestPasswordReset, resetPassword } from '@/api/auth'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const isResetMode = computed(() => route.name === 'ResetPassword')

const email = ref('')
const requested = ref(false)
const token = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const minLength = ref(12)
const loading = ref(false)
const error = ref('')

/** The emailed link carries the token in the fragment: #token=... */
function tokenFromHash(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('token') ?? ''
}

onMounted(async () => {
  if (!isResetMode.value) return
  token.value = tokenFromHash(route.hash)
  // Keep the token out of the address bar and browser history.
  if (route.hash) await router.replace({ path: route.path, hash: '' })
  try {
    minLength.value = (await getPasswordPolicy()).minLength
  } catch {
    // Keep the default; the server enforces the real policy.
  }
})

async function handleRequest(): Promise<void> {
  if (loading.value) return
  if (!email.value.includes('@')) {
    error.value = t('passwordReset.enterEmail')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await requestPasswordReset(email.value.trim())
    requested.value = true
  } catch {
    error.value = t('passwordReset.requestFailed')
  } finally {
    loading.value = false
  }
}

/** The server's message for a rejected token or password (shown as text). */
function serverMessage(err: unknown): string | null {
  const response = (err as { response?: { status?: number; data?: unknown } } | null)?.response
  if (response?.status !== 400) return null
  const body = response.data as { error?: unknown; details?: { message?: unknown }[] } | undefined
  const detail = body?.details?.[0]?.message
  if (typeof detail === 'string') return detail
  return typeof body?.error === 'string' ? body.error : null
}

async function handleReset(): Promise<void> {
  if (loading.value) return
  if (newPassword.value.length < minLength.value) {
    error.value = t('passwordReset.minLength', { n: minLength.value })
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('passwordReset.mismatch')
    return
  }
  loading.value = true
  error.value = ''
  try {
    await resetPassword(token.value, newPassword.value)
    await router.push({ path: '/login', query: { reset: '1' } })
  } catch (err) {
    error.value = serverMessage(err) ?? t('passwordReset.resetFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.reset-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  padding: 16px;
  box-sizing: border-box;
  background-color: var(--cat-bg-primary);
}

.reset-card {
  width: 100%;
  max-width: 380px;
  padding: 32px;
  background-color: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.reset-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--cat-text-primary);
  margin: 0 0 16px;
}

.reset-text {
  font-size: 14px;
  color: var(--cat-text-secondary, var(--cat-text-primary));
  margin: 0 0 16px;
}

.reset-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-primary);
  margin: 12px 0 6px;
}

.reset-hint {
  font-size: 12px;
  color: var(--cat-text-tertiary);
  margin: 6px 0 0;
}

.reset-error {
  margin-top: 16px;
}

.reset-button {
  width: 100%;
  height: 40px;
  margin-top: 20px;
  border-radius: 8px;
}

.reset-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--cat-border-muted);
  font-size: 13px;
}
</style>
