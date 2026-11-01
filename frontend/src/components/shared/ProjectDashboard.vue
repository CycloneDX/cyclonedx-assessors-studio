<template>
  <div class="project-dashboard" role="region" aria-label="Project Dashboard">
    <div v-if="loading" class="dashboard-loading">
      <el-skeleton :rows="2" animated />
    </div>

    <template v-else-if="stats">
      <div v-if="view === 'overview'">
        <!-- Stat cards row -->
        <div class="dashboard-stats">
            <div class="stat-card" role="region" aria-label="Assessment completion">
              <div class="stat-header">
                <span class="stat-title">{{ t('projectDashboard.assessments') }}</span>
              </div>
              <div class="stat-body">
                <div class="stat-ring-container">
                  <svg viewBox="0 0 36 36" class="stat-ring">
                    <circle class="ring-bg" cx="18" cy="18" r="14" fill="none" stroke-width="3" />
                    <circle
                      class="ring-fill"
                      cx="18" cy="18" r="14" fill="none" stroke-width="3"
                      :stroke-dasharray="`${completionArc} ${88 - completionArc}`"
                      stroke-dashoffset="22"
                      stroke-linecap="round"
                      :style="{ stroke: completionColor }"
                    />
                    <text x="18" y="19.5" text-anchor="middle" class="ring-text">{{ stats.assessmentCompletion.percent }}%</text>
                  </svg>
                </div>
                <div class="stat-detail">
                  <div class="stat-value">{{ stats.assessmentCompletion.completed }}/{{ stats.assessmentCompletion.total }}</div>
                  <div class="stat-sub">{{ stats.assessmentCompletion.inProgress }} in progress</div>
                </div>
              </div>
            </div>

            <div class="stat-card" role="region" aria-label="Timeline status">
              <div class="stat-header">
                <span class="stat-title">{{ t('projectDashboard.timeline') }}</span>
                <el-tag v-if="timelineStatus === 'on_track'" type="success" size="small" effect="dark">{{ t('projectDashboard.project') }}</el-tag>
                <el-tag v-else-if="timelineStatus === 'at_risk'" type="warning" size="small" effect="dark">{{ t('common.warning') }}</el-tag>
                <el-tag v-else-if="timelineStatus === 'overdue'" type="danger" size="small" effect="dark">{{ t('projectDashboard.overdue') }}</el-tag>
                <el-tag v-else size="small" effect="dark">{{ t('common.notProvided') }}</el-tag>
              </div>
              <div class="stat-body">
                <div class="stat-detail w-full">
                  <div v-if="stats.timeline.overdue > 0" class="timeline-alert">
                    <el-icon class="text-danger"><WarningFilled /></el-icon>
                    <span>{{ stats.timeline.overdue }} {{ t('projectDashboard.overdue') }}</span>
                  </div>
                  <div v-if="stats.timeline.projectDueDate" class="timeline-next">
                    <span class="stat-sub">Project deadline:</span>
                    <span class="timeline-date">{{ formatDate(stats.timeline.projectDueDate) }}</span>
                  </div>
                  <div v-if="nextDueAssessment" class="timeline-next">
                    <span class="stat-sub">Next due:</span>
                    <span class="timeline-date">{{ formatDate(nextDueAssessment.dueDate) }}</span>
                  </div>
                  <div v-if="!stats.timeline.projectDueDate && !stats.timeline.latestDueDate && stats.timeline.overdue === 0" class="stat-sub">
                    No due dates set
                  </div>
                </div>
              </div>
            </div>

            <div class="stat-card" role="region" aria-label="Evidence coverage">
              <div class="stat-header">
                <span class="stat-title">Evidence Coverage</span>
              </div>
              <div class="stat-body">
                <div class="stat-detail w-full">
                  <div class="progress-row">
                    <div class="stat-value">{{ stats.evidenceCoverage.percent !== null ? stats.evidenceCoverage.percent + '%' : 'N/A' }}</div>
                    <span class="stat-sub">{{ stats.evidenceCoverage.requirementsWithEvidence }}/{{ stats.evidenceCoverage.totalRequirements }} requirements</span>
                  </div>
                  <el-progress
                    v-if="stats.evidenceCoverage.percent !== null"
                    :percentage="stats.evidenceCoverage.percent"
                    :stroke-width="6"
                    :show-text="false"
                    :status="evidenceCoverageStatus"
                    class="mt-3"
                  />
                  <div class="stat-sub mt-2">{{ stats.evidenceCoverage.totalEvidenceItems }} evidence items</div>
                </div>
              </div>
            </div>

            <div class="stat-card" role="region" aria-label="Conformance score">
              <div class="stat-header">
                <span class="stat-title">Avg. Conformance</span>
              </div>
              <div class="stat-body">
                <div class="stat-ring-container">
                  <svg viewBox="0 0 36 36" class="stat-ring">
                    <circle class="ring-bg" cx="18" cy="18" r="14" fill="none" stroke-width="3" />
                    <circle
                      class="ring-fill"
                      cx="18" cy="18" r="14" fill="none" stroke-width="3"
                      :stroke-dasharray="`${conformanceArc} ${88 - conformanceArc}`"
                      stroke-dashoffset="22"
                      stroke-linecap="round"
                      :style="{ stroke: conformanceColor }"
                    />
                    <text x="18" y="19.5" text-anchor="middle" class="ring-text">{{ stats.conformance.averageScore !== null ? Math.round(stats.conformance.averageScore) + '%' : 'N/A' }}</text>
                  </svg>
                </div>
                <div class="stat-detail">
                  <div class="stat-value" :style="{ color: conformanceColor }">
                    {{ stats.conformance.averageScore !== null ? Math.round(stats.conformance.averageScore) + '%' : 'N/A' }}
                  </div>
                  <div class="stat-sub">{{ stats.conformance.assessments.length }} scored assessment{{ stats.conformance.assessments.length !== 1 ? 's' : '' }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Warnings row -->
          <div v-if="stats.warnings.length > 0" class="dashboard-warnings">
            <div
              v-for="(w, i) in stats.warnings"
              :key="i"
              class="warning-item"
              :class="w.severity"
              @click="w.assessmentId && $emit('navigate-assessment', w.assessmentId)"
              :style="{ cursor: w.assessmentId ? 'pointer' : 'default' }"
            >
              <el-icon v-if="w.severity === 'critical'" class="warning-icon"><CircleCloseFilled /></el-icon>
              <el-icon v-else-if="w.severity === 'warning'" class="warning-icon"><WarningFilled /></el-icon>
              <el-icon v-else class="warning-icon"><InfoFilled /></el-icon>
              <span class="warning-text">{{ w.message }}</span>
            </div>
        </div>
      </div>

      <div v-else>
        <div v-if="ganttItems.length === 0" class="gantt-empty">
            {{ t('projectDashboard.noAssessmentsWithDates') }}
          </div>
          <div v-else class="gantt-chart">
            <!-- Header with month labels -->
            <div class="gantt-header">
              <div class="gantt-label-col"></div>
              <div class="gantt-bar-col">
                <div class="gantt-months">
                  <div
                    v-for="m in ganttMonths"
                    :key="m.key"
                    class="gantt-month"
                    :style="{ left: m.leftPercent + '%', width: m.widthPercent + '%' }"
                  >{{ m.label }}</div>
                </div>
                <!-- Today marker -->
                <div
                  v-if="todayPercent !== null"
                  class="gantt-today-marker"
                  :style="{ left: todayPercent + '%' }"
                >
                  <div class="gantt-today-line"></div>
                  <span class="gantt-today-label">{{ t('projectDashboard.today') }}</span>
                </div>
              </div>
            </div>

            <!-- Project bar (if project has dates) -->
            <div v-if="projectGanttBar" class="gantt-row gantt-row-project">
              <div class="gantt-label-col">
                <span class="gantt-item-label gantt-project-label">{{ t('projectDashboard.project') }}</span>
              </div>
              <div class="gantt-bar-col">
                <div
                  class="gantt-bar gantt-bar-project"
                  :style="{ left: projectGanttBar.leftPercent + '%', width: projectGanttBar.widthPercent + '%' }"
                >
                  <span class="gantt-bar-text">{{ formatDateShort(projectGanttBar.start) }} &ndash; {{ formatDateShort(projectGanttBar.end) }}</span>
                </div>
              </div>
            </div>

            <!-- Assessment bars -->
            <div v-for="item in ganttItems" :key="item.id" class="gantt-row cursor-pointer" @click="$emit('navigate-assessment', item.id)">
              <div class="gantt-label-col">
                <span class="gantt-item-label" :title="item.title">{{ item.title }}</span>
              </div>
              <div class="gantt-bar-col">
                <div
                  class="gantt-bar"
                  :class="'gantt-bar-' + item.state"
                  :style="{ left: item.leftPercent + '%', width: item.widthPercent + '%' }"
                >
                  <span class="gantt-bar-text">{{ formatDateShort(item.start) }} &ndash; {{ formatDateShort(item.end) }}</span>
                </div>
              </div>
            </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { WarningFilled, CircleCloseFilled, InfoFilled } from '@element-plus/icons-vue'
import client from '@/api/client'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  projectId: string
  view?: 'overview' | 'timeline'
}>(), {
  view: 'overview',
})

defineEmits<{
  'navigate-assessment': [assessmentId: string]
}>()

const loading = ref(true)
const stats = ref<{
  assessmentCompletion: { total: number; completed: number; inProgress: number; percent: number };
  timeline: { projectStartDate: string | null; projectDueDate: string | null; overdue: number; upcomingDueDates: Array<{ id: string; title: string; dueDate: string; state: string }>; earliestDueDate: Date | null; latestDueDate: Date | null };
  evidenceCoverage: { totalRequirements: number; requirementsWithEvidence: number; totalEvidenceItems: number; percent: number | null };
  conformance: { averageScore: number | null; assessments: Array<{ id: string; title: string; score: number; state: string }> };
  warnings: Array<{ type: string; severity: 'critical' | 'warning' | 'info'; message: string; assessmentId?: string }>;
  assessmentBreakdown?: Array<{ id: string; title: string; state: string; startDate: string | null; dueDate: string | null; conformanceScore: number | null }>;
} | null>(null)

const fetchStats = async () => {
  loading.value = true
  try {
    const { data } = await client.get(`/projects/${props.projectId}/stats`)
    stats.value = data
  } catch (err) {
    console.error('Failed to fetch project stats:', err)
    stats.value = null
  } finally {
    loading.value = false
  }
}

onMounted(fetchStats)

watch(() => props.projectId, fetchStats)

const completionArc = computed(() => {
  if (!stats.value) return 0
  return (stats.value.assessmentCompletion.percent / 100) * 88
})

const conformanceArc = computed(() => {
  if (!stats.value || stats.value.conformance.averageScore === null) return 0
  return (stats.value.conformance.averageScore / 100) * 88
})

const completionColor = computed(() => {
  if (!stats.value) return 'var(--cat-text-tertiary)'
  const pct = stats.value.assessmentCompletion.percent
  if (pct === 100) return 'var(--cat-success)'
  if (pct >= 50) return 'var(--cat-accent-primary)'
  return 'var(--cat-warning)'
})

const timelineStatus = computed(() => {
  if (!stats.value) return 'none'
  if (stats.value.timeline.overdue > 0) return 'overdue'
  // Use project due date as the governing deadline if set
  if (stats.value.timeline.projectDueDate) {
    const projectDue = new Date(stats.value.timeline.projectDueDate)
    const daysUntil = Math.ceil((projectDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntil < 0) return 'overdue'
    if (daysUntil <= 7) return 'at_risk'
    return 'on_track'
  }
  if (stats.value.timeline.upcomingDueDates.length > 0) {
    const next = new Date(stats.value.timeline.upcomingDueDates[0].dueDate)
    const daysUntil = Math.ceil((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysUntil <= 7) return 'at_risk'
    return 'on_track'
  }
  if (!stats.value.timeline.latestDueDate) return 'none'
  return 'on_track'
})

const nextDueAssessment = computed(() => {
  if (!stats.value?.timeline.upcomingDueDates.length) return null
  return stats.value.timeline.upcomingDueDates[0]
})

const evidenceCoverageStatus = computed(() => {
  if (!stats.value) return undefined
  const pct = stats.value.evidenceCoverage.percent
  if (pct === null) return undefined
  if (pct >= 80) return 'success'
  if (pct >= 50) return 'warning'
  return 'exception'
})

const conformanceColor = computed(() => {
  if (!stats.value || stats.value.conformance.averageScore === null) return 'var(--cat-text-primary)'
  return getScoreColor(stats.value.conformance.averageScore)
})

const getScoreColor = (score: number): string => {
  if (score >= 80) return 'var(--cat-success)'
  if (score >= 50) return 'var(--cat-warning)'
  return 'var(--cat-danger)'
}

const formatDate = (date: string | null) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const formatDateShort = (date: Date) => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// --- Gantt chart computeds ---

interface GanttItem {
  id: string
  title: string
  state: string
  start: Date
  end: Date
  leftPercent: number
  widthPercent: number
}

const ganttRange = computed(() => {
  if (!stats.value) return { min: new Date(), max: new Date() }

  const dates: Date[] = []

  // Project dates
  if (stats.value.timeline.projectStartDate) dates.push(new Date(stats.value.timeline.projectStartDate))
  if (stats.value.timeline.projectDueDate) dates.push(new Date(stats.value.timeline.projectDueDate))

  // Assessment dates
  for (const a of (stats.value.assessmentBreakdown || [])) {
    if (a.startDate) dates.push(new Date(a.startDate))
    if (a.dueDate) dates.push(new Date(a.dueDate))
  }

  // Include today
  dates.push(new Date())

  if (dates.length === 0) return { min: new Date(), max: new Date() }

  const minTime = Math.min(...dates.map(d => d.getTime()))
  const maxTime = Math.max(...dates.map(d => d.getTime()))

  // Add 5% padding on each side
  const range = maxTime - minTime || 1000 * 60 * 60 * 24 * 30 // default 30 days if all same
  const padding = range * 0.05

  return {
    min: new Date(minTime - padding),
    max: new Date(maxTime + padding),
  }
})

const toPercent = (date: Date): number => {
  const { min, max } = ganttRange.value
  const total = max.getTime() - min.getTime()
  if (total === 0) return 0
  return ((date.getTime() - min.getTime()) / total) * 100
}

const ganttItems = computed((): GanttItem[] => {
  if (!stats.value?.assessmentBreakdown) return []

  interface AssessmentBreakdownItem {
    id: string
    title: string
    state: string
    startDate: string | null
    dueDate: string | null
  }

  return stats.value.assessmentBreakdown
    .filter((a: AssessmentBreakdownItem) => a.startDate || a.dueDate)
    .map((a: AssessmentBreakdownItem) => {
      const start = a.startDate ? new Date(a.startDate) : new Date(a.dueDate as string)
      const end = a.dueDate ? new Date(a.dueDate) : new Date(a.startDate as string)
      const leftPercent = toPercent(start)
      const rightPercent = toPercent(end)
      return {
        id: a.id,
        title: a.title,
        state: a.state,
        start,
        end,
        leftPercent,
        widthPercent: Math.max(rightPercent - leftPercent, 1),
      }
    })
})

const projectGanttBar = computed(() => {
  if (!stats.value?.timeline.projectStartDate && !stats.value?.timeline.projectDueDate) return null
  const start = stats.value.timeline.projectStartDate
    ? new Date(stats.value.timeline.projectStartDate)
    : new Date(stats.value.timeline.projectDueDate!)
  const end = stats.value.timeline.projectDueDate
    ? new Date(stats.value.timeline.projectDueDate)
    : new Date(stats.value.timeline.projectStartDate!)
  const leftPercent = toPercent(start)
  const rightPercent = toPercent(end)
  return {
    start,
    end,
    leftPercent,
    widthPercent: Math.max(rightPercent - leftPercent, 1),
  }
})

const todayPercent = computed(() => {
  if (!stats.value) return null
  const pct = toPercent(new Date())
  if (pct < 0 || pct > 100) return null
  return pct
})

const ganttMonths = computed(() => {
  const { min, max } = ganttRange.value
  const months: { key: string; label: string; leftPercent: number; widthPercent: number }[] = []

  const current = new Date(min.getFullYear(), min.getMonth(), 1)
  while (current <= max) {
    const monthStart = new Date(Math.max(current.getTime(), min.getTime()))
    const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1)
    const monthEnd = new Date(Math.min(nextMonth.getTime(), max.getTime()))

    const leftPercent = toPercent(monthStart)
    const rightPercent = toPercent(monthEnd)

    months.push({
      key: `${current.getFullYear()}-${current.getMonth()}`,
      label: current.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      leftPercent,
      widthPercent: rightPercent - leftPercent,
    })

    current.setMonth(current.getMonth() + 1)
  }

  return months
})

</script>

<style scoped lang="scss">
.project-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
}

.dashboard-loading {
  padding: var(--cat-spacing-4);
}

.dashboard-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--cat-spacing-3);
}

@media (max-width: 1200px) {
  .dashboard-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .dashboard-stats {
    grid-template-columns: 1fr;
  }
}

.stat-card {
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  padding: var(--cat-spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
  min-height: 140px;
}

.stat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stat-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-body {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-4);
  flex: 1;
}

.stat-ring-container {
  width: 60px;
  height: 60px;
  flex-shrink: 0;
}

.stat-ring {
  width: 100%;
  height: 100%;
}

.ring-bg {
  stroke: var(--cat-border-default);
}

.ring-fill {
  transition: stroke-dasharray 0.6s ease;
}

.ring-text {
  font-size: 8px;
  font-weight: 700;
  fill: var(--cat-text-primary);
}

.stat-detail {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: var(--cat-font-size-2xl);
  font-weight: var(--cat-font-weight-bold);
  color: var(--cat-text-primary);
  line-height: 1.2;
}

.stat-sub {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

.progress-row {
  display: flex;
  align-items: baseline;
  gap: var(--cat-spacing-2);
}

// Timeline
.timeline-alert {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--cat-danger);
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  margin-bottom: 4px;
}

.timeline-next {
  display: flex;
  align-items: center;
  gap: 6px;
}

.timeline-date {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

// Warnings
.dashboard-warnings {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cat-spacing-2);
  margin-top: var(--cat-spacing-3);
}

.warning-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--cat-radius-md);
  font-size: var(--cat-font-size-xs);
  border: 1px solid transparent;

  &.critical {
    background-color: color-mix(in srgb, var(--cat-danger) 12%, transparent);
    border-color: color-mix(in srgb, var(--cat-danger) 30%, transparent);
    color: var(--cat-danger);
  }

  &.warning {
    background-color: color-mix(in srgb, var(--cat-warning) 12%, transparent);
    border-color: color-mix(in srgb, var(--cat-warning) 30%, transparent);
    color: var(--cat-warning);
  }

  &.info {
    background-color: color-mix(in srgb, var(--cat-accent-primary) 12%, transparent);
    border-color: color-mix(in srgb, var(--cat-accent-primary) 30%, transparent);
    color: var(--cat-accent-primary);
  }

  &:hover {
    opacity: 0.9;
  }
}

.warning-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.warning-text {
  line-height: 1.3;
}

// Gantt chart
.gantt-empty {
  padding: var(--cat-spacing-4);
  color: var(--cat-text-tertiary);
  text-align: center;
  font-size: var(--cat-font-size-sm);
}

.gantt-chart {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100px;
  overflow: visible;
  padding-top: 14px;
}

.gantt-header {
  display: flex;
  align-items: flex-end;
  height: 32px;
  border-bottom: 1px solid var(--cat-border-default);
}

.gantt-label-col {
  width: 160px;
  min-width: 160px;
  flex-shrink: 0;
  padding-right: var(--cat-spacing-2);
}

.gantt-bar-col {
  flex: 1;
  position: relative;
  height: 100%;
}

.gantt-months {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.gantt-month {
  position: absolute;
  top: 0;
  bottom: 0;
  font-size: 10px;
  color: var(--cat-text-tertiary);
  padding-left: 4px;
  border-left: 1px solid var(--cat-border-default);
  display: flex;
  align-items: flex-end;
  padding-bottom: 4px;
  white-space: nowrap;
}

.gantt-today-marker {
  position: absolute;
  top: -14px;
  bottom: -100vh;
  z-index: 2;
  pointer-events: none;
}

.gantt-today-line {
  position: absolute;
  top: 12px;
  bottom: 0;
  width: 1.5px;
  background-color: var(--cat-accent-primary);
  opacity: 0.6;
}

.gantt-today-label {
  position: absolute;
  top: 0;
  left: 4px;
  font-size: 9px;
  font-weight: 600;
  color: var(--cat-accent-primary);
  white-space: nowrap;
}

.gantt-row {
  display: flex;
  align-items: center;
  height: 36px;
  border-bottom: 1px solid color-mix(in srgb, var(--cat-border-default) 50%, transparent);

  &:hover {
    background-color: color-mix(in srgb, var(--cat-bg-surface) 60%, transparent);
  }
}

.gantt-row-project {
  background-color: color-mix(in srgb, var(--cat-accent-primary) 4%, transparent);
  border-bottom: 1px solid var(--cat-border-default);
}

.gantt-item-label {
  display: block;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: var(--cat-spacing-2);
}

.gantt-project-label {
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.gantt-bar {
  position: absolute;
  height: 20px;
  border-radius: var(--cat-radius-sm);
  display: flex;
  align-items: center;
  overflow: hidden;
  font-size: 10px;
  color: #fff;
  padding: 0 6px;
  white-space: nowrap;

  &.gantt-bar-project {
    background-color: var(--cat-accent-primary);
    opacity: 0.7;
    height: 22px;
  }

  &.gantt-bar-new {
    background-color: var(--cat-text-tertiary);
  }

  &.gantt-bar-in_progress {
    background-color: var(--cat-accent-primary);
  }

  &.gantt-bar-on_hold {
    background-color: var(--cat-warning);
  }

  &.gantt-bar-complete {
    background-color: var(--cat-success);
  }

  &.gantt-bar-archived {
    background-color: var(--cat-success);
    opacity: 0.6;
  }

  &.gantt-bar-cancelled {
    background-color: var(--cat-text-tertiary);
    opacity: 0.4;
  }
}

.gantt-bar-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
