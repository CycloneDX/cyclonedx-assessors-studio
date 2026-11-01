<template>
  <div class="scheduler-view">
    <div class="scheduler-header">
      <div class="scheduler-title-row">
        <h1 class="scheduler-title">Assessment Scheduler</h1>
        <div class="scheduler-actions">
          <el-button-group>
            <el-button size="small" :disabled="selectedYear <= minYear" @click="selectedYear--" aria-label="Previous year">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <el-button size="small" class="year-btn">{{ selectedYear }}</el-button>
            <el-button size="small" :disabled="selectedYear >= maxYear" @click="selectedYear++" aria-label="Next year">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </el-button-group>
          <el-select
            v-model="filterAssessorId"
            placeholder="All assessors"
            clearable
            size="small"
            style="width: 180px"
          >
            <el-option
              v-for="u in assessorOptions"
              :key="u.id"
              :label="u.displayName"
              :value="u.id"
            />
          </el-select>
          <el-select
            v-model="filterProjectId"
            placeholder="All projects"
            clearable
            size="small"
            style="width: 180px"
          >
            <el-option
              v-for="p in projectOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
          <el-button type="primary" size="small" @click="openCreateDialog">
            <el-icon class="mr-1"><Plus /></el-icon>
            Schedule Assessment
          </el-button>
        </div>
      </div>

      <!-- Legend -->
      <div class="legend">
        <div v-for="s in STATUS_META" :key="s.key" class="legend-item">
          <span class="legend-dot" :style="{ background: s.color }"></span>
          <span class="legend-label">{{ s.label }}</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>Loading schedule…</span>
    </div>

    <el-alert v-else-if="error" type="error" show-icon :closable="false" class="m-16">{{ error }}</el-alert>

    <template v-else>
      <!-- Timeline Gantt -->
      <div class="timeline-wrapper">
        <!-- Month header -->
        <div class="timeline-grid">
          <div class="row-label-col"></div>
          <div class="months-header">
            <div
              v-for="(month, idx) in MONTHS"
              :key="idx"
              class="month-cell"
              :class="{ 'current-month': isCurrentMonth(idx) }"
            >
              {{ month }}
            </div>
          </div>
        </div>

        <!-- Today marker line -->
        <div class="timeline-body">
          <div class="today-line" :style="{ left: `calc(${ROW_LABEL_WIDTH}px + ${todayFraction * 100}%)` }"></div>

          <!-- Empty state -->
          <div v-if="timelineRows.length === 0" class="empty-timeline">
            <el-empty description="No assessments scheduled for this year">
              <el-button type="primary" @click="openCreateDialog">Schedule one now</el-button>
            </el-empty>
          </div>

          <!-- Grouped rows -->
          <template v-else>
            <div
              v-for="group in timelineRows"
              :key="group.assessorId ?? 'unassigned'"
              class="assessor-group"
            >
              <!-- Group heading -->
              <div class="group-heading">
                <el-icon><User /></el-icon>
                <span>{{ group.assessorName }}</span>
                <el-tag size="small" type="info" class="ml-2">{{ group.items.length }}</el-tag>
              </div>

              <!-- One row per scheduled item -->
              <div
                v-for="item in group.items"
                :key="item.id"
                class="timeline-row"
              >
                <div class="row-label" :title="item.title">
                  <span class="row-title">{{ item.title }}</span>
                  <span v-if="item.projectName" class="row-project">{{ item.projectName }}</span>
                </div>
                <div class="row-track">
                  <!-- Background month alternation -->
                  <div
                    v-for="(_, mi) in MONTHS"
                    :key="mi"
                    class="month-bg"
                    :class="{ alt: mi % 2 === 1, 'current-month-bg': isCurrentMonth(mi) }"
                  ></div>

                  <!-- The bar -->
                  <div
                    class="gantt-bar"
                    :style="barStyle(item)"
                    :title="barTooltip(item)"
                    @click="openEditDialog(item)"
                  >
                    <span class="bar-label">{{ item.title }}</span>
                    <el-icon v-if="item.recurrence !== 'none'" class="recurrence-icon" :title="`Repeats ${item.recurrence}`"><Refresh /></el-icon>
                  </div>

                  <!-- Status icon marker at start -->
                  <div
                    class="status-dot"
                    :style="{ left: `calc(${barStart(item) * 100}% - 6px)`, background: statusColor(item.status) }"
                    :title="statusLabel(item.status)"
                  ></div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="summary-cards">
        <el-card
          v-for="s in STATUS_META"
          :key="s.key"
          class="summary-card"
          shadow="never"
        >
          <div class="summary-card-inner">
            <div class="summary-count" :style="{ color: s.color }">{{ countByStatus(s.key) }}</div>
            <div class="summary-label">{{ s.label }}</div>
          </div>
        </el-card>
      </div>
    </template>

    <!-- Create/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingItem ? 'Edit Scheduled Assessment' : 'Schedule New Assessment'"
      width="560px"
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-width="130px"
        label-position="left"
      >
        <el-form-item label="Title" prop="title">
          <el-input v-model="form.title" placeholder="Assessment title" maxlength="255" show-word-limit />
        </el-form-item>

        <el-form-item label="Project">
          <el-select v-model="form.projectId" placeholder="Select project" clearable style="width:100%">
            <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="Assessor">
          <el-select v-model="form.assessorId" placeholder="Assign assessor" clearable style="width:100%">
            <el-option v-for="u in assessorOptions" :key="u.id" :label="u.displayName" :value="u.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="Standard">
          <el-select v-model="form.standardId" placeholder="Select standard (optional)" clearable style="width:100%">
            <el-option v-for="s in standardOptions" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="Scheduled Date" prop="scheduledDate">
          <el-date-picker
            v-model="form.scheduledDate"
            type="date"
            placeholder="Start date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width:100%"
          />
        </el-form-item>

        <el-form-item label="Due Date">
          <el-date-picker
            v-model="form.dueDate"
            type="date"
            placeholder="Due date (optional)"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width:100%"
          />
        </el-form-item>

        <el-form-item label="Recurrence">
          <el-select v-model="form.recurrence" style="width:100%">
            <el-option label="None (one-time)" value="none" />
            <el-option label="Weekly" value="weekly" />
            <el-option label="Monthly" value="monthly" />
            <el-option label="Quarterly" value="quarterly" />
            <el-option label="Yearly" value="yearly" />
          </el-select>
        </el-form-item>

        <el-form-item label="Status">
          <el-select v-model="form.status" style="width:100%">
            <el-option
              v-for="s in STATUS_META"
              :key="s.key"
              :label="s.label"
              :value="s.key"
            >
              <span class="status-option">
                <span class="status-dot-sm" :style="{ background: s.color }"></span>
                {{ s.label }}
              </span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="Description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="Optional description" />
        </el-form-item>

        <el-form-item label="Notes">
          <el-input v-model="form.notes" type="textarea" :rows="2" placeholder="Internal notes" />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button v-if="editingItem" type="danger" plain @click="handleDelete">Delete</el-button>
          <div class="footer-right">
            <el-button @click="dialogVisible = false">Cancel</el-button>
            <el-button type="primary" :loading="saving" @click="handleSave">
              {{ editingItem ? 'Save Changes' : 'Schedule' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Loading,
  Refresh,
  User,
} from '@element-plus/icons-vue'
import {
  getScheduledAssessments,
  createScheduledAssessment,
  updateScheduledAssessment,
  deleteScheduledAssessment,
} from '@/api/scheduler'
import type { ScheduledAssessment, ScheduledAssessmentStatus } from '@/types'
import client from '@/api/client'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ROW_LABEL_WIDTH = 200
const NOW = new Date()

const STATUS_META = [
  { key: 'scheduled' as ScheduledAssessmentStatus, label: 'Scheduled', color: '#909399' },
  { key: 'in_progress' as ScheduledAssessmentStatus, label: 'In Progress', color: '#409EFF' },
  { key: 'on_hold' as ScheduledAssessmentStatus, label: 'On Hold', color: '#E6A23C' },
  { key: 'warning' as ScheduledAssessmentStatus, label: 'Warning', color: '#F56C6C' },
  { key: 'complete' as ScheduledAssessmentStatus, label: 'Complete', color: '#67C23A' },
  { key: 'failed' as ScheduledAssessmentStatus, label: 'Failed', color: '#C0392B' },
]

const minYear = NOW.getFullYear() - 2
const maxYear = NOW.getFullYear() + 3
const selectedYear = ref(NOW.getFullYear())
const filterAssessorId = ref<string | null>(null)
const filterProjectId = ref<string | null>(null)

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<ScheduledAssessment[]>([])

const projectOptions = ref<{ id: string; name: string }[]>([])
const assessorOptions = ref<{ id: string; displayName: string }[]>([])
const standardOptions = ref<{ id: string; name: string }[]>([])

async function fetchOptions() {
  const [proj, users, stds] = await Promise.all([
    client.get('/projects', { params: { pageSize: 200 } }),
    client.get('/users', { params: { pageSize: 200 } }),
    client.get('/standards', { params: { pageSize: 200 } }),
  ])
  projectOptions.value = proj.data.data ?? []
  assessorOptions.value = (users.data.data ?? []).map((u: { id: string; displayName?: string; username: string }) => ({
    id: u.id,
    displayName: u.displayName || u.username,
  }))
  standardOptions.value = stds.data.data ?? []
}

async function fetchItems() {
  loading.value = true
  error.value = null
  try {
    const params: Record<string, unknown> = { year: selectedYear.value }
    if (filterAssessorId.value) params.assessorId = filterAssessorId.value
    if (filterProjectId.value) params.projectId = filterProjectId.value
    items.value = await getScheduledAssessments(params)
  } catch (e: unknown) {
    error.value = (e as Error).message || 'Failed to load schedule'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchOptions()
  fetchItems()
})

watch([selectedYear, filterAssessorId, filterProjectId], fetchItems)

// ── Timeline helpers ──────────────────────────────────────────────────

const todayFraction = computed(() => {
  if (NOW.getFullYear() !== selectedYear.value) return -1
  const start = new Date(selectedYear.value, 0, 1).getTime()
  const end = new Date(selectedYear.value + 1, 0, 1).getTime()
  return (NOW.getTime() - start) / (end - start)
})

function isCurrentMonth(monthIdx: number) {
  return NOW.getFullYear() === selectedYear.value && NOW.getMonth() === monthIdx
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  const diff = date.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

function daysInYear(year: number) {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
}

function barStart(item: ScheduledAssessment): number {
  const d = new Date(item.scheduledDate)
  return (dayOfYear(d) - 1) / daysInYear(selectedYear.value)
}

function barEnd(item: ScheduledAssessment): number {
  const end = item.dueDate ? new Date(item.dueDate) : new Date(item.scheduledDate)
  // If no due date, show at least 2 weeks wide
  if (!item.dueDate) {
    end.setDate(end.getDate() + 14)
  }
  const endFrac = (dayOfYear(end) - 1) / daysInYear(selectedYear.value)
  return Math.min(endFrac, 1)
}

function barStyle(item: ScheduledAssessment): Record<string, string> {
  const start = barStart(item)
  const end = barEnd(item)
  const color = statusColor(item.status)
  return {
    left: `${start * 100}%`,
    width: `${Math.max((end - start) * 100, 1)}%`,
    background: color,
  }
}

function barTooltip(item: ScheduledAssessment): string {
  const parts = [item.title]
  if (item.projectName) parts.push(`Project: ${item.projectName}`)
  if (item.assessorName) parts.push(`Assessor: ${item.assessorName}`)
  parts.push(`Start: ${item.scheduledDate}`)
  if (item.dueDate) parts.push(`Due: ${item.dueDate}`)
  parts.push(`Status: ${statusLabel(item.status)}`)
  if (item.recurrence !== 'none') parts.push(`Recurs: ${item.recurrence}`)
  return parts.join('\n')
}

function statusColor(status: ScheduledAssessmentStatus): string {
  return STATUS_META.find((s) => s.key === status)?.color ?? '#909399'
}

function statusLabel(status: ScheduledAssessmentStatus): string {
  return STATUS_META.find((s) => s.key === status)?.label ?? status
}

function countByStatus(status: ScheduledAssessmentStatus): number {
  return items.value.filter((i) => i.status === status).length
}

interface TimelineGroup {
  assessorId: string | null
  assessorName: string
  items: ScheduledAssessment[]
}

const timelineRows = computed<TimelineGroup[]>(() => {
  const groups = new Map<string, TimelineGroup>()
  for (const item of items.value) {
    const key = item.assessorId ?? '__unassigned__'
    if (!groups.has(key)) {
      groups.set(key, {
        assessorId: item.assessorId ?? null,
        assessorName: item.assessorName ?? 'Unassigned',
        items: [],
      })
    }
    groups.get(key)!.items.push(item)
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.assessorName.localeCompare(b.assessorName)
  )
})

// ── Dialog ────────────────────────────────────────────────────────────

const dialogVisible = ref(false)
const saving = ref(false)
const editingItem = ref<ScheduledAssessment | null>(null)
const formRef = ref<FormInstance>()

interface FormState {
  title: string
  description: string
  projectId: string | null
  assessorId: string | null
  standardId: string | null
  scheduledDate: string
  dueDate: string | null
  recurrence: string
  status: ScheduledAssessmentStatus
  notes: string
}

const form = ref<FormState>({
  title: '',
  description: '',
  projectId: null,
  assessorId: null,
  standardId: null,
  scheduledDate: '',
  dueDate: null,
  recurrence: 'none',
  status: 'scheduled',
  notes: '',
})

const formRules: FormRules = {
  title: [{ required: true, message: 'Title is required', trigger: 'blur' }],
  scheduledDate: [{ required: true, message: 'Scheduled date is required', trigger: 'change' }],
}

function openCreateDialog() {
  editingItem.value = null
  form.value = {
    title: '',
    description: '',
    projectId: filterProjectId.value,
    assessorId: filterAssessorId.value,
    standardId: null,
    scheduledDate: `${selectedYear.value}-01-01`,
    dueDate: null,
    recurrence: 'none',
    status: 'scheduled',
    notes: '',
  }
  dialogVisible.value = true
}

function openEditDialog(item: ScheduledAssessment) {
  editingItem.value = item
  form.value = {
    title: item.title,
    description: item.description ?? '',
    projectId: item.projectId ?? null,
    assessorId: item.assessorId ?? null,
    standardId: item.standardId ?? null,
    scheduledDate: item.scheduledDate.slice(0, 10),
    dueDate: item.dueDate ? item.dueDate.slice(0, 10) : null,
    recurrence: item.recurrence,
    status: item.status,
    notes: item.notes ?? '',
  }
  dialogVisible.value = true
}

function resetForm() {
  editingItem.value = null
  formRef.value?.clearValidate()
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const payload = {
      title: form.value.title,
      description: form.value.description || null,
      projectId: form.value.projectId || null,
      assessorId: form.value.assessorId || null,
      standardId: form.value.standardId || null,
      scheduledDate: form.value.scheduledDate,
      dueDate: form.value.dueDate || null,
      recurrence: form.value.recurrence as ScheduledAssessment['recurrence'],
      status: form.value.status,
      notes: form.value.notes || null,
    }

    if (editingItem.value) {
      await updateScheduledAssessment(editingItem.value.id, payload)
      ElMessage.success('Assessment updated')
    } else {
      await createScheduledAssessment(payload as Parameters<typeof createScheduledAssessment>[0])
      ElMessage.success('Assessment scheduled')
    }
    dialogVisible.value = false
    await fetchItems()
  } catch {
    ElMessage.error('Failed to save. Please try again.')
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!editingItem.value) return
  await ElMessageBox.confirm(
    `Delete "${editingItem.value.title}"? This cannot be undone.`,
    'Confirm Delete',
    { type: 'warning', confirmButtonText: 'Delete', confirmButtonClass: 'el-button--danger' }
  )
  try {
    await deleteScheduledAssessment(editingItem.value.id)
    ElMessage.success('Deleted')
    dialogVisible.value = false
    await fetchItems()
  } catch {
    ElMessage.error('Failed to delete')
  }
}

</script>

<style scoped lang="scss">
.scheduler-view {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 100%;
}

.scheduler-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scheduler-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.scheduler-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
  color: var(--el-text-color-primary);
}

.scheduler-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.year-btn {
  min-width: 64px;
  font-weight: 600;
  cursor: default;
}

.legend {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 40px;
  color: var(--el-text-color-secondary);
  justify-content: center;
}

// ── Timeline ──────────────────────────────────────────────────────────

$label-width: 200px;
$row-height: 40px;
$bar-height: 22px;

.timeline-wrapper {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow-x: auto;
  min-width: 0;
}

.timeline-grid {
  display: flex;
  border-bottom: 1px solid var(--el-border-color-light);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--el-bg-color);
}

.row-label-col {
  width: $label-width;
  flex-shrink: 0;
}

.months-header {
  flex: 1;
  display: flex;
  min-width: 600px;
}

.month-cell {
  flex: 1;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  padding: 8px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-left: 1px solid var(--el-border-color-lighter);

  &.current-month {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.timeline-body {
  position: relative;
  min-width: 600px + $label-width;
}

.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--el-color-danger);
  opacity: 0.6;
  z-index: 3;
  pointer-events: none;

  &::after {
    content: 'Today';
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 10px;
    color: var(--el-color-danger);
    white-space: nowrap;
  }
}

.empty-timeline {
  padding: 60px 0;
  display: flex;
  justify-content: center;
}

.assessor-group {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.group-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);

  .el-icon {
    color: var(--el-text-color-secondary);
  }
}

.timeline-row {
  display: flex;
  height: $row-height;
  border-bottom: 1px solid var(--el-border-color-lighter);

  &:last-child {
    border-bottom: none;
  }
}

.row-label {
  width: $label-width;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 12px;
  overflow: hidden;
  border-right: 1px solid var(--el-border-color-light);
}

.row-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-project {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-track {
  flex: 1;
  position: relative;
  display: flex;
  overflow: hidden;
}

.month-bg {
  flex: 1;
  height: 100%;

  &.alt {
    background: var(--el-fill-color-lighter);
  }

  &.current-month-bg {
    background: var(--el-color-primary-light-9);
  }
}

.gantt-bar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: $bar-height;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 4px;
  min-width: 6px;
  transition: filter 0.15s, opacity 0.15s;
  z-index: 1;
  overflow: hidden;

  &:hover {
    filter: brightness(1.1);
    z-index: 2;
  }
}

.bar-label {
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.recurrence-icon {
  color: rgba(255,255,255,0.8);
  font-size: 11px;
  flex-shrink: 0;
}

.status-dot {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--el-bg-color);
  z-index: 3;
}

// ── Summary cards ─────────────────────────────────────────────────────

.summary-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-card {
  flex: 1;
  min-width: 100px;
  border-radius: 8px;

  :deep(.el-card__body) {
    padding: 16px 12px;
  }
}

.summary-card-inner {
  text-align: center;
}

.summary-count {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 6px;
}

.summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

// ── Dialog ────────────────────────────────────────────────────────────

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-right {
  display: flex;
  gap: 8px;
}

.status-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot-sm {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ml-1 { margin-left: 4px; }
.ml-2 { margin-left: 8px; }
.mr-1 { margin-right: 4px; }
.m-16 { margin: 16px; }
</style>
