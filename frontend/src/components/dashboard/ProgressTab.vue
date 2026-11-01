<template>
  <div class="progress-content">
    <el-alert v-if="error" type="error" :closable="true" @close="error = ''">{{ error }}</el-alert>

    <!-- Entity Selector -->
    <div class="entity-selector-container">
      <label for="entity-select" class="selector-label">{{ t('progress.selectEntity') }}</label>
      <el-select
        id="entity-select"
        v-model="selectedEntityId"
        :placeholder="t('progress.allEntities')"
        clearable
        filterable
        :loading="loading"
        aria-label="Select entity to view progress"
        @change="onEntityChange"
      >
        <el-option :label="t('progress.allEntities')" value="" />
        <el-option v-for="entity in entities" :key="entity.id" :label="entity.name" :value="entity.id" />
      </el-select>
    </div>

    <!-- Summary Stats -->
    <div v-if="!loading" class="summary-grid">
      <StatCard
        :title="t('progress.totalEntitiesAssessed')"
        :value="summaryStats.totalEntitiesAssessed"
        :icon="FolderOpened"
        accentColor="var(--cat-chart-blue)"
      />
      <StatCard
        :title="t('progress.averageConformance')"
        :value="summaryStats.averageConformance + '%'"
        :icon="Odometer"
        :accentColor="getConformanceColor(summaryStats.averageConformance)"
      />
      <StatCard
        :title="t('progress.activeAssessments')"
        :value="summaryStats.activeAssessments"
        :icon="DocumentChecked"
        accentColor="var(--cat-chart-amber)"
      />
      <StatCard
        :title="t('progress.completedThisQuarter')"
        :value="summaryStats.completedThisQuarter"
        :icon="CircleCheck"
        accentColor="var(--cat-chart-green)"
      />
    </div>
    <div v-else class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ t('common.loading') }}</p>
    </div>

    <!-- ================================================================
         Project Status Table
    ================================================================ -->
    <div class="section-container">
      <h2 class="section-title">Project status — {{ currentYear }}</h2>
      <div v-if="projectsLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else-if="projects.length === 0" class="empty-state">
        <p>No projects found.</p>
      </div>
      <div v-else class="project-table-container">
        <table class="project-table">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Assessor</th>
              <th scope="col">State</th>
              <th scope="col">Started</th>
              <th scope="col">In progress</th>
              <th scope="col">Req. completed</th>
              <th scope="col">Closed / due</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in projects"
              :key="p.id + '-row'"
              class="project-row"
              @click="router.push(`/projects/${p.id}`)"
            >
              <td class="name-cell">
                <RouterLink :to="`/projects/${p.id}`" class="assessment-link">{{ p.name }}</RouterLink>
              </td>
              <td>{{ p.assessor ?? '—' }}</td>
              <td>
                <span class="state-badge" :class="`state-badge--${p.state}`">{{ formatProjectState(p.state) }}</span>
              </td>
              <td class="date-cell">{{ formatDate(p.startDate) || '—' }}</td>
              <td class="count-cell">
                <span v-if="p.inProgressAssessments > 0" class="inprog-pill">{{ p.inProgressAssessments }}</span>
                <span v-else class="muted">0</span>
              </td>
              <td>
                <div class="req-bar-wrap">
                  <el-progress :percentage="p.completionRate" :stroke-width="5" :show-text="false" :status="getProgressStatus(p.completionRate)" />
                  <span class="req-label">{{ p.requirementsCompleted }} req.</span>
                </div>
              </td>
              <td class="date-cell">{{ formatDate(p.closedAt ?? p.dueDate) || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================================================================
         Quarterly Assessment Schedule
    ================================================================ -->
    <div class="section-container">
      <h2 class="section-title">Assessment schedule — {{ currentYear }}</h2>

      <div v-if="scheduleLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else class="quarters-grid">
        <div
          v-for="(qData, qKey) in quarterlySchedule"
          :key="qKey"
          class="quarter-col"
        >
          <div class="quarter-header">
            <span class="quarter-label">{{ qData.label }}</span>
            <span v-if="qData.assessments.length" class="quarter-count">{{ qData.assessments.length }}</span>
          </div>
          <div v-if="qData.assessments.length === 0" class="quarter-empty">No assessments scheduled</div>
          <div
            v-for="a in qData.assessments"
            :key="a.id"
            class="sched-card"
            @click="$router.push(`/assessments/${a.id}`)"
          >
            <div class="sched-title">{{ a.title }}</div>
            <div class="sched-meta">
              <span v-if="a.projectName" class="sched-project">{{ a.projectName }}</span>
              <span class="state-badge sched-state" :class="`state-badge--${a.state}`">{{ formatState(a.state) }}</span>
            </div>
            <div v-if="a.dueDate" class="sched-date">Due {{ formatDate(a.dueDate) }}</div>
          </div>
        </div>
      </div>

      <div v-if="unscheduled.length > 0" class="unscheduled-section">
        <div class="unscheduled-label">Active — no due date set ({{ unscheduled.length }})</div>
        <div class="unscheduled-list">
          <div
            v-for="a in unscheduled"
            :key="a.id"
            class="sched-card sched-card--inline"
            @click="$router.push(`/assessments/${a.id}`)"
          >
            <span class="sched-title">{{ a.title }}</span>
            <span v-if="a.projectName" class="sched-project">{{ a.projectName }}</span>
            <span class="state-badge" :class="`state-badge--${a.state}`">{{ formatState(a.state) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================
         Deadlines (triage by urgency)
    ================================================================ -->
    <div class="section-container">
      <h2 class="section-title">Deadlines</h2>
      <div v-if="dueDatesLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else-if="upcomingDueDates.length === 0" class="due-empty">
        No open assessments have a due date set.
      </div>
      <template v-else>
        <!-- Summary strip: count per urgency bucket -->
        <div class="deadline-summary">
          <div
            v-for="b in deadlineBuckets"
            :key="b.key"
            class="deadline-summary-tile"
            :class="{ 'is-empty': b.items.length === 0 }"
          >
            <span class="deadline-summary-count" :style="{ color: b.items.length ? b.accent : 'var(--cat-text-tertiary)' }">
              {{ b.items.length }}
            </span>
            <span class="deadline-summary-label">{{ b.label }}</span>
          </div>
        </div>

        <!-- Grouped lists, worst-first -->
        <div v-for="b in populatedBuckets" :key="b.key" class="deadline-group">
          <div class="deadline-group-head">
            <span class="deadline-group-dot" :style="{ background: b.accent }"></span>
            <span class="deadline-group-title">{{ b.label }}</span>
            <span class="deadline-group-count">{{ b.items.length }}</span>
          </div>
          <div class="due-list">
            <div
              v-for="item in b.items"
              :key="item.id"
              class="due-row"
              @click="$router.push(`/assessments/${item.id}`)"
            >
              <div class="due-info">
                <span class="due-title">{{ item.title }}</span>
                <span class="due-meta">
                  <span class="state-badge due-state-badge" :class="`state-badge--${item.state}`">{{ formatState(item.state) }}</span>
                  {{ item.projectName }} · {{ formatDate(item.dueDate) }}
                </span>
              </div>
              <span class="due-badge" :style="{ color: b.accent, borderColor: b.accent }">
                {{ daysBadgeText(item) }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import client from '@/api/client'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Loading, FolderOpened, DocumentChecked, CircleCheck, Odometer } from '@element-plus/icons-vue'
import { RouterLink } from 'vue-router'
import StatCard from '@/components/shared/StatCard.vue'

const { t } = useI18n()
const router = useRouter()

// ============================================================================
// State
// ============================================================================

interface ProjectRow {
  id: string; name: string; state: string; assessor: string | null
  startDate: string | null; dueDate: string | null; closedAt: string | null
  inProgressAssessments: number; requirementsCompleted: number
  completionRate: number
}
const projectsLoading = ref(false)
const projects = ref<ProjectRow[]>([])

const selectedEntityId = ref<string>('')
const error = ref('')
const loading = ref(false)
const scheduleLoading = ref(false)
const currentYear = new Date().getFullYear()

const entities = ref<Array<{ id: string; name: string }>>([])
const summaryStats = ref({ totalEntitiesAssessed: 0, averageConformance: 0, activeAssessments: 0, completedThisQuarter: 0 })

interface ScheduledAssessment {
  id: string
  title: string
  state: string
  dueDate: string | null
  startDate: string | null
  projectName: string | null
  standardName: string | null
  conformanceScore: number | null
}

interface QuarterData {
  label: string
  assessments: ScheduledAssessment[]
}

const quarterlySchedule = ref<Record<string, QuarterData>>({
  Q1: { label: 'Q1 — Jan–Mar', assessments: [] },
  Q2: { label: 'Q2 — Apr–Jun', assessments: [] },
  Q3: { label: 'Q3 — Jul–Sep', assessments: [] },
  Q4: { label: 'Q4 — Oct–Dec', assessments: [] },
})
const unscheduled = ref<ScheduledAssessment[]>([])

interface DueDateItem {
  id: string
  title: string
  projectName: string | null
  dueDate: string
  daysLeft: number
  overdue: boolean
  state: string
}

const dueDatesLoading = ref(false)
const upcomingDueDates = ref<DueDateItem[]>([])

// Deadline triage buckets. Items arrive sorted ascending by due date
// (most overdue first) from the backend, so each bucket stays ordered
// by simply filtering.
interface DeadlineBucket {
  key: 'overdue' | 'week' | 'month' | 'later'
  label: string
  accent: string
  items: DueDateItem[]
}

const deadlineBuckets = computed<DeadlineBucket[]>(() => {
  const buckets: DeadlineBucket[] = [
    { key: 'overdue', label: 'Overdue',        accent: '#f85149', items: [] },
    { key: 'week',    label: 'Due this week',  accent: '#d29922', items: [] },
    { key: 'month',   label: 'Due this month', accent: '#2f81f7', items: [] },
    { key: 'later',   label: 'Later',          accent: '#39d353', items: [] },
  ]
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b])) as Record<DeadlineBucket['key'], DeadlineBucket>
  for (const item of upcomingDueDates.value) {
    if (item.overdue) byKey.overdue.items.push(item)
    else if (item.daysLeft <= 7) byKey.week.items.push(item)
    else if (item.daysLeft <= 30) byKey.month.items.push(item)
    else byKey.later.items.push(item)
  }
  return buckets
})

// Buckets that actually have items, for rendering the grouped lists.
const populatedBuckets = computed(() => deadlineBuckets.value.filter(b => b.items.length > 0))

function daysBadgeText(item: DueDateItem): string {
  if (item.overdue) return `${Math.abs(item.daysLeft)}d over`
  if (item.daysLeft === 0) return 'Due today'
  return `${item.daysLeft}d left`
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  loadProgressData()
  loadProjects()
  loadQuarterlySchedule()
  loadUpcomingDueDates()
})

// ============================================================================
// Data loading
// ============================================================================

async function loadProgressData() {
  loading.value = true
  error.value = ''
  try {
    const params: Record<string, string> = {}
    if (selectedEntityId.value) params.entityId = selectedEntityId.value
    const { data } = await client.get('/dashboard/progress', { params })
    entities.value = data.entities || []
    summaryStats.value = data.summaryStats || { totalEntitiesAssessed: 0, averageConformance: 0, activeAssessments: 0, completedThisQuarter: 0 }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || e.message || 'Failed to load progress data'
  } finally {
    loading.value = false
  }
}

async function loadQuarterlySchedule() {
  scheduleLoading.value = true
  try {
    const { data } = await client.get('/dashboard/quarterly-schedule')
    if (data.quarters) {
      const mapAssessments = (list: Record<string, unknown>[]) =>
        list.map(a => ({
          id: String(a.id),
          title: String(a.title),
          state: String(a.state),
          dueDate: (a.due_date as string) ?? null,
          startDate: (a.start_date as string) ?? null,
          projectName: (a.project_name as string) ?? null,
          standardName: (a.standard_name as string) ?? null,
          conformanceScore: a.conformance_score != null ? Number(a.conformance_score) : null,
        }))
      quarterlySchedule.value = {
        Q1: { label: data.quarters.Q1.label, assessments: mapAssessments(data.quarters.Q1.assessments) },
        Q2: { label: data.quarters.Q2.label, assessments: mapAssessments(data.quarters.Q2.assessments) },
        Q3: { label: data.quarters.Q3.label, assessments: mapAssessments(data.quarters.Q3.assessments) },
        Q4: { label: data.quarters.Q4.label, assessments: mapAssessments(data.quarters.Q4.assessments) },
      }
      unscheduled.value = mapAssessments(data.unscheduled || [])
    }
  } catch (err) {
    console.error('Failed to load quarterly schedule:', err)
  } finally {
    scheduleLoading.value = false
  }
}

async function loadProjects() {
  projectsLoading.value = true
  try {
    const { data } = await client.get('/dashboard/project-health')
    projects.value = (data.data || []).map((p: Record<string, unknown>) => ({
      id: String(p.id), name: String(p.name), state: String(p.state),
      assessor: (p.assessor as string) ?? null,
      startDate: (p.startDate as string) ?? null,
      dueDate: (p.dueDate as string) ?? null,
      closedAt: (p.closedAt as string) ?? null,
      inProgressAssessments: Number(p.inProgressAssessments ?? 0),
      requirementsCompleted: Number(p.requirementsCompleted ?? 0),
      completionRate: Number(p.completionRate ?? 0),
    }))
  } catch (err) {
    console.error('Failed to load projects:', err)
  } finally {
    projectsLoading.value = false
  }
}

async function loadUpcomingDueDates() {
  dueDatesLoading.value = true
  try {
    // Response is camelCased by the API layer and keyed under `data`.
    // daysUntilDue / overdue are computed server-side on calendar-day
    // boundaries, so we trust them rather than recomputing client-side.
    const { data } = await client.get('/dashboard/upcoming-due-dates')
    upcomingDueDates.value = (data.data || []).map((d: Record<string, unknown>) => ({
      id: String(d.id),
      title: String(d.title),
      projectName: (d.projectName as string) ?? null,
      dueDate: d.dueDate as string,
      daysLeft: Number(d.daysUntilDue ?? 0),
      overdue: Boolean(d.overdue),
      state: String(d.state ?? ''),
    }))
  } catch (err) {
    console.error('Failed to load upcoming due dates:', err)
  } finally {
    dueDatesLoading.value = false
  }
}

async function onEntityChange() {
  error.value = ''
  await loadProgressData()
}

// ============================================================================
// Utilities
// ============================================================================

function formatProjectState(s: string): string {
  const m: Record<string, string> = { new: 'New', in_progress: 'In progress', on_hold: 'On hold', complete: 'Complete', operational: 'Operational', retired: 'Retired' }
  return m[s] || s
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#39d353'
  if (score >= 60) return '#d29922'
  return '#f85149'
}

function getConformanceColor(score: number): string {
  return getScoreColor(score)
}

function getProgressStatus(score: number): string {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'exception'
}

function formatState(state: string): string {
  const map: Record<string, string> = {
    new: 'New', pending: 'Pending', in_progress: 'In progress',
    on_hold: 'On hold', complete: 'Complete', cancelled: 'Cancelled',
  }
  return map[state] || state
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.progress-content {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

// ============================================================================
// Entity Selector
// ============================================================================

.entity-selector-container {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-4);
  background-color: var(--cat-bg-surface);
  padding: var(--cat-spacing-4);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);

  .selector-label {
    font-size: var(--cat-font-size-base);
    font-weight: var(--cat-font-weight-medium);
    color: var(--cat-text-primary);
    flex-shrink: 0;
    min-width: 120px;
  }

  :deep(.el-select) {
    flex: 1;
    max-width: 400px;
  }
}

// ============================================================================
// Summary Stats
// ============================================================================

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--cat-spacing-4);
}

// ============================================================================
// Sections
// ============================================================================

.section-container {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.section-title {
  font-size: var(--cat-font-size-2xl);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
  margin: 0;
}

// ============================================================================
// Project Status Table
// ============================================================================

.project-table-container {
  overflow-x: auto;
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
}

.project-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--cat-font-size-sm);

  thead {
    background-color: var(--cat-bg-input);
    border-bottom: 1px solid var(--cat-border-default);

    th {
      padding: var(--cat-spacing-3) var(--cat-spacing-4);
      text-align: left;
      font-weight: var(--cat-font-weight-semibold);
      color: var(--cat-text-primary);
      white-space: nowrap;
    }
  }

  tbody tr {
    border-bottom: 1px solid var(--cat-border-default);
    cursor: pointer;
    transition: background-color var(--cat-transition-fast);

    &:last-child { border-bottom: none; }
    &:hover { background-color: var(--cat-bg-hover); }
  }

  td {
    padding: var(--cat-spacing-3) var(--cat-spacing-4);
    color: var(--cat-text-secondary);
    vertical-align: middle;
  }
}

.name-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assessor-cell { white-space: nowrap; }
.date-cell { white-space: nowrap; font-size: var(--cat-font-size-xs); }
.count-cell { text-align: center; }

.inprog-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 600;
  background-color: rgba(47, 129, 247, 0.15);
  color: #2f81f7;
}

.muted { color: var(--cat-text-tertiary); }

.req-bar-wrap {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  min-width: 140px;

  :deep(.el-progress) { flex: 1; }

  .req-label {
    font-size: 11px;
    color: var(--cat-text-secondary);
    white-space: nowrap;
    min-width: 44px;
  }
}

// ============================================================================
// Quarterly Schedule
// ============================================================================

.quarters-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--cat-spacing-4);
}

.quarter-col {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
}

.quarter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  background-color: var(--cat-bg-input);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
}

.quarter-label {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.quarter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background-color: var(--cat-bg-input);
  border: 1px solid var(--cat-border-default);
  color: var(--cat-text-secondary);
}

.quarter-empty {
  padding: var(--cat-spacing-4);
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-xs);
  border: 1px dashed var(--cat-border-default);
  border-radius: var(--cat-radius-md);
}

.sched-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--cat-spacing-3);
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  cursor: pointer;
  transition: border-color var(--cat-transition-fast), background-color var(--cat-transition-fast);

  &:hover {
    border-color: var(--cat-border-focus);
    background-color: var(--cat-bg-hover);
  }
}

.sched-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
  line-height: 1.3;
}

.sched-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.sched-project {
  font-size: 11px;
  color: var(--cat-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sched-state {
  flex-shrink: 0;
}

.sched-date {
  font-size: 11px;
  color: var(--cat-text-tertiary);
}

// Unscheduled inline strip
.unscheduled-section {
  margin-top: var(--cat-spacing-2);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
}

.unscheduled-label {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
  font-weight: var(--cat-font-weight-medium);
}

.unscheduled-list {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
}

.sched-card--inline {
  flex-direction: row;
  align-items: center;
  gap: var(--cat-spacing-3);

  .sched-title { flex: 1; }
  .sched-project { flex: none; min-width: 0; max-width: 160px; }
}

// ============================================================================
// Shared: State Badge
// ============================================================================

.state-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  line-height: 1.6;
  white-space: nowrap;

  &--complete, &--operational   { background-color: rgba(57, 211, 83, 0.15); color: #39d353; }
  &--in_progress                { background-color: rgba(47, 129, 247, 0.15); color: #2f81f7; }
  &--pending, &--new            { background-color: rgba(210, 153, 34, 0.15); color: #d29922; }
  &--on_hold                    { background-color: rgba(139, 148, 158, 0.15); color: #8b949e; }
  &--cancelled, &--retired      { background-color: rgba(248, 81, 73, 0.15); color: #f85149; }
}

// ============================================================================
// Deadlines
// ============================================================================

.deadline-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--cat-spacing-3);
}

.deadline-summary-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);

  &.is-empty { opacity: 0.55; }
}

.deadline-summary-count {
  font-size: 26px;
  font-weight: var(--cat-font-weight-semibold);
  line-height: 1.1;
}

.deadline-summary-label {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

.deadline-group {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
  margin-top: var(--cat-spacing-4);
}

.deadline-group-head {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
}

.deadline-group-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.deadline-group-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.deadline-group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: var(--cat-bg-input);
  border: 1px solid var(--cat-border-default);
  color: var(--cat-text-secondary);
}

.due-state-badge {
  margin-right: var(--cat-spacing-1);
}

.due-list {
  display: flex;
  flex-direction: column;
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.due-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  border-top: 1px solid var(--cat-border-default);
  cursor: pointer;
  transition: background-color var(--cat-transition-fast);

  &:first-child { border-top: none; }
  &:hover { background-color: var(--cat-bg-hover); }
}

.due-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.due-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.due-meta {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

.due-badge {
  flex-shrink: 0;
  margin-left: var(--cat-spacing-4);
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 10px;
  font-size: 11px;
  font-weight: var(--cat-font-weight-semibold);
}

.due-empty {
  padding: var(--cat-spacing-6);
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-sm);
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
}

// ============================================================================
// Assessment Link
// ============================================================================

.assessment-link {
  color: var(--cat-accent-primary);
  text-decoration: none;
  transition: color var(--cat-transition-fast);

  &:hover { color: var(--cat-blue-300); text-decoration: underline; }
  &:active { color: var(--cat-blue-400); }
}

// ============================================================================
// Empty / Loading states
// ============================================================================

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--cat-spacing-4);
  padding: var(--cat-spacing-12);
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  text-align: center;

  p { margin: 0; color: var(--cat-text-secondary); font-size: var(--cat-font-size-base); }
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-12);
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);

  .is-loading { color: var(--cat-accent-primary); animation: spin 1s linear infinite; }
  p { margin: 0; color: var(--cat-text-secondary); }
}

.card-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-8);

  .is-loading { color: var(--cat-accent-primary); animation: spin 1s linear infinite; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// ============================================================================
// Responsive
// ============================================================================

@media (max-width: 900px) {
  .quarters-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .entity-selector-container {
    flex-direction: column;
    align-items: flex-start;

    .selector-label { min-width: unset; }
    :deep(.el-select) { max-width: 100%; width: 100%; }
  }

  .summary-grid { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--cat-spacing-3); }
  .quarters-grid { grid-template-columns: 1fr; }
}
</style>
