<template>
  <div class="overview-content">
    <!-- Error Alert -->
    <el-alert v-if="error" type="error" :closable="true" @close="error = ''">
      {{ error }}
    </el-alert>

    <!-- KPI Cards - Loading State -->
    <div v-if="statsLoading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ t('common.loading') }}</p>
    </div>

    <!-- KPI Row: Strategic Metrics -->
    <div v-else class="kpi-grid">
      <StatCard
        :title="t('dashboard.totalProjects')"
        :value="stats.totalProjects"
        :change="0"
        changeType="up"
        :icon="FolderOpened"
        accentColor="var(--cat-chart-blue)"
      />
      <StatCard
        :title="t('dashboard.totalAssessments')"
        :value="stats.totalAssessments"
        :change="0"
        changeType="up"
        :icon="DocumentChecked"
        accentColor="var(--cat-chart-amber)"
      />
      <StatCard
        :title="t('dashboard.completionRate')"
        :value="stats.completionRate + '%'"
        :change="0"
        changeType="up"
        :icon="Odometer"
        accentColor="var(--cat-chart-green)"
      />
      <StatCard
        :title="t('dashboard.overdueAssessments')"
        :value="stats.assessmentsOverdue"
        :change="0"
        changeType="down"
        :icon="Warning"
        :accentColor="stats.assessmentsOverdue > 0 ? 'var(--cat-chart-red)' : 'var(--cat-chart-amber)'"
      />
    </div>

    <!-- Charts Row: Conformance Donut + Assessment Pipeline -->
    <div class="dashboard-grid">
      <!-- Conformance Donut Chart -->
      <el-card class="dashboard-card">
        <template #header>
          <div class="card-header">
            <h2 class="card-title">{{ t('dashboard.conformanceBreakdown') }}</h2>
          </div>
        </template>
        <div v-if="conformanceLoading" class="card-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
        <div v-else-if="conformanceTotal === 0" class="no-data">
          No conformance data available. Start assessments to begin tracking compliance status.
        </div>
        <div v-else class="chart-container conformance-chart-container">
          <canvas ref="conformanceChartCanvas"></canvas>
          <div class="conformance-legend">
            <div v-for="item in conformanceData" :key="item.result" class="legend-item">
              <span class="legend-color" :style="{ backgroundColor: item.color }"></span>
              <span class="legend-label">{{ item.label }}</span>
              <span class="legend-value">{{ item.count }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- Assessment Pipeline -->
      <el-card class="dashboard-card">
        <template #header>
          <div class="card-header">
            <h2 class="card-title">{{ t('dashboard.assessmentPipeline') }}</h2>
          </div>
        </template>
        <div v-if="distributionLoading" class="card-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
        <div v-else-if="assessmentDistribution.length === 0" class="no-data">
          No assessments yet. Create assessments to view their status distribution.
        </div>
        <div v-else class="chart-container pipeline-chart-container" :style="{ height: pipelineChartHeight + 'px' }">
          <canvas ref="pipelineChartCanvas"></canvas>
        </div>
      </el-card>
    </div>

    <!-- Risk Insights -->
    <el-card class="dashboard-card risk-insights-card">
      <template #header>
        <div class="card-header">
          <h2 class="card-title">{{ t('dashboard.riskInsights') }}</h2>
          <el-badge v-if="riskInsights.length > 0" :value="riskInsights.length" type="danger" />
        </div>
      </template>
      <div v-if="riskInsightsLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
      <div v-else-if="riskInsights.length === 0" class="no-risks">
        <el-icon :size="32" color="var(--cat-chart-green)"><CircleCheckFilled /></el-icon>
        <p>{{ t('dashboard.noRisks') }}</p>
      </div>
      <div v-else class="risk-list">
        <div v-for="(insight, index) in riskInsights" :key="index" class="risk-item" :class="'risk-' + insight.severity">
          <div class="risk-severity-indicator"></div>
          <div class="risk-content">
            <div class="risk-header">
              <el-tag size="small" :type="getSeverityTagType(insight.severity)" effect="dark" disable-transitions>
                {{ t('dashboard.' + insight.severity) }}
              </el-tag>
              <el-tag size="small" effect="plain" disable-transitions>
                {{ t('dashboard.' + insight.type) }}
              </el-tag>
            </div>
            <h4 class="risk-title">{{ insight.title }}</h4>
            <p class="risk-detail">{{ insight.detail }}</p>
          </div>
        </div>
      </div>
    </el-card>

    <!-- Claims & Mitigations Health -->
    <el-card class="dashboard-card">
      <template #header>
        <div class="card-header">
          <h2 class="card-title">Claims &amp; Mitigations</h2>
        </div>
      </template>
      <ClaimsMitigationsWidget />
    </el-card>

    <!-- Recent Assessments Table -->
    <el-card class="dashboard-card">
      <template #header>
        <div class="card-header">
          <h2 class="card-title">{{ t('dashboard.recentAssessments') }}</h2>
          <RouterLink to="/assessments" class="view-all-link" aria-label="View all assessments">{{ t('dashboard.viewAll') }}</RouterLink>
        </div>
      </template>

      <div v-if="assessmentsLoading" class="card-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>

      <el-table v-else :data="recentAssessments" stripe aria-label="Recent assessments table">
        <el-table-column prop="title" :label="t('assessments.titleField')" min-width="180" sortable></el-table-column>
        <el-table-column :label="t('assessments.project')" min-width="140">
          <template #default="{ row }">
            {{ row.projectName }}
          </template>
        </el-table-column>
        <el-table-column :label="t('assessments.state')" width="120">
          <template #default="{ row }">
            <StateBadge :state="row.state" />
          </template>
        </el-table-column>
        <el-table-column :label="t('assessments.dueDate')" width="120">
          <template #default="{ row }">
            {{ formatDate(row.dueDate) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpened, DocumentChecked, Odometer, Loading, Warning, CircleCheckFilled } from '@element-plus/icons-vue'
import { Chart, DoughnutController, ArcElement, Tooltip, Legend, BarController, BarElement, CategoryScale, LinearScale } from 'chart.js'
import client from '@/api/client'
import type { Assessment } from '@/types'
import StatCard from '@/components/shared/StatCard.vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import ClaimsMitigationsWidget from '@/components/dashboard/widgets/ClaimsMitigationsWidget.vue'

Chart.register(DoughnutController, ArcElement, Tooltip, Legend, BarController, BarElement, CategoryScale, LinearScale)

const { t } = useI18n()

// Chart refs
const conformanceChartCanvas = ref<HTMLCanvasElement | null>(null)
const pipelineChartCanvas = ref<HTMLCanvasElement | null>(null)
let conformanceChartInstance: Chart | null = null
let pipelineChartInstance: Chart | null = null

// State
const error = ref('')
const statsLoading = ref(true)
const assessmentsLoading = ref(true)
const distributionLoading = ref(true)
const conformanceLoading = ref(true)
const riskInsightsLoading = ref(true)

const stats = ref({
  totalProjects: 0,
  projectsInProgress: 0,
  totalAssessments: 0,
  assessmentsInProgress: 0,
  assessmentsComplete: 0,
  totalEvidence: 0,
  totalClaims: 0,
  totalAttestations: 0,
  totalStandards: 0,
  evidenceExpiringSoon: 0,
  assessmentsOverdue: 0,
  completionRate: 0,
})

interface DistributionItem { state: string; count: number; label?: string }
interface ConformanceItem { result: string; count: number }
interface RiskInsight { severity: string; type: string; title: string; detail: string }

const recentAssessments = ref<Assessment[]>([])
const assessmentDistribution = ref<DistributionItem[]>([])
const riskInsights = ref<RiskInsight[]>([])

const conformanceRaw = ref<ConformanceItem[]>([])

const pipelineChartHeight = computed(() => {
  const nonZero = assessmentDistribution.value.filter((d) => d.count > 0)
  const barCount = Math.max(nonZero.length, 1)
  // 8px bar + 20px gap per bar, plus 30px padding for axes
  return barCount * 28 + 30
})

const conformanceTotal = computed(() => {
  return conformanceRaw.value.reduce((sum: number, item) => sum + item.count, 0)
})

const conformanceData = computed(() => {
  const labelMap: Record<string, string> = {
    yes: t('dashboard.conformant'),
    no: t('dashboard.nonConformant'),
    na: t('dashboard.notApplicable'),
    unassessed: t('dashboard.unassessed'),
  }
  const colorMap: Record<string, string> = {
    yes: '#3fb950',
    no: '#f85149',
    na: '#909399',
    unassessed: '#484f58',
  }
  return conformanceRaw.value.map((item: ConformanceItem) => ({
    ...item,
    label: labelMap[item.result] || item.result,
    color: colorMap[item.result] || '#909399',
  }))
})

// Methods
const formatDate = (dateString: string) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}



const getSeverityTagType = (severity: string): string => {
  const typeMap: Record<string, string> = {
    critical: 'danger',
    high: 'warning',
    medium: 'info',
    low: '',
  }
  return typeMap[severity] || 'info'
}

// Chart rendering
const renderConformanceChart = () => {
  if (!conformanceChartCanvas.value || conformanceTotal.value === 0) return
  if (conformanceChartInstance) conformanceChartInstance.destroy()

  // Build radial gradients for each donut segment (lighter center to deeper edge)
  const ctx = conformanceChartCanvas.value.getContext('2d')
  const gradientMap: Record<string, [string, string]> = {
    yes: ['#56d364', '#1a7f37'],
    no: ['#ff6b6b', '#a11d2b'],
    na: ['#b1bac4', '#606872'],
    unassessed: ['#6e7681', '#30363d'],
  }

  const segmentGradients = conformanceData.value.map((d) => {
    if (!ctx) return d.color
    const centerX = (conformanceChartCanvas.value?.width ?? 0) / 2
    const centerY = (conformanceChartCanvas.value?.height ?? 0) / 2
    const outerRadius = Math.min(centerX, centerY)
    const grad = ctx.createRadialGradient(centerX, centerY, outerRadius * 0.35, centerX, centerY, outerRadius)
    const [inner, outer] = gradientMap[d.result] || ['#b1bac4', '#606872']
    grad.addColorStop(0, inner)
    grad.addColorStop(1, outer)
    return grad
  })

  conformanceChartInstance = new Chart(conformanceChartCanvas.value, {
    type: 'doughnut',
    data: {
      labels: conformanceData.value.map(d => d.label),
      datasets: [{
        data: conformanceData.value.map(d => d.count),
        backgroundColor: segmentGradients,
        borderColor: 'transparent',
        borderWidth: 0,
        spacing: 2,
        hoverOffset: 0,
        hoverBorderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      animation: {
        animateRotate: true,
        animateScale: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(22, 27, 34, 0.95)',
          titleColor: '#c9d1d9',
          bodyColor: '#c9d1d9',
          borderColor: 'rgba(139, 148, 158, 0.2)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          displayColors: true,
          boxWidth: 10,
          boxHeight: 10,
          boxPadding: 4,
          callbacks: {
            label: (context) => {
              const value = context.raw as number
              const pct = conformanceTotal.value > 0 ? Math.round((value / conformanceTotal.value) * 100) : 0
              return ` ${context.label}: ${value} (${pct}%)`
            },
          },
        },
      },
    },
  })
}

const renderPipelineChart = () => {
  if (!pipelineChartCanvas.value || assessmentDistribution.value.length === 0) return
  if (pipelineChartInstance) pipelineChartInstance.destroy()

  const stateGradients: Record<string, [string, string]> = {
    new: ['#1a4a80', '#6cb6ff'],
    pending: ['#7a5200', '#e8b931'],
    in_progress: ['#155d27', '#56d364'],
    on_hold: ['#40454d', '#b1bac4'],
    cancelled: ['#a11d2b', '#ff6b6b'],
    complete: ['#0f5323', '#3dd68c'],
  }

  const stateLabels: Record<string, string> = {
    new: 'New',
    pending: 'Pending',
    in_progress: 'In Progress',
    on_hold: 'On Hold',
    cancelled: 'Cancelled',
    complete: 'Complete',
  }

  // Filter to non-zero states
  const nonZero = assessmentDistribution.value.filter((d) => d.count > 0)

  const ctx = pipelineChartCanvas.value.getContext('2d')
  if (!ctx) return

  // Build horizontal gradients for each bar
  const barGradients = nonZero.map((d) => {
    const grad = ctx.createLinearGradient(0, 0, pipelineChartCanvas.value?.width ?? 0, 0)
    const [start, end] = stateGradients[d.state as keyof typeof stateGradients] || ['#3a6fb5', '#58a6ff']
    grad.addColorStop(0, start)
    grad.addColorStop(1, end)
    return grad
  })

  pipelineChartInstance = new Chart(pipelineChartCanvas.value, {
    type: 'bar',
    data: {
      labels: nonZero.map((d: DistributionItem) => stateLabels[d.state] || d.state),
      datasets: [{
        data: nonZero.map((d: DistributionItem) => d.count),
        backgroundColor: barGradients,
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 8,
        maxBarThickness: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(22, 27, 34, 0.95)',
          titleColor: '#c9d1d9',
          bodyColor: '#c9d1d9',
          borderColor: 'rgba(139, 148, 158, 0.2)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: '#8b949e',
            stepSize: 1,
            precision: 0,
          },
          grid: {
            color: 'rgba(139,148,158,0.08)',
          },
        },
        y: {
          ticks: {
            color: '#c9d1d9',
            font: { size: 12 },
          },
          grid: {
            display: false,
          },
        },
      },
    },
  })
}

// Data fetching
const fetchStats = async () => {
  statsLoading.value = true
  try {
    const response = await client.get('/dashboard/stats')
    stats.value = response.data
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    error.value = e.response?.data?.error || 'Failed to load dashboard stats'
  } finally {
    statsLoading.value = false
  }
}

const fetchRecentAssessments = async () => {
  assessmentsLoading.value = true
  try {
    const response = await client.get('/dashboard/recent-assessments')
    recentAssessments.value = response.data.data || []
  } catch (err: unknown) {
    console.error('Failed to load recent assessments:', err)
  } finally {
    assessmentsLoading.value = false
  }
}

const fetchAssessmentDistribution = async () => {
  distributionLoading.value = true
  try {
    const response = await client.get('/dashboard/assessment-distribution')
    assessmentDistribution.value = (response.data.data || []).filter((d: DistributionItem) => d.count > 0)
  } catch (err: unknown) {
    console.error('Failed to load assessment distribution:', err)
  } finally {
    distributionLoading.value = false
    await nextTick()
    renderPipelineChart()
  }
}

const fetchConformanceBreakdown = async () => {
  conformanceLoading.value = true
  try {
    const response = await client.get('/dashboard/conformance-breakdown')
    conformanceRaw.value = response.data.data || []
  } catch (err: unknown) {
    console.error('Failed to load conformance breakdown:', err)
  } finally {
    conformanceLoading.value = false
    await nextTick()
    renderConformanceChart()
  }
}

const fetchRiskInsights = async () => {
  riskInsightsLoading.value = true
  try {
    const response = await client.get('/dashboard/risk-insights')
    riskInsights.value = response.data.data || []
  } catch (err: unknown) {
    console.error('Failed to load risk insights:', err)
  } finally {
    riskInsightsLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([
    fetchStats(),
    fetchRecentAssessments(),
    fetchAssessmentDistribution(),
    fetchConformanceBreakdown(),
    fetchRiskInsights(),
  ])
})
</script>

<style scoped lang="scss">
.overview-content {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--cat-spacing-4);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--cat-spacing-6);

  @media (max-width: 1024px) {
    grid-template-columns: 1fr;
  }
}

.dashboard-card {
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  margin: 0;
  font-size: var(--cat-font-size-base);
  font-weight: var(--cat-font-weight-semibold);
}

.view-all-link {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-brand-secondary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

// Chart containers
.chart-container {
  position: relative;
}

.conformance-chart-container {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-6);
  min-height: 200px;

  canvas {
    max-width: 180px;
    max-height: 180px;
    flex-shrink: 0;
  }
}

.conformance-legend {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
  flex: 1;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-2);
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.legend-label {
  flex: 1;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
}

.legend-value {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.pipeline-chart-container {
  canvas {
    width: 100% !important;
    height: 100% !important;
  }
}

// Coverage
.coverage-list {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.coverage-item {
  .coverage-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .coverage-name {
    font-size: var(--cat-font-size-sm);
    font-weight: var(--cat-font-weight-medium);
    color: var(--cat-text-primary);
  }

  .coverage-percent {
    font-size: var(--cat-font-size-sm);
    font-weight: var(--cat-font-weight-semibold);
    color: var(--cat-text-secondary);
  }

  .coverage-detail {
    font-size: var(--cat-font-size-xs);
    color: var(--cat-text-tertiary);
    margin-top: 2px;
  }
}

// Risk Insights
.risk-insights-card {
  :deep(.el-card__body) {
    padding: 0;
  }
}

.no-risks {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-8);
  text-align: center;
  color: var(--cat-text-tertiary);

  p {
    margin: var(--cat-spacing-3) 0 0;
    font-size: var(--cat-font-size-sm);
  }
}

.risk-list {
  max-height: 320px;
  overflow-y: auto;
}

.risk-item {
  display: flex;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-4) var(--cat-spacing-5);
  border-bottom: 1px solid var(--cat-border-muted);
  transition: background-color 0.15s;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background-color: var(--cat-bg-secondary);
  }
}

.risk-severity-indicator {
  width: 4px;
  flex-shrink: 0;
  border-radius: 2px;
  margin-top: 2px;
  align-self: stretch;
}

.risk-critical .risk-severity-indicator { background-color: var(--cat-chart-red); }
.risk-high .risk-severity-indicator { background-color: var(--cat-chart-amber); }
.risk-medium .risk-severity-indicator { background-color: var(--cat-chart-blue); }
.risk-low .risk-severity-indicator { background-color: var(--cat-chart-green); }

.risk-content {
  flex: 1;
  min-width: 0;
}

.risk-header {
  display: flex;
  gap: var(--cat-spacing-2);
  margin-bottom: var(--cat-spacing-2);
}

.risk-title {
  margin: 0 0 var(--cat-spacing-1) 0;
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

.risk-detail {
  margin: 0;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  line-height: 1.5;
}

// Project Health
.project-health-list {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.project-health-item {
  padding: var(--cat-spacing-3);
  background-color: var(--cat-bg-secondary);
  border-radius: var(--cat-radius-md);
}

.project-health-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--cat-spacing-2);
}

.project-health-name {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-brand-secondary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.project-health-rate {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
}

.project-health-meta {
  display: flex;
  gap: var(--cat-spacing-4);
  margin-top: var(--cat-spacing-2);
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

.project-overdue {
  color: var(--cat-chart-red);
  font-weight: var(--cat-font-weight-medium);
}

// Evidence Health
.evidence-health {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--cat-spacing-3);
}

.health-item {
  text-align: center;
  padding: var(--cat-spacing-3);
  background-color: var(--cat-bg-secondary);
  border-radius: var(--cat-radius-md);
}

.health-value {
  font-size: var(--cat-font-size-xl);
  font-weight: var(--cat-font-weight-bold);
  margin-bottom: 4px;
}

.health-label {
  display: flex;
  justify-content: center;
}

.expiring-section {
  border-top: 1px solid var(--cat-border-default);
  padding-top: var(--cat-spacing-3);
}

.expiring-title {
  margin: 0 0 var(--cat-spacing-2) 0;
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-chart-amber);
}

.expiring-item {
  display: flex;
  justify-content: space-between;
  padding: var(--cat-spacing-2) 0;
  font-size: var(--cat-font-size-sm);

  .expiring-name {
    color: var(--cat-text-primary);
  }

  .expiring-date {
    color: var(--cat-text-tertiary);
  }
}

// Due dates
.due-dates-list {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
}

.due-date-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-spacing-3);
  background-color: var(--cat-bg-secondary);
  border-radius: var(--cat-radius-md);
}

.due-date-content {
  flex: 1;
}

.due-date-title {
  margin: 0;
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-primary);
}

.due-date-meta {
  margin: var(--cat-spacing-1) 0 0;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
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

.card-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--cat-spacing-6);
  color: var(--cat-text-tertiary);

  .el-icon {
    font-size: 24px;
  }
}

.no-data {
  text-align: center;
  padding: var(--cat-spacing-4);
  color: var(--cat-text-tertiary);
}
</style>
