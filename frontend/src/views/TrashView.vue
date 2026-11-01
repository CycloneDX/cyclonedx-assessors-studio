<template>
  <div class="trash-container">
    <PageHeader :title="t('trash.title')" :subtitle="t('trash.subtitle')">
      <template #actions>
        <el-button :disabled="loading" @click="fetchTrash">
          <el-icon><Refresh /></el-icon>
          <span>{{ t('common.refresh') }}</span>
        </el-button>
      </template>
    </PageHeader>

    <div class="trash-content">
      <div class="filter-bar" role="search" :aria-label="t('common.filters')">
        <div class="filter-field">
          <label class="filter-label" :for="searchId">{{ t('common.search') }}</label>
          <el-input :id="searchId" v-model="search" :placeholder="t('trash.searchPlaceholder')" clearable />
        </div>
        <div class="filter-field filter-field--narrow">
          <label class="filter-label" :for="typeId">{{ t('trash.resource') }}</label>
          <el-select :id="typeId" v-model="resourceFilter" clearable :placeholder="t('trash.allTypes')">
            <el-option v-for="r in resourceTypes" :key="r" :label="t(`trash.types.${r}`)" :value="r" />
          </el-select>
        </div>
      </div>

      <div v-if="loading" class="loading-container" role="status" aria-live="polite">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button class="retry-button" @click="fetchTrash">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <div v-if="filteredItems.length === 0" class="empty-state">
          <el-icon :size="32"><Delete /></el-icon>
          <p>{{ t('trash.empty') }}</p>
        </div>

        <el-table v-else :data="filteredItems" stripe border :aria-label="t('trash.title')">
          <el-table-column prop="resource" :label="t('trash.resource')" width="150">
            <template #default="{ row }">
              <el-tag size="small" :type="resourceTagType(row.resource)" disable-transitions>
                {{ t(`trash.types.${row.resource}`) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="label" :label="t('common.name')" min-width="240">
            <template #default="{ row }">
              <span class="item-label">{{ row.label || t('trash.untitled') }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="deletedAt" :label="t('trash.deletedAt')" min-width="180">
            <template #default="{ row }">{{ formatDateTime(row.deletedAt) }}</template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="140">
            <template #default="{ row }">
              <el-button
                size="small"
                type="primary"
                plain
                :loading="restoringId === row.id"
                @click="handleRestore(row)"
              >
                {{ t('trash.restore') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Loading, Refresh, Delete } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { formatDateTime } from '@/utils/dateFormat'
import { listTrash, restoreTrashItem, type TrashItem, type TrashResource } from '@/api/trash'

const { t } = useI18n()
const searchId = useId()
const typeId = useId()

const items = ref<TrashItem[]>([])
const loading = ref(false)
const error = ref('')
const restoringId = ref<string | null>(null)

const search = ref('')
const resourceFilter = ref<TrashResource | ''>('')
const resourceTypes: TrashResource[] = ['assessment', 'evidence', 'claim', 'mitigation']

const filteredItems = computed(() => {
  let list = items.value
  if (resourceFilter.value) list = list.filter((i) => i.resource === resourceFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter((i) => (i.label ?? '').toLowerCase().includes(q))
  return list
})

function resourceTagType(resource: TrashResource): 'primary' | 'success' | 'warning' | 'info' {
  switch (resource) {
    case 'assessment': return 'primary'
    case 'evidence': return 'success'
    case 'claim': return 'warning'
    default: return 'info'
  }
}

async function fetchTrash() {
  loading.value = true
  error.value = ''
  try {
    items.value = await listTrash()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || t('trash.loadError')
  } finally {
    loading.value = false
  }
}

async function handleRestore(row: TrashItem) {
  restoringId.value = row.id
  try {
    await restoreTrashItem(row.resource, row.id)
    ElMessage.success(t('trash.restoreSuccess'))
    items.value = items.value.filter((i) => i.id !== row.id)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('trash.restoreError'))
  } finally {
    restoringId.value = null
  }
}

onMounted(fetchTrash)
</script>

<style scoped lang="scss">
.trash-container {
  padding: 0;
}

.trash-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.filter-bar {
  display: flex;
  gap: var(--cat-spacing-4);
  flex-wrap: wrap;
  padding: var(--cat-spacing-4);
  background: var(--cat-bg-primary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
}

.filter-field {
  flex: 1;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-1);

  &--narrow {
    flex: 0 0 220px;
    min-width: 200px;
  }
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
    margin-top: 16px;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 48px 0;
  color: var(--cat-text-tertiary);
}

.item-label {
  color: var(--cat-text-primary);
}
</style>
