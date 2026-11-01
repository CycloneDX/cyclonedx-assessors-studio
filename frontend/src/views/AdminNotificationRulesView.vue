<template>
  <div class="admin-notification-rules-container">
    <PageHeader :title="t('notificationRules.title')">
      <template #actions>
        <el-button type="primary" @click="openCreateDialog">{{ t('notificationRules.createRule') }}</el-button>
      </template>
    </PageHeader>

    <div class="admin-notification-rules-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchRules" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <div v-if="rules.length === 0" class="empty-state">
          <p>{{ t('notificationRules.noRules') }}</p>
          <p class="empty-state-hint">{{ t('notificationRules.noRulesDescription') }}</p>
        </div>

        <el-table v-else :data="rules" stripe border>
          <el-table-column prop="name" :label="t('common.name')" min-width="160" />
          <el-table-column :label="t('notificationRules.channel')" min-width="120">
            <template #default="{ row }">
              <el-tag>{{ t(`notificationRules.channels.${row.channel}`) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('notificationRules.eventTypes')" min-width="200">
            <template #default="{ row }">
              <div class="event-types-cell">
                <el-tag
                  v-for="eventType in (row.eventTypes || row.event_types || []).slice(0, 3)"
                  :key="eventType"
                  size="small"
                  class="mr-2 mb-2"
                >
                  {{ eventType }}
                </el-tag>
                <el-tag
                  v-if="(row.eventTypes || row.event_types || []).length > 3"
                  size="small"
                  class="mr-2 mb-2"
                >
                  +{{ (row.eventTypes || row.event_types || []).length - 3 }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="t('notificationRules.filters')" min-width="140">
            <template #default="{ row }">
              {{ formatFiltersSummary(row) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('common.status')" min-width="100">
            <template #default="{ row }">
              <el-switch
                v-model="row.enabled"
                :active-value="true"
                :inactive-value="false"
                @change="handleToggleEnabled(row)"
              />
            </template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="100">
            <template #default="{ row }">
              <div class="row-actions">
                <IconButton :icon="EditIcon" variant="primary" :tooltip="t('common.edit')" @click="openEditDialog(row)" />
                <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="handleDelete(row)" />
              </div>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="showDialog" :title="dialogTitle" width="700px" @close="resetForm">
      <el-form :model="form" label-width="140px">
        <!-- Rule Name -->
        <el-form-item :label="t('common.name')" required>
          <el-input
            v-model="form.name"
            :placeholder="t('notificationRules.namePlaceholder')"
          />
        </el-form-item>

        <!-- Channel -->
        <el-form-item :label="t('notificationRules.channel')" required>
          <el-select v-model="form.channel" @change="resetDestinationFields">
            <el-option
              v-for="channel in channels"
              :key="channel"
              :label="t(`notificationRules.channels.${channel}`)"
              :value="channel"
            />
          </el-select>
        </el-form-item>

        <!-- Event Types -->
        <el-form-item :label="t('notificationRules.eventTypes')" required>
          <el-select v-model="form.eventTypes" multiple placeholder="Select event types">
            <el-option-group
              v-for="(eventTypeGroup, category) in eventTypesByCategory"
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

        <!-- Channel-specific Destination Fields -->
        <el-form-item v-if="form.channel === 'email'" :label="t('notificationRules.emailAddresses')" required>
          <el-input
            v-model="form.destination"
            type="textarea"
            :rows="3"
            :placeholder="t('notificationRules.emailAddressesPlaceholder')"
          />
        </el-form-item>

        <el-form-item v-if="['slack', 'teams', 'mattermost'].includes(form.channel)" :label="t('notificationRules.chatIntegration')" required>
          <el-select
            v-model="form.destination"
            :loading="chatIntegrationsLoading"
            :placeholder="t('notificationRules.selectChatIntegration')"
          >
            <el-option
              v-for="integration in chatIntegrations"
              :key="integration.id"
              :label="integration.name || integration.display_name"
              :value="integration.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.channel === 'webhook'" :label="t('notificationRules.webhook')" required>
          <el-select
            v-model="form.destination"
            :loading="webhooksLoading"
            :placeholder="t('notificationRules.selectWebhook')"
          >
            <el-option
              v-for="webhook in webhooks"
              :key="webhook.id"
              :label="webhook.name"
              :value="webhook.id"
            />
          </el-select>
        </el-form-item>

        <!-- Filters -->
        <el-form-item :label="t('notificationRules.filters')">
          <div class="filters-section">
            <el-form-item :label="t('notificationRules.filterProject')">
              <SearchSelect
                v-model="form.filterProjectId"
                :options="projectOptions"
                :placeholder="t('notificationRules.selectProject')"
                :loading="projectsLoading"
              />
            </el-form-item>

            <el-form-item :label="t('notificationRules.filterStandard')">
              <SearchSelect
                v-model="form.filterStandardId"
                :options="standardOptions"
                :placeholder="t('notificationRules.selectStandard')"
                :loading="standardsLoading"
              />
            </el-form-item>
          </div>
        </el-form-item>

        <!-- Enabled -->
        <el-form-item :label="t('notificationRules.enabled')">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">{{ t('common.save') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Loading,
  Edit as EditIcon,
  Delete,
} from '@element-plus/icons-vue'
import client from '@/api/client'
import PageHeader from '@/components/shared/PageHeader.vue'
import IconButton from '@/components/shared/IconButton.vue'
import SearchSelect from '@/components/shared/SearchSelect.vue'
import type { SelectOption } from '@/components/shared/SearchSelect.vue'

interface NotificationRule {
  id: string
  name: string
  channel: string
  eventTypes?: string[]
  event_types?: string[]
  destination: string | Record<string, unknown>
  filters?: string | Record<string, unknown>
  filterProjectId?: string
  filter_project_id?: string
  filterStandardId?: string
  filter_standard_id?: string
  enabled: boolean
}

interface ChatIntegration {
  id: string
  name?: string
  display_name?: string
  type: string
}

interface Webhook {
  id: string
  name: string
  url: string
}

const { t } = useI18n()

const rules = ref<NotificationRule[]>([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const showDialog = ref(false)
const isEditing = ref(false)
const editingId = ref<string | null>(null)

const channels = ref(['email', 'slack', 'teams', 'mattermost', 'webhook'])

const eventTypesByCategory = ref({
  'Assessment': [
    'assessment.created',
    'assessment.state_changed',
    'assessment.deleted',
    'assessment.assigned'
  ],
  'Evidence': [
    'evidence.created',
    'evidence.state_changed',
    'evidence.attachment_added',
    'evidence.attachment_removed'
  ],
  'Claim': [
    'claim.created',
    'claim.updated'
  ],
  'Attestation': [
    'attestation.created',
    'attestation.signed',
    'attestation.exported'
  ],
  'Project': [
    'project.created',
    'project.state_changed',
    'project.archived'
  ],
  'Standard': [
    'standard.imported',
    'standard.state_changed'
  ],
  'System': [
    'user.created',
    'user.deactivated',
    'apikey.created'
  ]
})

const form = ref({
  name: '',
  channel: 'email',
  eventTypes: [] as string[],
  destination: '',
  filterProjectId: '',
  filterStandardId: '',
  enabled: true
})

const chatIntegrations = ref<ChatIntegration[]>([])
const chatIntegrationsLoading = ref(false)

const webhooks = ref<Webhook[]>([])
const webhooksLoading = ref(false)

const projectOptions = ref<SelectOption[]>([])
const projectsLoading = ref(false)

const standardOptions = ref<SelectOption[]>([])
const standardsLoading = ref(false)

const dialogTitle = computed(() =>
  isEditing.value ? t('notificationRules.editRule') : t('notificationRules.createRule')
)

// Safely parse a JSON string or return the value if already an object
const parseJsonField = (value: Record<string, unknown> | string | null): Record<string, unknown> => {
  if (!value) return {}
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value
}

// Extract destination string from the stored destination object
const extractDestinationString = (channel: string, dest: Record<string, unknown>): string => {
  if (channel === 'email') return (dest.emails as string) || ''
  if (['slack', 'teams', 'mattermost'].includes(channel)) return (dest.integrationId as string) || ''
  if (channel === 'webhook') return (dest.webhookId as string) || ''
  return ''
}

const fetchRules = async () => {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/admin/notification-rules')
    const rawRules = data.rules || data
    // Normalize JSON string fields from DB
    rules.value = rawRules.map((rule: Record<string, unknown>) => {
      const parsedFilters = parseJsonField(rule.filters as Record<string, unknown> | string)
      const parsedEventTypes = typeof rule.event_types === 'string'
        ? JSON.parse(rule.event_types)
        : rule.event_types
      return {
        ...rule,
        event_types: parsedEventTypes,
        destination: rule.destination,
        filters: parsedFilters,
        filterProjectId: (parsedFilters.projectId as string) || '',
        filterStandardId: (parsedFilters.standardId as string) || '',
      }
    })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    error.value = e.response?.data?.error || 'Failed to load notification rules'
  } finally {
    loading.value = false
  }
}

const fetchChatIntegrations = async () => {
  chatIntegrationsLoading.value = true
  try {
    const { data } = await client.get('/integrations/chat')
    chatIntegrations.value = data.integrations || data
  } catch (err: unknown) {
    ElMessage.error('Failed to load chat integrations')
  } finally {
    chatIntegrationsLoading.value = false
  }
}

const fetchWebhooks = async () => {
  webhooksLoading.value = true
  try {
    const { data } = await client.get('/webhooks')
    webhooks.value = data.webhooks || data
  } catch (err: unknown) {
    ElMessage.error('Failed to load webhooks')
  } finally {
    webhooksLoading.value = false
  }
}

const fetchProjectOptions = async () => {
  projectsLoading.value = true
  try {
    const { data } = await client.get('/projects', {
      params: { limit: 100 }
    })
    projectOptions.value = (data.data || []).map((project: Record<string, unknown>) => ({
      value: project.id as string,
      label: project.name as string
    }))
  } catch (err: unknown) {
    ElMessage.error('Failed to load projects')
  } finally {
    projectsLoading.value = false
  }
}

const fetchStandardOptions = async () => {
  standardsLoading.value = true
  try {
    const { data } = await client.get('/standards', {
      params: { limit: 100 }
    })
    standardOptions.value = (data.data || []).map((standard: Record<string, unknown>) => ({
      value: standard.id as string,
      label: standard.name as string
    }))
  } catch (err: unknown) {
    ElMessage.error('Failed to load standards')
  } finally {
    standardsLoading.value = false
  }
}

const resetDestinationFields = () => {
  form.value.destination = ''
}

const openCreateDialog = () => {
  isEditing.value = false
  editingId.value = null
  resetForm()
  fetchProjectOptions()
  fetchStandardOptions()
  showDialog.value = true
}

const openEditDialog = (rule: NotificationRule) => {
  isEditing.value = true
  editingId.value = rule.id

  // Parse destination object to extract the string value for the form field
  const parsedDest = parseJsonField(rule.destination)
  const destString = extractDestinationString(rule.channel, parsedDest)

  // Parse filters to extract project/standard IDs
  const parsedFilters = parseJsonField(rule.filters ?? null)

  form.value = {
    name: rule.name,
    channel: rule.channel,
    eventTypes: rule.eventTypes || rule.event_types || [],
    destination: destString,
    filterProjectId: rule.filterProjectId || (parsedFilters.projectId as string) || '',
    filterStandardId: rule.filterStandardId || (parsedFilters.standardId as string) || '',
    enabled: rule.enabled
  }
  fetchProjectOptions()
  fetchStandardOptions()
  showDialog.value = true
}

const resetForm = () => {
  form.value = {
    name: '',
    channel: 'email',
    eventTypes: [],
    destination: '',
    filterProjectId: '',
    filterStandardId: '',
    enabled: true
  }
  projectOptions.value = []
  standardOptions.value = []
}

const handleSave = async () => {
  if (!form.value.name || !form.value.channel || form.value.eventTypes.length === 0 || !form.value.destination) {
    ElMessage.error(t('notificationRules.validationError'))
    return
  }

  saving.value = true
  try {
    // Build destination object based on channel type
    const destination: Record<string, string> = {}
    if (form.value.channel === 'email') {
      destination.emails = form.value.destination
    } else if (['slack', 'teams', 'mattermost'].includes(form.value.channel)) {
      destination.integrationId = form.value.destination
    } else if (form.value.channel === 'webhook') {
      destination.webhookId = form.value.destination
    }

    // Build filters object
    const filters: Record<string, string> = {}
    if (form.value.filterProjectId) filters.projectId = form.value.filterProjectId
    if (form.value.filterStandardId) filters.standardId = form.value.filterStandardId

    const payload = {
      name: form.value.name,
      channel: form.value.channel,
      eventTypes: form.value.eventTypes,
      destination,
      filters,
      enabled: form.value.enabled
    }

    if (isEditing.value && editingId.value) {
      await client.put(`/admin/notification-rules/${editingId.value}`, payload)
      ElMessage.success(t('notificationRules.ruleSaved'))
    } else {
      await client.post('/admin/notification-rules', payload)
      ElMessage.success(t('notificationRules.ruleCreated'))
    }

    showDialog.value = false
    await fetchRules()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || t('notificationRules.saveFailed'))
  } finally {
    saving.value = false
  }
}

const handleToggleEnabled = async (rule: NotificationRule) => {
  try {
    await client.patch(`/admin/notification-rules/${rule.id}`, {
      enabled: rule.enabled
    })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || t('notificationRules.updateFailed'))
    rule.enabled = !rule.enabled
  }
}

const handleDelete = async (rule: NotificationRule) => {
  try {
    await ElMessageBox.confirm(
      t('notificationRules.deleteConfirmation'),
      t('notificationRules.deleteTitle'),
      { confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel'), type: 'warning' }
    )
    await client.delete(`/admin/notification-rules/${rule.id}`)
    ElMessage.success(t('notificationRules.ruleDeleted'))
    await fetchRules()
  } catch (err: unknown) {
    if (err !== 'cancel') {
      const e = err as { response?: { data?: { error?: string } } }
      ElMessage.error(e.response?.data?.error || t('notificationRules.deleteFailed'))
    }
  }
}

const formatFiltersSummary = (rule: NotificationRule): string => {
  const filters: string[] = []
  if (rule.filterProjectId || rule.filter_project_id) {
    filters.push('Project')
  }
  if (rule.filterStandardId || rule.filter_standard_id) {
    filters.push('Standard')
  }
  return filters.length > 0 ? filters.join(', ') : t('notificationRules.noFilters')
}

onMounted(async () => {
  await fetchRules()
  await fetchChatIntegrations()
  await fetchWebhooks()
})
</script>

<style scoped lang="scss">
.admin-notification-rules-container {
  padding: 0;
}

.admin-notification-rules-content {
  padding: var(--cat-spacing-6);
}

.loading-container,
.error-container {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-6);
  color: var(--cat-text-secondary);
}

.error-container {
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.retry-button {
  margin-top: var(--cat-spacing-2);
}

.empty-state {
  text-align: center;
  padding: var(--cat-spacing-8);

  p {
    margin: 0;
    color: var(--cat-text-secondary);

    &.empty-state-hint {
      font-size: var(--cat-font-size-sm);
      margin-top: var(--cat-spacing-2);
      color: var(--cat-text-tertiary);
    }
  }
}

.event-types-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

:deep(.el-form-item) {
  margin-bottom: var(--cat-spacing-4);

  &:last-of-type {
    margin-bottom: 0;
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

:deep(.el-dialog__body) {
  padding: var(--cat-spacing-4);
}

.row-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

:deep(.el-table) {
  width: 100%;
}
</style>
