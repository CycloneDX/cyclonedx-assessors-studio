<template>
  <div class="projects-container">
    <PageHeader :title="t('projects.title')">
      <template #actions>
        <el-button v-if="authStore.hasPermission('admin.import')" @click="showImportAttestationDialog = true">
          <el-icon class="mr-2"><Upload /></el-icon>
          {{ t('common.importAttestation') }}
        </el-button>
        <el-button v-if="authStore.hasPermission('projects.create')" type="primary" @click="showCreateDialog">
          {{ t('projects.newProject') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="projects-content">
      <!-- Error Alert -->
      <el-alert v-if="error" type="error" :closable="true" @close="error = ''">
        {{ error }}
      </el-alert>

      <div class="filter-bar" role="search">
        <el-select v-model="filterState" :placeholder="t('projects.filterByState')" class="w-150" clearable aria-label="Filter by state">
          <el-option :label="t('projects.allStates')" value=""></el-option>
          <el-option :label="t('states.new')" value="new"></el-option>
          <el-option :label="t('states.in_progress')" value="in_progress"></el-option>
          <el-option :label="t('states.on_hold')" value="on_hold"></el-option>
          <el-option :label="t('states.complete')" value="complete"></el-option>
          <el-option :label="t('states.operational')" value="operational"></el-option>
          <el-option :label="t('states.retired')" value="retired"></el-option>
        </el-select>

        <el-autocomplete
          v-model="filterTag"
          :fetch-suggestions="fetchTagSuggestions"
          :placeholder="t('projects.filterByTag')"
          class="w-160 tag-filter-autocomplete"
          popper-class="tag-filter-popper"
          clearable
          value-key="name"
          :trigger-on-focus="true"
          aria-label="Filter by tag"
        >
          <template #default="scope">
            <span v-if="scope?.item" class="tag-display-pill" :style="tagPillStyle(scope.item.color)">
              {{ scope.item.name }}
            </span>
          </template>
        </el-autocomplete>

        <el-input v-model="searchText" :placeholder="t('projects.searchPlaceholder')" class="w-250" clearable aria-label="Search projects" />
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p>{{ t('common.loading') }}</p>
      </div>

      <!-- Empty State -->
      <div v-if="!loading && filteredProjects.length === 0" class="empty-state-contextual">
        <el-icon :size="48"><FolderOpened /></el-icon>
        <h3>{{ t('projects.noProjects') }}</h3>
        <p>{{ t('projects.noProjectsDescription') }}</p>
        <el-button type="primary" @click="showCreateDialog">{{ t('projects.newProject') }}</el-button>
      </div>

      <!-- Table -->
      <el-table v-else :data="filteredProjects" stripe border @row-click="navigateToProject" aria-label="Projects table">
        <el-table-column prop="name" :label="t('projects.name')" min-width="200" sortable></el-table-column>
        <el-table-column :label="t('projects.standards')" min-width="140">
          <template #default="{ row }">
            <el-tooltip
              v-if="(row.standards || []).length > 0"
              placement="top"
              :show-after="300"
            >
              <template #content>
                <div v-for="std in row.standards" :key="std.id" class="whitespace-nowrap">
                  {{ std.name }}{{ std.version ? ` v${std.version}` : '' }}
                </div>
              </template>
              <span class="standards-count">{{ (row.standards || []).length }} {{ (row.standards || []).length === 1 ? 'standard' : 'standards' }}</span>
            </el-tooltip>
            <span v-else class="standards-count none">0 standards</span>
          </template>
        </el-table-column>
        <el-table-column prop="state" :label="t('projects.state')" min-width="120" sortable>
          <template #default="{ row }">
            <StateBadge :state="row.state" />
          </template>
        </el-table-column>
        <el-table-column :label="t('common.tags')" min-width="180">
          <template #default="{ row }">
            <span
              v-for="tag in (row.tags || [])"
              :key="tag.name"
              class="tag-display-pill"
              :style="tagPillStyle(tag.color)"
            >{{ tag.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" :label="t('projects.created')" min-width="140" sortable>
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" min-width="100">
          <template #default="{ row }">
            <RowActions @edit="openEditDialog(row)" @delete="deleteProject(row)" />
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="totalCount"
        layout="total, prev, pager, next"
      />
    </div>

    <!-- Create/Edit Project Dialog -->
    <el-dialog
      v-model="showDialog"
      :title="isEditMode ? t('common.edit') : t('projects.newProject')"
      width="600px"
      @close="resetForm"
    >
      <el-form :model="dialogForm" label-width="120px" :rules="formRules" ref="formRef">
        <el-form-item :label="t('projects.name')" prop="name">
          <el-input v-model="dialogForm.name" :placeholder="t('projects.name')" />
        </el-form-item>

        <el-form-item :label="t('projects.description')" prop="description">
          <el-input v-model="dialogForm.description" type="textarea" :rows="3" :placeholder="t('projects.description')" />
        </el-form-item>

        <el-form-item :label="t('projects.standards')" prop="standardIds">
          <el-select v-model="dialogForm.standardIds" multiple placeholder="Select standards" class="w-full">
            <el-option v-for="std in availableStandards" :key="std.id" :label="std.version ? `${std.name} v${std.version}` : std.name" :value="std.id"></el-option>
          </el-select>
        </el-form-item>

        <el-form-item :label="t('common.tags')">
          <TagInput v-model="dialogForm.tags" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveProject">
          {{ t('common.save') }}
        </el-button>
      </template>
    </el-dialog>
    <!-- Import Attestation Dialog -->
    <el-dialog v-model="showImportAttestationDialog" :title="t('common.importCycloneDXAttestation')" width="600px" @close="resetImport">
      <div class="import-instructions">
        <p>Upload a CycloneDX JSON file containing attestation declarations. Standards included in the document will be imported and deduplicated against existing standards.</p>
      </div>

      <el-upload
        :auto-upload="false"
        :limit="1"
        accept=".json,.cdx.json"
        :on-change="handleImportFileChange"
        drag
      >
        <el-icon :size="48" class="text-tertiary"><Upload /></el-icon>
        <div class="mt-3">Drop a CycloneDX JSON file here or click to select</div>
      </el-upload>

      <div v-if="importPreview" class="import-preview">
        <h4>Document Preview</h4>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="Spec Version">{{ importPreview.specVersion }}</el-descriptions-item>
          <el-descriptions-item label="Serial Number">{{ importPreview.serialNumber || 'N/A' }}</el-descriptions-item>
          <el-descriptions-item label="Standards">{{ importPreview.standardCount }}</el-descriptions-item>
          <el-descriptions-item label="Claims">{{ importPreview.claimCount }}</el-descriptions-item>
          <el-descriptions-item label="Evidence">{{ importPreview.evidenceCount }}</el-descriptions-item>
          <el-descriptions-item label="Attestations">{{ importPreview.attestationCount }}</el-descriptions-item>
          <el-descriptions-item label="Signatories">{{ importPreview.signatoryCount }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div v-if="importResult" class="import-result">
        <el-alert type="success" :closable="false" show-icon>
          <template #title>Import Successful</template>
          <div>
            <p v-for="(line, i) in importResult.importLog" :key="i">{{ line }}</p>
          </div>
        </el-alert>
      </div>

      <template #footer>
        <el-button @click="showImportAttestationDialog = false">{{ importResult ? 'Close' : t('common.cancel') }}</el-button>
        <el-button v-if="!importResult" type="primary" :loading="importing" :disabled="!importData" @click="executeImport">
          Import
        </el-button>
        <el-button v-if="importResult" type="primary" @click="navigateToImportedProject">
          View Project
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Upload, FolderOpened } from '@element-plus/icons-vue'
import client from '@/api/client'
import type { Project, Standard, Tag } from '@/types'
import PageHeader from '@/components/shared/PageHeader.vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import RowActions from '@/components/shared/RowActions.vue'
import TagInput from '@/components/shared/TagInput.vue'
import { tagPillStyle } from '@/utils/tagColor'
import { listTags } from '@/api/tags'

const router = useRouter()
const authStore = useAuthStore()
const { t } = useI18n()

// State
const loading = ref(true)
const error = ref('')
const projects = ref<(Project & { standards?: Standard[]; tags?: Tag[] })[]>([])
const availableStandards = ref<Standard[]>([])
// Catalog of tags used to power the filter typeahead. Loaded once on
// mount; admin changes to the tag library after that show up on
// navigation/refresh, which is acceptable since tag edits are rare.
const availableTags = ref<Tag[]>([])
const showDialog = ref(false)
const saving = ref(false)
const isEditMode = ref(false)
const filterState = ref('')
const filterTag = ref('')
const searchText = ref('')
const formRef = ref()
const currentPage = ref(1)
const pageSize = ref(20)

// Form
const dialogForm = ref({
  id: '',
  name: '',
  description: '',
  standardIds: [] as string[],
  tags: [] as string[]
})

const formRules = {
  name: [{ required: true, message: 'Name is required', trigger: 'blur' }],
  standardIds: [{ required: true, type: 'array', min: 1, message: 'At least one standard is required', trigger: 'change' }]
}

const filteredProjects = computed(() => {
  const filtered = projects.value.filter(project => {
    const matchesState = !filterState.value || project.state === filterState.value
    const matchesTag = !filterTag.value || (project.tags || []).some((t) => t.name.toLowerCase().includes(filterTag.value.toLowerCase()))
    const matchesSearch = !searchText.value ||
      project.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
      (project.description || '').toLowerCase().includes(searchText.value.toLowerCase())
    return matchesState && matchesTag && matchesSearch
  })
  return filtered.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value)
})

const totalCount = computed(() => {
  return projects.value.filter(project => {
    const matchesState = !filterState.value || project.state === filterState.value
    const matchesTag = !filterTag.value || (project.tags || []).some((t) => t.name.toLowerCase().includes(filterTag.value.toLowerCase()))
    const matchesSearch = !searchText.value ||
      project.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
      (project.description || '').toLowerCase().includes(searchText.value.toLowerCase())
    return matchesState && matchesTag && matchesSearch
  }).length
})

// Methods
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString()
}

const fetchProjects = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await client.get('/projects', { params: { limit: 100 } })
    projects.value = response.data.data || []
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    error.value = e.response?.data?.error || 'Failed to load projects'
  } finally {
    loading.value = false
  }
}

const fetchStandards = async () => {
  try {
    const response = await client.get('/standards')
    availableStandards.value = response.data.data || []
  } catch (err: unknown) {
    console.error('Failed to load standards:', err)
  }
}


const showCreateDialog = async () => {
  isEditMode.value = false
  resetForm()
  await fetchStandards()
  showDialog.value = true
}

const openEditDialog = async (row: Project & { standards?: Standard[]; tags?: Tag[] }) => {
  isEditMode.value = true
  dialogForm.value = {
    id: row.id,
    name: row.name,
    description: row.description,
    standardIds: (row.standards || []).map((s) => s.id),
    tags: (row.tags || []).map((t) => t.name)
  }
  await fetchStandards()
  showDialog.value = true
}

const saveProject = async () => {
  if (!formRef.value) return

  await formRef.value.validate()

  saving.value = true
  try {
    if (isEditMode.value) {
      await client.put(`/projects/${dialogForm.value.id}`, {
        name: dialogForm.value.name,
        description: dialogForm.value.description,
        standardIds: dialogForm.value.standardIds,
        tags: dialogForm.value.tags
      })
      ElMessage.success('Project updated successfully')
    } else {
      await client.post('/projects', {
        name: dialogForm.value.name,
        description: dialogForm.value.description,
        standardIds: dialogForm.value.standardIds,
        tags: dialogForm.value.tags
      })
      ElMessage.success('Project created successfully')
    }
    showDialog.value = false
    await fetchProjects()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to save project')
  } finally {
    saving.value = false
  }
}

const deleteProject = (row: Project) => {
  ElMessageBox.confirm('Are you sure you want to delete this project?', 'Warning', {
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
    type: 'warning'
  })
    .then(async () => {
      try {
        await client.delete(`/projects/${row.id}`)
        ElMessage.success('Project deleted successfully')
        await fetchProjects()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } }
        ElMessage.error(e.response?.data?.error || 'Failed to delete project')
      }
    })
    .catch(() => {
      ElMessage.info('Delete cancelled')
    })
}

const resetForm = () => {
  dialogForm.value = {
    id: '',
    name: '',
    description: '',
    standardIds: [] as string[],
    tags: [] as string[]
  }
  formRef.value?.clearValidate()
}

const navigateToProject = (row: Project) => {
  router.push(`/projects/${row.id}`)
}

// Import attestation state
const showImportAttestationDialog = ref(false)
const importing = ref(false)
const importData = ref<any | null>(null)
const importPreview = ref<any | null>(null)
const importResult = ref<any | null>(null)

const handleImportFileChange = (file: any) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target?.result as string)
      if (json.bomFormat !== 'CycloneDX') {
        ElMessage.error('Not a valid CycloneDX document')
        return
      }
      importData.value = json
      importPreview.value = {
        specVersion: json.specVersion || 'Unknown',
        serialNumber: json.serialNumber || null,
        standardCount: (json.definitions?.standards as Array<unknown> | undefined)?.length || 0,
        claimCount: (json.declarations?.claims as Array<unknown> | undefined)?.length || 0,
        evidenceCount: (json.declarations?.evidence as Array<unknown> | undefined)?.length || 0,
        attestationCount: (json.declarations?.attestations as Array<unknown> | undefined)?.length || 0,
        signatoryCount: (json.declarations?.affirmation?.signatories as Array<unknown> | undefined)?.length || 0,
      }
    } catch {
      ElMessage.error('Failed to parse JSON file')
    }
  }
  reader.readAsText((file as { raw: File }).raw)
}

const executeImport = async () => {
  if (!importData.value) return
  importing.value = true
  try {
    const { data } = await client.post('/import/attestation', importData.value)
    importResult.value = data
    await fetchProjects()
    ElMessage.success('Attestation imported successfully')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Import failed')
  } finally {
    importing.value = false
  }
}

const navigateToImportedProject = () => {
  if (importResult.value?.projectId) {
    router.push(`/projects/${importResult.value.projectId}`)
  }
  showImportAttestationDialog.value = false
}

const resetImport = () => {
  importData.value = null
  importPreview.value = null
  importResult.value = null
}

async function fetchAvailableTags() {
  try {
    availableTags.value = await listTags()
  } catch {
    // A missing tag catalog should not block the projects list; the
    // filter typeahead just falls back to showing nothing.
    availableTags.value = []
  }
}

// Typeahead callback. We match case-insensitively against the name
// and surface full Tag objects so the suggestion template can style
// each pill with its configured colour.
function fetchTagSuggestions(queryString: string, cb: (results: Tag[]) => void) {
  const q = (queryString || '').trim().toLowerCase()
  const all = availableTags.value
  const matches = q ? all.filter((tag) => tag.name.toLowerCase().includes(q)) : all
  cb(matches)
}

onMounted(() => {
  fetchProjects()
  fetchAvailableTags()
})
</script>

<style scoped lang="scss">
.projects-container {
  padding: 0;
}

.projects-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.filter-bar {
  display: flex;
  gap: var(--cat-spacing-4);
  margin-bottom: var(--cat-spacing-4);
}

:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}

.import-instructions {
  margin-bottom: var(--cat-spacing-4);
  color: var(--cat-text-secondary);
  font-size: var(--cat-font-size-sm);
}

.import-preview {
  margin-top: var(--cat-spacing-4);

  h4 {
    margin-bottom: var(--cat-spacing-2);
    font-weight: var(--cat-font-weight-medium);
  }
}

.import-result {
  margin-top: var(--cat-spacing-4);
}

.standards-count {
  font-size: var(--cat-font-size-sm, 0.875rem);
  color: var(--cat-text-primary);
  cursor: default;
  border-bottom: 1px dashed var(--cat-text-tertiary);

  &.none {
    color: var(--cat-text-tertiary);
    border-bottom: none;
  }
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--cat-spacing-8);
  color: var(--cat-text-tertiary);

  .el-icon {
    font-size: 32px;
    margin-bottom: var(--cat-spacing-3);
  }
}

.empty-state-contextual {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--cat-text-secondary);

  .el-icon {
    color: var(--cat-text-tertiary);
    margin-bottom: 16px;
  }

  h3 {
    margin: 0 0 8px;
    color: var(--cat-text-primary);
    font-size: 16px;
  }

  p {
    margin: 0 0 20px;
    max-width: 400px;
    line-height: 1.5;
  }
}
</style>
