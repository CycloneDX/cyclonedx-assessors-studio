<template>
  <el-card class="api-keys-card">
    <template #header>
      <div class="api-keys-header">
        <span>{{ heading }}</span>
        <el-button type="primary" size="small" @click="openCreateDialog">
          {{ t('apiKeys.create') }}
        </el-button>
      </div>
    </template>

    <div v-if="loading" class="loading-container" role="status" aria-live="polite">
      <el-icon class="is-loading" :size="20"><Loading /></el-icon>
      <span>{{ t('common.loading') }}</span>
    </div>

    <div v-else-if="error" class="error-container">
      <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
      <el-button size="small" @click="fetchKeys" class="retry-button">{{ t('common.retry') }}</el-button>
    </div>

    <template v-else>
      <div v-if="visibleKeys.length === 0" class="empty-state-small">
        <p>{{ t('apiKeys.empty') }}</p>
      </div>

      <el-table v-else :data="visibleKeys" stripe border :aria-label="t('apiKeys.tableLabel')">
        <el-table-column prop="name" :label="t('common.name')" min-width="180" />
        <el-table-column prop="prefix" :label="t('apiKeys.prefix')" width="160">
          <template #default="{ row }">
            <code class="prefix-cell">{{ row.prefix }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" :label="t('apiKeys.createdAt')" min-width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column prop="expires_at" :label="t('apiKeys.expiresAt')" min-width="170">
          <template #default="{ row }">
            {{ row.expires_at ? formatDateTime(row.expires_at) : t('apiKeys.never') }}
          </template>
        </el-table-column>
        <el-table-column prop="last_used_at" :label="t('apiKeys.lastUsed')" min-width="170">
          <template #default="{ row }">
            {{ row.last_used_at ? formatDateTime(row.last_used_at) : t('apiKeys.neverUsed') }}
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="120">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="handleRevoke(row)">
              {{ t('apiKeys.revoke') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-dialog
      v-model="showCreateDialog"
      :title="t('apiKeys.create')"
      width="520px"
      :close-on-click-modal="false"
      @close="handleCreateDialogClose"
    >
      <el-form :model="form" label-width="160px" @submit.prevent="handleCreate">
        <el-form-item :label="t('common.name')" required>
          <el-input
            v-model="form.name"
            :placeholder="t('apiKeys.namePlaceholder')"
            maxlength="255"
            show-word-limit
            :disabled="saving"
          />
          <div class="form-hint">{{ t('apiKeys.nameHint') }}</div>
        </el-form-item>

        <el-form-item :label="t('apiKeys.expiresIn')">
          <el-select v-model="form.expiresInDays" :disabled="saving">
            <el-option :label="t('apiKeys.days30')" :value="30" />
            <el-option :label="t('apiKeys.days90')" :value="90" />
            <el-option :label="t('apiKeys.days180')" :value="180" />
            <el-option :label="t('apiKeys.days365')" :value="365" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false" :disabled="saving">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">{{ t('apiKeys.create') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showRevealDialog"
      :title="t('apiKeys.revealTitle')"
      width="640px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="handleRevealDialogClose"
    >
      <el-alert
        :title="t('apiKeys.revealOnceWarning')"
        type="warning"
        show-icon
        :closable="false"
        class="reveal-warning"
      />

      <div class="reveal-display" role="group" :aria-label="t('apiKeys.revealTitle')">
        <label class="reveal-label" :for="keyInputId">{{ t('apiKeys.key') }}</label>
        <div class="reveal-copy-row">
          <el-input
            :id="keyInputId"
            :model-value="revealedKey ?? ''"
            readonly
            type="text"
            class="reveal-input"
          />
          <el-button type="primary" @click="copyKey">{{ t('common.copy') }}</el-button>
        </div>
      </div>

      <template #footer>
        <el-button type="primary" @click="showRevealDialog = false">{{ t('common.done') }}</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { formatDateTime } from '@/utils/dateFormat'
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKey,
  type CreatedApiKey,
} from '@/api/apikeys'

const props = withDefaults(
  defineProps<{
    /** When set, only show keys for this user (admin context). */
    userId?: string
    /** Override card heading. Defaults to localized "API Keys". */
    heading?: string
  }>(),
  { userId: undefined, heading: undefined },
)

const { t } = useI18n()
const keyInputId = useId()

const heading = computed(() => props.heading ?? t('apiKeys.heading'))

const keys = ref<ApiKey[]>([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const showCreateDialog = ref(false)
const showRevealDialog = ref(false)
const createdKey = ref<CreatedApiKey | null>(null)
// Plaintext key kept in a separate ref so we can null it out
// independently. The server only returns this once; on dialog close
// we drop it from memory immediately.
const revealedKey = ref<string | null>(null)

const form = ref<{ name: string; expiresInDays: number }>({
  name: '',
  expiresInDays: 90,
})

// When userId is provided we filter client side. The backend list
// endpoint already returns only the caller's own keys for non admins;
// for admins we filter so the per user variant only shows the targeted
// user's keys.
const visibleKeys = computed(() => {
  if (!props.userId) return keys.value
  return keys.value.filter((k) => k.user_id === props.userId)
})

async function fetchKeys() {
  loading.value = true
  error.value = ''
  try {
    keys.value = await listApiKeys()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || t('apiKeys.loadError')
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  form.value = { name: '', expiresInDays: 90 }
  showCreateDialog.value = true
}

function handleCreateDialogClose() {
  form.value = { name: '', expiresInDays: 90 }
}

async function handleCreate() {
  const name = form.value.name.trim()
  if (name.length < 1) {
    ElMessage.error(t('apiKeys.nameRequired'))
    return
  }
  if (name.length > 255) {
    ElMessage.error(t('apiKeys.nameTooLong'))
    return
  }

  saving.value = true
  try {
    const result = await createApiKey({
      name,
      // Keys always expire (server caps at 365 days).
      expiresInDays: form.value.expiresInDays,
      userId: props.userId,
    })
    createdKey.value = result
    revealedKey.value = result.key
    showCreateDialog.value = false
    showRevealDialog.value = true
    await fetchKeys()
    ElMessage.success(t('apiKeys.createSuccess'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('apiKeys.createError'))
  } finally {
    saving.value = false
  }
}

async function handleRevoke(row: ApiKey) {
  try {
    await ElMessageBox.confirm(
      t('apiKeys.confirmRevoke', { name: row.name }),
      t('apiKeys.revoke'),
      {
        confirmButtonText: t('apiKeys.revoke'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }

  try {
    await revokeApiKey(row.id)
    ElMessage.success(t('apiKeys.revokeSuccess'))
    await fetchKeys()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('apiKeys.revokeError'))
  }
}

async function copyKey() {
  const key = revealedKey.value
  if (!key) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(key)
    } else {
      const ta = document.createElement('textarea')
      ta.value = key
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    ElMessage.success(t('apiKeys.keyCopied'))
  } catch {
    ElMessage.error(t('apiKeys.copyError'))
  }
}

function handleRevealDialogClose() {
  // Drop the plaintext key from memory immediately. The server never
  // returns it again.
  revealedKey.value = null
  createdKey.value = null
}

onMounted(fetchKeys)
</script>

<style scoped lang="scss">
.api-keys-card {
  margin-bottom: var(--cat-spacing-4);
}

.api-keys-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cat-spacing-3);
}

.loading-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--cat-spacing-4);
  color: var(--cat-text-secondary);
}

.error-container {
  padding: var(--cat-spacing-3) 0;

  .retry-button {
    margin-top: var(--cat-spacing-2);
  }
}

.empty-state-small {
  text-align: center;
  padding: var(--cat-spacing-4);
  color: var(--cat-text-tertiary);
}

.prefix-cell {
  font-family: var(--cat-font-mono);
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.form-hint {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  margin-top: 4px;
}

.reveal-warning {
  margin-bottom: var(--cat-spacing-4);
}

.reveal-display {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
  margin-bottom: var(--cat-spacing-4);
}

.reveal-label {
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.reveal-copy-row {
  display: flex;
  gap: var(--cat-spacing-2);
  align-items: center;

  :deep(.reveal-input) {
    flex: 1;

    input {
      font-family: var(--cat-font-mono);
      font-size: var(--cat-font-size-sm);
    }
  }
}
</style>
