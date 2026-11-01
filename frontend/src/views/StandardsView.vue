<template>
  <div class="standards-container">
    <PageHeader :title="t('standards.title')">
      <template #actions>
        <el-badge v-if="authStore.hasPermission('standards.import')" :value="feedBadgeCount || ''" :hidden="feedBadgeCount === 0" type="danger">
          <el-button :icon="Refresh" :loading="feedChecking" @click="openFeedDialog">
            Check for Updates
          </el-button>
        </el-badge>
        <el-button v-if="authStore.hasPermission('standards.import')" type="primary" @click="showImportDialog = true">
          {{ t('standards.importStandard') }}
        </el-button>
        <el-button v-if="canManageStandards" type="success" @click="showCreateDialog = true">
          {{ t('standards.newStandard') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="standards-content">
      <div v-if="loading" class="standards-loading">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <el-alert v-else-if="error" type="error" show-icon :closable="false">
        {{ error }}
      </el-alert>

      <template v-else>
        <div class="standards-filters">
          <el-select v-model="filterState" :placeholder="t('standards.filterByState')" :aria-label="t('standards.filterByState')" clearable class="state-filter">
            <el-option :label="t('standards.all')" value=""></el-option>
            <el-option :label="t('standards.draft')" value="draft"></el-option>
            <el-option :label="t('standards.inReview')" value="in_review"></el-option>
            <el-option :label="t('standards.published')" value="published"></el-option>
            <el-option :label="t('standards.retired')" value="retired"></el-option>
          </el-select>
        </div>
        <el-table :data="paginatedData" stripe border @row-click="navigateToStandard" aria-label="Standards table">
          <el-table-column prop="name" :label="t('standards.name')" min-width="250" sortable></el-table-column>
          <el-table-column prop="version" :label="t('standards.version')" min-width="100" sortable></el-table-column>
          <el-table-column prop="owner" :label="t('standards.owner')" min-width="200" sortable></el-table-column>
          <el-table-column prop="state" :label="t('common.state')" min-width="120" sortable>
            <template #default="{ row }">
              <StateBadge :state="row.state" />
            </template>
          </el-table-column>
          <el-table-column prop="requirementsCount" :label="t('standards.requirements')" min-width="140" align="center" sortable></el-table-column>
          <el-table-column :label="t('common.actions')" min-width="100">
            <template #default="{ row }">
              <RowActions :show-edit="false" :show-view="true" :show-export="true" :show-delete="authStore.hasPermission('admin.settings') && (row.state === 'draft' || row.state === 'retired')" @view="navigateToStandard(row)" @export="handleExportStandard(row)" @delete="handleDeleteStandard(row)" />
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="totalCount"
          layout="total, prev, pager, next"
        />
      </template>
    </div>

    <!-- Create Standard Dialog -->
    <el-dialog v-model="showCreateDialog" :title="t('standards.newStandard')" width="550px" @close="resetCreateStandardForm">
      <el-form :model="createStandardForm" label-width="120px">
        <el-form-item :label="t('standards.name')" required>
          <el-input v-model="createStandardForm.name" placeholder="e.g. Internal Security Requirements" />
        </el-form-item>
        <el-form-item :label="t('standards.identifier')" required>
          <el-input v-model="createStandardForm.identifier" placeholder="e.g. ISR-1.0" />
        </el-form-item>
        <el-form-item :label="t('standards.version')">
          <el-input v-model="createStandardForm.version" placeholder="e.g. 1.0" />
        </el-form-item>
        <el-form-item :label="t('standards.owner')">
          <el-input v-model="createStandardForm.owner" placeholder="e.g. Security Team" />
        </el-form-item>
        <el-form-item :label="t('standards.description')">
          <el-input v-model="createStandardForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="creatingStandard" @click="handleCreateStandard">{{ t('standards.createDraft') }}</el-button>
      </template>
    </el-dialog>

    <!-- Import Standard Dialog -->
    <el-dialog v-model="showImportDialog" :title="t('standards.importStandard')" width="550px" @close="resetImportForm">
      <div v-if="!importPreview">
        <p class="mb-5 text-el-secondary">
          Select a CycloneDX JSON file containing a standards definition. The standard name, version, and requirements will be extracted automatically.
        </p>
        <el-upload
          :auto-upload="false"
          :limit="1"
          accept=".json,.cdx.json"
          :on-change="handleFileSelected"
          :on-remove="handleFileRemove"
          drag
        >
          <el-icon class="text-size-48 text-el-secondary mb-3"><Upload /></el-icon>
          <div>{{ t('standards.dropCycloneDXFile') }}</div>
          <template #tip>
            <div class="el-upload__tip">{{ t('standards.acceptsJsonFiles') }}</div>
          </template>
        </el-upload>
        <el-alert v-if="importParseError" type="error" :closable="false" class="mt-4">
          {{ importParseError }}
        </el-alert>
      </div>
      <div v-else>
        <el-descriptions :column="1" border>
          <el-descriptions-item :label="t('standards.name')">{{ importPreview.name }}</el-descriptions-item>
          <el-descriptions-item :label="t('standards.identifier')">{{ importPreview.identifier }}</el-descriptions-item>
          <el-descriptions-item v-if="importPreview.version" :label="t('standards.version')">{{ importPreview.version }}</el-descriptions-item>
          <el-descriptions-item v-if="importPreview.owner" :label="t('standards.owner')">{{ importPreview.owner }}</el-descriptions-item>
          <el-descriptions-item v-if="importPreview.description" :label="t('standards.description')">{{ importPreview.description }}</el-descriptions-item>
          <el-descriptions-item :label="t('standards.requirements')">{{ importPreview.requirementCount }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="showImportDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button v-if="importPreview" type="default" @click="importPreview = null; selectedFile = null;">
          {{ t('standards.back') }}
        </el-button>
        <el-button v-if="importPreview" type="primary" :loading="importing" @click="handleImport">
          {{ importing ? t('standards.importing') : t('standards.importStandard') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Feed / Check for Updates dialog -->
    <el-dialog v-model="showFeedDialog" title="CycloneDX Standards Feed" width="680px" destroy-on-close>
      <div class="feed-dialog-body">
        <!-- Header bar -->
        <div class="feed-dialog-meta">
          <span v-if="feedLastChecked" class="feed-last-checked">
            Last checked: {{ feedLastChecked.toLocaleString() }}
          </span>
          <div style="flex:1" />
          <el-button size="small" :icon="Refresh" :loading="feedChecking" @click="checkFeed(true)">
            Refresh
          </el-button>
        </div>

        <!-- Error -->
        <el-alert v-if="feedError" type="warning" :closable="false" style="margin-bottom:12px">
          Could not reach the CycloneDX standards feed: {{ feedError }}
        </el-alert>

        <!-- Loading -->
        <div v-if="feedChecking" class="feed-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          Checking for updates…
        </div>

        <!-- Up to date -->
        <el-result
          v-else-if="!feedError && feedAvailable.length === 0"
          icon="success"
          title="You're up to date"
          sub-title="All standards in the CycloneDX catalogue are already imported."
        />

        <!-- Available updates -->
        <template v-else-if="feedAvailable.length > 0">
          <p class="feed-available-label">
            {{ feedAvailable.length }} standard{{ feedAvailable.length !== 1 ? 's' : '' }} available from the CycloneDX catalogue:
          </p>
          <div class="feed-entry-list">
            <div v-for="entry in feedAvailable" :key="entry.feedId" class="feed-entry">
              <div class="feed-entry-info">
                <span class="feed-entry-name">{{ entry.title }}</span>
                <span class="feed-entry-version">v{{ entry.version }}</span>
                <span class="feed-entry-owner">{{ entry.owner }}</span>
                <p v-if="entry.summary" class="feed-entry-summary">{{ entry.summary }}</p>
              </div>
              <el-button
                type="primary"
                size="small"
                :icon="Download"
                :loading="feedImporting[entry.feedId]"
                @click="importFromFeed(entry)"
              >
                Import
              </el-button>
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="showFeedDialog = false">Close</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loading, Upload, Refresh, Download } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/shared/PageHeader.vue'
import RowActions from '@/components/shared/RowActions.vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import client from '@/api/client'

const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()

const loading = ref(true)
const error = ref('')
const standards = ref<Record<string, unknown>[]>([])
const showImportDialog = ref(false)
const importing = ref(false)
const selectedFile = ref<File | null>(null)
const importParseError = ref('')
const importPreview = ref<{
  name: string
  identifier: string
  version: string
  owner: string
  description: string
  requirementCount: number
  requirements: Record<string, unknown>[]
  levels: Record<string, unknown>[]
  rawJson: string
} | null>(null)
const showCreateDialog = ref(false)
const creatingStandard = ref(false)
const filterState = ref('')
const createStandardForm = ref({
  name: '',
  identifier: '',
  version: '',
  owner: '',
  description: '',
})
const currentPage = ref(1)
const pageSize = ref(20)

const fetchStandards = async () => {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get('/standards', { params: { limit: 100 } })
    standards.value = data.data || []
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    error.value = e.response?.data?.error || 'Failed to load standards'
  } finally {
    loading.value = false
  }
}

const navigateToStandard = (row: Record<string, unknown>) => {
  router.push(`/standards/${row.id as string}`)
}

const handleDeleteStandard = async (row: Record<string, unknown>) => {
  try {
    await ElMessageBox.confirm(
      `Delete "${row.name as string}"? This action cannot be undone.`,
      'Delete Standard',
      {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning',
      }
    )
    await client.delete(`/standards/${row.id as string}`)
    ElMessage.success('Standard deleted')
    await fetchStandards()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (err !== 'cancel' && e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to delete standard')
    }
  }
}

const handleExportStandard = async (row: Record<string, unknown>) => {
  try {
    const response = await client.get(`/standards/${row.id as string}/export`, {
      responseType: 'blob',
    })
    const blob = new Blob([response.data], { type: 'application/vnd.cyclonedx+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const slug = (row.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const suffix = row.version
      ? (row.version as string).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
      : new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, '')
    link.download = `${slug}-${suffix}.cdx.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to export standard')
  }
}

const handleFileSelected = async (file: Record<string, unknown>) => {
  selectedFile.value = (file.raw as File)
  importParseError.value = ''
  importPreview.value = null

  try {
    const text = await (file.raw as File).text()
    const json = JSON.parse(text)
    let stdMeta: Record<string, unknown> = {}
    let requirements: Record<string, unknown>[] = []
    let levels: Record<string, unknown>[] = []

    const parseRequirements = (reqs: Record<string, unknown>[]) => reqs.map((req: Record<string, unknown>) => ({
      identifier: (req['bom-ref'] || req.identifier || req.id || '') as string,
      name: (req.title || req.text || req.name || req.identifier || '') as string,
      description: (req.description || req.text || null) as string | null,
      openCre: (req.openCre || req['open-cre'] || null) as unknown,
      parentIdentifier: (req.parent || null) as string | null,
    }))

    const parseLevels = (lvls: Record<string, unknown>[]) => lvls.map((lvl: Record<string, unknown>) => ({
      identifier: (lvl['bom-ref'] || lvl.identifier || '') as string,
      title: (lvl.title || null) as string | null,
      description: (lvl.description || null) as string | null,
      requirements: (lvl.requirements || []) as unknown[],
    }))

    // CycloneDX definitions.standards format
    if (json.definitions?.standards) {
      const stds = json.definitions.standards
      if (Array.isArray(stds) && stds.length > 0) {
        const std = stds[0]
        stdMeta = {
          name: std.name || std.title || '',
          identifier: std['bom-ref'] || std.identifier || '',
          version: std.version || '',
          owner: std.owner || '',
          description: std.description || '',
        }
        if (std.requirements && Array.isArray(std.requirements)) {
          requirements = parseRequirements(std.requirements)
        }
        if (std.levels && Array.isArray(std.levels)) {
          levels = parseLevels(std.levels)
        }
      }
    }

    // Flat array of requirements (no standard metadata available)
    if (!stdMeta.name && Array.isArray(json)) {
      const fileName = (file.name as string).replace(/\.(cdx\.)?json$/, '')
      stdMeta = { name: fileName, identifier: '', version: '', owner: '', description: '' }
      requirements = parseRequirements(json)
    }

    // { requirements: [...] } format
    if (!stdMeta.name && json.requirements && Array.isArray(json.requirements)) {
      const fileName = (file.name as string).replace(/\.(cdx\.)?json$/, '')
      stdMeta = {
        name: json.name || json.title || fileName,
        identifier: json['bom-ref'] || json.identifier || '',
        version: json.version || '',
        owner: json.owner || '',
        description: json.description || '',
      }
      requirements = parseRequirements(json.requirements)
      if (json.levels && Array.isArray(json.levels)) {
        levels = parseLevels(json.levels)
      }
    }

    if (!stdMeta.name && !stdMeta.identifier) {
      importParseError.value = 'Could not extract standard metadata from this file. Please ensure it is a valid CycloneDX standards definition.'
      selectedFile.value = null
      return
    }

    importPreview.value = {
      name: (stdMeta.name as string) || '',
      identifier: (stdMeta.identifier as string) || '',
      version: (stdMeta.version as string) || '',
      owner: (stdMeta.owner as string) || '',
      description: (stdMeta.description as string) || '',
      requirementCount: requirements.length,
      requirements,
      levels,
      rawJson: text,
    }
  } catch (err: unknown) {
    const e = err as { message?: string }
    importParseError.value = `Failed to parse file: ${e.message || 'Unknown error'}`
    selectedFile.value = null
  }
}

const handleFileRemove = () => {
  selectedFile.value = null
  importPreview.value = null
  importParseError.value = ''
}

const handleImport = async () => {
  if (!importPreview.value) return

  importing.value = true
  try {
    await client.post('/standards/import', {
      name: importPreview.value.name,
      identifier: importPreview.value.identifier,
      version: importPreview.value.version || undefined,
      owner: importPreview.value.owner || undefined,
      description: importPreview.value.description || undefined,
      requirements: importPreview.value.requirements,
      levels: importPreview.value.levels.length > 0 ? importPreview.value.levels : undefined,
      sourceJson: importPreview.value.rawJson,
    })

    const count = importPreview.value.requirementCount
    ElMessage.success(`Standard imported successfully${count > 0 ? ` with ${count} requirements` : ''}`)
    showImportDialog.value = false
    resetImportForm()
    await fetchStandards()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to import standard')
  } finally {
    importing.value = false
  }
}

const resetImportForm = () => {
  importPreview.value = null
  importParseError.value = ''
  selectedFile.value = null
}

const canManageStandards = computed(() => {
  return authStore.hasAnyPermission('standards.create', 'standards.edit')
})

const filteredStandards = computed(() => {
  if (!filterState.value) {
    return standards.value
  }
  return standards.value.filter((standard) => standard.state === filterState.value)
})

const totalCount = computed(() => filteredStandards.value.length)

const paginatedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredStandards.value.slice(start, end)
})

watch(filterState, () => {
  currentPage.value = 1
})

const resetCreateStandardForm = () => {
  createStandardForm.value = {
    name: '',
    identifier: '',
    version: '',
    owner: '',
    description: '',
  }
}

const handleCreateStandard = async () => {
  if (!createStandardForm.value.name || !createStandardForm.value.identifier) {
    ElMessage.error('Name and Identifier are required')
    return
  }

  creatingStandard.value = true
  try {
    const { data } = await client.post('/standards', {
      name: createStandardForm.value.name,
      identifier: createStandardForm.value.identifier,
      version: createStandardForm.value.version || undefined,
      owner: createStandardForm.value.owner || undefined,
      description: createStandardForm.value.description || undefined,
    })

    ElMessage.success('Standard created successfully')
    showCreateDialog.value = false
    resetCreateStandardForm()
    await router.push(`/standards/${data.data.id as string}`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to create standard')
  } finally {
    creatingStandard.value = false
  }
}

// ─── Feed / update-check ──────────────────────────────────────────────────────

interface FeedEntry {
  feedId: string
  title: string
  version: string
  owner: string
  summary: string | null
  bomLink: string
  bomRef: string
  downloadUrl: string
  dateModified: string
}

const showFeedDialog   = ref(false)
const feedChecking     = ref(false)
const feedLastChecked  = ref<Date | null>(null)
const feedAvailable    = ref<FeedEntry[]>([])
const feedError        = ref('')
const feedImporting    = ref<Record<string, boolean>>({})

const feedBadgeCount = computed(() => feedAvailable.value.length)

async function checkFeed(force = false) {
  feedChecking.value = true
  feedError.value = ''
  try {
    const { data } = await client.get('/standards/feed/check', {
      params: force ? { force: 'true' } : {},
    })
    feedAvailable.value  = data.available ?? []
    feedLastChecked.value = data.lastChecked ? new Date(data.lastChecked) : new Date()
    if (data.error) feedError.value = data.error
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    feedError.value = e.response?.data?.error ?? 'Failed to reach standards feed'
  } finally {
    feedChecking.value = false
  }
}

async function importFromFeed(entry: FeedEntry) {
  feedImporting.value = { ...feedImporting.value, [entry.feedId]: true }
  try {
    await client.post('/standards/feed/import', {
      downloadUrl: entry.downloadUrl,
      title: entry.title,
    })
    ElMessage.success(`"${entry.title}" imported successfully`)
    feedAvailable.value = feedAvailable.value.filter(e => e.feedId !== entry.feedId)
    await fetchStandards()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error ?? 'Import failed')
  } finally {
    const updated = { ...feedImporting.value }
    delete updated[entry.feedId]
    feedImporting.value = updated
  }
}

async function openFeedDialog() {
  showFeedDialog.value = true
  if (feedLastChecked.value === null) await checkFeed()
}

onMounted(async () => {
  await fetchStandards()
  // Silently prime the feed cache so the badge populates quickly
  checkFeed().catch(() => {})
})
</script>

<style scoped lang="scss">
.standards-container {
  padding: 0;
}

.standards-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.standards-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--cat-text-secondary);
}

.standards-filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  align-items: center;

  .state-filter {
    width: 200px;
  }
}

:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}

// Feed dialog styles
.feed-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.feed-dialog-meta {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  gap: 8px;
}

.feed-last-checked {
  font-size: 12px;
  color: var(--cat-text-tertiary);
}

.feed-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: var(--cat-text-secondary);
}

.feed-available-label {
  font-size: 13px;
  color: var(--cat-text-secondary);
  margin: 0 0 12px;
}

.feed-entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.feed-entry {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);

  .el-button { flex-shrink: 0; margin-top: 2px; }
}

.feed-entry-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.feed-entry-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--cat-text-primary);
}

.feed-entry-version {
  font-size: 11px;
  font-weight: 600;
  color: var(--el-color-primary);
  font-family: var(--cat-font-mono);
}

.feed-entry-owner {
  font-size: 11px;
  color: var(--cat-text-tertiary);
}

.feed-entry-summary {
  font-size: 12px;
  color: var(--cat-text-secondary);
  margin: 4px 0 0;
  line-height: 1.4;
}
</style>
