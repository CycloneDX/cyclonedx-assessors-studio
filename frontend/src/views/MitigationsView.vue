<template>
  <div class="mt-page">
    <PageHeader title="Mitigation Registry">
      <template #actions>
        <el-button type="primary" :icon="Plus" @click="openCreate">New Mitigation</el-button>
      </template>
    </PageHeader>

    <!-- Stat bar -->
    <div class="mt-stat-bar">
      <div v-for="stat in statItems" :key="stat.key"
        class="mt-stat" :class="[`mt-stat--${stat.key}`, { active: statusFilter === stat.value }]"
        @click="statusFilter = statusFilter === stat.value ? '' : stat.value">
        <div class="mt-stat-value">{{ stat.count }}</div>
        <div class="mt-stat-label">{{ stat.label }}</div>
      </div>
    </div>

    <div class="mt-content">
      <!-- Toolbar -->
      <div class="mt-toolbar">
        <el-input v-model="searchQuery" placeholder="Search by title, ID, type, owner…" clearable style="max-width:320px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="statusFilter" placeholder="All Statuses" clearable style="width:160px">
          <el-option label="Proposed"    value="Proposed" />
          <el-option label="In Progress" value="In Progress" />
          <el-option label="Implemented" value="Implemented" />
          <el-option label="Verified"    value="Verified" />
          <el-option label="Closed"      value="Closed" />
        </el-select>
        <el-select v-model="typeFilter" placeholder="All Types" clearable style="width:150px">
          <el-option label="Technical" value="Technical" />
          <el-option label="Process"   value="Process" />
          <el-option label="Policy"    value="Policy" />
          <el-option label="Training"  value="Training" />
          <el-option label="Physical"  value="Physical" />
        </el-select>
        <el-select v-model="priorityFilter" placeholder="All Priorities" clearable style="width:150px">
          <el-option label="Critical" value="Critical" />
          <el-option label="High"     value="High" />
          <el-option label="Medium"   value="Medium" />
          <el-option label="Low"      value="Low" />
        </el-select>
        <el-select v-model="categoryFilter" placeholder="All Categories" clearable style="width:160px">
          <el-option label="Preventive"   value="Preventive" />
          <el-option label="Detective"    value="Detective" />
          <el-option label="Corrective"   value="Corrective" />
          <el-option label="Compensating" value="Compensating" />
        </el-select>
        <div style="flex:1" />
        <span v-if="hasFilters" class="mt-result-count">{{ filtered.length }} of {{ mitigations.length }}</span>
        <el-button v-if="hasFilters" link @click="clearFilters">Clear filters</el-button>
      </div>

      <!-- Table card -->
      <div class="mt-card">
        <div class="mt-card-header">
          <span class="mt-card-title"><el-icon><Shield /></el-icon> Mitigations Pool</span>
          <el-tag type="info" size="small">{{ filtered.length }}</el-tag>
          <div style="flex:1" />
          <template v-if="selectedIds.length > 0">
            <span class="mt-sel-label">{{ selectedIds.length }} selected</span>
            <el-button size="small" type="danger" plain @click="bulkDelete">Delete</el-button>
          </template>
        </div>

        <div v-if="loading" class="mt-loading">
          <el-icon class="is-loading"><Loading /></el-icon> Loading…
        </div>
        <el-alert v-else-if="loadError" type="error" :description="loadError" show-icon :closable="false" />

        <template v-else>
          <div class="mt-table-scroll">
          <!-- Column headers -->
          <div class="mt-table-head">
            <div class="mt-col-check"><el-checkbox :model-value="allSelected" @change="toggleAll" aria-label="Select all mitigations" /></div>
            <div class="mt-col-id mt-sortable" @click="sortBy('displayId')">MIT ID <SortIcon :field="'displayId'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-title mt-sortable" @click="sortBy('title')">Title <SortIcon :field="'title'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-type mt-sortable" @click="sortBy('type')">Type <SortIcon :field="'type'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-category mt-sortable" @click="sortBy('category')">Category <SortIcon :field="'category'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-priority mt-sortable" @click="sortBy('priority')">Priority <SortIcon :field="'priority'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-status mt-sortable" @click="sortBy('status')">Status <SortIcon :field="'status'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-pipeline">Pipeline</div>
            <div class="mt-col-owner mt-sortable" @click="sortBy('owner')">Owner <SortIcon :field="'owner'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-date mt-sortable" @click="sortBy('targetDate')">Target <SortIcon :field="'targetDate'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-date mt-sortable" @click="sortBy('completionDate')">Completed <SortIcon :field="'completionDate'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-effectiveness mt-sortable" @click="sortBy('effectiveness')">Effectiveness <SortIcon :field="'effectiveness'" :current="sortField" :dir="sortDir" /></div>
            <div class="mt-col-actions"></div>
          </div>

          <div v-if="paged.length === 0" class="mt-empty">
            <el-icon :size="36"><FirstAidKit /></el-icon>
            <p>No mitigations found</p>
            <span v-if="hasFilters">Try adjusting your filters.</span>
            <span v-else>Click <strong>New Mitigation</strong> to create the first record.</span>
          </div>

          <div v-for="row in paged" :key="row.id"
            class="mt-row"
            :class="{ 'mt-row--selected': selectedIds.includes(row.id) }"
            @click="navigate(row)">
            <div class="mt-col-check" @click.stop>
              <el-checkbox :model-value="selectedIds.includes(row.id)" @change="toggleRow(row.id)" :aria-label="`Select mitigation ${row.title}`" />
            </div>
            <div class="mt-col-id">
              <span class="mt-id-chip">{{ fmtMtgId(row.displayId) }}</span>
            </div>
            <div class="mt-col-title">{{ row.title }}</div>
            <div class="mt-col-type">
              <span v-if="row.type" class="mt-badge" :class="`mt-type--${row.type.toLowerCase()}`">{{ row.type }}</span>
              <span v-else class="mt-muted">—</span>
            </div>
            <div class="mt-col-category">
              <span v-if="row.category" class="mt-muted-text">{{ row.category }}</span>
              <span v-else class="mt-muted">—</span>
            </div>
            <div class="mt-col-priority">
              <span v-if="row.priority" class="mt-badge mt-priority" :class="`mt-pri--${row.priority.toLowerCase()}`">{{ row.priority }}</span>
              <span v-else class="mt-muted">—</span>
            </div>
            <div class="mt-col-status">
              <span class="mt-status-badge" :class="`mt-status--${row.status.toLowerCase().replace(' ', '-')}`">
                <el-icon v-if="row.status === 'In Progress'"><Loading /></el-icon>
                <el-icon v-else-if="row.status === 'Implemented'"><Check /></el-icon>
                <el-icon v-else-if="row.status === 'Verified'"><CircleCheck /></el-icon>
                <el-icon v-else-if="row.status === 'Closed'"><Lock /></el-icon>
                <el-icon v-else><Clock /></el-icon>
                {{ row.status }}
              </span>
            </div>
            <div class="mt-col-pipeline">
              <span v-for="n in 5" :key="n" class="mt-dot" :class="pipelineDotClass(row.status, n)" />
            </div>
            <div class="mt-col-owner">{{ row.owner || '—' }}</div>
            <div class="mt-col-date" :class="isOverdue(row) ? 'mt-overdue' : ''">
              {{ row.targetDate ? formatDate(row.targetDate) : '—' }}
              <el-icon v-if="isOverdue(row)" style="color:var(--el-color-danger);margin-left:3px"><Warning /></el-icon>
            </div>
            <div class="mt-col-date">
              {{ row.completionDate ? formatDate(row.completionDate) : '—' }}
            </div>
            <div class="mt-col-effectiveness">
              <span v-if="row.effectiveness" class="mt-badge" :class="`mt-eff--${row.effectiveness.toLowerCase().replace(/\s+/g, '-')}`">{{ row.effectiveness }}</span>
              <span v-else class="mt-muted">—</span>
            </div>
            <div class="mt-col-actions" @click.stop>
              <el-button link type="primary" size="small" @click="navigate(row)" :aria-label="`Edit mitigation ${row.title}`"><el-icon><Edit /></el-icon></el-button>
              <el-button link type="danger" size="small" @click="confirmDelete(row.id)" :aria-label="`Delete mitigation ${row.title}`"><el-icon><Delete /></el-icon></el-button>
            </div>
          </div>

          </div><!-- /mt-table-scroll -->

          <!-- Footer / pagination -->
          <div class="mt-table-footer">
            <span>{{ filtered.length }} record{{ filtered.length !== 1 ? 's' : '' }}</span>
            <div style="flex:1" />
            <el-pagination
              v-model:current-page="currentPage"
              :page-size="pageSize"
              :total="filtered.length"
              layout="prev, pager, next"
              small
            />
          </div>
        </template>
      </div>
    </div>

    <!-- Create dialog -->
    <el-dialog v-model="showCreateDialog" title="New Mitigation" width="560px" :close-on-click-modal="false">
      <div class="mt-form-grid">
        <div class="mt-field mt-span-2">
          <label>Title <span class="mt-req">*</span></label>
          <el-input v-model="createForm.title" placeholder="Short descriptive title" :status="formErrors.title ? 'error' : ''" />
          <span v-if="formErrors.title" class="mt-field-error">{{ formErrors.title }}</span>
        </div>
        <div class="mt-field">
          <label>Type <span class="mt-req">*</span></label>
          <el-select v-model="createForm.type" style="width:100%" :class="formErrors.type ? 'mt-select-error' : ''">
            <el-option label="Technical" value="Technical" />
            <el-option label="Process"   value="Process" />
            <el-option label="Policy"    value="Policy" />
            <el-option label="Training"  value="Training" />
            <el-option label="Physical"  value="Physical" />
          </el-select>
          <span v-if="formErrors.type" class="mt-field-error">{{ formErrors.type }}</span>
        </div>
        <div class="mt-field">
          <label>Category</label>
          <el-select v-model="createForm.category" style="width:100%" clearable>
            <el-option label="Preventive"   value="Preventive" />
            <el-option label="Detective"    value="Detective" />
            <el-option label="Corrective"   value="Corrective" />
            <el-option label="Compensating" value="Compensating" />
          </el-select>
        </div>
        <div class="mt-field">
          <label>Priority <span class="mt-req">*</span></label>
          <el-select v-model="createForm.priority" style="width:100%" :class="formErrors.priority ? 'mt-select-error' : ''">
            <el-option label="Critical" value="Critical" />
            <el-option label="High"     value="High" />
            <el-option label="Medium"   value="Medium" />
            <el-option label="Low"      value="Low" />
          </el-select>
          <span v-if="formErrors.priority" class="mt-field-error">{{ formErrors.priority }}</span>
        </div>
        <div class="mt-field">
          <label>Status</label>
          <el-select v-model="createForm.status" style="width:100%">
            <el-option label="Proposed"    value="Proposed" />
            <el-option label="In Progress" value="In Progress" />
            <el-option label="Implemented" value="Implemented" />
            <el-option label="Verified"    value="Verified" />
            <el-option label="Closed"      value="Closed" />
          </el-select>
        </div>
        <div class="mt-field mt-span-2">
          <label>Description</label>
          <el-input v-model="createForm.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="Describe the mitigation strategy…" />
        </div>
      </div>
      <template #footer>
        <el-button @click="showCreateDialog = false">Cancel</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">Create Mitigation</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Loading, FirstAidKit, Search, Plus,
  Edit, Delete, Check, CircleCheck, Lock, Clock, Warning,
} from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { formatDate } from '@/utils/dateFormat'
import { apiErrorMessage } from '@/utils/errorMessage'
import type { Mitigation } from '@/types'

// Shield icon inline (not in EP icons by that name)
const Shield = { render: () => h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
  h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
]) }

const router = useRouter()

function fmtMtgId(n?: number): string {
  if (!n) return 'MIT-???'
  return `MIT-${String(n).padStart(4, '0')}`
}

// ── State ──────────────────────────────────────────────────────────────────
const loading         = ref(false)
const loadError       = ref('')
const saving          = ref(false)
const mitigations     = ref<Mitigation[]>([])
const showCreateDialog = ref(false)

const searchQuery    = ref('')
const statusFilter   = ref('')
const typeFilter     = ref('')
const priorityFilter = ref('')
const categoryFilter = ref('')
const sortField      = ref('createdAt')
const sortDir        = ref<'asc' | 'desc'>('desc')
const currentPage    = ref(1)
const pageSize       = ref(20)
const selectedIds    = ref<string[]>([])

const createForm = ref({ title: '', type: '', category: '', priority: '', status: 'Proposed', description: '' })
const formErrors = ref<Record<string, string>>({})

// ── Computed ───────────────────────────────────────────────────────────────
const hasFilters = computed(() => !!(searchQuery.value || statusFilter.value || typeFilter.value || priorityFilter.value || categoryFilter.value))

const statItems = computed(() => [
  { key: 'total',       value: '',            label: 'Total',       count: mitigations.value.length },
  { key: 'proposed',    value: 'Proposed',    label: 'Proposed',    count: mitigations.value.filter(m => m.status === 'Proposed').length },
  { key: 'in-progress', value: 'In Progress', label: 'In Progress', count: mitigations.value.filter(m => m.status === 'In Progress').length },
  { key: 'implemented', value: 'Implemented', label: 'Implemented', count: mitigations.value.filter(m => m.status === 'Implemented').length },
  { key: 'verified',    value: 'Verified',    label: 'Verified',    count: mitigations.value.filter(m => m.status === 'Verified').length },
  { key: 'closed',      value: 'Closed',      label: 'Closed',      count: mitigations.value.filter(m => m.status === 'Closed').length },
])

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  let rows = [...mitigations.value]
  if (q) rows = rows.filter(m =>
    m.title.toLowerCase().includes(q) ||
    (m.owner ?? '').toLowerCase().includes(q) ||
    (m.displayId ? fmtMtgId(m.displayId).toLowerCase().includes(q) : false) ||
    (m.type ?? '').toLowerCase().includes(q)
  )
  if (statusFilter.value)   rows = rows.filter(m => m.status === statusFilter.value)
  if (typeFilter.value)     rows = rows.filter(m => m.type === typeFilter.value)
  if (priorityFilter.value) rows = rows.filter(m => m.priority === priorityFilter.value)
  if (categoryFilter.value) rows = rows.filter(m => m.category === categoryFilter.value)
  rows.sort((a, b) => {
    const f = sortField.value as keyof Mitigation
    const av = String(a[f] ?? '').toLowerCase()
    const bv = String(b[f] ?? '').toLowerCase()
    return sortDir.value === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  return rows
})

const paged = computed(() => {
  const s = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(s, s + pageSize.value)
})

const allSelected = computed(() =>
  paged.value.length > 0 && paged.value.every(r => selectedIds.value.includes(r.id))
)

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUS_STEPS = ['Proposed', 'In Progress', 'Implemented', 'Verified', 'Closed']

function pipelineDotClass(status: string, dotIndex: number): string {
  const pos = STATUS_STEPS.indexOf(status) + 1
  if (dotIndex > pos) return 'mt-dot--empty'
  if (status === 'Closed') return 'mt-dot--closed'
  if (status === 'Verified') return 'mt-dot--verified'
  return dotIndex === 1 ? 'mt-dot--proposed' : 'mt-dot--active'
}

function isOverdue(row: Mitigation): boolean {
  if (!row.targetDate) return false
  if (['Implemented', 'Verified', 'Closed'].includes(row.status)) return false
  return new Date(row.targetDate) < new Date()
}

function sortBy(field: string) {
  if (sortField.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = field; sortDir.value = 'asc' }
}

function clearFilters() {
  searchQuery.value = ''; statusFilter.value = ''; typeFilter.value = ''; priorityFilter.value = ''; categoryFilter.value = ''
}

function toggleAll(val: boolean | string | number) {
  if (val) paged.value.forEach(r => { if (!selectedIds.value.includes(r.id)) selectedIds.value.push(r.id) })
  else paged.value.forEach(r => { selectedIds.value = selectedIds.value.filter(id => id !== r.id) })
}

function toggleRow(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1); else selectedIds.value.push(id)
}

function navigate(row: Mitigation) { router.push(`/mitigations/${row.id}`) }

// ── Data ───────────────────────────────────────────────────────────────────
async function fetchMitigations() {
  loading.value = true; loadError.value = ''
  try {
    const { data } = await client.get('/mitigations', { params: { limit: 100 } })
    mitigations.value = data.data || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load mitigations')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  createForm.value = { title: '', type: '', category: '', priority: '', status: 'Proposed', description: '' }
  formErrors.value = {}
  showCreateDialog.value = true
}

async function handleCreate() {
  formErrors.value = {}
  if (!createForm.value.title.trim()) { formErrors.value.title = 'Title is required'; return }
  if (!createForm.value.type)         { formErrors.value.type  = 'Type is required';  return }
  if (!createForm.value.priority)     { formErrors.value.priority = 'Priority is required'; return }
  saving.value = true
  try {
    await client.post('/mitigations', {
      title:       createForm.value.title.trim(),
      type:        createForm.value.type,
      category:    createForm.value.category || null,
      priority:    createForm.value.priority,
      status:      createForm.value.status,
      description: createForm.value.description || null,
    })
    ElMessage.success('Mitigation created')
    showCreateDialog.value = false
    await fetchMitigations()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to create mitigation'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(id: string) {
  await ElMessageBox.confirm('Delete this mitigation?', 'Confirm Delete', { type: 'warning', confirmButtonText: 'Delete', confirmButtonClass: 'el-button--danger' })
  try {
    await client.delete(`/mitigations/${id}`)
    mitigations.value = mitigations.value.filter(m => m.id !== id)
    ElMessage.success('Mitigation deleted')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to delete'))
  }
}

async function bulkDelete() {
  await ElMessageBox.confirm(`Delete ${selectedIds.value.length} mitigation(s)?`, 'Confirm Delete', { type: 'warning' })
  for (const id of selectedIds.value) {
    try { await client.delete(`/mitigations/${id}`) } catch { /* skip */ }
  }
  ElMessage.success(`${selectedIds.value.length} mitigation(s) deleted`)
  selectedIds.value = []
  await fetchMitigations()
}

onMounted(fetchMitigations)

// ── Sort icon component ────────────────────────────────────────────────────
const SortIcon = ({ field, current, dir }: { field: string; current: string; dir: string }) => {
  if (field !== current) return h('span', { class: 'mt-sort-icon mt-sort-none' }, '↕')
  return h('span', { class: 'mt-sort-icon' }, dir === 'asc' ? '↑' : '↓')
}
</script>

<style scoped lang="scss">
.mt-page { padding: 0; min-height: 100vh; }

// Stat bar
.mt-stat-bar {
  display: flex;
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 0 var(--cat-spacing-6);
}

.mt-stat {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 10px 20px 10px 0;
  margin-right: 20px;
  border-right: 1px solid var(--cat-border-default);
  cursor: pointer;
  min-width: 80px;

  &:last-child { border-right: none; margin-right: 0; }
  &:hover .mt-stat-label { color: var(--el-color-primary); }
  &.active .mt-stat-value, &.active .mt-stat-label { color: var(--el-color-primary); }
  &--proposed    .mt-stat-value { color: var(--el-color-info); }
  &--in-progress .mt-stat-value { color: var(--el-color-warning); }
  &--implemented .mt-stat-value { color: var(--el-color-primary); }
  &--verified    .mt-stat-value { color: var(--el-color-success); }
  &--closed      .mt-stat-value { color: var(--cat-text-tertiary); }
}

.mt-stat-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--cat-text-primary);
}

.mt-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--cat-text-tertiary);
  margin-top: 3px;
}

// Content
.mt-content { padding: var(--cat-spacing-4) var(--cat-spacing-6) var(--cat-spacing-8); }

// Toolbar
.mt-toolbar {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  margin-bottom: var(--cat-spacing-4);
  flex-wrap: wrap;
}
.mt-result-count { font-size: 12px; color: var(--cat-text-secondary); }

// Card
.mt-card {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

// Allow table to scroll horizontally when viewport is narrow
.mt-table-scroll {
  overflow-x: auto;
}

.mt-card-header {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  padding: 12px 16px;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
}

.mt-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cat-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mt-sel-label { font-size: 12px; color: var(--cat-text-secondary); }

// Table grid — cols: check | id | title | type | category | priority | status | pipeline | owner | target | completed | effectiveness | actions
$cols: 36px 90px 1fr 120px 110px 100px 140px 85px 120px 110px 110px 140px 72px;

.mt-table-head {
  display: grid;
  grid-template-columns: $cols;
  background: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--cat-text-secondary);

  > div {
    padding: 10px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.mt-sortable {
  cursor: pointer;
  user-select: none;
  &:hover { color: var(--el-color-primary); }
}

.mt-sort-icon { font-size: 11px; opacity: 0.6; }
.mt-sort-none { opacity: 0.3; }

.mt-row {
  display: grid;
  grid-template-columns: $cols;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-primary);
  cursor: pointer;
  transition: background 100ms;
  padding: 0 8px;

  &:last-child { border-bottom: none; }
  &:hover { background: var(--cat-bg-hover); }
  &--selected { background: var(--el-color-primary-light-9); }

  > div {
    padding: 10px 8px;
    display: flex;
    align-items: center;
    font-size: 13px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.mt-col-title { font-weight: 500; color: var(--el-color-primary); }
.mt-col-actions { gap: 2px; }
.mt-muted-text { font-size: 13px; color: var(--cat-text-secondary); }
.mt-overdue { color: var(--el-color-danger) !important; font-weight: 600; display: flex; align-items: center; }

// Pipeline dots
.mt-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 3px;
  flex-shrink: 0;

  &--empty    { background: var(--cat-border-default); }
  &--proposed { background: var(--el-color-info); }
  &--active   { background: var(--el-color-success); }
  &--verified { background: var(--el-color-success); }
  &--closed   { background: var(--el-color-success); }
}

.mt-col-pipeline {
  display: flex;
  align-items: center;
}

.mt-id-chip {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary-dark-2);
  padding: 2px 7px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.mt-muted { color: var(--cat-text-tertiary); }

// Generic badge
.mt-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  white-space: nowrap;
}

// Type badges
.mt-type--technical   { background: var(--el-color-primary-light-9);  color: var(--el-color-primary-dark-2); }
.mt-type--process     { background: var(--el-color-info-light-9);     color: var(--el-color-info); }
.mt-type--policy      { background: var(--el-color-warning-light-9);  color: var(--el-color-warning-dark-2); }
.mt-type--training    { background: var(--el-color-success-light-9);  color: var(--el-color-success-dark-2); }
.mt-type--physical    { background: var(--el-color-danger-light-9);   color: var(--el-color-danger-dark-2); }

// Category badges
.mt-cat--preventive   { background: var(--el-color-primary-light-9);  color: var(--el-color-primary-dark-2); }
.mt-cat--detective    { background: var(--el-color-info-light-9);     color: var(--el-color-info); }
.mt-cat--corrective   { background: var(--el-color-warning-light-9);  color: var(--el-color-warning-dark-2); }
.mt-cat--compensating { background: var(--el-color-success-light-9);  color: var(--el-color-success-dark-2); }

// Priority badges
.mt-priority { font-weight: 700; }
.mt-pri--critical { background: var(--el-color-danger-light-9);   color: var(--el-color-danger); }
.mt-pri--high     { background: var(--el-color-warning-light-9);  color: var(--el-color-warning-dark-2); }
.mt-pri--medium   { background: var(--el-color-info-light-9);     color: var(--el-color-info); }
.mt-pri--low      { background: var(--cat-bg-subtle, #f4f4f5);   color: var(--cat-text-secondary); }

// Status badges
.mt-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  white-space: nowrap;
}
.mt-status--proposed    { background: var(--el-color-info-light-9);    color: var(--el-color-info); }
.mt-status--in-progress { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.mt-status--implemented { background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); }
.mt-status--verified    { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.mt-status--closed      { background: var(--cat-bg-subtle, #f4f4f5);  color: var(--cat-text-secondary); }

// Effectiveness badges
.mt-eff--effective           { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.mt-eff--partially-effective { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.mt-eff--not-effective       { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }
.mt-eff--unknown             { background: var(--cat-bg-subtle, #f4f4f5);  color: var(--cat-text-secondary); }

.mt-table-footer {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
  font-size: 12px;
  color: var(--cat-text-tertiary);
}

.mt-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--cat-text-secondary);
}

.mt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  text-align: center;
  color: var(--cat-text-tertiary);
  gap: 6px;

  p { font-weight: 600; color: var(--cat-text-secondary); margin: 0; }
}

// Create form
.mt-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
}

.mt-field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--cat-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
}

.mt-span-2 { grid-column: span 2; }
.mt-req { color: var(--el-color-danger); }
.mt-field-error { font-size: 12px; color: var(--el-color-danger); }
.mt-select-error :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
</style>
