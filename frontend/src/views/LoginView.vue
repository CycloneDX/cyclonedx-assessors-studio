<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo-mark">
          <img :src="logoSrc" alt="CycloneDX" class="login-logo-img" />
        </div>
        <div class="login-branding">
          <h1 class="login-title">Assessors Studio</h1>
          <p class="login-subtitle">{{ t('login.subtitle') }}</p>
        </div>
      </div>

      <el-alert v-if="resetDone" type="success" :closable="false" show-icon class="login-error" role="status">
        {{ t('login.resetDone') }}
      </el-alert>

      <form @submit.prevent="handleLogin" class="login-form" aria-label="Sign in form">
        <el-form-item>
          <label for="login-username" class="login-form-label">{{ t('login.username') }}</label>
          <el-input
            id="login-username"
            v-model="form.username"
            :placeholder="t('login.username')"
            size="large"
            :prefix-icon="UserIcon"
            aria-required="true"
          />
        </el-form-item>

        <el-form-item>
          <label for="login-password" class="login-form-label">{{ t('login.password') }}</label>
          <el-input
            id="login-password"
            v-model="form.password"
            type="password"
            :placeholder="t('login.password')"
            size="large"
            show-password
            :prefix-icon="LockIcon"
            aria-required="true"
          />
        </el-form-item>

        <el-alert
          v-if="error"
          type="error"
          :closable="true"
          show-icon
          class="login-error"
          @close="error = ''"
        >
          {{ error }}
        </el-alert>

        <el-button
          native-type="submit"
          type="primary"
          size="large"
          class="login-button"
          :loading="loading"
        >
          {{ t('login.signIn') }}
        </el-button>

        <div class="login-forgot">
          <router-link to="/forgot-password">{{ t('login.forgotPassword') }}</router-link>
        </div>
      </form>

      <div class="login-footer">
        <span class="login-hint">&copy; OWASP Foundation</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useLogo } from '@/composables/useLogo'
import { User as UserIcon, Lock as LockIcon } from '@element-plus/icons-vue'

const { logoSrc } = useLogo()

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { t } = useI18n()

// Pull the post-login destination off the URL. Router guards stamp
// `redirect=<path>` on the /login URL when an unauthenticated user
// hits a protected route, so the user lands back where they came from
// after signing in. Reject any value that does not start with a single
// "/" so an attacker cannot stage a redirect to an external origin via
// "//evil.com" or similar.
function resolveRedirectTarget(): string {
  const raw = route.query.redirect
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return '/dashboard'
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

const form = ref({
  username: '',
  password: ''
})

const loading = ref(false)
const error = ref('')
const resetDone = route.query.reset === '1'

onMounted(() => {
  nextTick(() => {
    const input = document.getElementById('login-username')
    if (input) input.focus()
  })
})

const handleLogin = async () => {
  if (loading.value) return
  if (!form.value.username || !form.value.password) {
    error.value = t('login.enterCredentials')
    return
  }

  loading.value = true
  error.value = ''

  try {
    await authStore.login(form.value.username, form.value.password)
    await router.push(resolveRedirectTarget())
  } catch {
    // Surface a single, localized failure string for every credential
    // error. Echoing the server error text risks leaking account-state
    // distinctions (for example "account locked" vs "bad password") and
    // leaves a path for attacker-controlled strings rendered via an
    // upstream proxy or error middleware to reach the DOM. The server
    // remains the source of truth for lockout and rate-limit behavior;
    // the UI treats every failure uniformly.
    error.value = t('login.loginFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100vh;
  background-color: var(--cat-bg-primary);
}

.login-card {
  width: 100%;
  max-width: 380px;
  padding: 40px 32px 32px;
  background-color: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}

.login-logo-mark {
  width: 200px;
  margin: 0 auto;
}

.login-logo-img {
  width: 100%;
  height: auto;
}

.login-branding {
  text-align: center;
}

.login-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--cat-text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.01em;
}

.login-subtitle {
  font-size: 13px;
  color: var(--cat-text-tertiary);
  margin: 0;
}

.login-form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-primary);
  margin-bottom: 6px;
}

.login-form {
  :deep(.el-form-item) {
    margin-bottom: 16px;
  }

  :deep(.el-input__wrapper) {
    background-color: var(--cat-bg-tertiary);
    border-radius: 8px;
    box-shadow: 0 0 0 1px var(--cat-border-default) inset;

    &:hover {
      box-shadow: 0 0 0 1px var(--cat-border-emphasis) inset;
    }

    &.is-focus {
      box-shadow: 0 0 0 1px var(--cat-brand-primary) inset,
                  0 0 0 3px rgba(47, 129, 247, 0.15);
    }
  }

  :deep(.el-input__prefix .el-icon) {
    font-size: 16px;
    color: var(--cat-text-tertiary);
  }
}

.login-error {
  margin-bottom: 16px;
}

.login-button {
  width: 100%;
  height: 40px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
  margin-top: 8px;
}

.login-forgot {
  text-align: center;
  margin-top: 12px;
  font-size: 13px;
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--cat-border-muted);
}

.login-hint {
  font-size: 12px;
  color: var(--cat-text-quaternary, var(--cat-text-tertiary));
  opacity: 0.7;
}
</style>
