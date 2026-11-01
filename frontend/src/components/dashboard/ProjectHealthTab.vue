<template>
  <div class="ph-content">
    <el-alert v-if="error" type="error" :closable="true" @close="error = ''">{{ error }}</el-alert>

    <p class="tab-intro">Which projects need attention, and why — sorted by risk.</p>

    <!-- ================================================================
         Health Summary
    ================================================================ -->
    <div v-if="!projectsLoading && projects.length > 0" class="health-summary">
      <button
        v-for="level in HEALTH_LEVELS"
        :key="level.id"
        class="health-summary-tile"
        :class="{ active: healthFilter === level.id }"
        @click="healthFilter = healthFilter === level.id ? 'all' : level.id"
      >
        <span class="health-summary-val" :style="{ color: level.color }">{{ healthCounts[level.id] }}</span>
        <span class="health-summary-lbl">{{ level.label }}</span>
      </button>
    </div>

    <!-- ================================================================
         Project Health Cards
    ================================================================ -->
    <div class="section-container">
      <div class="section-header">
        <h2 class="section-title">Project health</h2>
        <RouterLink to="/projects" class="view-all-link">View all projects</RouterLink>
      </div>

      <div v-if="projectsLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else-if="projects.length === 0" class="empty-state">
        <el-icon :size="48" color="var(--cat-text-tertiary)"><Document /></el-icon>
        <p>No projects yet. Create a project to start tracking assessments.</p>
      </div>
      <div v-else-if="visibleProjects.length === 0" class="empty-state">
        <p>No projects in this health category.</p>
      </div>
      <div v-else class="health-cards-grid">
        <RouterLink
          v-for="p in visibleProjects"
          :key="p.id"
          :to="`/projects/${p.id}`"
          class="health-card"
        >
          <div class="health-card-header">
            <span class="health-card-name">{{ p.name }}</span>
            <span class="health-card-rate" :style="{ color: getProgressColor(p.completionRate) }">{{ p.completionRate }}%</span>
          </div>
          <el-progress :percentage="p.completionRate" :stroke-width="5" :status="getProgressStatus(p.completionRate)" :show-text="false" />
          <div class="health-card-status">
            <span class="health-pill" :class="`health-pill--${p.health.level}`">{{ healthLabel(p.health.level) }}</span>
            <span class="health-reason">{{ p.health.reason }}</span>
          </div>
          <div class="health-card-meta">
            <span>{{ p.completedAssessments }}/{{ p.totalAssessments }} assessments</span>
            <span v-if="p.overdueAssessments > 0" class="overdue-badge">{{ p.overdueAssessments }} overdue</span>
            <span>{{ p.attestationCount }} attestations</span>
          </div>
        </RouterLink>
      </div>
    </div>

    <!-- ================================================================
         Project Details
    ================================================================ -->
    <div v-if="!projectsLoading && projects.length > 0" class="section-container">
      <h2 class="section-title">Project details</h2>

      <div class="project-table-container">
        <table class="project-table">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">State</th>
              <th scope="col">Assessor</th>
              <th scope="col">Due date</th>
              <th scope="col">Progress</th>
              <th scope="col">In progress</th>
              <th scope="col">Overdue</th>
              <th scope="col">Attestations</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in sortedProjects"
              :key="p.id"
              @click="$router.push(`/projects/${p.id}`)"
            >
              <td class="name-cell">{{ p.name }}</td>
              <td>
                <span class="state-badge" :class="`state-badge--${p.state}`">{{ formatProjectState(p.state) }}</span>
              </td>
              <td class="meta-col">{{ p.assessor ?? '—' }}</td>
              <td class="date-cell">{{ formatDate(p.dueDate) || '—' }}</td>
              <td>
                <div class="req-bar-wrap">
                  <el-progress :percentage="p.completionRate" :stroke-width="5" :status="getProgressStatus(p.completionRate)" :show-text="false" />
                  <span class="req-label">{{ p.completedAssessments }}/{{ p.totalAssessments }}</span>
                </div>
              </td>
              <td class="count-cell">
                <span v-if="p.inProgressAssessments > 0" class="inprog-pill">{{ p.inProgressAssessments }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="count-cell">
                <span v-if="p.overdueAssessments > 0" class="overdue-badge">{{ p.overdueAssessments }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="count-cell">{{ p.attestationCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ================================================================
         Standards Coverage
    ================================================================ -->
    <div class="section-container">
      <h2 class="section-title">Standards coverage</h2>

      <div v-if="coverageLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else-if="complianceCoverage.length === 0" class="empty-state">
        <el-icon :size="48" color="var(--cat-text-tertiary)"><Document /></el-icon>
        <p>No standards with active assessments. Import standards and create assessments to track coverage.</p>
      </div>
      <div v-else class="coverage-grid">
        <div v-for="item in complianceCoverage" :key="item.standardId" class="coverage-card">
          <div class="coverage-card-header">
            <span class="coverage-name">{{ item.standardName }}</span>
            <span class="coverage-pct" :style="{ color: getProgressColor(item.coveragePercent) }">{{ item.coveragePercent }}%</span>
          </div>
          <el-progress :percentage="item.coveragePercent" :stroke-width="8" :status="getProgressStatus(item.coveragePercent)" :show-text="false" />
          <div class="coverage-detail">{{ item.assessedRequirements }} of {{ item.totalRequirements }} requirements assessed</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Loading, Document } from '@element-plus/icons-vue'
import client from '@/api/client'

const error = ref('')

// ── Project health ────────────────────────────────────────────────
const projectsLoading = ref(false)

interface ProjectRow {
  id: string; name: string; state: string; assessor: string | null
  startDate: string | null; dueDate: string | null; closedAt: string | null
  inProgressAssessments: number
  completionRate: number; completedAssessments: number
  totalAssessments: number; overdueAssessments: number; attestationCount: number
}
const projects = ref<ProjectRow[]>([])

// ── Health synthesis ──────────────────────────────────────────────
// A project's health is derived client-side from the signals the
// project-health endpoint already returns; the thresholds here define
// the tab's editorial line: overdue work and blown due dates are
// critical, everything that predicts them is at-risk.
type HealthLevel = 'critical' | 'at_risk' | 'on_track'
interface HealthInfo { level: HealthLevel; reason: string }

const HEALTH_LEVELS = [
  { id: 'critical' as const, label: 'Critical', color: '#f85149' },
  { id: 'at_risk' as const,  label: 'At risk',  color: '#d29922' },
  { id: 'on_track' as const, label: 'On track', color: '#39d353' },
]

const healthFilter = ref<HealthLevel | 'all'>('all')

function assessHealth(p: ProjectRow): HealthInfo {
  if (p.state === 'complete' || p.state === 'operational') {
    return { level: 'on_track', reason: 'Closed out' }
  }

  const due = p.dueDate ? new Date(p.dueDate).getTime() : null
  const daysLeft = due !== null ? Math.ceil((due - Date.now()) / 86_400_000) : null

  if (daysLeft !== null && daysLeft < 0 && p.completionRate < 100) {
    return { level: 'critical', reason: `Past due date at ${p.completionRate}% complete` }
  }
  if (p.overdueAssessments >= 2) {
    return { level: 'critical', reason: `${p.overdueAssessments} overdue assessments` }
  }
  if (p.overdueAssessments === 1) {
    return { level: 'at_risk', reason: '1 overdue assessment' }
  }
  if (daysLeft !== null && daysLeft <= 14 && p.completionRate < 70) {
    return { level: 'at_risk', reason: `Due in ${daysLeft}d at ${p.completionRate}% complete` }
  }
  if (p.state === 'in_progress' && p.totalAssessments > 0 && p.inProgressAssessments === 0 && p.completionRate < 100) {
    return { level: 'at_risk', reason: 'No assessments in progress' }
  }
  if (p.totalAssessments === 0) {
    return { level: 'on_track', reason: 'No assessments yet' }
  }
  return { level: 'on_track', reason: `${p.inProgressAssessments} in progress` }
}

const HEALTH_ORDER: Record<HealthLevel, number> = { critical: 0, at_risk: 1, on_track: 2 }

const assessedProjects = computed(() =>
  projects.value.map(p => ({ ...p, health: assessHealth(p) }))
)

const sortedProjects = computed(() =>
  [...assessedProjects.value].sort((a, b) =>
    HEALTH_ORDER[a.health.level] - HEALTH_ORDER[b.health.level]
    || b.overdueAssessments - a.overdueAssessments
    || a.completionRate - b.completionRate
  )
)

const visibleProjects = computed(() =>
  healthFilter.value === 'all'
    ? sortedProjects.value
    : sortedProjects.value.filter(p => p.health.level === healthFilter.value)
)

const healthCounts = computed<Record<HealthLevel, number>>(() => {
  const counts: Record<HealthLevel, number> = { critical: 0, at_risk: 0, on_track: 0 }
  for (const p of assessedProjects.value) counts[p.health.level]++
  return counts
})

function healthLabel(level: HealthLevel) {
  return HEALTH_LEVELS.find(l => l.id === level)?.label ?? level
}

// ── Compliance coverage ───────────────────────────────────────────
const coverageLoading = ref(false)
interface CoverageItem { standardId: string; standardName: string; coveragePercent: number; assessedRequirements: number; totalRequirements: number }
const complianceCoverage = ref<CoverageItem[]>([])

// ── Lifecycle ─────────────────────────────────────────────────────
onMounted(() => {
  Promise.all([loadProjects(), loadCoverage()])
})

// ── Data loading ──────────────────────────────────────────────────
async function loadProjects() {
  projectsLoading.value = true
  try {
    const { data } = await client.get('/dashboard/project-health')
    projects.value = (data.data || []).map((p: Record<string, unknown>) => ({
      id: p.id, name: p.name, state: p.state,
      assessor: p.assessor ?? null,
      startDate: p.startDate ?? null, dueDate: p.dueDate ?? null, closedAt: p.closedAt ?? null,
      inProgressAssessments: Number(p.inProgressAssessments ?? 0),
      completionRate: Number(p.completionRate ?? 0),
      completedAssessments: Number(p.completedAssessments ?? 0),
      totalAssessments: Number(p.totalAssessments ?? 0),
      overdueAssessments: Number(p.overdueAssessments ?? 0),
      attestationCount: Number(p.attestationCount ?? 0),
    }))
  } catch (e) {
    error.value = 'Failed to load project health data.'
    console.error(e)
  } finally {
    projectsLoading.value = false
  }
}

async function loadCoverage() {
  coverageLoading.value = true
  try {
    const { data } = await client.get('/dashboard/compliance-coverage')
    complianceCoverage.value = data.data || []
  } catch (e) {
    console.error('Failed to load compliance coverage:', e)
  } finally {
    coverageLoading.value = false
  }
}

// ── Utilities ─────────────────────────────────────────────────────
function getProgressColor(pct: number) {
  if (pct >= 80) return 'var(--cat-chart-green)'
  if (pct >= 50) return 'var(--cat-chart-amber)'
  return 'var(--cat-chart-red)'
}
function getProgressStatus(pct: number) {
  if (pct >= 80) return 'success'
  if (pct >= 50) return 'warning'
  return 'exception'
}
function formatDate(d: string | Date | null | undefined) {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
function formatProjectState(s: string) {
  const m: Record<string, string> = { new: 'New', in_progress: 'In progress', on_hold: 'On hold', complete: 'Complete', operational: 'Operational', retired: 'Retired' }
  return m[s] || s
}
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.ph-content {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

.tab-intro {
  margin: 0;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-tertiary);
}

.section-container {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font-size: var(--cat-font-size-2xl);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.view-all-link {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-accent-primary);
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

// ── Health summary ────────────────────────────────────────────
.health-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--cat-spacing-3);
}

.health-summary-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  cursor: pointer;
  transition: border-color var(--cat-transition-fast), background-color var(--cat-transition-fast);

  &:hover { background: var(--cat-bg-hover); }
  &.active { border-color: var(--cat-border-focus); background: var(--cat-bg-hover); }
}

.health-summary-val {
  font-size: 26px;
  font-weight: var(--cat-font-weight-semibold);
  line-height: 1.1;
}

.health-summary-lbl {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

// ── Health cards ─────────────────────────────────────────────
.health-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--cat-spacing-4);
}

.health-card {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
  padding: var(--cat-spacing-4);
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  text-decoration: none;
  color: inherit;
  transition: border-color var(--cat-transition-fast), background-color var(--cat-transition-fast);
  &:hover { border-color: var(--cat-border-focus); background: var(--cat-bg-hover); }
}

.health-card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.health-card-name {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.health-card-rate {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
}

.health-card-status {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
}

.health-pill {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: var(--cat-font-weight-semibold);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;

  &--critical { background: rgba(248,81,73,0.15); color: #f85149; }
  &--at_risk  { background: rgba(210,153,34,0.15); color: #d29922; }
  &--on_track { background: rgba(57,211,83,0.15); color: #39d353; }
}

.health-reason {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-card-meta {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  flex-wrap: wrap;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.overdue-badge {
  color: #f85149;
  font-weight: var(--cat-font-weight-medium);
}

// ── Project details table ─────────────────────────────────────
.project-table-container {
  overflow-x: auto;
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
}

.project-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--cat-font-size-sm);

  thead {
    background: var(--cat-bg-input);
    border-bottom: 1px solid var(--cat-border-default);
    th { padding: var(--cat-spacing-3) var(--cat-spacing-4); text-align: left; font-weight: var(--cat-font-weight-semibold); color: var(--cat-text-primary); white-space: nowrap; }
  }

  tbody tr {
    border-bottom: 1px solid var(--cat-border-default);
    cursor: pointer;
    transition: background-color var(--cat-transition-fast);
    &:last-child { border-bottom: none; }
    &:hover { background: var(--cat-bg-hover); }
  }

  td { padding: var(--cat-spacing-3) var(--cat-spacing-4); color: var(--cat-text-secondary); vertical-align: middle; }
}

.name-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cat-text-primary); font-weight: var(--cat-font-weight-medium); }
.meta-col { font-size: var(--cat-font-size-xs); }
.date-cell { white-space: nowrap; font-size: var(--cat-font-size-xs); }
.count-cell { text-align: center; }

.inprog-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
  font-size: 11px; font-weight: 600;
  background: rgba(47,129,247,0.15); color: #2f81f7;
}

.muted { color: var(--cat-text-tertiary); }

.req-bar-wrap {
  display: flex; align-items: center; gap: var(--cat-spacing-2); min-width: 140px;
  :deep(.el-progress) { flex: 1; }
  .req-label { font-size: 11px; color: var(--cat-text-secondary); white-space: nowrap; min-width: 44px; }
}

// ── Compliance coverage ───────────────────────────────────────
.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--cat-spacing-4);
}

.coverage-card {
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  padding: var(--cat-spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-2);
}

.coverage-card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.coverage-name {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

.coverage-pct {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
}

.coverage-detail {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

// ── Shared: state badge ───────────────────────────────────────
.state-badge {
  display: inline-flex; align-items: center;
  padding: 2px 10px; border-radius: 4px;
  font-size: var(--cat-font-size-xs); font-weight: var(--cat-font-weight-medium);
  line-height: 1.6; white-space: nowrap;

  &--complete, &--operational { background: rgba(57,211,83,0.15); color: #39d353; }
  &--in_progress              { background: rgba(47,129,247,0.15); color: #2f81f7; }
  &--pending, &--new          { background: rgba(210,153,34,0.15); color: #d29922; }
  &--on_hold                  { background: rgba(139,148,158,0.15); color: #8b949e; }
  &--cancelled, &--retired    { background: rgba(248,81,73,0.15); color: #f85149; }
}

// ── Empty / loading states ────────────────────────────────────
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--cat-spacing-4); padding: var(--cat-spacing-12);
  background: var(--cat-bg-surface); border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg); text-align: center;
  p { margin: 0; color: var(--cat-text-secondary); font-size: var(--cat-font-size-base); }
}

.card-loading {
  display: flex; align-items: center; justify-content: center; padding: var(--cat-spacing-8);
  .is-loading { color: var(--cat-accent-primary); animation: spin 1s linear infinite; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
