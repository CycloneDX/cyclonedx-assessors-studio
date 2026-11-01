<template>
  <div class="admin-assessors-container" :class="{ 'admin-assessors-container--embedded': embedded }">
    <PageHeader
      v-if="!embedded"
      :title="t('assessorsAdmin.title')"
      :subtitle="t('assessorsAdmin.subtitle')"
    >
      <template #actions>
        <el-button
          v-if="canManage"
          type="primary"
          @click="openCreateDialog"
        >
          {{ t('assessorsAdmin.create') }}
        </el-button>
      </template>
    </PageHeader>

    <div v-if="embedded && canManage" class="admin-assessors-toolbar">
      <el-button type="primary" @click="openCreateDialog">
        {{ t('assessorsAdmin.create') }}
      </el-button>
    </div>

    <div class="admin-assessors-content">
      <div class="filter-bar" role="search" :aria-label="t('common.filters')">
        <div class="filter-field">
          <label class="filter-label" :for="searchId">{{ t('common.search') }}</label>
          <el-input
            :id="searchId"
            v-model="search"
            :placeholder="t('assessorsAdmin.searchPlaceholder')"
            clearable
          />
        </div>

        <div class="filter-field">
          <label class="filter-label" :for="typeFilterId">{{ t('assessorsAdmin.type') }}</label>
          <el-select
            :id="typeFilterId"
            v-model="typeFilter"
            clearable
            :placeholder="t('common.all')"
          >
            <el-option :label="t('assessorsAdmin.internal')" value="internal" />
            <el-option :label="t('assessorsAdmin.thirdParty')" value="thirdParty" />
          </el-select>
        </div>
      </div>

      <div v-if="loading" class="loading-container" role="status" aria-live="polite">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchAll" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <div v-if="filteredAssessors.length === 0" class="empty-state">
          <p>{{ t('assessorsAdmin.empty') }}</p>
        </div>

        <el-table
          v-else
          :data="filteredAssessors"
          stripe
          border
          :aria-label="t('assessorsAdmin.tableLabel')"
          @row-click="handleRowClick"
        >
          <el-table-column prop="bomRef" :label="t('assessorsAdmin.bomRef')" min-width="180">
            <template #default="{ row }">
              <code class="id-cell">{{ row.bomRef }}</code>
            </template>
          </el-table-column>
          <el-table-column :label="t('assessorsAdmin.entity')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.entityName">{{ row.entityName }}</span>
              <span v-else class="empty-cell">-</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('assessorsAdmin.user')" min-width="180">
            <template #default="{ row }">
              <span v-if="row.userDisplayName">{{ row.userDisplayName }}</span>
              <span v-else class="empty-cell">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="thirdParty" :label="t('assessorsAdmin.type')" width="140">
            <template #default="{ row }">
              <span class="type-badge" :class="row.thirdParty ? 'type-badge--thirdParty' : 'type-badge--internal'">
                {{ row.thirdParty ? t('assessorsAdmin.thirdParty') : t('assessorsAdmin.internal') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" :label="t('common.createdAt')" min-width="170">
            <template #default="{ row }">
              {{ formatDateTime(row.createdAt) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="140">
            <template #default="{ row }">
              <RowActions
                :show-view="true"
                :show-edit="canManage"
                :show-delete="canManage"
                @view="openDetail(row)"
                @edit="openEditDialog(row)"
                @delete="handleDelete(row)"
              />
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>

    <el-dialog
      v-model="showDialog"
      :title="isEditing ? t('assessorsAdmin.edit') : t('assessorsAdmin.create')"
      width="560px"
      @close="handleDialogClose"
    >
      <el-form :model="form" label-width="160px" @submit.prevent="handleSave">
        <el-form-item :label="t('assessorsAdmin.type')" required>
          <el-radio-group v-model="form.thirdParty" :disabled="saving">
            <el-radio :value="false">{{ t('assessorsAdmin.internal') }}</el-radio>
            <el-radio :value="true">{{ t('assessorsAdmin.thirdParty') }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item :label="t('assessorsAdmin.entity')">
          <SearchSelect
            v-model="form.entityId"
            :options="entityOptions"
            :placeholder="t('assessorsAdmin.selectEntity')"
            :loading="entitiesLoading"
          />
          <div class="form-hint">{{ t('assessorsAdmin.entityHint') }}</div>
        </el-form-item>

        <el-form-item :label="t('assessorsAdmin.user')" v-if="!form.thirdParty">
          <SearchSelect
            v-model="form.userId"
            :options="userOptions"
            :placeholder="t('assessorsAdmin.selectUser')"
            :loading="usersLoading"
          />
          <div class="form-hint">{{ t('assessorsAdmin.userHint') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false" :disabled="saving">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showDetailDialog"
      :title="t('assessorsAdmin.detailTitle')"
      width="720px"
    >
      <div v-if="detailLoading" class="loading-container">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>
      <template v-else-if="detail">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">{{ t('assessorsAdmin.bomRef') }}</span>
            <code class="detail-value detail-value--mono">{{ detail.bomRef }}</code>
          </div>
          <div class="detail-item">
            <span class="detail-label">{{ t('assessorsAdmin.type') }}</span>
            <span class="detail-value">
              {{ detail.thirdParty ? t('assessorsAdmin.thirdParty') : t('assessorsAdmin.internal') }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">{{ t('assessorsAdmin.entity') }}</span>
            <span class="detail-value">{{ detail.entityName || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">{{ t('assessorsAdmin.user') }}</span>
            <span class="detail-value">{{ detail.userDisplayName || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">{{ t('common.createdAt') }}</span>
            <span class="detail-value">{{ formatDateTime(detail.createdAt) }}</span>
          </div>
        </div>

        <h4 class="detail-section-heading">{{ t('assessorsAdmin.attestations') }}</h4>
        <div v-if="detail.attestations.length === 0" class="empty-state-small">
          <p>{{ t('assessorsAdmin.noAttestations') }}</p>
        </div>
        <el-table v-else :data="detail.attestations" stripe border size="small">
          <el-table-column prop="assessmentTitle" :label="t('assessorsAdmin.assessmentTitle')" min-width="220" />
          <el-table-column prop="summary" :label="t('common.summary')" min-width="200">
            <template #default="{ row }">
              <span v-if="row.summary">{{ row.summary }}</span>
              <span v-else class="empty-cell">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" :label="t('common.createdAt')" min-width="170">
            <template #default="{ row }">
              {{ formatDateTime(row.createdAt) }}
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="showDetailDialog = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import client from '@/api/client'
import PageHeader from '@/components/shared/PageHeader.vue'
import RowActions from '@/components/shared/RowActions.vue'
import SearchSelect from '@/components/shared/SearchSelect.vue'
import type { SelectOption } from '@/components/shared/SearchSelect.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/dateFormat'
import {
  listAssessors,
  getAssessor,
  createAssessor,
  updateAssessor,
  deleteAssessor,
  type Assessor,
  type AssessorDetail,
} from '@/api/assessors'
import { getEntities } from '@/api/entities'

const { t } = useI18n()
const authStore = useAuthStore()

// Embedded mode hides the PageHeader so the parent User Management
// view owns the heading. The primary action moves into a compact
// toolbar since the tab body needs to keep the el-tabs header visible
// at all times.
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const searchId = useId()
const typeFilterId = useId()

const assessors = ref<Assessor[]>([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const search = ref('')
const typeFilter = ref<'' | 'internal' | 'thirdParty'>('')

const showDialog = ref(false)
const isEditing = ref(false)
const editingId = ref<string | null>(null)

const showDetailDialog = ref(false)
const detail = ref<AssessorDetail | null>(null)
const detailLoading = ref(false)

const form = ref<{ thirdParty: boolean; entityId: string; userId: string }>({
  thirdParty: false,
  entityId: '',
  userId: '',
})

const entityOptions = ref<SelectOption[]>([])
const entitiesLoading = ref(false)
const userOptions = ref<SelectOption[]>([])
const usersLoading = ref(false)

const canManage = computed(() => authStore.hasPermission('assessments.manage'))

const filteredAssessors = computed(() => {
  let rows = assessors.value
  if (typeFilter.value === 'internal') {
    rows = rows.filter((r) => !r.thirdParty)
  } else if (typeFilter.value === 'thirdParty') {
    rows = rows.filter((r) => r.thirdParty)
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase()
    rows = rows.filter((r) => {
      return (
        r.bomRef.toLowerCase().includes(q) ||
        (r.entityName ?? '').toLowerCase().includes(q) ||
        (r.userDisplayName ?? '').toLowerCase().includes(q)
      )
    })
  }
  return rows
})

async function fetchAll() {
  loading.value = true
  error.value = ''
  try {
    assessors.value = await listAssessors()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || t('assessorsAdmin.loadError')
  } finally {
    loading.value = false
  }
}

async function fetchEntities() {
  entitiesLoading.value = true
  try {
    const { data } = await getEntities({ limit: 500 })
    // Entity list is served through /api/v1 so camelCaseResponse has
    // already rewritten entity_type -> entityType; mirror that here
    // rather than reading the pre-middleware snake_case shape.
    const rows = (data?.data ?? []) as Array<{ id: string; name: string; entityType: string | null }>
    entityOptions.value = rows.map((r) => ({
      value: r.id,
      label: r.name,
      description: r.entityType ?? undefined,
    }))
  } catch {
    entityOptions.value = []
  } finally {
    entitiesLoading.value = false
  }
}

async function fetchUsers() {
  usersLoading.value = true
  try {
    const { data } = await client.get('/users')
    const rows = (data?.data ?? []) as Array<{
      id: string
      username: string
      displayName: string | null
      isActive: boolean
    }>
    userOptions.value = rows
      .filter((u) => u.isActive)
      .map((u) => ({
        value: u.id,
        label: u.displayName || u.username,
        description: u.username,
      }))
  } catch {
    userOptions.value = []
  } finally {
    usersLoading.value = false
  }
}

function openCreateDialog() {
  form.value = { thirdParty: false, entityId: '', userId: '' }
  isEditing.value = false
  editingId.value = null
  showDialog.value = true
  // Refresh option lists so newly created entities/users show up.
  fetchEntities()
  fetchUsers()
}

function openEditDialog(row: Assessor) {
  form.value = {
    thirdParty: row.thirdParty,
    entityId: row.entityId ?? '',
    userId: row.userId ?? '',
  }
  isEditing.value = true
  editingId.value = row.id
  showDialog.value = true
  fetchEntities()
  fetchUsers()
}

function handleDialogClose() {
  form.value = { thirdParty: false, entityId: '', userId: '' }
  editingId.value = null
  isEditing.value = false
}

async function handleSave() {
  saving.value = true
  try {
    const payload = {
      thirdParty: form.value.thirdParty,
      entityId: form.value.entityId || null,
      // Clear user link when flipping to third party so stale mapping
      // cannot suggest a given user made an independent attestation.
      userId: form.value.thirdParty ? null : form.value.userId || null,
    }
    if (isEditing.value && editingId.value) {
      await updateAssessor(editingId.value, payload)
      ElMessage.success(t('assessorsAdmin.updateSuccess'))
    } else {
      await createAssessor(payload)
      ElMessage.success(t('assessorsAdmin.createSuccess'))
    }
    showDialog.value = false
    await fetchAll()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('assessorsAdmin.saveError'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: Assessor) {
  try {
    await ElMessageBox.confirm(
      t('assessorsAdmin.confirmDelete', { target: row.bomRef }),
      t('assessorsAdmin.deleteTitle'),
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
    await deleteAssessor(row.id)
    ElMessage.success(t('assessorsAdmin.deleteSuccess'))
    await fetchAll()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('assessorsAdmin.deleteError'))
  }
}

async function openDetail(row: Assessor) {
  showDetailDialog.value = true
  detail.value = null
  detailLoading.value = true
  try {
    detail.value = await getAssessor(row.id)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('assessorsAdmin.loadDetailError'))
    showDetailDialog.value = false
  } finally {
    detailLoading.value = false
  }
}

function handleRowClick(row: Assessor) {
  openDetail(row)
}

onMounted(() => {
  fetchAll()
})
</script>

<style scoped lang="scss">
.admin-assessors-container {
  padding: 0;
}

.admin-assessors-container--embedded {
  .admin-assessors-content {
    padding: 0;
  }
}

.admin-assessors-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--cat-spacing-3);
}

.admin-assessors-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--cat-spacing-3);
  align-items: end;
  padding: var(--cat-spacing-3);
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  margin-bottom: var(--cat-spacing-4);
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-label {
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  padding: var(--cat-spacing-3) 0;

  .retry-button {
    margin-top: var(--cat-spacing-2);
  }
}

.empty-state {
  text-align: center;
  padding: var(--cat-spacing-6);
  color: var(--cat-text-tertiary);
}

.empty-state-small {
  text-align: center;
  padding: var(--cat-spacing-4);
  color: var(--cat-text-tertiary);
}

.id-cell {
  font-family: var(--cat-font-mono);
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.empty-cell {
  color: var(--cat-text-tertiary);
}

.form-hint {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  margin-top: 4px;
}

.type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  line-height: 1.6;
  white-space: nowrap;

  &--internal {
    background-color: rgba(47, 129, 247, 0.15);
    color: #2f81f7;
  }

  &--thirdParty {
    background-color: rgba(210, 153, 34, 0.15);
    color: #d29922;
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--cat-spacing-3);
  margin-bottom: var(--cat-spacing-4);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.detail-value {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-primary);

  &--mono {
    font-family: var(--cat-font-mono);
  }
}

.detail-section-heading {
  margin: var(--cat-spacing-3) 0 var(--cat-spacing-2);
  font-size: var(--cat-font-size-md);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

:deep(.el-table tbody tr) {
  cursor: pointer;
}
</style>
