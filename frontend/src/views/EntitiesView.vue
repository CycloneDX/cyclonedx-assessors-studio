<template>
  <div class="entities-container">
    <PageHeader title="Entities">
      <template #actions>
        <el-button v-if="authStore.hasAnyPermission('entities.create', 'entities.edit')" @click="showImportDialog = true">
          <el-icon class="mr-2"><Upload /></el-icon>
          Import
        </el-button>
        <el-button v-if="authStore.hasPermission('entities.create')" type="primary" @click="showCreateDialog">
          <el-icon class="mr-2"><Plus /></el-icon>
          New Entity
        </el-button>
      </template>
    </PageHeader>

    <div class="entities-content">
      <!-- Error Alert -->
      <el-alert v-if="error" type="error" :closable="true" @close="error = ''">
        {{ error }}
      </el-alert>

      <el-tabs v-model="activeMainTab" class="entities-main-tabs">
        <el-tab-pane label="Directory" name="directory">

      <!-- KPI Ribbon -->
      <div v-if="!loading && entities.length > 0" class="entity-kpi-ribbon">
        <div
          v-for="kpi in entityKpis"
          :key="kpi.type"
          class="entity-kpi-tile"
          :class="[`entity-kpi-tile--${kpi.type}`, { 'entity-kpi-tile--active': filterEntityType === kpi.type }]"
          role="button"
          :aria-pressed="filterEntityType === kpi.type"
          :title="filterEntityType === kpi.type ? `Clear filter` : `Show ${kpi.label} only`"
          @click="filterEntityType = filterEntityType === kpi.type ? '' : kpi.type"
        >
          <span class="entity-kpi-count">{{ kpi.count }}</span>
          <span class="entity-kpi-label">{{ kpi.label }}</span>
        </div>
      </div>

      <!-- Filters and View Toggle -->
      <div class="filter-section">
        <div class="filter-bar" role="search">
          <el-select
            v-model="filterEntityType"
            :placeholder="'All Types'"
            class="w-180"
            clearable
            aria-label="Filter by entity type"
          >
            <el-option label="All Types" value=""></el-option>
            <el-option
              v-for="type in allEntityTypes"
              :key="type"
              :label="formatEntityType(type)"
              :value="type"
            ></el-option>
          </el-select>

          <el-select
            v-model="filterPerspective"
            :placeholder="'All Relationships'"
            class="w-180"
            clearable
            aria-label="Filter by relationship perspective"
          >
            <el-option label="All Relationships" value=""></el-option>
            <el-option label="Producer" value="producer"></el-option>
            <el-option label="Consumer" value="consumer"></el-option>
          </el-select>

          <el-select
            v-model="filterState"
            :placeholder="'All States'"
            class="w-150"
            clearable
            aria-label="Filter by state"
          >
            <el-option label="All States" value=""></el-option>
            <el-option label="Active" value="active"></el-option>
            <el-option label="Inactive" value="inactive"></el-option>
            <el-option label="Archived" value="archived"></el-option>
          </el-select>

          <el-autocomplete
            v-model="filterTag"
            :fetch-suggestions="fetchTagSuggestions"
            placeholder="Filter by tag"
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

          <el-input
            v-model="searchText"
            placeholder="Search entities..."
            class="w-250"
            clearable
            aria-label="Search entities"
          />

          <div class="view-mode-toggle">
            <el-radio-group v-model="viewMode" size="small" aria-label="View mode">
              <el-radio-button value="table">
                <el-icon><Grid /></el-icon>
                <span class="sr-only">Table view</span>
              </el-radio-button>
              <el-radio-button value="graph">
                <el-icon><Share /></el-icon>
                <span class="sr-only">Graph view</span>
              </el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p>Loading entities...</p>
      </div>

      <!-- Empty State -->
      <div v-else-if="totalCount === 0 && viewMode === 'table'" class="empty-state-contextual">
        <el-icon :size="48"><FolderOpened /></el-icon>
        <h3>No Entities Found</h3>
        <p>{{ getEmptyStateMessage() }}</p>
        <el-button v-if="authStore.hasPermission('entities.create')" type="primary" @click="showCreateDialog">
          Create New Entity
        </el-button>
      </div>

      <!-- Table View -->
      <template v-else-if="viewMode === 'table'">
        <el-table
          :data="paginatedEntities"
          stripe
          border
          @row-click="navigateToEntity"
         
          aria-label="Entities table"
        >
          <el-table-column prop="name" label="Name" min-width="200" sortable></el-table-column>

          <el-table-column prop="entityType" label="Type" min-width="100" sortable>
            <template #default="{ row }">
              <span class="entity-type-badge" :class="`entity-type-badge--${row.entityType}`">
                {{ formatEntityType(row.entityType) }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="Part of" min-width="160" sortable>
            <template #default="{ row }">
              <span v-if="row.parentName" class="parent-name-cell">{{ row.parentName }}</span>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="Standards" min-width="100">
            <template #default="{ row }">
              <el-tooltip
                v-if="(row.standards || []).length > 0"
                placement="top"
                :show-after="100"
              >
                <template #content>
                  <div v-for="std in row.standards" :key="std.id" class="whitespace-nowrap">
                    {{ std.name }}{{ std.version ? ` v${std.version}` : '' }}
                  </div>
                </template>
                <span class="standards-count">{{ (row.standards || []).length }}</span>
              </el-tooltip>
              <span v-else class="standards-count none">0</span>
            </template>
          </el-table-column>

          <el-table-column label="Assessments" min-width="100">
            <template #default="{ row }">
              <span class="assessment-count">{{ row.assessmentCount || 0 }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Location" min-width="150">
            <template #default="{ row }">
              <span v-if="row.locality || row.country" class="location-cell">
                <span v-if="row.locality">{{ row.locality }}</span>
                <span v-if="row.locality && row.country" class="loc-sep">, </span>
                <span v-if="row.country">{{ row.country }}</span>
              </span>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="State" min-width="90" sortable>
            <template #default="{ row }">
              <StateBadge :state="row.state" />
            </template>
          </el-table-column>

          <el-table-column label="Created" min-width="120" sortable>
            <template #default="{ row }">
              {{ formatDate(row.createdAt) }}
            </template>
          </el-table-column>

          <el-table-column v-if="authStore.hasAnyPermission('entities.edit', 'entities.delete')" label="Actions" min-width="90">
            <template #default="{ row }">
              <RowActions @edit="openEditDialog(row)" @delete="deleteEntity(row)" />
            </template>
          </el-table-column>
        </el-table>

        <!-- Pagination -->
        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="totalCount"
          layout="total, prev, pager, next"
        />
      </template>

      <!-- Graph View -->
      <template v-else-if="viewMode === 'graph'">
        <div v-if="graphLoading" class="loading-container">
          <el-icon class="is-loading"><Loading /></el-icon>
          <p>Loading relationship graph...</p>
        </div>
        <div v-else-if="graphEntities.length === 0" class="empty-state-contextual">
          <el-icon :size="48"><Share /></el-icon>
          <h3>No Relationships Found</h3>
          <p>Create relationships between entities to see the graph visualization.</p>
        </div>
        <RelationshipGraph
          v-else
          entity-id=""
          entity-name=""
          :relationships="[]"
          :graph-edges="graphEdges"
          :graph-entities="graphEntities"
          @navigate="navigateToEntityById"
        />
      </template>

        </el-tab-pane>

        <el-tab-pane label="Relationships" name="relationships">
          <RelationshipsTab
            v-if="!loading"
            :entities="entities"
            :graph-edges="graphEdges"
          />
          <div v-else class="loading-container">
            <el-icon class="is-loading"><Loading /></el-icon>
            <p>Loading...</p>
          </div>
        </el-tab-pane>
      </el-tabs>

    </div>

    <!-- Create/Edit Entity Dialog -->
    <el-dialog
      v-model="showDialog"
      :title="isEditMode ? 'Edit Entity' : 'New Entity'"
      width="600px"
      @close="resetForm"
    >
      <el-form :model="dialogForm" label-width="120px" :rules="formRules" ref="formRef">
        <el-form-item label="Name" prop="name">
          <el-input v-model="dialogForm.name" placeholder="Entity name" />
        </el-form-item>

        <el-form-item label="Description" prop="description">
          <el-input
            v-model="dialogForm.description"
            type="textarea"
            :rows="3"
            placeholder="Describe this entity (optional)"
          />
        </el-form-item>

        <el-form-item label="Entity Type" prop="entityType">
          <el-select v-model="dialogForm.entityType" placeholder="Choose a type" class="w-full">
            <el-option
              v-for="type in allEntityTypes"
              :key="type"
              :label="formatEntityType(type)"
              :value="type"
            ></el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="Tags">
          <TagInput v-model="dialogForm.tags" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">Cancel</el-button>
        <el-button type="primary" :loading="saving" @click="saveEntity">
          Save
        </el-button>
      </template>
    </el-dialog>

    <!-- Import Dialog (admin only) -->
    <el-dialog v-model="showImportDialog" title="Import Entities" width="720px" @close="resetImport">
      <div v-if="!importResult">
        <!-- Drop zone -->
        <div
          class="import-dropzone"
          :class="{ 'import-dropzone--active': importDragOver }"
          @dragover.prevent="importDragOver = true"
          @dragleave.prevent="importDragOver = false"
          @drop.prevent="onImportDrop"
          @click="importFileRef?.click()"
        >
          <el-icon :size="36" class="import-drop-icon"><Upload /></el-icon>
          <p class="import-drop-primary">Drop a file here or click to browse</p>
          <p class="import-drop-hint">Accepts <strong>.csv</strong> or <strong>.json</strong> · Max 5 MB</p>
          <input ref="importFileRef" type="file" accept=".csv,.json" class="sr-only" @change="onImportFileChange" />
        </div>

        <!-- Format guide -->
        <el-collapse class="import-format-guide">
          <el-collapse-item title="Expected file format" name="fmt">
            <div class="import-format-tabs">
              <div>
                <p class="fmt-label">CSV columns (header row required):</p>
                <code class="fmt-code">entity_name, parent_name, description, entity_type, country, region, locality, timezone, state</code>
                <p class="fmt-note">Only <code>entity_name</code> is required. <code>entity_type</code> must be one of: organization · business_unit · team · product · product_version · component · service</p>
              </div>
              <div class="mt-3">
                <p class="fmt-label">JSON — array of objects:</p>
                <code class="fmt-code">[ { "name": "HQ", "entityType": "organization" }, … ]</code>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <!-- Preview table -->
        <div v-if="importPreview.length > 0" class="import-preview">
          <div class="import-preview-header">
            <span class="import-preview-title">Preview — {{ importPreview.length }} row{{ importPreview.length !== 1 ? 's' : '' }} from <em>{{ importFileName }}</em></span>
            <el-button size="small" text @click="resetImport">Clear</el-button>
          </div>
          <el-table :data="importPreview.slice(0, 10)" size="small" border max-height="260">
            <el-table-column prop="name" label="Name" min-width="160" />
            <el-table-column prop="parentName" label="Parent" min-width="140">
              <template #default="{ row }">{{ row.parentName || '—' }}</template>
            </el-table-column>
            <el-table-column prop="entityType" label="Type" min-width="110">
              <template #default="{ row }">{{ row.entityType || 'team' }}</template>
            </el-table-column>
            <el-table-column prop="country" label="Country" min-width="100">
              <template #default="{ row }">{{ row.country || '—' }}</template>
            </el-table-column>
          </el-table>
          <p v-if="importPreview.length > 10" class="import-preview-more">… and {{ importPreview.length - 10 }} more rows</p>
        </div>
      </div>

      <!-- Result panel -->
      <div v-else class="import-result">
        <el-result
          :icon="importResult.errors.length > 0 && importResult.inserted + importResult.updated === 0 ? 'error' : 'success'"
          :title="importResult.inserted + importResult.updated === 0 ? 'Import failed' : 'Import complete'"
        >
          <template #sub-title>
            <div class="import-result-stats">
              <el-tag type="success">{{ importResult.inserted }} inserted</el-tag>
              <el-tag type="info">{{ importResult.updated }} updated</el-tag>
              <el-tag v-if="importResult.errors.length" type="warning">{{ importResult.errors.length }} warning{{ importResult.errors.length !== 1 ? 's' : '' }}</el-tag>
            </div>
          </template>
          <template v-if="importResult.errors.length > 0" #extra>
            <el-collapse>
              <el-collapse-item :title="`${importResult.errors.length} warning(s)`" name="errs">
                <ul class="import-error-list">
                  <li v-for="(e, i) in importResult.errors" :key="i">{{ e }}</li>
                </ul>
              </el-collapse-item>
            </el-collapse>
          </template>
        </el-result>
      </div>

      <template #footer>
        <el-button @click="resetImport(); showImportDialog = false">
          {{ importResult ? 'Close' : 'Cancel' }}
        </el-button>
        <el-button
          v-if="!importResult && importPreview.length > 0"
          type="primary"
          :loading="importing"
          @click="runImport"
        >
          Import {{ importPreview.length }} row{{ importPreview.length !== 1 ? 's' : '' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, FolderOpened, Plus, Grid, Share, Upload } from '@element-plus/icons-vue'
import client from '@/api/client'
import PageHeader from '@/components/shared/PageHeader.vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import RowActions from '@/components/shared/RowActions.vue'
import TagInput from '@/components/shared/TagInput.vue'
import RelationshipGraph from '@/components/shared/RelationshipGraph.vue'
import RelationshipsTab from '@/components/entities/RelationshipsTab.vue'
import { getEntities, createEntity, updateEntity, deleteEntity as deleteEntityAPI } from '@/api/entities'
import { listTags } from '@/api/tags'
import { tagPillStyle } from '@/utils/tagColor'
import type { Entity, EntityType, Tag } from '@/types'
import type { GraphEdge } from '@/components/shared/RelationshipGraph.vue'

const router = useRouter()
const authStore = useAuthStore()

// All entity types (no supplier, that's a relationship type)
const allEntityTypes: EntityType[] = [
  'organization',
  'business_unit',
  'team',
  'product',
  'product_version',
  'component',
  'service',
  'project',
]

// ── Import state ─────────────────────────────────────────────────────────────
interface ImportPreviewRow {
  name: string
  parentName: string | null
  entityType: string | null
  description: string | null
  country: string | null
  region: string | null
  locality: string | null
  timezone: string | null
  state: string | null
}

const showImportDialog = ref(false)
const importDragOver = ref(false)
const importFileRef = ref<HTMLInputElement | null>(null)
const importPreview = ref<ImportPreviewRow[]>([])
const importFileName = ref('')
const importing = ref(false)
const importResult = ref<{ inserted: number; updated: number; total: number; errors: string[] } | null>(null)

function parseImportCSV(text: string): ImportPreviewRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  const rows: ImportPreviewRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const values: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { values.push(cur.trim()); cur = '' }
      else cur += ch
    }
    values.push(cur.trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { if (values[idx] !== undefined) obj[h] = values[idx] })
    const name = obj.entity_name || obj.name
    if (!name) continue
    rows.push({
      name, parentName: obj.parent_name || obj.parent_entity_name || null,
      entityType: obj.entity_type || obj.entitytype || null,
      description: obj.description || null, country: obj.country || null,
      region: obj.region || null, locality: obj.locality || obj.city || null,
      timezone: obj.timezone || null, state: obj.state || null,
    })
  }
  return rows
}

function parseImportJSON(text: string): ImportPreviewRow[] {
  const parsed = JSON.parse(text)
  const arr = Array.isArray(parsed) ? parsed : parsed.entities ?? parsed.data ?? []
  return arr.map((item: Record<string, unknown>) => ({
    name: String(item.name || item.entity_name || '').trim(),
    parentName: String(item.parentName || item.parent_name || '').trim() || null,
    entityType: item.entityType ? String(item.entityType) : (item.entity_type ? String(item.entity_type) : null),
    description: item.description ? String(item.description) : null,
    country: item.country ? String(item.country) : null,
    region: item.region ? String(item.region) : null,
    locality: item.locality ? String(item.locality) : null,
    timezone: item.timezone ? String(item.timezone) : null,
    state: item.state ? String(item.state) : null,
  })).filter((r: ImportPreviewRow) => r.name)
}

function loadImportFile(file: File) {
  importFileName.value = file.name
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = e.target?.result as string
      importPreview.value = file.name.endsWith('.json') ? parseImportJSON(text) : parseImportCSV(text)
      if (importPreview.value.length === 0) ElMessage.warning('No valid rows found in file')
    } catch (err) {
      ElMessage.error(`Failed to parse file: ${(err as Error).message}`)
    }
  }
  reader.readAsText(file)
}

function onImportFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) loadImportFile(file)
}

function onImportDrop(e: DragEvent) {
  importDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) loadImportFile(file)
}

async function runImport() {
  if (importPreview.value.length === 0) return
  importing.value = true
  try {
    const formData = new FormData()
    const content = JSON.stringify(importPreview.value.map(r => ({
      name: r.name, parentName: r.parentName, entityType: r.entityType,
      description: r.description, country: r.country, region: r.region,
      locality: r.locality, timezone: r.timezone, state: r.state,
    })))
    const blob = new Blob([content], { type: 'application/json' })
    formData.append('file', blob, 'import.json')
    const { data } = await client.post('/entities/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    importResult.value = data
    await fetchEntities()
  } catch (err) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Import failed')
  } finally {
    importing.value = false
  }
}

function resetImport() {
  importPreview.value = []
  importFileName.value = ''
  importResult.value = null
  importDragOver.value = false
  if (importFileRef.value) importFileRef.value.value = ''
}
// ── End import state ──────────────────────────────────────────────────────────

// Tab
const activeMainTab = ref('directory')

// State
const loading = ref(true)
const error = ref('')
const entities = ref<Entity[]>([])
const showDialog = ref(false)
const saving = ref(false)
const isEditMode = ref(false)
const viewMode = ref<'table' | 'graph'>('table')
const filterPerspective = ref('')
const filterEntityType = ref('')
const filterState = ref('')
const filterTag = ref('')
const searchText = ref('')
// Catalog of tags used to power the filter typeahead. Loaded once on
// mount; admin changes to the tag library after that show up on
// navigation/refresh, which is acceptable since tag edits are rare.
const availableTags = ref<Tag[]>([])
const formRef = ref()
const currentPage = ref(1)
const pageSize = 20

// Graph state
const graphLoading = ref(false)
const graphEntities = ref<Array<{ id: string; name: string }>>([])
const graphEdges = ref<GraphEdge[]>([])

// Form
const dialogForm = ref({
  id: '',
  name: '',
  description: '',
  entityType: 'organization' as EntityType,
  tags: [] as string[],
})

const formRules = {
  name: [{ required: true, message: 'Name is required', trigger: 'blur' }],
  entityType: [{ required: true, message: 'Entity type is required', trigger: 'change' }],
}

// Computed
const entityKpis = computed(() => {
  const counts: Record<string, number> = {}
  for (const e of entities.value) {
    if (e.state === 'archived') continue
    counts[e.entityType] = (counts[e.entityType] || 0) + 1
  }
  const order = ['organization', 'business_unit', 'team', 'product', 'product_version', 'component', 'service']
  const labels: Record<string, string> = {
    organization: 'Organizations', business_unit: 'Business Units', team: 'Teams',
    product: 'Products', product_version: 'Versions', component: 'Components', service: 'Services', project: 'Projects',
  }
  return order.filter(t => counts[t]).map(t => ({ type: t, label: labels[t], count: counts[t] }))
})

const filteredEntities = computed(() => {
  const filtered = entities.value.filter(entity => {
    // Filter by entity type
    const matchesType = !filterEntityType.value || entity.entityType === filterEntityType.value

    // Filter by state: when no filter is selected, hide archived entities by default
    const matchesState = filterState.value
      ? entity.state === filterState.value
      : entity.state !== 'archived'

    // Filter by search
    const matchesSearch =
      !searchText.value ||
      entity.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
      (entity.description || '').toLowerCase().includes(searchText.value.toLowerCase())

    // Filter by perspective (relationship-based)
    const matchesPerspective = !filterPerspective.value || perspectiveEntityIds.value.has(entity.id)

    // Filter by tag (substring, case-insensitive)
    const matchesTag =
      !filterTag.value ||
      (entity.tags || []).some((t) =>
        t.name.toLowerCase().includes(filterTag.value.toLowerCase())
      )

    return matchesType && matchesState && matchesSearch && matchesPerspective && matchesTag
  })
  // Reset to first page when filters change
  currentPage.value = 1
  return filtered
})

// Entities that match the current perspective filter
const perspectiveEntityIds = ref<Set<string>>(new Set())

const totalCount = computed(() => {
  return filteredEntities.value.length
})

const paginatedEntities = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  const end = start + pageSize
  return filteredEntities.value.slice(start, end)
})

// Methods
const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString()
}

const formatEntityType = (type: EntityType): string => {
  const map: Record<string, string> = {
    organization: 'Organization',
    business_unit: 'Business Unit',
    team: 'Team',
    product: 'Product',
    product_version: 'Product Version',
    component: 'Component',
    service: 'Service',
    project: 'Project',
  }
  return map[type] || type
}

const getEmptyStateMessage = (): string => {
  if (
    searchText.value ||
    filterEntityType.value ||
    filterState.value ||
    filterPerspective.value ||
    filterTag.value
  ) {
    return 'No entities match these filters. Try broadening your search.'
  }
  return 'Create your first entity to start organizing what you assess.'
}

const fetchEntities = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await getEntities({ limit: 100 })
    entities.value = response.data || []
  } catch (err: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: axios error handling
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || 'Failed to load entities'
  } finally {
    loading.value = false
  }
}

const fetchRelationshipGraph = async () => {
  graphLoading.value = true
  try {
    const params: Record<string, unknown> = {}
    if (filterPerspective.value) {
      params.perspective = filterPerspective.value
    }
    const response = await client.get('/entities/relationship-graph', { params })
    graphEntities.value = response.data.entities || []
    graphEdges.value = response.data.edges || []
  } catch (err: unknown) {
    console.error('Failed to fetch relationship graph:', err)
    graphEntities.value = []
    graphEdges.value = []
  } finally {
    graphLoading.value = false
  }
}

const fetchPerspectiveFilter = async () => {
  if (!filterPerspective.value) {
    perspectiveEntityIds.value = new Set()
    return
  }
  try {
    const response = await client.get('/entities/relationship-graph', {
      params: { perspective: filterPerspective.value }
    })
    const entityIds = (response.data.entities || []).map((e: Record<string, unknown>) => e.id as string)
    perspectiveEntityIds.value = new Set(entityIds)
  } catch (err: unknown) {
    console.error('Failed to fetch perspective filter:', err)
    perspectiveEntityIds.value = new Set()
  }
}

// Watch perspective filter to update both table filtering and graph
watch(filterPerspective, async () => {
  await fetchPerspectiveFilter()
  if (viewMode.value === 'graph') {
    await fetchRelationshipGraph()
  }
})

// Watch view mode to fetch graph data when switching to graph
watch(viewMode, async (newMode) => {
  if (newMode === 'graph') {
    await fetchRelationshipGraph()
  }
})

const showCreateDialog = () => {
  isEditMode.value = false
  resetForm()
  showDialog.value = true
}

const openEditDialog = (row: Entity) => {
  isEditMode.value = true
  dialogForm.value = {
    id: row.id,
    name: row.name,
    description: row.description || '',
    entityType: row.entityType,
    tags: (row.tags || []).map((t: Tag | string) => (typeof t === 'string' ? t : t.name)),
  }
  showDialog.value = true
}

const saveEntity = async () => {
  if (!formRef.value) return

  await formRef.value.validate()

  saving.value = true
  try {
    if (isEditMode.value) {
      await updateEntity(dialogForm.value.id, {
        name: dialogForm.value.name,
        description: dialogForm.value.description || null,
        entityType: dialogForm.value.entityType,
      })
      ElMessage.success('Entity updated successfully')
    } else {
      await createEntity({
        name: dialogForm.value.name,
        description: dialogForm.value.description || null,
        entityType: dialogForm.value.entityType,
      })
      ElMessage.success('Entity created successfully')
    }
    showDialog.value = false
    await fetchEntities()
  } catch (err: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: axios error handling
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to save entity')
  } finally {
    saving.value = false
  }
}

const deleteEntity = async (row: Entity) => {
  try {
    await ElMessageBox.confirm(
      `Are you sure you want to delete "${row.name}"? This will archive the entity.`,
      'Delete Entity',
      {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      }
    )
  } catch {
    // User cancelled
    return
  }

  try {
    await deleteEntityAPI(row.id)
    ElMessage.success('Entity deleted successfully')
    await fetchEntities()
  } catch (err: unknown) {
    // biome-ignore lint/suspicious/noExplicitAny: axios error handling
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to delete entity')
  }
}

const resetForm = () => {
  dialogForm.value = {
    id: '',
    name: '',
    description: '',
    entityType: 'organization',
    tags: [],
  }
  formRef.value?.clearValidate()
}

const navigateToEntity = (row: Entity) => {
  router.push(`/entities/${row.id}`)
}

const navigateToEntityById = (entityId: string) => {
  router.push(`/entities/${entityId}`)
}

async function fetchAvailableTags() {
  try {
    availableTags.value = await listTags()
  } catch {
    // A missing tag catalog should not block the entities list; the
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
  fetchEntities()
  fetchAvailableTags()
  fetchRelationshipGraph()
})
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.entities-container {
  padding: 0;
}

.entities-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.entities-main-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: var(--cat-spacing-4);
  }

  :deep(.el-tabs__content) {
    overflow: visible;
  }

  :deep(.el-tab-pane) {
    outline: none;
  }
}

.entity-kpi-ribbon {
  display: flex;
  gap: var(--cat-spacing-3);
  margin-bottom: var(--cat-spacing-4);
  flex-wrap: wrap;
}

.entity-kpi-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  border-radius: var(--cat-radius-md);
  background: var(--cat-bg-card);
  border: 1px solid var(--cat-border-subtle);
  min-width: 110px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.1s, box-shadow 0.1s, background 0.15s;

  &:hover { background: var(--cat-bg-hover); transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.12); }
  &:active { transform: translateY(0); }

  &--active {
    background: var(--cat-bg-hover);
    box-shadow: 0 0 0 2px currentColor;
  }

  &--organization { border-top: 3px solid #6366f1; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #6366f1; } }
  &--business_unit { border-top: 3px solid #0ea5e9; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #0ea5e9; } }
  &--team         { border-top: 3px solid #10b981; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #10b981; } }
  &--product      { border-top: 3px solid #f59e0b; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #f59e0b; } }
  &--product_version { border-top: 3px solid #f97316; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #f97316; } }
  &--component    { border-top: 3px solid #8b5cf6; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #8b5cf6; } }
  &--service      { border-top: 3px solid #ec4899; &.entity-kpi-tile--active { box-shadow: 0 0 0 2px #ec4899; } }
}

.entity-kpi-count {
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1;
  color: var(--cat-text-primary);
}

.entity-kpi-label {
  font-size: 0.72rem;
  color: var(--cat-text-secondary);
  margin-top: 4px;
  text-align: center;
  white-space: nowrap;
}

.parent-name-cell {
  color: var(--cat-text-secondary);
  font-size: 0.85em;
}

.location-cell {
  color: var(--cat-text-secondary);
  font-size: 0.85em;
}

.loc-sep {
  opacity: 0.5;
}

.text-muted {
  color: var(--cat-text-tertiary, #6b7280);
}

// ── Import dialog styles ───────────────────────────────────────────────────────
.import-dropzone {
  border: 2px dashed var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  padding: 40px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 16px;

  &:hover, &--active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .import-drop-icon { color: var(--cat-text-tertiary); margin-bottom: 12px; }
  .import-drop-primary { font-weight: 600; margin: 0 0 4px; }
  .import-drop-hint { font-size: 0.82rem; color: var(--cat-text-secondary); margin: 0; }
}

.import-format-guide {
  margin-bottom: 16px;
  :deep(.el-collapse-item__header) { font-size: 0.85rem; color: var(--cat-text-secondary); }
}

.import-format-tabs {
  font-size: 0.83rem;
  .fmt-label { font-weight: 600; margin: 0 0 4px; }
  .fmt-code {
    display: block;
    background: var(--cat-bg-subtle);
    border-radius: 4px;
    padding: 6px 10px;
    font-family: monospace;
    font-size: 0.78rem;
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 6px;
  }
  .fmt-note { color: var(--cat-text-secondary); margin: 0; }
  .mt-3 { margin-top: 12px; }
}

.import-preview {
  margin-top: 8px;
  .import-preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .import-preview-title { font-size: 0.85rem; font-weight: 600; }
  .import-preview-more { font-size: 0.8rem; color: var(--cat-text-secondary); margin: 6px 0 0; }
}

.import-result-stats {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.import-error-list {
  font-size: 0.82rem;
  color: var(--el-color-warning);
  padding-left: 18px;
  margin: 0;
  li { margin-bottom: 4px; }
}

.filter-section {
  margin-bottom: var(--cat-spacing-4);
}

.filter-bar {
  display: flex;
  gap: var(--cat-spacing-4);
  align-items: center;
}

.view-mode-toggle {
  margin-left: auto;
}

:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}

.entity-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  line-height: 1.6;
  white-space: nowrap;

  &--organization {
    background-color: rgba(47, 129, 247, 0.15);
    color: #2f81f7;
  }

  &--business_unit {
    background-color: rgba(163, 113, 247, 0.15);
    color: #a371f7;
  }

  &--team {
    background-color: rgba(57, 211, 83, 0.15);
    color: #39d353;
  }

  &--product {
    background-color: rgba(210, 153, 34, 0.15);
    color: #d29922;
  }

  &--product_version {
    background-color: rgba(240, 136, 62, 0.15);
    color: #f0883e;
  }

  &--component {
    background-color: rgba(63, 184, 175, 0.15);
    color: #3fb8af;
  }

  &--service {
    background-color: rgba(219, 97, 162, 0.15);
    color: #db61a2;
  }

  &--project {
    background-color: rgba(139, 148, 158, 0.15);
    color: #8b949e;
  }
}

.standards-count,
.assessment-count {
  font-size: var(--cat-font-size-sm);
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
