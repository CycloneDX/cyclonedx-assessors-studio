<template>
  <div class="ev-page">
    <PageHeader title="Evidence Registry">
      <template #actions>
        <el-button :icon="Download" @click="exportCsv">Export</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">New Evidence</el-button>
      </template>
    </PageHeader>

    <!-- Stat bar -->
    <div class="ev-stat-bar">
      <div v-for="stat in statItems" :key="stat.key"
        class="ev-stat" :class="[`ev-stat--${stat.key}`, { active: stateFilter === stat.value }]"
        @click="stateFilter = stateFilter === stat.value ? '' : stat.value">
        <div class="ev-stat-value">{{ stat.count }}</div>
        <div class="ev-stat-label">{{ stat.label }}</div>
      </div>
    </div>

    <div class="ev-content">
      <!-- Toolbar -->
      <div class="ev-toolbar">
        <el-input v-model="searchText" placeholder="Search name, ID, author…" clearable style="max-width:320px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="stateFilter" placeholder="All States" clearable style="width:150px">
          <el-option label="In Progress" value="in_progress" />
          <el-option label="In Review" value="in_review" />
          <el-option label="Claimed" value="claimed" />
          <el-option label="Expired" value="expired" />
        </el-select>
        <el-select v-model="typeFilter" placeholder="All Types" clearable style="width:180px">
          <el-option label="Proof" value="proof" />
          <el-option label="Counter Evidence" value="counter_evidence" />
          <el-option label="Mitigation Strategy" value="mitigation_strategy" />
        </el-select>
        <div style="flex:1" />
        <span v-if="hasFilters" class="ev-result-count">{{ filteredEvidence.length }} of {{ evidence.length }}</span>
        <el-button v-if="hasFilters" link @click="clearFilters">Clear filters</el-button>
      </div>

      <!-- Table card -->
      <div class="ev-card">
        <div class="ev-card-header">
          <span class="ev-card-title"><el-icon><FolderOpened /></el-icon> Evidence Pool</span>
          <el-tag type="info" size="small">{{ filteredEvidence.length }}</el-tag>
          <div style="flex:1" />
          <template v-if="selectedIds.length > 0">
            <span class="ev-sel-label">{{ selectedIds.length }} selected</span>
            <el-button size="small" type="success" @click="bulkAccept">Accept</el-button>
            <el-button size="small" type="danger" plain @click="bulkDelete">Delete</el-button>
          </template>
        </div>

        <div v-if="loading" class="ev-loading">
          <el-icon class="is-loading"><Loading /></el-icon> Loading…
        </div>
        <el-alert v-else-if="loadError" type="error" :description="loadError" show-icon :closable="false" />

        <template v-else>
          <!-- Column headers -->
          <div class="ev-table-head">
            <div class="ev-col-check"><el-checkbox :model-value="allSelected" @change="toggleAll" aria-label="Select all evidence" /></div>
            <div class="ev-col-id ev-sortable" @click="sortBy('id')">ID <SortIcon :field="'id'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-name ev-sortable" @click="sortBy('name')">Name <SortIcon :field="'name'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-type ev-sortable" @click="sortBy('type')">Type <SortIcon :field="'type'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-state ev-sortable" @click="sortBy('state')">State <SortIcon :field="'state'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-author ev-sortable" @click="sortBy('authorName')">Author <SortIcon :field="'authorName'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-reviewer">Reviewer</div>
            <div class="ev-col-expires ev-sortable" @click="sortBy('expiresOn')">Expires <SortIcon :field="'expiresOn'" :current="sortField" :dir="sortDir" /></div>
            <div class="ev-col-counts">Claims</div>
            <div class="ev-col-counts">Assessments</div>
            <div class="ev-col-actions"></div>
          </div>

          <div v-if="pagedEvidence.length === 0" class="ev-empty">
            <el-icon :size="36"><Collection /></el-icon>
            <p>No evidence records found</p>
            <span v-if="hasFilters">Try adjusting your filters.</span>
            <span v-else>Click <strong>New Evidence</strong> to create the first record.</span>
          </div>

          <div v-for="row in pagedEvidence" :key="row.id"
            class="ev-row"
            :class="{ 'ev-row--selected': selectedIds.includes(row.id) }"
            @click="navigateTo(row)">
            <div class="ev-col-check" @click.stop>
              <el-checkbox :model-value="selectedIds.includes(row.id)" @change="toggleRow(row.id)" :aria-label="`Select evidence ${row.name}`" />
            </div>
            <div class="ev-col-id">
              <span class="ev-id-chip">{{ fmtEvdId(row.displayId) }}</span>
            </div>
            <div class="ev-col-name">{{ row.name }}</div>
            <div class="ev-col-type">
              <span class="ev-type-badge" :class="`ev-type--${evidenceType(row)}`">{{ typeLabel(evidenceType(row)) }}</span>
            </div>
            <div class="ev-col-state">
              <StateBadge :state="row.state" />
            </div>
            <div class="ev-col-author">{{ row.authorName || '—' }}</div>
            <div class="ev-col-reviewer">{{ row.reviewerName || '—' }}</div>
            <div class="ev-col-expires" :class="expiryClass(row.expiresOn)">
              {{ row.expiresOn ? formatDate(row.expiresOn) : '—' }}
              <el-icon v-if="isExpiringSoon(row.expiresOn)" style="color:var(--el-color-warning);margin-left:3px"><Warning /></el-icon>
              <el-icon v-if="isExpired(row.expiresOn)" style="color:var(--el-color-danger);margin-left:3px"><CircleCloseFilled /></el-icon>
            </div>
            <div class="ev-col-counts" @click.stop>
              <span class="ev-bubble ev-bubble--claims">{{ row.claimsCount ?? 0 }}</span>
            </div>
            <div class="ev-col-counts" @click.stop>
              <span class="ev-bubble ev-bubble--assessments">{{ row.assessmentCount ?? 0 }}</span>
            </div>
            <div class="ev-col-actions" @click.stop>
              <el-button link type="primary" size="small" @click="navigateTo(row)" :aria-label="`Edit evidence ${row.name}`"><el-icon><Edit /></el-icon></el-button>
              <el-button link type="danger" size="small" @click="confirmDelete(row.id)" :aria-label="`Delete evidence ${row.name}`"><el-icon><Delete /></el-icon></el-button>
            </div>
          </div>

          <!-- Footer / pagination -->
          <div class="ev-table-footer">
            <span>{{ filteredEvidence.length }} record{{ filteredEvidence.length !== 1 ? 's' : '' }}</span>
            <div style="flex:1" />
            <el-pagination
              v-model:current-page="currentPage"
              :page-size="pageSize"
              :total="filteredEvidence.length"
              layout="prev, pager, next"
              small
            />
          </div>
        </template>
      </div>
    </div>

    <!-- ── Create dialog ── -->
    <el-dialog v-model="showCreate" title="New Evidence" width="640px" :close-on-click-modal="false">
      <div class="ev-form-grid">
        <div class="ev-field">
          <label>Name <span class="ev-req">*</span></label>
          <el-input v-model="form.name" placeholder="Evidence name" :status="formErrors.name ? 'error' : ''" />
          <span v-if="formErrors.name" class="ev-field-error">{{ formErrors.name }}</span>
        </div>
        <div class="ev-field">
          <label>State <span class="ev-req">*</span></label>
          <el-select v-model="form.state" style="width:100%">
            <el-option label="In Progress" value="in_progress" />
            <el-option label="In Review" value="in_review" />
          </el-select>
        </div>
        <div class="ev-field">
          <label>Type <span class="ev-req">*</span></label>
          <el-select v-model="form.type" style="width:100%">
            <el-option label="Proof" value="proof" />
            <el-option label="Counter Evidence" value="counter_evidence" />
            <el-option label="Mitigation Strategy" value="mitigation_strategy" />
          </el-select>
        </div>
        <div class="ev-field">
          <label>Expires On</label>
          <el-date-picker v-model="form.expiresOn" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" style="width:100%" />
        </div>
        <div class="ev-field">
          <label>Author</label>
          <el-input :model-value="authStore.user?.displayName || '—'" disabled />
        </div>
        <div class="ev-field">
          <label>Reviewer <span class="ev-req">*</span></label>
          <el-select v-model="form.reviewerId" filterable clearable placeholder="Select reviewer…" style="width:100%"
            :class="formErrors.reviewerId ? 'ev-select-error' : ''">
            <el-option v-for="u in reviewerOptions" :key="u.id" :label="u.displayName" :value="u.id" />
          </el-select>
          <span v-if="formErrors.reviewerId" class="ev-field-error">{{ formErrors.reviewerId }}</span>
        </div>
        <div class="ev-field ev-span-2">
          <label>Owner <span class="ev-opt">(optional)</span></label>
          <el-input v-model="form.owner" placeholder="Person or team responsible for this evidence" />
        </div>
        <div class="ev-field ev-span-2">
          <label>Description / Notes</label>
          <el-input v-model="form.description" type="textarea" :rows="4" placeholder="Describe the evidence and how it satisfies the requirement…" />
        </div>
      </div>
      <template #footer>
        <el-button @click="showCreate = false">Cancel</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">Create Evidence</el-button>
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
  Loading, Collection, FolderOpened, Search, Download, Plus,
  Warning, CircleCloseFilled, Edit, Delete,
} from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import { formatDate } from '@/utils/dateFormat'
import { apiErrorMessage } from '@/utils/errorMessage'
import { useAuthStore } from '@/stores/auth'
import type { Evidence } from '@/types'

const router    = useRouter()
const authStore = useAuthStore()

function fmtEvdId(n?: number): string {
  if (!n) return 'EVD-???'
  return `EVD-${String(n).padStart(4, '0')}`
}

// ── State ──────────────────────────────────────────────────────────────────
const loading    = ref(false)
const loadError  = ref('')
const saving     = ref(false)
const evidence   = ref<Evidence[]>([])
const showCreate = ref(false)

const searchText  = ref('')
const stateFilter = ref('')
const typeFilter  = ref('')
const sortField   = ref('createdAt')
const sortDir     = ref<'asc' | 'desc'>('desc')
const currentPage = ref(1)
const pageSize    = ref(20)
const selectedIds = ref<string[]>([])

interface AssignableUser { id: string; displayName: string; username: string }
const reviewerOptions = ref<AssignableUser[]>([])

const form = ref({ name: '', state: 'in_progress', type: 'proof', expiresOn: '', owner: '', reviewerId: '' as string | null, description: '' })
const formErrors = ref<Record<string, string>>({})

// ── Computed ───────────────────────────────────────────────────────────────
const hasFilters = computed(() => !!(searchText.value || stateFilter.value || typeFilter.value))

const statItems = computed(() => [
  { key: 'total',     value: '',           label: 'Total',          count: evidence.value.length },
  { key: 'progress',  value: 'in_progress',label: 'In Progress',    count: evidence.value.filter(e => e.state === 'in_progress').length },
  { key: 'review',    value: 'in_review',  label: 'In Review',      count: evidence.value.filter(e => e.state === 'in_review').length },
  { key: 'claimed',   value: 'claimed',    label: 'Claimed',        count: evidence.value.filter(e => e.state === 'claimed').length },
  { key: 'expired',   value: 'expired',    label: 'Expired',        count: evidence.value.filter(e => e.state === 'expired').length },
])

const filteredEvidence = computed(() => {
  let rows = [...evidence.value]
  const q = searchText.value.trim().toLowerCase()
  if (q) rows = rows.filter(e =>
    e.name.toLowerCase().includes(q) ||
    (e.authorName || '').toLowerCase().includes(q) ||
    (e.displayId ? fmtEvdId(e.displayId).toLowerCase().includes(q) : false)
  )
  if (stateFilter.value) rows = rows.filter(e => e.state === stateFilter.value)
  if (typeFilter.value)  rows = rows.filter(e => evidenceType(e) === typeFilter.value)
  rows.sort((a, b) => {
    const f = sortField.value as keyof Evidence
    const av = String(a[f] ?? '').toLowerCase()
    const bv = String(b[f] ?? '').toLowerCase()
    return sortDir.value === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
  return rows
})

const pagedEvidence = computed(() => {
  const s = (currentPage.value - 1) * pageSize.value
  return filteredEvidence.value.slice(s, s + pageSize.value)
})

const allSelected = computed(() =>
  pagedEvidence.value.length > 0 && pagedEvidence.value.every(r => selectedIds.value.includes(r.id))
)

// ── Helpers ────────────────────────────────────────────────────────────────
// Evidence created before the `type` column existed — including the demo seed
// rows — stores a null type. Every such record is a plain proof unless it is
// flagged as counter-evidence. Derive a concrete type so the badge, the type
// filter, and the CSV export agree instead of rendering a bare dash for proofs.
function evidenceType(row: Pick<Evidence, 'type' | 'isCounterEvidence'>): string {
  return row.type ?? (row.isCounterEvidence ? 'counter_evidence' : 'proof')
}

function typeLabel(type: string) {
  return { proof: 'Proof', counter_evidence: 'Counter Evidence', mitigation_strategy: 'Mitigation Strategy' }[type] ?? type
}

function isExpiringSoon(date?: string | null) {
  if (!date) return false
  const diff = (new Date(date).getTime() - Date.now()) / 86400000
  return diff >= 0 && diff <= 30
}

function isExpired(date?: string | null) {
  if (!date) return false
  return new Date(date) < new Date()
}

function expiryClass(date?: string | null) {
  if (isExpired(date)) return 'ev-expired'
  if (isExpiringSoon(date)) return 'ev-expiring'
  return ''
}

function sortBy(field: string) {
  if (sortField.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else { sortField.value = field; sortDir.value = 'asc' }
}

function clearFilters() {
  searchText.value = ''; stateFilter.value = ''; typeFilter.value = ''
}

function toggleAll(val: boolean | string | number) {
  if (val) pagedEvidence.value.forEach(r => { if (!selectedIds.value.includes(r.id)) selectedIds.value.push(r.id) })
  else pagedEvidence.value.forEach(r => { selectedIds.value = selectedIds.value.filter(id => id !== r.id) })
}

function toggleRow(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1); else selectedIds.value.push(id)
}

function navigateTo(row: Evidence) { router.push(`/evidence/${row.id}`) }

// ── Data ───────────────────────────────────────────────────────────────────
async function fetchReviewers() {
  try {
    const { data } = await client.get('/users/assignable')
    reviewerOptions.value = (data.data ?? data).map((u: Record<string, string>) => ({
      id: u.id,
      displayName: u.displayName || u.display_name || u.username,
      username: u.username,
    }))
  } catch { /* non-fatal */ }
}

async function fetchEvidence() {
  loading.value = true; loadError.value = ''
  try {
    const { data } = await client.get('/evidence', { params: { limit: 100 } })
    evidence.value = data.data || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load evidence')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = { name: '', state: 'in_progress', type: 'proof', expiresOn: '', owner: '', reviewerId: null, description: '' }
  formErrors.value = {}
  showCreate.value = true
}

async function handleCreate() {
  formErrors.value = {}
  if (!form.value.name.trim()) { formErrors.value.name = 'Name is required'; return }
  if (!form.value.reviewerId) { formErrors.value.reviewerId = 'Reviewer is required'; return }
  saving.value = true
  try {
    await client.post('/evidence', {
      name: form.value.name.trim(),
      state: form.value.state,
      type: form.value.type || null,
      expiresOn: form.value.expiresOn || null,
      owner: form.value.owner || null,
      reviewerId: form.value.reviewerId || null,
      description: form.value.description || null,
      isCounterEvidence: form.value.type === 'counter_evidence',
    })
    ElMessage.success('Evidence created')
    showCreate.value = false
    await fetchEvidence()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to create evidence'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(id: string) {
  await ElMessageBox.confirm('Delete this evidence record?', 'Confirm Delete', { type: 'warning', confirmButtonText: 'Delete', confirmButtonClass: 'el-button--danger' })
  try {
    await client.delete(`/evidence/${id}`)
    evidence.value = evidence.value.filter(e => e.id !== id)
    ElMessage.success('Evidence deleted')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to delete'))
  }
}

async function bulkAccept() {
  for (const id of selectedIds.value) {
    try { await client.put(`/evidence/${id}`, { state: 'in_review' }) } catch { /* skip */ }
  }
  ElMessage.success(`${selectedIds.value.length} record(s) moved to In Review`)
  selectedIds.value = []
  await fetchEvidence()
}

async function bulkDelete() {
  await ElMessageBox.confirm(`Delete ${selectedIds.value.length} record(s)?`, 'Confirm Delete', { type: 'warning' })
  for (const id of selectedIds.value) {
    try { await client.delete(`/evidence/${id}`) } catch { /* skip */ }
  }
  ElMessage.success(`${selectedIds.value.length} record(s) deleted`)
  selectedIds.value = []
  await fetchEvidence()
}

function exportCsv() {
  const cols = ['id', 'name', 'type', 'state', 'authorName', 'reviewerName', 'expiresOn', 'createdAt']
  const header = cols.join(',')
  const rows = filteredEvidence.value.map(r =>
    cols.map(c => {
      const v = c === 'type' ? evidenceType(r) : (r as Record<string, unknown>)[c]
      return `"${String(v ?? '').replace(/"/g, '""')}"`
    }).join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'evidence-registry.csv'; a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('Registry exported as CSV')
}

onMounted(() => { fetchEvidence(); fetchReviewers() })

// ── Sort icon component (inline) ───────────────────────────────────────────
const SortIcon = ({ field, current, dir }: { field: string; current: string; dir: string }) => {
  if (field !== current) return h('span', { class: 'ev-sort-icon ev-sort-none' }, '↕')
  return h('span', { class: 'ev-sort-icon' }, dir === 'asc' ? '↑' : '↓')
}
</script>

<style scoped lang="scss">
.ev-page { padding: 0; min-height: 100vh; }

// Stat bar
.ev-stat-bar {
  display: flex;
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 0 var(--cat-spacing-6);
}

.ev-stat {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 10px 20px 10px 0;
  margin-right: 20px;
  border-right: 1px solid var(--cat-border-default);
  cursor: pointer;
  min-width: 70px;

  &:last-child { border-right: none; margin-right: 0; }
  &:hover .ev-stat-label { color: var(--el-color-primary); }
  &.active .ev-stat-value, &.active .ev-stat-label { color: var(--el-color-primary); }
  &--progress .ev-stat-value { color: var(--el-color-warning); }
  &--review   .ev-stat-value { color: var(--el-color-primary); }
  &--claimed  .ev-stat-value { color: var(--el-color-success); }
  &--expired  .ev-stat-value { color: var(--el-color-danger); }
}

.ev-stat-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--cat-text-primary);
}

.ev-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--cat-text-tertiary);
  margin-top: 3px;
}

// Content
.ev-content { padding: var(--cat-spacing-4) var(--cat-spacing-6) var(--cat-spacing-8); }

// Toolbar
.ev-toolbar {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  margin-bottom: var(--cat-spacing-4);
  flex-wrap: wrap;
}
.ev-result-count { font-size: 12px; color: var(--cat-text-secondary); }

// Card
.ev-card {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.ev-card-header {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  padding: 12px 16px;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
}

.ev-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cat-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ev-sel-label { font-size: 12px; color: var(--cat-text-secondary); }

// Table grid — cols: checkbox | id | name | type | state | author | reviewer | expires | claims | assessments | actions
$cols: 36px 90px 1fr 160px 130px 130px 120px 130px 70px 100px 80px;

.ev-table-head {
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

.ev-sortable {
  cursor: pointer;
  user-select: none;
  &:hover { color: var(--el-color-primary); }
}

.ev-sort-icon { font-size: 11px; opacity: 0.6; }
.ev-sort-none { opacity: 0.3; }

.ev-row {
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

.ev-col-name { font-weight: 500; color: var(--el-color-primary); }

.ev-id-chip {
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary-dark-2);
  padding: 2px 7px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.ev-type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 20px;
  &.ev-type--proof              { background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); }
  &.ev-type--counter_evidence   { background: var(--el-color-info-light-9);    color: var(--el-color-info); }
  &.ev-type--mitigation_strategy{ background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
}

.ev-bubble {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
  &--claims      { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
  &--assessments { background: var(--el-color-success-light-9); color: var(--el-color-success); }
}

.ev-expired  { color: var(--el-color-danger) !important; font-weight: 600; }
.ev-expiring { color: var(--el-color-warning) !important; font-weight: 600; }

.ev-col-actions { gap: 2px; }

.ev-table-footer {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
  font-size: 12px;
  color: var(--cat-text-tertiary);
}

.ev-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--cat-text-secondary);
}

.ev-empty {
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
.ev-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
}

.ev-field {
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

.ev-span-2 { grid-column: span 2; }
.ev-req { color: var(--el-color-danger); }
.ev-opt { color: var(--cat-text-tertiary); font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 2px; }
.ev-field-error { font-size: 12px; color: var(--el-color-danger); }
</style>
