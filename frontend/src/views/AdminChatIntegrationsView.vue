<template>
  <div class="chat-integrations-container" :class="{ 'embedded-mode': embedded }">
    <PageHeader v-if="!embedded" :title="t('chatIntegrations.title')" :subtitle="t('chatIntegrations.subtitle')" />

    <!-- Stacked layout when embedded (no tabs within tabs) -->
    <template v-if="embedded">
      <div class="stacked-platforms">
        <div v-for="p in platforms" :key="p.key" class="platform-section">
          <div class="platform-section-header">
            <h3>{{ p.label }}</h3>
            <div class="platform-section-actions">
              <el-button type="primary" size="small" @click="openCreateDialogForPlatform(p.key)">
                {{ t('chatIntegrations.create') }}
              </el-button>
            </div>
          </div>

          <div v-if="platformData[p.key]?.loading" class="loading-container">
            <el-icon class="is-loading" :size="20"><Loading /></el-icon>
            <span>{{ t('common.loading') }}</span>
          </div>
          <div v-else-if="platformData[p.key]?.error" class="error-container">
            <el-alert :title="t('common.error')" :description="platformData[p.key].error" type="error" :closable="false" />
          </div>
          <template v-else>
            <div v-if="(platformData[p.key]?.items || []).length === 0" class="empty-state-inline">
              <span>{{ t('chatIntegrations.noIntegrations', { platform: p.label }) }}</span>
            </div>
            <el-table v-else :data="platformData[p.key]?.items || []" class="integrations-table" stripe size="small">
              <el-table-column prop="name" :label="t('chatIntegrations.name')" min-width="140" />
              <el-table-column :label="t('chatIntegrations.channelName')" min-width="120">
                <template #default="{ row }">{{ row.channelName || row.channel_name || '—' }}</template>
              </el-table-column>
              <el-table-column :label="t('chatIntegrations.categories')" min-width="130">
                <template #default="{ row }">
                  <el-tooltip :content="parseCategories(row.eventCategories || row.event_categories).join(', ')" placement="top" :show-after="300">
                    <span class="event-summary">{{ formatEventSummary(row.eventCategories || row.event_categories) }}</span>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column :label="t('common.status')" width="100">
                <template #default="{ row }">
                  <span class="status-badge" :class="(row.isActive ?? row.is_active) ? 'status-badge--active' : 'status-badge--disabled'">
                    {{ (row.isActive ?? row.is_active) ? t('common.active') : t('common.inactive') }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column :label="t('common.actions')" width="110" align="right">
                <template #default="{ row }">
                  <div class="row-actions">
                    <IconButton :icon="Promotion" variant="warning" :tooltip="t('chatIntegrations.sendTest')" @click="testIntegration(row)" />
                    <IconButton :icon="EditIcon" variant="primary" :tooltip="t('common.edit')" @click="openEditDialog(row)" />
                    <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="confirmDelete(row)" />
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </div>
      </div>
    </template>

    <!-- Tabbed layout when standalone -->
    <template v-else>
      <el-tabs v-model="activePlatform" class="platform-tabs" @tab-change="fetchIntegrations">
        <el-tab-pane
          v-for="p in platforms"
          :key="p.key"
          :label="p.label"
          :name="p.key"
        />
      </el-tabs>

      <div class="chat-integrations-content">
        <!-- Loading -->
        <div v-if="loading" class="loading-container">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>{{ t('common.loading') }}</span>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="error-container">
          <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
          <el-button @click="fetchIntegrations" class="retry-button">{{ t('common.retry') }}</el-button>
        </div>

        <template v-else>
          <!-- Actions bar -->
          <div class="actions-bar">
            <el-button type="primary" @click="openCreateDialog">
              {{ t('chatIntegrations.create') }}
            </el-button>
          </div>

          <!-- Empty state -->
          <div v-if="integrations.length === 0" class="empty-state">
            <p>{{ t('chatIntegrations.noIntegrations', { platform: currentPlatformLabel }) }}</p>
            <el-collapse>
              <el-collapse-item :title="t('chatIntegrations.setupGuide')">
                <div class="setup-guide">
                  <div v-if="activePlatform === 'slack'">
                    <p>{{ t('chatIntegrations.slackSetupGuide') }}</p>
                    <pre class="env-example">SLACK_ENABLED=true</pre>
                  </div>
                  <div v-else-if="activePlatform === 'teams'">
                    <p>{{ t('chatIntegrations.teamsSetupGuide') }}</p>
                    <pre class="env-example">TEAMS_ENABLED=true</pre>
                  </div>
                  <div v-else-if="activePlatform === 'mattermost'">
                    <p>{{ t('chatIntegrations.mattermostSetupGuide') }}</p>
                    <pre class="env-example">MATTERMOST_ENABLED=true</pre>
                  </div>
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>

          <!-- Integration table -->
          <el-table v-else :data="integrations" class="integrations-table" stripe>
            <el-table-column prop="name" :label="t('chatIntegrations.name')" min-width="140" />
            <el-table-column :label="t('chatIntegrations.channelName')" min-width="120">
              <template #default="{ row }">{{ row.channelName || row.channel_name || '—' }}</template>
            </el-table-column>
            <el-table-column :label="t('chatIntegrations.categories')" min-width="130">
              <template #default="{ row }">
                <el-tooltip :content="parseCategories(row.eventCategories || row.event_categories).join(', ')" placement="top" :show-after="300">
                  <span class="event-summary">{{ formatEventSummary(row.eventCategories || row.event_categories) }}</span>
                </el-tooltip>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.status')" width="100">
              <template #default="{ row }">
                <span class="status-badge" :class="(row.isActive ?? row.is_active) ? 'status-badge--active' : 'status-badge--disabled'">
                  {{ (row.isActive ?? row.is_active) ? t('common.active') : t('common.inactive') }}
                </span>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.actions')" width="110" align="right">
              <template #default="{ row }">
                <div class="row-actions">
                  <IconButton :icon="Promotion" variant="warning" :tooltip="t('chatIntegrations.sendTest')" @click="testIntegration(row)" />
                  <IconButton :icon="EditIcon" variant="primary" :tooltip="t('common.edit')" @click="openEditDialog(row)" />
                  <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="confirmDelete(row)" />
                </div>
              </template>
            </el-table-column>
          </el-table>

          <!-- Delivery log expand for selected integration -->
          <div v-if="selectedIntegration" class="delivery-log-section">
            <h4>{{ t('chatIntegrations.deliveryLog') }}: {{ selectedIntegration.name }}</h4>
            <el-button size="small" @click="selectedIntegration = null">{{ t('common.close') }}</el-button>
            <el-table :data="deliveries" class="delivery-table" stripe size="small">
              <el-table-column prop="event_type" :label="t('chatIntegrations.eventType')" min-width="180" />
              <el-table-column prop="status" :label="t('common.status')" width="100">
                <template #default="{ row }">
                  <el-tag :type="deliveryStatusType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="http_status" :label="t('webhooks.httpStatus')" width="100" />
              <el-table-column prop="attempt" :label="t('webhooks.attempt')" width="80" />
              <el-table-column prop="error_message" :label="t('webhooks.errorMessage')" min-width="200">
                <template #default="{ row }">{{ row.error_message || '—' }}</template>
              </el-table-column>
              <el-table-column prop="created_at" :label="t('webhooks.timestamp')" width="180">
                <template #default="{ row }">{{ formatDate(row.created_at || row.createdAt) }}</template>
              </el-table-column>
            </el-table>
            <div v-if="deliveryPagination.total > deliveryPagination.limit" class="pagination-bar">
              <el-pagination
                layout="prev, pager, next"
                :total="deliveryPagination.total"
                :page-size="deliveryPagination.limit"
                :current-page="deliveryPage"
                @current-change="onDeliveryPageChange"
              />
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Create/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? t('chatIntegrations.editTitle') : t('chatIntegrations.createTitle')"
      width="520px"
    >
      <el-form :model="form" label-position="top">
        <el-form-item :label="t('chatIntegrations.name')" required>
          <el-input v-model="form.name" :placeholder="t('chatIntegrations.namePlaceholder')" />
        </el-form-item>
        <el-form-item v-if="!editingId" :label="t('chatIntegrations.platform')" required>
          <el-select v-model="form.platform" class="w-full">
            <el-option v-for="p in platforms" :key="p.key" :label="p.label" :value="p.key" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('chatIntegrations.webhookUrl')" required>
          <el-input v-model="form.webhookUrl" :placeholder="webhookUrlPlaceholder" />
          <div class="form-hint">{{ webhookUrlHint }}</div>
        </el-form-item>
        <el-form-item :label="t('chatIntegrations.channelName')">
          <el-input v-model="form.channelName" :placeholder="t('chatIntegrations.channelNamePlaceholder')" />
          <div class="form-hint">{{ t('chatIntegrations.channelNameHint') }}</div>
        </el-form-item>
        <el-form-item :label="t('common.enabled')">
          <el-switch v-model="form.isActive" />
        </el-form-item>
        <el-form-item :label="t('chatIntegrations.categories')" required>
          <EventTypeSelector
            v-model="form.eventCategories"
            granularity="event"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveIntegration">
          {{ editingId ? t('common.save') : t('common.create') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Test result notification -->
    <el-dialog v-model="testResultVisible" :title="t('chatIntegrations.testResult')" width="400px">
      <el-result
        :icon="testResult?.success ? 'success' : 'error'"
        :title="testResult?.success ? t('chatIntegrations.testSuccess') : t('chatIntegrations.testFailed')"
        :sub-title="testResult?.message"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/shared/PageHeader.vue'
import EventTypeSelector from '@/components/shared/EventTypeSelector.vue'
import IconButton from '@/components/shared/IconButton.vue'
import { Loading, Edit as EditIcon, Delete, Promotion } from '@element-plus/icons-vue'
import { apiErrorMessage } from '@/utils/errorMessage'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

const platforms = [
  { key: 'slack', label: 'Slack' },
  { key: 'teams', label: 'Microsoft Teams' },
  { key: 'mattermost', label: 'Mattermost' },
]

const activePlatform = ref('slack')
const loading = ref(true)
const error = ref<string | null>(null)
const integrations = ref<Record<string, unknown>[]>([])
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const testResultVisible = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const selectedIntegration = ref<Record<string, unknown> | null>(null)
const deliveries = ref<Record<string, unknown>[]>([])
const deliveryPage = ref(1)
const deliveryPagination = ref({ limit: 20, offset: 0, total: 0 })

const form = ref({
  name: '',
  platform: 'slack',
  isActive: true,
  webhookUrl: '',
  channelName: '',
  eventCategories: ['assessment', 'evidence', 'attestation'] as string[],
})

// Stacked mode state (used when embedded)
interface PlatformState {
  loading: boolean
  error: string | null
  items: Record<string, unknown>[]
}
const platformData = reactive<Record<string, PlatformState>>({
  slack: { loading: true, error: null, items: [] },
  teams: { loading: true, error: null, items: [] },
  mattermost: { loading: true, error: null, items: [] },
})

async function fetchAllPlatforms() {
  for (const p of platforms) {
    platformData[p.key].loading = true
    platformData[p.key].error = null
    try {
      const { data } = await client.get('/integrations/chat', { params: { platform: p.key } })
      platformData[p.key].items = data.data || []
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      platformData[p.key].error = e?.response?.data?.error || e?.message || 'Failed to load'
    } finally {
      platformData[p.key].loading = false
    }
  }
}

function openCreateDialogForPlatform(platform: string) {
  editingId.value = null
  form.value = {
    name: '',
    platform,
    isActive: true,
    webhookUrl: '',
    channelName: '',
    eventCategories: ['assessment', 'evidence', 'attestation'],
  }
  dialogVisible.value = true
}

const currentPlatformLabel = computed(() => {
  return platforms.find((p) => p.key === activePlatform.value)?.label || activePlatform.value
})

const webhookUrlPlaceholder = computed(() => {
  const p = form.value.platform || activePlatform.value
  if (p === 'slack') return 'https://hooks.slack.com/services/...'
  if (p === 'teams') return 'https://xxx.webhook.office.com/...'
  return 'https://mattermost.example.com/hooks/...'
})

const webhookUrlHint = computed(() => {
  const p = form.value.platform || activePlatform.value
  if (p === 'slack') return t('chatIntegrations.slackUrlHint')
  if (p === 'teams') return t('chatIntegrations.teamsUrlHint')
  return t('chatIntegrations.mattermostUrlHint')
})

function parseCategories(cats: string | string[] | undefined): string[] {
  if (!cats) return []
  if (Array.isArray(cats)) return cats
  try {
    const parsed = JSON.parse(cats)
    if (Array.isArray(parsed)) return parsed
  } catch { /* not JSON */ }
  return cats.split(',').map((c: string) => c.trim()).filter(Boolean)
}

function formatEventSummary(cats: string | string[] | undefined): string {
  const items = parseCategories(cats)
  if (items.length === 0) return 'None'
  // Separate category-level entries from specific event types
  const categories = items.filter((i) => !i.includes('.'))
  const events = items.filter((i) => i.includes('.'))
  const parts: string[] = []
  if (categories.length > 0) {
    parts.push(`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`)
  }
  if (events.length > 0) {
    parts.push(`${events.length} ${events.length === 1 ? 'event' : 'events'}`)
  }
  return parts.join(', ')
}

function deliveryStatusType(status: string): string {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'warning'
  if (status === 'exhausted') return 'danger'
  return 'info'
}

function formatDate(d: string | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

async function fetchIntegrations() {
  loading.value = true
  error.value = null
  selectedIntegration.value = null
  try {
    const { data } = await client.get('/integrations/chat', {
      params: { platform: activePlatform.value },
    })
    integrations.value = data.data || []
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e?.response?.data?.error || e?.message || 'Failed to load integrations'
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  editingId.value = null
  form.value = {
    name: '',
    platform: activePlatform.value,
    isActive: true,
    webhookUrl: '',
    channelName: '',
    eventCategories: ['assessment', 'evidence', 'attestation'],
  }
  dialogVisible.value = true
}

function openEditDialog(row: Record<string, unknown>) {
  editingId.value = row.id as string
  form.value = {
    name: row.name as string,
    platform: row.platform as string,
    isActive: (row.isActive ?? row.is_active ?? true) as boolean,
    webhookUrl: (row.webhookUrl || row.webhook_url || '') as string,
    channelName: (row.channelName || row.channel_name || '') as string,
    eventCategories: parseCategories(row.eventCategories as string | string[] | undefined || row.event_categories as string | string[] | undefined),
  }
  dialogVisible.value = true
}

async function saveIntegration() {
  saving.value = true
  try {
    if (editingId.value) {
      await client.put(`/integrations/chat/${editingId.value}`, {
        name: form.value.name,
        webhookUrl: form.value.webhookUrl,
        channelName: form.value.channelName || null,
        eventCategories: form.value.eventCategories,
        isActive: form.value.isActive,
      })
      ElMessage.success(t('chatIntegrations.updated'))
    } else {
      await client.post('/integrations/chat', {
        name: form.value.name,
        platform: form.value.platform,
        webhookUrl: form.value.webhookUrl,
        channelName: form.value.channelName || undefined,
        eventCategories: form.value.eventCategories,
      })
      ElMessage.success(t('chatIntegrations.created'))
    }
    dialogVisible.value = false
    if (props.embedded) {
      await fetchAllPlatforms()
    } else {
      await fetchIntegrations()
    }
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Save failed'))
  } finally {
    saving.value = false
  }
}

async function testIntegration(row: Record<string, unknown>) {
  try {
    const { data } = await client.post(`/integrations/chat/${row.id as string}/test`)
    testResult.value = data
    testResultVisible.value = true
  } catch (err: unknown) {
    testResult.value = {
      success: false,
      message: apiErrorMessage(err, 'Test failed'),
    }
    testResultVisible.value = true
  }
}

async function confirmDelete(row: Record<string, unknown>) {
  try {
    await ElMessageBox.confirm(
      t('chatIntegrations.deleteConfirm', { name: row.name }),
      t('common.confirm'),
      { type: 'warning' },
    )
    await client.delete(`/integrations/chat/${row.id}`)
    ElMessage.success(t('chatIntegrations.deleted'))
    if (props.embedded) {
      await fetchAllPlatforms()
    } else {
      await fetchIntegrations()
    }
  } catch {
    // cancelled
  }
}

async function fetchDeliveries() {
  if (!selectedIntegration.value) return
  const offset = (deliveryPage.value - 1) * deliveryPagination.value.limit
  try {
    const { data } = await client.get(
      `/integrations/chat/${selectedIntegration.value.id}/deliveries`,
      { params: { limit: deliveryPagination.value.limit, offset } },
    )
    deliveries.value = data.data || []
    deliveryPagination.value = data.pagination || deliveryPagination.value
  } catch {
    deliveries.value = []
  }
}

function onDeliveryPageChange(page: number) {
  deliveryPage.value = page
  fetchDeliveries()
}

onMounted(() => {
  if (props.embedded) {
    fetchAllPlatforms()
  } else {
    fetchIntegrations()
  }
})
</script>

<style scoped lang="scss">
.chat-integrations-container {
  padding: var(--cat-spacing-4);

  &.embedded-mode {
    padding: 0;
  }
}

.chat-integrations-content {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.platform-tabs {
  margin-bottom: var(--cat-spacing-2);
}

.loading-container {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  padding: var(--cat-spacing-6);
  color: var(--cat-text-secondary);
}

.error-container {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
}

.actions-bar {
  display: flex;
  justify-content: flex-end;
}

.empty-state {
  padding: var(--cat-spacing-6);
  text-align: center;
  color: var(--cat-text-secondary);
}

.stacked-platforms {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-5);
}

.platform-section {
  background: var(--cat-bg-primary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.platform-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);

  h3 {
    margin: 0;
    font-size: var(--cat-font-size-md);
    font-weight: var(--cat-font-weight-semibold);
    color: var(--cat-text-primary);
  }
}

.empty-state-inline {
  padding: var(--cat-spacing-4);
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-sm);
}

.category-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.event-summary {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
  cursor: default;
}

.row-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
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

  &--active {
    background-color: rgba(63, 185, 80, 0.15);
    color: #3fb950;
  }

  &--disabled {
    background-color: rgba(248, 81, 73, 0.15);
    color: #f85149;
  }
}

.delivery-log-section {
  margin-top: var(--cat-spacing-4);
  padding: var(--cat-spacing-4);
  background: var(--cat-bg-primary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);

  h4 {
    margin: 0 0 var(--cat-spacing-2);
    font-size: var(--cat-font-size-md);
  }
}

.pagination-bar {
  display: flex;
  justify-content: center;
  margin-top: var(--cat-spacing-3);
}

.form-hint {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  margin-top: 4px;
}

.setup-guide {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
}

.env-example {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  padding: var(--cat-spacing-3);
  font-family: var(--cat-font-mono);
  font-size: var(--cat-font-size-xs);
  margin: var(--cat-spacing-2) 0;
}
</style>
