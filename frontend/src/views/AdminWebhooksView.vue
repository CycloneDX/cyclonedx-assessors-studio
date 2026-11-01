<template>
  <div class="admin-webhooks-container" :class="{ 'embedded-mode': embedded }">
    <PageHeader v-if="!embedded" :title="t('webhooks.title')" :subtitle="t('webhooks.subtitle')">
      <template #actions>
        <el-button type="primary" @click="openCreateDialog">{{ t('webhooks.createWebhook') }}</el-button>
      </template>
    </PageHeader>
    <div class="admin-webhooks-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchWebhooks" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <!-- Webhooks List -->
        <div v-if="!selectedWebhook">
          <div class="list-header">
            <el-button type="primary" size="small" @click="openCreateDialog">{{ t('webhooks.createWebhook') }}</el-button>
          </div>

          <div v-if="webhooks.length === 0" class="empty-state">
            <p>{{ t('webhooks.noWebhooks') }}</p>
            <p class="empty-state-hint">{{ t('webhooks.noWebhooksDescription') }}</p>
          </div>

          <el-table v-else :data="webhooks" stripe>
            <el-table-column prop="name" :label="t('common.name')" min-width="130" />
            <el-table-column :label="t('webhooks.url')" min-width="180">
              <template #default="{ row }">
                <span class="url-cell" :title="row.url">{{ truncateUrl(row.url) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('webhooks.eventTypes')" min-width="100">
              <template #default="{ row }">
                <span>{{ formatEventTypes(row.eventTypes || row.event_types) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.status')" width="100">
              <template #default="{ row }">
                <span class="status-badge" :class="(row.isActive ?? row.is_active) ? 'status-badge--active' : 'status-badge--disabled'">
                  {{ (row.isActive ?? row.is_active) ? t('common.active') : t('webhooks.disabled') }}
                </span>
              </template>
            </el-table-column>
            <el-table-column :label="t('webhooks.failures')" width="80" align="center">
              <template #default="{ row }">
                <span :class="{ 'failure-count': (row.consecutiveFailures || row.consecutive_failures || 0) > 0 }">
                  {{ row.consecutiveFailures ?? row.consecutive_failures ?? 0 }}
                </span>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.actions')" width="160">
              <template #default="{ row }">
                <div class="row-actions">
                  <IconButton :icon="ViewIcon" variant="info" :tooltip="t('webhooks.viewDeliveries')" @click="selectWebhook(row)" />
                  <IconButton :icon="Promotion" variant="warning" :tooltip="t('webhooks.sendTest')" @click="handleTest(row)" />
                  <IconButton :icon="EditIcon" variant="primary" :tooltip="t('common.edit')" @click="openEditDialog(row)" />
                  <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="handleDelete(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- Delivery Log View -->
        <div v-else>
          <div class="delivery-header">
            <el-button @click="selectedWebhook = null" size="small">
              <el-icon><ArrowLeft /></el-icon>
              {{ t('common.back') }}
            </el-button>
            <h3 class="delivery-title">{{ selectedWebhook.name }} {{ t('webhooks.deliveryLog') }}</h3>
          </div>

          <div v-if="deliveriesLoading" class="loading-container">
            <el-icon class="is-loading" :size="24"><Loading /></el-icon>
            <span>{{ t('common.loading') }}</span>
          </div>

          <template v-else>
            <div v-if="deliveries.length === 0" class="empty-state">
              <p>{{ t('webhooks.noDeliveries') }}</p>
            </div>

            <el-table v-else :data="deliveries" stripe border>
              <el-table-column type="expand">
                <template #default="{ row }">
                  <div class="delivery-detail">
                    <div v-if="row.request_body || row.requestBody" class="detail-section">
                      <strong>{{ t('webhooks.requestBody') }}:</strong>
                      <pre class="detail-pre">{{ formatJson(row.request_body || row.requestBody) }}</pre>
                    </div>
                    <div v-if="row.error_message || row.errorMessage" class="detail-section">
                      <strong>{{ t('webhooks.errorMessage') }}:</strong>
                      <pre class="detail-pre error-text">{{ row.error_message || row.errorMessage }}</pre>
                    </div>
                    <div v-if="row.response_body || row.responseBody" class="detail-section">
                      <strong>{{ t('webhooks.responseBody') }}:</strong>
                      <pre class="detail-pre">{{ row.response_body || row.responseBody }}</pre>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column :label="t('webhooks.eventType')" prop="event_type" min-width="180" />
              <el-table-column :label="t('common.status')" min-width="110">
                <template #default="{ row }">
                  <span class="status-badge" :class="`status-badge--${row.status}`">
                    {{ row.status }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column :label="t('webhooks.httpStatus')" prop="http_status" min-width="100" align="center">
                <template #default="{ row }">
                  {{ row.http_status ?? row.httpStatus ?? '\u2014' }}
                </template>
              </el-table-column>
              <el-table-column :label="t('webhooks.attempt')" prop="attempt" min-width="80" align="center" />
              <el-table-column :label="t('webhooks.timestamp')" min-width="170">
                <template #default="{ row }">
                  {{ formatDate(row.delivered_at || row.deliveredAt || row.created_at || row.createdAt) }}
                </template>
              </el-table-column>
            </el-table>

            <el-pagination
              v-model:current-page="deliveryPage"
              :page-size="deliveryPageSize"
              :total="deliveryTotal"
              layout="total, prev, pager, next"
              @current-change="fetchDeliveries"
            />
          </template>
        </div>
      </template>
    </div>

    <WebhookFormDialog
      v-model:visible="showDialog"
      v-model:secret-dialog-visible="showSecretDialog"
      :is-editing="isEditing"
      :editing-id="editingId"
      :initial-data="webhookFormData"
      :saving="saving"
      :secret="createdSecret"
      @save="handleSave"
      @copy-secret="copySecret"
    />
  </div>
</template>

<script setup lang="ts">
import client from '@/api/client'
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Loading,
  Edit as EditIcon,
  Delete,
  View as ViewIcon,
  Promotion,
  ArrowLeft,
} from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import WebhookFormDialog from '@/components/shared/WebhookFormDialog.vue'
import IconButton from '@/components/shared/IconButton.vue'

const { t } = useI18n()

// --- State ---
const webhooks = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)
const showDialog = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const showSecretDialog = ref(false)
const createdSecret = ref('')
const webhookFormData = ref<{ name: string; url: string; eventTypes: string[]; isActive: boolean }>({
  name: '',
  url: '',
  eventTypes: [],
  isActive: true,
})

// Delivery log state
const selectedWebhook = ref<Record<string, unknown> | null>(null)
const deliveries = ref<Record<string, unknown>[]>([])
const deliveriesLoading = ref(false)
const deliveryPage = ref(1)
const deliveryPageSize = 20
const deliveryTotal = ref(0)

// --- API calls ---

const fetchWebhooks = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await client.get('/webhooks')
    webhooks.value = response.data.data || []
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || 'Failed to fetch webhooks'
  } finally {
    loading.value = false
  }
}

const fetchDeliveries = async () => {
  if (!selectedWebhook.value) return
  deliveriesLoading.value = true
  try {
    const offset = (deliveryPage.value - 1) * deliveryPageSize
    const response = await client.get(`/webhooks/${(selectedWebhook.value as Record<string, unknown>).id}/deliveries`, {
      params: { limit: deliveryPageSize, offset },
    })
    deliveries.value = response.data.data || []
    deliveryTotal.value = Number(response.data.pagination?.total ?? 0)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to fetch deliveries')
  } finally {
    deliveriesLoading.value = false
  }
}

// --- Handlers ---

const openCreateDialog = () => {
  isEditing.value = false
  editingId.value = ''
  createdSecret.value = ''
  webhookFormData.value = { name: '', url: '', eventTypes: [], isActive: true }
  showDialog.value = true
}

const openEditDialog = (row: Record<string, unknown>) => {
  isEditing.value = true
  editingId.value = row.id as string
  webhookFormData.value = {
    name: row.name as string,
    url: row.url as string,
    eventTypes: [...((row.eventTypes || row.event_types) as string[] || [])],
    isActive: (row.isActive ?? row.is_active ?? true) as boolean,
  }
  showDialog.value = true
}

const handleSave = async (data: { name: string; url: string; eventTypes: string[]; regenerateSecret: boolean; isActive: boolean }) => {
  saving.value = true
  try {
    if (isEditing.value) {
      interface WebhookPayload {
        name: string
        url: string
        eventTypes: string[]
        isActive: boolean
        regenerateSecret?: boolean
      }
      const payload: WebhookPayload = {
        name: data.name,
        url: data.url,
        eventTypes: data.eventTypes,
        isActive: data.isActive,
      }
      if (data.regenerateSecret) {
        payload.regenerateSecret = true
      }
      const response = await client.put(`/webhooks/${editingId.value}`, payload)
      if (response.data.secret) {
        createdSecret.value = response.data.secret
        showSecretDialog.value = true
      }
      ElMessage.success(t('webhooks.webhookUpdated'))
    } else {
      const response = await client.post('/webhooks', {
        name: data.name,
        url: data.url,
        eventTypes: data.eventTypes,
      })
      if (response.data.secret) {
        createdSecret.value = response.data.secret
        showSecretDialog.value = true
      }
      ElMessage.success(t('webhooks.webhookCreatedSuccess'))
    }
    showDialog.value = false
    fetchWebhooks()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to save webhook')
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row: Record<string, unknown>) => {
  try {
    await ElMessageBox.confirm(
      t('webhooks.confirmDelete', { name: row.name }),
      t('common.delete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }

  try {
    await client.delete(`/webhooks/${row.id as string}`)
    ElMessage.success(t('webhooks.webhookDeleted'))
    fetchWebhooks()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to delete webhook')
  }
}

const handleTest = async (row: Record<string, unknown>) => {
  try {
    const response = await client.post(`/webhooks/${row.id as string}/test`)
    ElMessage.success(t('webhooks.testSent', { eventId: response.data.eventId || '' }))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to send test event')
  }
}

const selectWebhook = (row: Record<string, unknown>) => {
  selectedWebhook.value = row
  deliveryPage.value = 1
  fetchDeliveries()
}

const copySecret = async () => {
  try {
    await navigator.clipboard.writeText(createdSecret.value)
    ElMessage.success(t('webhooks.secretCopied'))
  } catch {
    ElMessage.error('Failed to copy to clipboard')
  }
}

// --- Formatters ---

const truncateUrl = (url: string): string => {
  if (!url) return ''
  if (url.length <= 50) return url
  return `${url.substring(0, 47)}...`
}

const formatEventTypes = (types: string[] | undefined): string => {
  if (!types || !Array.isArray(types)) return ''
  if (types.length === 1 && types[0] === '*') return 'All events'
  return `${types.length} event${types.length !== 1 ? 's' : ''}`
}

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleString()
  } catch {
    return dateStr
  }
}

const formatJson = (data: Record<string, unknown> | string): string => {
  if (!data) return ''
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch {
      return data
    }
  }
  return JSON.stringify(data, null, 2)
}

onMounted(() => {
  fetchWebhooks()
})
</script>

<style scoped lang="scss">
.admin-webhooks-container {
  padding: 0;
}

.list-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--cat-spacing-3);
}

.row-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.embedded-mode {
  padding: 0;

  .admin-webhooks-content {
    padding: 0;
  }
}

.admin-webhooks-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--cat-text-secondary);
}

.error-container {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);

  .retry-button {
    margin-top: 16px;
  }
}

.empty-state {
  text-align: center;
  padding: 48px 0;
  color: var(--cat-text-secondary);

  p {
    margin: 0;
  }

  .empty-state-hint {
    margin-top: 8px;
    font-size: var(--cat-font-size-sm);
    color: var(--cat-text-tertiary);
  }
}

.url-cell {
  font-family: var(--cat-font-family-mono, monospace);
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  line-height: 1.6;
  white-space: nowrap;

  &--active,
  &--success {
    background-color: rgba(63, 185, 80, 0.15);
    color: #3fb950;
  }

  &--disabled {
    background-color: rgba(248, 81, 73, 0.15);
    color: #f85149;
  }

  &--pending {
    background-color: rgba(210, 153, 34, 0.15);
    color: #d29922;
  }

  &--failed {
    background-color: rgba(248, 81, 73, 0.15);
    color: #f85149;
  }

  &--exhausted {
    background-color: rgba(139, 148, 158, 0.15);
    color: #8b949e;
  }
}

.failure-count {
  color: #f85149;
  font-weight: var(--cat-font-weight-semibold);
}

// Delivery log
.delivery-header {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-4);
  margin-bottom: var(--cat-spacing-4);
}

.delivery-title {
  margin: 0;
  font-size: var(--cat-font-size-lg);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.delivery-detail {
  padding: var(--cat-spacing-4);
}

.detail-section {
  margin-bottom: var(--cat-spacing-3);

  &:last-child {
    margin-bottom: 0;
  }

  strong {
    display: block;
    margin-bottom: var(--cat-spacing-2);
    color: var(--cat-text-secondary);
    font-size: var(--cat-font-size-sm);
  }
}

.detail-pre {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: 4px;
  padding: var(--cat-spacing-3);
  font-family: var(--cat-font-family-mono, monospace);
  font-size: var(--cat-font-size-xs);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  margin: 0;
}

.error-text {
  color: #f85149;
}



:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}

:deep(.el-pagination) {
  margin-top: var(--cat-spacing-4);
  justify-content: flex-end;
}
</style>
