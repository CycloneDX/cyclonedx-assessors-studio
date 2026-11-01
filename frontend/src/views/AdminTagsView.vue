<template>
  <div class="admin-tags-container">
    <PageHeader :title="t('tagsAdmin.title')" :subtitle="t('tagsAdmin.subtitle')">
      <template #actions>
        <el-button
          v-if="canManage"
          type="primary"
          @click="openCreateDialog"
        >
          {{ t('tagsAdmin.create') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="admin-tags-content">
      <div class="filter-bar" role="search" :aria-label="t('common.filters')">
        <div class="filter-field">
          <label class="filter-label" :for="searchId">{{ t('common.search') }}</label>
          <el-input
            :id="searchId"
            v-model="search"
            :placeholder="t('tagsAdmin.searchPlaceholder')"
            clearable
          />
        </div>
      </div>

      <div v-if="loading" class="loading-container" role="status" aria-live="polite">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchTags" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <div v-if="filteredTags.length === 0" class="empty-state">
          <p>{{ t('tagsAdmin.empty') }}</p>
        </div>

        <el-table
          v-else
          :data="filteredTags"
          stripe
          border
          :aria-label="t('tagsAdmin.tableLabel')"
        >
          <el-table-column prop="name" :label="t('common.name')" min-width="220">
            <template #default="{ row }">
              <span
                class="tag-display-pill"
                :style="pillStyle(row.color)"
              >
                {{ row.name }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="color" :label="t('tagsAdmin.color')" width="160">
            <template #default="{ row }">
              <div class="color-cell">
                <span class="color-swatch" :style="{ backgroundColor: row.color }" aria-hidden="true" />
                <code class="color-code">{{ row.color }}</code>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="usageCount" :label="t('tagsAdmin.usage')" width="110">
            <template #default="{ row }">
              <span :class="row.usageCount > 0 ? 'usage-count usage-count--active' : 'usage-count usage-count--zero'">
                {{ row.usageCount ?? 0 }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" :label="t('common.createdAt')" min-width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.createdAt) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="120">
            <template #default="{ row }">
              <RowActions
                v-if="canManage"
                :show-edit="true"
                :show-delete="true"
                @edit="openEditDialog(row)"
                @delete="handleDelete(row)"
              />
              <span v-else class="empty-cell">-</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </div>

    <el-dialog
      v-model="showDialog"
      :title="isEditing ? t('tagsAdmin.edit') : t('tagsAdmin.create')"
      width="480px"
      @close="handleDialogClose"
    >
      <el-form :model="form" label-width="120px" @submit.prevent="handleSave">
        <el-form-item :label="t('common.name')" required>
          <el-input
            v-model="form.name"
            :placeholder="t('tagsAdmin.namePlaceholder')"
            maxlength="100"
            show-word-limit
            :disabled="saving"
          />
        </el-form-item>
        <el-form-item :label="t('tagsAdmin.color')">
          <el-color-picker v-model="form.color" :disabled="saving" :predefine="presetColors" />
          <div class="form-hint">{{ t('tagsAdmin.colorHint') }}</div>
        </el-form-item>
        <el-form-item :label="t('common.preview')">
          <span
            class="tag-display-pill"
            :style="pillStyle(form.color)"
          >
            {{ form.name || t('tagsAdmin.namePlaceholder') }}
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false" :disabled="saving">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import RowActions from '@/components/shared/RowActions.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/dateFormat'
import { tagPillStyle as pillStyle } from '@/utils/tagColor'
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  type Tag,
} from '@/api/tags'

const { t } = useI18n()
const authStore = useAuthStore()

const searchId = useId()

const tags = ref<Tag[]>([])
const loading = ref(false)
const error = ref('')
const saving = ref(false)

const search = ref('')

const showDialog = ref(false)
const isEditing = ref(false)
const editingId = ref<string | null>(null)

const DEFAULT_COLOR = '#6366f1'

const form = ref<{ name: string; color: string }>({
  name: '',
  color: DEFAULT_COLOR,
})

// Tag names are stored lowercase (the backend normalizes and the DB enforces
// CHECK(name = LOWER(name))). Mirror that here so the preview shows what the
// server will actually save and users are not surprised by a silent rename.
watch(
  () => form.value.name,
  (value) => {
    const lowered = value.toLowerCase()
    if (lowered !== value) {
      form.value.name = lowered
    }
  },
)

const presetColors = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#64748b',
  '#475569',
]

// Mid session permission revocations only take effect on the next
// route change, so we double gate the management actions here as well.
const canManage = computed(() => authStore.hasPermission('admin.tags'))

const filteredTags = computed(() => {
  if (!search.value.trim()) return tags.value
  const q = search.value.trim().toLowerCase()
  return tags.value.filter((tag) => tag.name.toLowerCase().includes(q))
})

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

async function fetchTags() {
  loading.value = true
  error.value = ''
  try {
    tags.value = await listTags()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || t('tagsAdmin.loadError')
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  form.value = { name: '', color: DEFAULT_COLOR }
  isEditing.value = false
  editingId.value = null
  showDialog.value = true
}

function openEditDialog(row: Tag) {
  form.value = { name: row.name, color: row.color || DEFAULT_COLOR }
  isEditing.value = true
  editingId.value = row.id
  showDialog.value = true
}

function handleDialogClose() {
  form.value = { name: '', color: DEFAULT_COLOR }
  isEditing.value = false
  editingId.value = null
}

async function handleSave() {
  // Belt and suspenders: the input watcher already lowercases the field, but
  // if anything slips through (paste event, autofill, programmatic fill) we
  // normalize again here so the POST/PUT payload matches the DB constraint.
  const name = form.value.name.trim().toLowerCase()
  if (name.length < 1) {
    ElMessage.error(t('tagsAdmin.nameRequired'))
    return
  }
  if (name.length > 100) {
    ElMessage.error(t('tagsAdmin.nameTooLong'))
    return
  }
  // The backend rejects malformed colours with a 400. Surface a friendly
  // message client side instead of round tripping for an obvious case.
  if (!isValidHex(form.value.color)) {
    ElMessage.error(t('tagsAdmin.colorInvalid'))
    return
  }

  saving.value = true
  try {
    if (isEditing.value && editingId.value) {
      await updateTag(editingId.value, { name, color: form.value.color })
      ElMessage.success(t('tagsAdmin.updateSuccess'))
    } else {
      await createTag({ name, color: form.value.color })
      ElMessage.success(t('tagsAdmin.createSuccess'))
    }
    showDialog.value = false
    await fetchTags()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('tagsAdmin.saveError'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: Tag) {
  try {
    await ElMessageBox.confirm(
      t('tagsAdmin.confirmDelete', { name: row.name }),
      t('tagsAdmin.deleteTitle'),
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
    await deleteTag(row.id)
    ElMessage.success(t('tagsAdmin.deleteSuccess'))
    await fetchTags()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('tagsAdmin.deleteError'))
  }
}

onMounted(fetchTags)
</script>

<style scoped lang="scss">
.admin-tags-container {
  padding: 0;
}

.admin-tags-content {
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
  text-align: center;
  padding: 48px 0;
  color: var(--cat-text-tertiary);
}

// Layout, color, and fallback rules for .tag-display-pill live in the
// global stylesheet at @/assets/styles/_tags.scss so that teleported
// Element Plus poppers pick them up. The override below restricts
// overly long tag names so a malicious or fat fingered tag does not
// stretch the admin table viewport. The backend caps name at 100 chars
// already, but we are defensive here too.
.tag-display-pill {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}

// In the Create/Edit dialog the preview pill lives alone inside an
// el-form-item content flex row. The global pill rules add margin-right
// and margin-bottom intended for lists of pills; inside the dialog those
// margins pull the preview off the vertical centerline set by
// .el-form-item__content { align-items: center; }, so it no longer lines
// up with the "Preview" label. Reset them here for the dialog preview
// only.
:deep(.el-form-item) .tag-display-pill {
  margin-right: 0;
  margin-bottom: 0;
}

.usage-count {
  display: inline-block;
  min-width: 28px;
  padding: 1px 8px;
  border-radius: 12px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  text-align: center;

  &--active {
    background: rgba(63, 185, 80, 0.12);
    color: #3fb950;
    border: 1px solid rgba(63, 185, 80, 0.3);
  }

  &--zero {
    background: var(--cat-bg-secondary);
    color: var(--cat-text-tertiary);
    border: 1px solid var(--cat-border-default);
  }
}

.empty-cell {
  color: var(--cat-text-tertiary);
  font-style: italic;
}

.color-cell {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-spacing-2);
}

.color-swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--cat-border-default);
}

.color-code {
  font-family: var(--cat-font-mono);
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

// Sits next to the color picker inside an el-form-item flex row. The
// left margin puts breathing room between the swatch control and the
// hint text; the top margin preserves spacing if the row wraps on a
// narrow viewport.
.form-hint {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  margin-top: 4px;
  margin-left: var(--cat-spacing-3);
}
</style>
