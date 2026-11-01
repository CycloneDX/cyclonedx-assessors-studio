<template>
  <div class="setup-container">
    <PageHeader title="Targeted Assessment Setup">
      <template #actions>
        <el-button @click="handleCancel">Cancel</el-button>
        <el-button
          v-if="mode === 'picker'"
          type="primary"
          :disabled="selectedRequirementIds.length === 0"
          :loading="starting"
          @click="handleStart"
        >
          Start Assessment ({{ selectedRequirementIds.length }} selected)
        </el-button>
      </template>
    </PageHeader>

    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>Loading…</span>
    </div>

    <template v-else>
      <div class="setup-content">

        <!-- ─── Branch: no standard linked ─── -->
        <template v-if="mode === 'branch'">
          <p class="setup-intro text-secondary">
            This assessment has no standard linked. Choose how you'd like to proceed:
          </p>

          <div class="branch-cards">
            <div class="branch-card" :class="{ active: branch === 'standard' }" @click="branch = 'standard'">
              <div class="branch-card-icon">📋</div>
              <div class="branch-card-body">
                <div class="branch-card-title">Link a Standard</div>
                <div class="branch-card-desc">Select a compliance standard and cherry-pick specific requirements to assess.</div>
              </div>
            </div>
            <div class="branch-card" :class="{ active: branch === 'task' }" @click="branch = 'task'">
              <div class="branch-card-icon">✅</div>
              <div class="branch-card-body">
                <div class="branch-card-title">Task Assessment</div>
                <div class="branch-card-desc">Freeform work — sign-offs, evidence gathering, pen test prep, or any ad-hoc assessment activity.</div>
              </div>
            </div>
          </div>

          <!-- Standard picker (branch A) -->
          <div v-if="branch === 'standard'" class="branch-form">
            <el-form label-width="110px">
              <el-form-item label="Standard" required>
                <el-select v-model="linkedStandardId" placeholder="Select a standard" class="w-full" filterable>
                  <el-option
                    v-for="std in standards"
                    :key="(std as any).id"
                    :label="`${(std as any).name}${(std as any).version ? ' v' + (std as any).version : ''}`"
                    :value="(std as any).id"
                  />
                </el-select>
              </el-form-item>
            </el-form>
            <el-button
              type="primary"
              :disabled="!linkedStandardId"
              :loading="loadingRequirements"
              @click="loadRequirementsForLinkedStandard"
            >
              Continue to Requirement Selection
            </el-button>
          </div>

          <!-- Task label form (branch B) -->
          <div v-if="branch === 'task'" class="branch-form">
            <el-form label-width="110px">
              <el-form-item label="Task Type" required>
                <div class="task-chips">
                  <el-tag
                    v-for="suggestion in taskSuggestions"
                    :key="suggestion"
                    class="task-chip"
                    :type="taskLabel === suggestion ? 'primary' : 'info'"
                    effect="plain"
                    style="cursor:pointer"
                    @click="taskLabel = suggestion"
                  >{{ suggestion }}</el-tag>
                </div>
                <el-input
                  v-model="taskLabel"
                  placeholder="or type your own…"
                  :maxlength="25"
                  show-word-limit
                  class="mt-2"
                />
                <div class="form-hint">A short label describing the nature of this work (25 chars max).</div>
              </el-form-item>
              <el-form-item label="Assessors">
                <el-select
                  v-model="assessorIds"
                  multiple
                  placeholder="Assign assessors (optional)"
                  class="w-full"
                  filterable
                >
                  <el-option
                    v-for="user in assignableUsers"
                    :key="(user as any).id"
                    :label="(user as any).displayName || (user as any).username"
                    :value="(user as any).id"
                  >
                    <span>{{ (user as any).displayName || (user as any).username }}</span>
                    <span class="user-role-hint">{{ (user as any).role }}</span>
                  </el-option>
                </el-select>
              </el-form-item>
            </el-form>
            <el-button
              type="primary"
              :disabled="!taskLabel.trim()"
              :loading="starting"
              @click="handleStartTask"
            >
              Start Task Assessment
            </el-button>
          </div>
        </template>

        <!-- ─── Requirement picker (standard is known) ─── -->
        <template v-if="mode === 'picker'">
          <p class="setup-intro text-secondary">
            Select the requirements you want to assess. Use the level filters to narrow the list,
            then check or uncheck individual items.
          </p>

          <!-- Assessor picker -->
          <div class="assessor-row">
            <span class="assessor-label">Assessors</span>
            <el-select
              v-model="assessorIds"
              multiple
              placeholder="Assign assessors (optional)"
              class="assessor-select"
              filterable
              @change="saveAssessors"
            >
              <el-option
                v-for="user in assignableUsers"
                :key="(user as any).id"
                :label="(user as any).displayName || (user as any).username"
                :value="(user as any).id"
              >
                <span>{{ (user as any).displayName || (user as any).username }}</span>
                <span class="user-role-hint">{{ (user as any).role }}</span>
              </el-option>
            </el-select>
          </div>

          <!-- Level filter chips -->
          <div v-if="levels.length > 0" class="level-filters">
            <span class="filter-label">Filter by level:</span>
            <el-check-tag
              v-for="level in levels"
              :key="level.id"
              :checked="activeLevelIds.includes(level.id)"
              @change="toggleLevel(level.id)"
            >
              {{ level.identifier }}{{ level.title ? ' — ' + level.title : '' }}
            </el-check-tag>
            <el-button v-if="activeLevelIds.length > 0" link size="small" @click="activeLevelIds = []">
              Clear filters
            </el-button>
          </div>

          <!-- Search -->
          <div class="search-bar">
            <el-input
              v-model="search"
              placeholder="Search by identifier or name…"
              clearable
              class="w-full"
            />
          </div>

          <!-- Bulk actions + selection summary -->
          <div class="bulk-actions">
            <el-button size="small" @click="selectAll">Select all visible ({{ filteredLeafRequirements.length }})</el-button>
            <el-button size="small" @click="deselectAll">Deselect all</el-button>
            <span v-if="selectedRequirementIds.length > 0" class="selection-summary">
              {{ selectionSummary }}
            </span>
          </div>

          <!-- Requirements list -->
          <div class="requirements-list">
            <template v-for="group in groupedRequirements" :key="group.levelId">
              <div class="level-group">
                <div class="level-header">
                  <el-checkbox
                    :model-value="isGroupSelected(group)"
                    :indeterminate="isGroupIndeterminate(group)"
                    @change="toggleGroup(group)"
                  >
                    <span class="level-title">{{ group.levelIdentifier }}{{ group.levelTitle ? ' — ' + group.levelTitle : '' }}</span>
                    <span class="req-count">({{ group.requirements.length }})</span>
                  </el-checkbox>
                </div>
                <template v-for="item in group.requirements" :key="item.id">
                  <!-- Parent category header — not selectable -->
                  <div v-if="parentIds.has(item.id)" class="requirement-parent">
                    <span class="req-identifier">{{ item.identifier }}</span>
                    <span class="req-name">{{ item.name }}</span>
                  </div>
                  <!-- Leaf requirement — selectable -->
                  <div
                    v-else
                    class="requirement-row"
                    :class="{ selected: selectedRequirementIds.includes(item.id) }"
                  >
                    <el-checkbox
                      :model-value="selectedRequirementIds.includes(item.id)"
                      @change="toggleRequirement(item.id)"
                    >
                      <span class="req-identifier">{{ item.identifier }}</span>
                      <span class="req-name">{{ item.name }}</span>
                    </el-checkbox>
                  </div>
                </template>
              </div>
            </template>

            <template v-if="ungroupedLeafRequirements.length > 0 || ungroupedParents.length > 0">
              <div class="level-group">
                <div class="level-header">
                  <el-checkbox
                    :model-value="isUngroupedSelected"
                    :indeterminate="isUngroupedIndeterminate"
                    @change="toggleUngrouped"
                  >
                    <span class="level-title">Other requirements</span>
                    <span class="req-count">({{ ungroupedLeafRequirements.length }})</span>
                  </el-checkbox>
                </div>
                <template v-for="item in ungroupedAll" :key="item.id">
                  <div v-if="parentIds.has(item.id)" class="requirement-parent">
                    <span class="req-identifier">{{ item.identifier }}</span>
                    <span class="req-name">{{ item.name }}</span>
                  </div>
                  <div
                    v-else
                    class="requirement-row"
                    :class="{ selected: selectedRequirementIds.includes(item.id) }"
                  >
                    <el-checkbox
                      :model-value="selectedRequirementIds.includes(item.id)"
                      @change="toggleRequirement(item.id)"
                    >
                      <span class="req-identifier">{{ item.identifier }}</span>
                      <span class="req-name">{{ item.name }}</span>
                    </el-checkbox>
                  </div>
                </template>
              </div>
            </template>

            <el-empty v-if="filteredLeafRequirements.length === 0 && filteredRequirements.length === 0" description="No requirements match your filters" />
          </div>
        </template>

      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import client from '@/api/client'
import PageHeader from '@/components/shared/PageHeader.vue'
import { getAvailableRequirements, startAssessment } from '@/api/assessments'

const route = useRoute()
const router = useRouter()
const assessmentId = route.params.id as string

// ── State ──────────────────────────────────────────────────────────────────
const loading = ref(false)
const loadingRequirements = ref(false)
const starting = ref(false)
const search = ref('')
const activeLevelIds = ref<string[]>([])
const selectedRequirementIds = ref<string[]>([])
const assessorIds = ref<string[]>([])
const assignableUsers = ref<Record<string, unknown>[]>([])
const standards = ref<Record<string, unknown>[]>([])

type Level = { id: string; identifier: string; title: string; standard_id: string }
type Requirement = {
  id: string
  identifier: string
  name: string
  description?: string
  parent_id?: string | null
  levels: { id: string; identifier: string; title: string }[]
}

const levels = ref<Level[]>([])
const requirements = ref<Requirement[]>([])

const mode = ref<'branch' | 'picker'>('branch')
const branch = ref<'standard' | 'task' | null>(null)
const linkedStandardId = ref<string | null>(null)
const taskLabel = ref('')

const taskSuggestions = ['Pen Test Prep', 'Sign-off Review', 'Evidence Gathering', 'Gap Analysis', 'Vendor Review']

// ── Navigate-away guard ────────────────────────────────────────────────────
onBeforeRouteLeave(async (_to, _from, next) => {
  if (mode.value === 'picker' && selectedRequirementIds.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        'You have requirements selected but haven\'t started the assessment yet. Leave anyway?',
        'Unsaved selection',
        { confirmButtonText: 'Leave', cancelButtonText: 'Stay', type: 'warning' }
      )
      next()
    } catch {
      next(false)
    }
  } else {
    next()
  }
})

// ── Cancel ─────────────────────────────────────────────────────────────────
async function handleCancel() {
  if (mode.value === 'picker' && selectedRequirementIds.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        'You have requirements selected but haven\'t started the assessment yet. Leave anyway?',
        'Unsaved selection',
        { confirmButtonText: 'Leave', cancelButtonText: 'Stay', type: 'warning' }
      )
    } catch {
      return
    }
  }
  router.push(`/assessments/${assessmentId}`)
}

// ── Init ───────────────────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true
  try {
    // Load assignable users for assessor picker
    const usersRes = await client.get('/users/assignable')
    assignableUsers.value = usersRes.data.data || []

    // Pre-populate assessors and check if standard is already linked
    const assessmentRes = await client.get(`/assessments/${assessmentId}`)
    const assessmentData = assessmentRes.data as { assessors?: { id: string }[]; standardId?: string | null }
    assessorIds.value = (assessmentData.assessors || []).map(a => a.id)

    if (!assessmentData.standardId) {
      // No standard — show branch screen so user picks link-standard or task path
      mode.value = 'branch'
      try {
        const res = await client.get('/standards')
        standards.value = (res.data.data || []).filter((s: Record<string, unknown>) => s.state === 'published')
      } catch { /* non-fatal */ }
    } else {
      // Standard linked — load requirements and go straight to picker
      const data = await getAvailableRequirements(assessmentId)
      levels.value = data.levels
      requirements.value = data.requirements
      mode.value = 'picker'
    }
  } catch {
    mode.value = 'branch'
    try {
      const res = await client.get('/standards')
      standards.value = (res.data.data || []).filter((s: Record<string, unknown>) => s.state === 'published')
    } catch { /* non-fatal */ }
  } finally {
    loading.value = false
  }
})

// ── Parent IDs set (requirements that have children — not directly assessable) ──
const parentIds = computed(() => {
  const ids = new Set<string>()
  for (const r of requirements.value) {
    if (r.parent_id) ids.add(r.parent_id)
  }
  return ids
})

// ── Branch: link a standard ────────────────────────────────────────────────
async function loadRequirementsForLinkedStandard() {
  if (!linkedStandardId.value) return
  loadingRequirements.value = true
  try {
    await client.put(`/assessments/${assessmentId}`, { standardId: linkedStandardId.value })
    const data = await getAvailableRequirements(assessmentId)
    levels.value = data.levels
    requirements.value = data.requirements
    mode.value = 'picker'
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to load requirements')
  } finally {
    loadingRequirements.value = false
  }
}

// ── Branch: start as task ──────────────────────────────────────────────────
async function handleStartTask() {
  if (!taskLabel.value.trim()) return
  starting.value = true
  try {
    if (assessorIds.value.length > 0) {
      await client.put(`/assessments/${assessmentId}`, { assessorIds: assessorIds.value })
    }
    await client.post(`/assessments/${assessmentId}/start`, {
      assessmentType: 'tasks',
      taskLabel: taskLabel.value.trim(),
    })
    ElMessage.success('Task assessment started')
    router.push(`/assessments/${assessmentId}`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to start assessment')
  } finally {
    starting.value = false
  }
}

// ── Assessors: auto-save on change in picker mode ─────────────────────────
async function saveAssessors() {
  try {
    await client.put(`/assessments/${assessmentId}`, { assessorIds: assessorIds.value })
  } catch { /* non-fatal */ }
}

// ── Requirement filtering ──────────────────────────────────────────────────
const filteredRequirements = computed(() => {
  let reqs = requirements.value
  if (activeLevelIds.value.length > 0) {
    reqs = reqs.filter(r => r.levels.some(l => activeLevelIds.value.includes(l.id)))
  }
  if (search.value.trim()) {
    const q = search.value.toLowerCase()
    reqs = reqs.filter(r =>
      r.identifier.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    )
  }
  return reqs
})

// All leaf requirements regardless of active filters (used for level-chip selection)
const leafRequirements = computed(() =>
  requirements.value.filter(r => !parentIds.value.has(r.id))
)

const filteredLeafRequirements = computed(() =>
  filteredRequirements.value.filter(r => !parentIds.value.has(r.id))
)

type ReqGroup = { levelId: string; levelIdentifier: string; levelTitle: string; requirements: Requirement[] }

const groupedRequirements = computed<ReqGroup[]>(() => {
  const groups: ReqGroup[] = []
  const seen = new Set<string>()
  for (const level of levels.value) {
    const reqs = filteredRequirements.value.filter(r => r.levels.some(l => l.id === level.id) && !seen.has(r.id))
    reqs.forEach(r => seen.add(r.id))
    if (reqs.length > 0) {
      groups.push({ levelId: level.id, levelIdentifier: level.identifier, levelTitle: level.title, requirements: reqs })
    }
  }
  return groups
})

const groupedIds = computed(() => new Set(groupedRequirements.value.flatMap(g => g.requirements.map(r => r.id))))

const ungroupedAll = computed(() => filteredRequirements.value.filter(r => !groupedIds.value.has(r.id)))
const ungroupedLeafRequirements = computed(() => ungroupedAll.value.filter(r => !parentIds.value.has(r.id)))
const ungroupedParents = computed(() => ungroupedAll.value.filter(r => parentIds.value.has(r.id)))

// ── Selection summary ──────────────────────────────────────────────────────
const selectionSummary = computed(() => {
  const count = selectedRequirementIds.value.length
  if (count === 0) return ''

  // Count per level
  const levelCounts: Record<string, { identifier: string; count: number }> = {}
  for (const req of requirements.value.filter(r => selectedRequirementIds.value.includes(r.id))) {
    for (const l of req.levels) {
      if (!levelCounts[l.id]) levelCounts[l.id] = { identifier: l.identifier, count: 0 }
      levelCounts[l.id].count++
    }
  }
  const levelParts = Object.values(levelCounts).map(l => `${l.count} from ${l.identifier}`)
  if (levelParts.length === 0) return `${count} requirement${count !== 1 ? 's' : ''} selected`
  return `${count} requirement${count !== 1 ? 's' : ''} selected (${levelParts.join(', ')})`
})

// ── Group selection helpers (leaf-only for selection) ─────────────────────
function leafOf(g: ReqGroup) { return g.requirements.filter(r => !parentIds.value.has(r.id)) }

function isGroupSelected(g: ReqGroup) {
  const leaves = leafOf(g)
  return leaves.length > 0 && leaves.every(r => selectedRequirementIds.value.includes(r.id))
}
function isGroupIndeterminate(g: ReqGroup) {
  const leaves = leafOf(g)
  const n = leaves.filter(r => selectedRequirementIds.value.includes(r.id)).length
  return n > 0 && n < leaves.length
}
function toggleGroup(g: ReqGroup) {
  const leaves = leafOf(g)
  if (isGroupSelected(g)) {
    selectedRequirementIds.value = selectedRequirementIds.value.filter(id => !leaves.some(r => r.id === id))
  } else {
    leaves.forEach(r => { if (!selectedRequirementIds.value.includes(r.id)) selectedRequirementIds.value.push(r.id) })
  }
}

const isUngroupedSelected = computed(() => {
  const leaves = ungroupedLeafRequirements.value
  return leaves.length > 0 && leaves.every(r => selectedRequirementIds.value.includes(r.id))
})
const isUngroupedIndeterminate = computed(() => {
  const n = ungroupedLeafRequirements.value.filter(r => selectedRequirementIds.value.includes(r.id)).length
  return n > 0 && n < ungroupedLeafRequirements.value.length
})
function toggleUngrouped() {
  const leaves = ungroupedLeafRequirements.value
  if (isUngroupedSelected.value) {
    selectedRequirementIds.value = selectedRequirementIds.value.filter(id => !leaves.some(r => r.id === id))
  } else {
    leaves.forEach(r => { if (!selectedRequirementIds.value.includes(r.id)) selectedRequirementIds.value.push(r.id) })
  }
}

function toggleLevel(id: string) {
  const wasActive = activeLevelIds.value.includes(id)
  if (!wasActive) {
    activeLevelIds.value.push(id)
    // Select all leaf requirements belonging to this level
    const leafIds = leafRequirements.value
      .filter(r => r.levels.some(l => l.id === id))
      .map(r => r.id)
    leafIds.forEach(rid => {
      if (!selectedRequirementIds.value.includes(rid)) selectedRequirementIds.value.push(rid)
    })
  } else {
    activeLevelIds.value.splice(activeLevelIds.value.indexOf(id), 1)
    // Deselect leaf requirements that belong ONLY to this level (not also in another active level)
    const remaining = activeLevelIds.value
    leafRequirements.value
      .filter(r => r.levels.some(l => l.id === id))
      .filter(r => !r.levels.some(l => remaining.includes(l.id)))
      .forEach(r => {
        const si = selectedRequirementIds.value.indexOf(r.id)
        if (si !== -1) selectedRequirementIds.value.splice(si, 1)
      })
  }
}
function toggleRequirement(id: string) {
  const i = selectedRequirementIds.value.indexOf(id)
  if (i === -1) selectedRequirementIds.value.push(id)
  else selectedRequirementIds.value.splice(i, 1)
}
function selectAll() {
  filteredLeafRequirements.value.forEach(r => {
    if (!selectedRequirementIds.value.includes(r.id)) selectedRequirementIds.value.push(r.id)
  })
}
function deselectAll() { selectedRequirementIds.value = [] }

// ── Start picker assessment ────────────────────────────────────────────────
async function handleStart() {
  if (selectedRequirementIds.value.length === 0) return
  starting.value = true
  try {
    if (assessorIds.value.length > 0) {
      await client.put(`/assessments/${assessmentId}`, { assessorIds: assessorIds.value })
    }
    await startAssessment(assessmentId, selectedRequirementIds.value)
    ElMessage.success('Assessment started with selected requirements')
    router.push(`/assessments/${assessmentId}`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to start assessment')
  } finally {
    starting.value = false
  }
}
</script>

<style scoped lang="scss">
.setup-container { padding: 0; }

.setup-content {
  padding: 0 var(--spacing-6);
  max-width: 900px;
}

.setup-intro { margin-bottom: var(--spacing-5); }

/* ── Branch cards ── */
.branch-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-5);
}

.branch-card {
  display: flex;
  gap: var(--spacing-3);
  align-items: flex-start;
  padding: var(--spacing-4);
  border: 2px solid var(--color-border);
  border-radius: var(--border-radius-md);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &:hover { border-color: var(--color-primary); }
  &.active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }

  .branch-card-icon { font-size: 24px; line-height: 1; }
  .branch-card-title { font-weight: 600; font-size: 14px; margin-bottom: var(--spacing-1); }
  .branch-card-desc { font-size: 13px; color: var(--color-text-secondary); }
}

.branch-form {
  padding: var(--spacing-4);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  background: var(--color-bg-secondary);
  margin-bottom: var(--spacing-4);

  .form-hint { font-size: 12px; color: var(--color-text-tertiary); margin-top: 4px; }
}

.task-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
}
.task-chip { transition: opacity 0.1s; }
.mt-2 { margin-top: 8px; }

/* ── Assessor row in picker mode ── */
.assessor-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-5);
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);

  .assessor-label {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .assessor-select { flex: 1; }
}

.user-role-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-left: var(--spacing-2);
}

/* ── Picker ── */
.level-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-4);

  .filter-label { font-size: 13px; color: var(--color-text-secondary); }
}

.search-bar { margin-bottom: var(--spacing-3); }

.bulk-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-4);

  .selection-summary {
    font-size: 13px;
    color: var(--color-primary);
    margin-left: var(--spacing-2);
  }
}

.requirements-list {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-md);
  overflow: hidden;
}

.level-group + .level-group { border-top: 1px solid var(--color-border); }

.level-header {
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-bg-secondary);
  font-weight: 600;

  .level-title { font-size: 13px; margin-right: var(--spacing-2); }
  .req-count { font-size: 12px; color: var(--color-text-tertiary); font-weight: 400; }
}

/* Parent category header — visually distinct, not a checkbox */
.requirement-parent {
  padding: var(--spacing-2) var(--spacing-4) var(--spacing-2) var(--spacing-5);
  border-top: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);

  .req-identifier {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-right: var(--spacing-2);
  }
  .req-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-secondary);
    font-style: italic;
  }
}

.requirement-row {
  padding: var(--spacing-2) var(--spacing-4) var(--spacing-2) var(--spacing-7);
  border-top: 1px solid var(--color-border-light);
  transition: background 0.1s;

  &.selected { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
  &:hover { background: var(--color-bg-hover); }

  .req-identifier {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-right: var(--spacing-2);
  }
  .req-name { font-size: 13px; }
}

.loading-container {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-8);
  color: var(--color-text-secondary);
}
</style>
