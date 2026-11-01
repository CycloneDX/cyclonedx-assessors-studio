<template>
  <div class="project-detail-container">

    <!-- ── Breadcrumb ─────────────────────────────────────────────── -->
    <div class="project-breadcrumb">
      <el-breadcrumb :separator-icon="ArrowRight">
        <el-breadcrumb-item :to="{ path: '/projects' }">{{ t('nav.projects') }}</el-breadcrumb-item>
        <el-breadcrumb-item>{{ project?.name || t('common.loading') }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <!-- ── Loading / Error ───────────────────────────────────────── -->
    <div v-if="loading" class="loading-state">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>{{ t('common.loading') }}</span>
    </div>
    <el-alert v-else-if="error" type="error" show-icon :closable="false" class="m-24">{{ error }}</el-alert>

    <template v-else-if="project">

      <!-- ── Project Hero Header ───────────────────────────────────── -->
      <div class="project-hero">
        <div class="hero-left">
          <div class="hero-name-row">
            <h1 class="project-name">{{ project.name }}</h1>
            <StateBadge :state="project.state" />
            <el-tag v-if="isOverdue" type="danger" size="small" effect="dark" class="overdue-tag">
              <el-icon><WarningFilled /></el-icon> Overdue
            </el-tag>
          </div>
          <p v-if="project.description" class="project-description">{{ project.description }}</p>
          <div class="hero-meta">
            <span v-if="project.startDate" class="meta-item">
              <el-icon><Calendar /></el-icon> Start: {{ formatDate(project.startDate) }}
            </span>
            <span v-if="project.dueDate" class="meta-item">
              <el-icon><Clock /></el-icon> Due: {{ formatDate(project.dueDate) }}
            </span>
            <span v-if="projectStandards.length" class="meta-item">
              <el-icon><Document /></el-icon>
              {{ projectStandards.map(s => s.name + (s.version ? ` v${s.version}` : '')).join(', ') }}
            </span>
            <template v-if="projectTags.length">
              <span
                v-for="tag in projectTags"
                :key="tag.name"
                class="tag-pill"
                :style="tagPillStyle(tag.color)"
              >{{ tag.name }}</span>
            </template>
          </div>
        </div>

        <div class="hero-actions">
          <el-button size="small" @click="handleExportCycloneDX">CycloneDX</el-button>
          <el-button size="small" :loading="pdfExporting" @click="handleExportProjectPDF">PDF Report</el-button>
          <el-button size="small" @click="openEditDialog">
            <el-icon><EditIcon /></el-icon> Edit
          </el-button>
          <el-dropdown trigger="click">
            <el-button size="small" aria-label="More project actions">
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item class="text-el-danger" @click="handleArchiveProject">
                  {{ t('projects.archiveProject') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- ── KPI Ribbon ────────────────────────────────────────────── -->
      <div class="kpi-ribbon">
        <div class="kpi-card" :class="kpiCompletionClass">
          <div class="kpi-value">{{ stats?.assessmentCompletion.percent ?? '—' }}%</div>
          <div class="kpi-label">Completion</div>
          <div class="kpi-sub">{{ stats?.assessmentCompletion.completed ?? 0 }}/{{ stats?.assessmentCompletion.total ?? 0 }} assessments</div>
        </div>
        <div class="kpi-card" :class="kpiConformanceClass">
          <div class="kpi-value">
            {{ stats?.conformance.averageScore != null ? Math.round(stats.conformance.averageScore) + '%' : '—' }}
          </div>
          <div class="kpi-label">Avg Conformance</div>
          <div class="kpi-sub">{{ stats?.conformance.assessments.length ?? 0 }} scored</div>
        </div>
        <div class="kpi-card" :class="kpiEvidenceClass">
          <div class="kpi-value">{{ stats?.evidenceCoverage.percent != null ? stats.evidenceCoverage.percent + '%' : '—' }}</div>
          <div class="kpi-label">Evidence Coverage</div>
          <div class="kpi-sub">{{ stats?.evidenceCoverage.requirementsWithEvidence ?? 0 }}/{{ stats?.evidenceCoverage.totalRequirements ?? 0 }} requirements</div>
        </div>
        <div class="kpi-card" :class="kpiScheduleClass">
          <div class="kpi-value">{{ scheduledItems.length }}</div>
          <div class="kpi-label">Scheduled</div>
          <div class="kpi-sub">{{ upcomingScheduled.length }} upcoming · {{ overdueScheduled.length }} overdue</div>
        </div>
        <div class="kpi-card" :class="kpiWarningClass">
          <div class="kpi-value">{{ stats?.warnings.filter(w => w.severity === 'critical').length ?? 0 }}</div>
          <div class="kpi-label">Critical Issues</div>
          <div class="kpi-sub">{{ stats?.warnings.length ?? 0 }} total alerts</div>
        </div>
      </div>

      <!-- ── Main Tab Area ─────────────────────────────────────────── -->
      <div class="main-tabs-card">
        <el-tabs v-model="activeTab" class="project-tabs">

          <!-- Overview -->
          <el-tab-pane name="overview">
            <template #label>
              <span class="tab-label"><el-icon><Odometer /></el-icon> Overview</span>
            </template>
            <div class="tab-content">
              <ProjectDashboard
                :key="dashboardKey"
                :project-id="(route.params.id as string)"
                view="overview"
                @navigate-assessment="navigateToAssessment"
              />

              <!-- Upcoming Scheduled strip -->
              <div v-if="upcomingScheduled.length" class="upcoming-strip">
                <div class="upcoming-header">
                  <el-icon><Calendar /></el-icon>
                  <span>Upcoming Scheduled Assessments</span>
                </div>
                <div class="upcoming-list">
                  <div
                    v-for="item in upcomingScheduled.slice(0, 5)"
                    :key="item.id"
                    class="upcoming-item"
                    @click="openScheduleEdit(item)"
                  >
                    <div class="upcoming-dot" :style="{ background: scheduleStatusColor(item.status) }"></div>
                    <div class="upcoming-info">
                      <span class="upcoming-title">{{ item.title }}</span>
                      <span v-if="item.assessorName" class="upcoming-meta">{{ item.assessorName }}</span>
                    </div>
                    <div class="upcoming-date">{{ formatDate(item.scheduledDate) }}</div>
                    <el-tag size="small" :style="{ background: scheduleStatusColor(item.status) + '22', color: scheduleStatusColor(item.status), borderColor: scheduleStatusColor(item.status) + '44' }">
                      {{ scheduleStatusLabel(item.status) }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Timeline -->
          <el-tab-pane name="timeline">
            <template #label>
              <span class="tab-label">
                <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-2px"><rect x="1" y="2.5" width="9" height="2.5" rx="1.25" fill="currentColor"/><rect x="4" y="6.75" width="11" height="2.5" rx="1.25" fill="currentColor"/><rect x="2" y="11" width="8" height="2.5" rx="1.25" fill="currentColor"/></svg>
                Timeline
              </span>
            </template>
            <div class="tab-content">
              <!-- Legend -->
              <div class="timeline-legend">
                <span class="legend-item"><span class="ldot" style="background:var(--cat-accent-primary)"></span> In Progress</span>
                <span class="legend-item"><span class="ldot" style="background:var(--cat-success)"></span> Complete</span>
                <span class="legend-item"><span class="ldot" style="background:var(--cat-warning)"></span> On Hold</span>
                <span class="legend-item"><span class="ldot" style="background:var(--cat-text-tertiary)"></span> New</span>
                <span class="legend-sep">|</span>
                <span class="legend-item"><span class="ldot ldot-scheduled"></span> Scheduled (planned)</span>
                <span class="legend-item"><span class="ldot ldot-overdue-sched"></span> Overdue (scheduled)</span>
              </div>
              <ProjectDashboard
                :key="'tl-' + dashboardKey"
                :project-id="(route.params.id as string)"
                view="timeline"
                @navigate-assessment="navigateToAssessment"
              />

              <!-- Scheduled items on the same timeline concept -->
              <div v-if="scheduledItems.length" class="sched-timeline-section">
                <div class="sched-timeline-label">Planned / Scheduled</div>
                <div class="sched-timeline-rows">
                  <div
                    v-for="item in scheduledItems"
                    :key="item.id"
                    class="sched-row"
                    @click="openScheduleEdit(item)"
                  >
                    <div class="sched-row-label">
                      <span class="sched-row-title">{{ item.title }}</span>
                      <span v-if="item.assessorName" class="sched-row-assessor">{{ item.assessorName }}</span>
                    </div>
                    <div class="sched-row-dates">
                      {{ formatDate(item.scheduledDate) }}
                      <span v-if="item.dueDate"> → {{ formatDate(item.dueDate) }}</span>
                    </div>
                    <el-tag
                      size="small"
                      class="sched-status-tag"
                      :style="{ background: scheduleStatusColor(item.status) + '22', color: scheduleStatusColor(item.status), borderColor: scheduleStatusColor(item.status) + '55' }"
                    >
                      {{ scheduleStatusLabel(item.status) }}
                    </el-tag>
                    <el-tag v-if="item.recurrence !== 'none'" size="small" type="info" plain>
                      <el-icon><Refresh /></el-icon> {{ item.recurrence }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Schedule -->
          <el-tab-pane name="schedule">
            <template #label>
              <span class="tab-label">
                <el-icon><Calendar /></el-icon> Schedule
                <el-badge v-if="scheduledItems.length" :value="scheduledItems.length" class="tab-badge" />
              </span>
            </template>
            <div class="tab-content">
              <div class="schedule-tab-header">
                <div class="schedule-status-chips">
                  <div
                    v-for="s in SCHEDULE_STATUS_META"
                    :key="s.key"
                    class="status-chip"
                    :class="{ active: scheduleFilter === s.key }"
                    :style="scheduleFilter === s.key ? { background: s.color + '22', borderColor: s.color, color: s.color } : {}"
                    @click="scheduleFilter = scheduleFilter === s.key ? null : s.key"
                  >
                    <span class="chip-dot" :style="{ background: s.color }"></span>
                    {{ s.label }}
                    <span class="chip-count">{{ scheduledItems.filter(i => i.status === s.key).length }}</span>
                  </div>
                </div>
                <el-button type="primary" size="small" @click="openScheduleCreate">
                  <el-icon class="mr-1"><Plus /></el-icon> Schedule Assessment
                </el-button>
              </div>

              <div v-if="scheduleLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>Loading…</span>
              </div>

              <template v-else-if="filteredSchedule.length === 0">
                <el-empty description="No scheduled assessments for this project">
                  <el-button type="primary" @click="openScheduleCreate">Schedule one now</el-button>
                </el-empty>
              </template>

              <div v-else class="schedule-cards">
                <div
                  v-for="item in filteredSchedule"
                  :key="item.id"
                  class="schedule-card"
                  :class="'scard-' + item.status"
                  @click="openScheduleEdit(item)"
                >
                  <div class="scard-status-bar" :style="{ background: scheduleStatusColor(item.status) }"></div>
                  <div class="scard-body">
                    <div class="scard-header">
                      <span class="scard-title">{{ item.title }}</span>
                      <el-tag
                        size="small"
                        :style="{ background: scheduleStatusColor(item.status) + '22', color: scheduleStatusColor(item.status), borderColor: scheduleStatusColor(item.status) + '55' }"
                      >{{ scheduleStatusLabel(item.status) }}</el-tag>
                    </div>
                    <div class="scard-meta">
                      <span v-if="item.assessorName" class="scard-meta-item">
                        <el-icon><User /></el-icon> {{ item.assessorName }}
                      </span>
                      <span v-if="item.standardName" class="scard-meta-item">
                        <el-icon><Document /></el-icon> {{ item.standardName }}
                      </span>
                      <span class="scard-meta-item">
                        <el-icon><Calendar /></el-icon> {{ formatDate(item.scheduledDate) }}
                        <template v-if="item.dueDate"> → {{ formatDate(item.dueDate) }}</template>
                      </span>
                      <span v-if="item.recurrence !== 'none'" class="scard-meta-item">
                        <el-icon><Refresh /></el-icon> {{ item.recurrence }}
                      </span>
                    </div>
                    <p v-if="item.notes" class="scard-notes">{{ item.notes }}</p>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Assessments -->
          <el-tab-pane name="assessments">
            <template #label>
              <span class="tab-label"><el-icon><DocumentChecked /></el-icon> {{ t('nav.assessments') }}</span>
            </template>
            <div class="tab-content">
              <div class="tab-toolbar">
                <span class="tab-count">{{ assessments.length }} assessment{{ assessments.length !== 1 ? 's' : '' }}</span>
                <el-button type="primary" size="small" @click="showAssessmentDialog = true">
                  <el-icon><Plus /></el-icon> {{ t('assessments.newAssessment') }}
                </el-button>
              </div>
              <div v-if="assessmentsLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
              </div>
              <el-table v-else :data="assessments" stripe border @row-click="navigateToAssessment" class="clickable-table">
                <el-table-column prop="title" :label="t('assessments.titleField')" min-width="200" sortable />
                <el-table-column label="State" min-width="110">
                  <template #default="{ row }">
                    <StateBadge :state="row.state" />
                  </template>
                </el-table-column>
                <el-table-column label="Conformance" min-width="120" align="center">
                  <template #default="{ row }">
                    <span
                      v-if="row.conformanceScore != null"
                      class="score-badge"
                      :class="scoreClass(row.conformanceScore)"
                    >{{ Math.round(row.conformanceScore) }}%</span>
                    <span v-else class="no-score">—</span>
                  </template>
                </el-table-column>
                <el-table-column label="Due" min-width="130">
                  <template #default="{ row }">
                    <span :class="{ 'overdue-text': isAssessmentOverdue(row) }">
                      {{ formatDate(row.dueDate) || '—' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="Start" min-width="130">
                  <template #default="{ row }">{{ formatDate(row.startDate) || '—' }}</template>
                </el-table-column>
              </el-table>
              <div v-if="!assessmentsLoading && assessments.length === 0" class="no-data">
                {{ t('common.noData') }}
              </div>
            </div>
          </el-tab-pane>

          <!-- Standards -->
          <el-tab-pane name="standards">
            <template #label>
              <span class="tab-label"><el-icon><Document /></el-icon> {{ t('nav.standards') }}</span>
            </template>
            <div class="tab-content">
              <el-table :data="projectStandards" stripe border @row-click="navigateToStandard" class="clickable-table">
                <el-table-column prop="name" :label="t('standards.name')" min-width="250" sortable />
                <el-table-column prop="version" :label="t('standards.version')" min-width="100" />
                <el-table-column prop="owner" :label="t('standards.owner')" min-width="200" />
              </el-table>
              <div v-if="projectStandards.length === 0" class="no-data">{{ t('common.noData') }}</div>
            </div>
          </el-tab-pane>

          <!-- Settings -->
          <el-tab-pane name="settings">
            <template #label>
              <span class="tab-label"><el-icon><Setting /></el-icon> Settings</span>
            </template>
            <div class="tab-content settings-section">
              <el-descriptions :column="2" border label-class-name="desc-label">
                <el-descriptions-item label="Name">{{ project.name }}</el-descriptions-item>
                <el-descriptions-item label="State"><StateBadge :state="project.state" /></el-descriptions-item>
                <el-descriptions-item label="Start Date">{{ formatDate(project.startDate) || '—' }}</el-descriptions-item>
                <el-descriptions-item label="Due Date">{{ formatDate(project.dueDate) || '—' }}</el-descriptions-item>
                <el-descriptions-item label="Description" :span="2">{{ project.description || '—' }}</el-descriptions-item>
                <el-descriptions-item label="Standards" :span="2">
                  <div class="settings-standards">
                    <span v-for="std in projectStandards" :key="std.id" class="std-chip">
                      {{ std.name }}{{ std.version ? ` v${std.version}` : '' }}
                    </span>
                  </div>
                </el-descriptions-item>
                <el-descriptions-item v-if="projectTags.length" label="Tags" :span="2">
                  <span
                    v-for="tag in projectTags"
                    :key="tag.name"
                    class="tag-pill"
                    :style="tagPillStyle(tag.color)"
                  >{{ tag.name }}</span>
                </el-descriptions-item>
              </el-descriptions>
              <div class="settings-actions">
                <el-button @click="openEditDialog"><el-icon><EditIcon /></el-icon> Edit Project</el-button>
                <el-button @click="handleExportCycloneDX">Export CycloneDX</el-button>
                <el-button :loading="pdfExporting" @click="handleExportProjectPDF">Export PDF Report</el-button>
                <el-button type="danger" plain @click="handleArchiveProject">Archive Project</el-button>
              </div>
            </div>
          </el-tab-pane>

        </el-tabs>
      </div>
    </template>

    <!-- ── Edit Project Dialog ───────────────────────────────────── -->
    <el-dialog v-model="showEditDialog" :title="t('projects.editProject')" width="600px" @close="resetEditForm">
      <el-form :model="editForm" label-width="120px">
        <el-form-item :label="t('projects.name')" required>
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item :label="t('projects.description')">
          <el-input v-model="editForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item :label="t('projects.state')">
          <el-select v-model="editForm.state">
            <el-option :label="t('states.new')" value="new" />
            <el-option :label="t('states.in_progress')" value="in_progress" />
            <el-option :label="t('states.on_hold')" value="on_hold" />
            <el-option :label="t('states.complete')" value="complete" />
            <el-option :label="t('states.operational')" value="operational" />
            <el-option :label="t('states.retired')" value="retired" />
          </el-select>
        </el-form-item>
        <el-form-item label="Start Date">
          <el-date-picker v-model="editForm.startDate" type="date" class="w-full" clearable />
        </el-form-item>
        <el-form-item label="Due Date">
          <el-date-picker v-model="editForm.dueDate" type="date" class="w-full" clearable />
        </el-form-item>
        <el-form-item :label="t('projects.standards')">
          <el-select v-model="editForm.standardIds" multiple :placeholder="t('projects.selectStandards')" class="w-full">
            <el-option v-for="std in availableStandards" :key="std.id" :label="`${std.name} ${std.version ? 'v' + std.version : ''}`" :value="std.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.tags')">
          <TagInput v-model="editForm.tags" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveProject">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- ── New Assessment Dialog ─────────────────────────────────── -->
    <el-dialog v-model="showAssessmentDialog" :title="t('assessments.newAssessment')" width="500px" @close="resetAssessmentForm">
      <el-form :model="assessmentForm" label-width="120px">
        <el-form-item :label="t('assessments.titleField')" required>
          <el-input v-model="assessmentForm.title" />
        </el-form-item>
        <el-form-item :label="t('common.description')">
          <el-input v-model="assessmentForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item :label="t('assessments.dueDate')">
          <el-date-picker v-model="assessmentForm.dueDate" type="date" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAssessmentDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="assessmentSaving" @click="createAssessmentAction">{{ t('common.create') }}</el-button>
      </template>
    </el-dialog>

    <!-- ── Schedule Create/Edit Dialog ──────────────────────────── -->
    <el-dialog
      v-model="scheduleDialogVisible"
      :title="editingSchedule ? 'Edit Scheduled Assessment' : 'Schedule Assessment'"
      width="560px"
      :close-on-click-modal="false"
      @closed="resetScheduleForm"
    >
      <el-form ref="scheduleFormRef" :model="scheduleForm" :rules="scheduleFormRules" label-width="130px" label-position="left">
        <el-form-item label="Title" prop="title">
          <el-input v-model="scheduleForm.title" placeholder="Assessment title" maxlength="255" show-word-limit />
        </el-form-item>
        <el-form-item label="Assessor">
          <el-select v-model="scheduleForm.assessorId" placeholder="Assign assessor" clearable style="width:100%">
            <el-option v-for="u in assessorOptions" :key="u.id" :label="u.displayName" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="Standard">
          <el-select v-model="scheduleForm.standardId" placeholder="Select standard (optional)" clearable style="width:100%">
            <el-option v-for="s in projectStandards" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="Scheduled Date" prop="scheduledDate">
          <el-date-picker v-model="scheduleForm.scheduledDate" type="date" placeholder="Start date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="Due Date">
          <el-date-picker v-model="scheduleForm.dueDate" type="date" placeholder="Due date (optional)" format="YYYY-MM-DD" value-format="YYYY-MM-DD" style="width:100%" />
        </el-form-item>
        <el-form-item label="Recurrence">
          <el-select v-model="scheduleForm.recurrence" style="width:100%">
            <el-option label="None (one-time)" value="none" />
            <el-option label="Weekly" value="weekly" />
            <el-option label="Monthly" value="monthly" />
            <el-option label="Quarterly" value="quarterly" />
            <el-option label="Yearly" value="yearly" />
          </el-select>
        </el-form-item>
        <el-form-item label="Status">
          <el-select v-model="scheduleForm.status" style="width:100%">
            <el-option v-for="s in SCHEDULE_STATUS_META" :key="s.key" :label="s.label" :value="s.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="Notes">
          <el-input v-model="scheduleForm.notes" type="textarea" :rows="2" placeholder="Internal notes" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button v-if="editingSchedule" type="danger" plain @click="handleScheduleDelete">Delete</el-button>
          <div class="footer-right">
            <el-button @click="scheduleDialogVisible = false">Cancel</el-button>
            <el-button type="primary" :loading="scheduleSaving" @click="handleScheduleSave">
              {{ editingSchedule ? 'Save Changes' : 'Schedule' }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ArrowRight, Loading, Edit as EditIcon, Odometer, Calendar, Clock,
  Document, DocumentChecked, WarningFilled, Plus, Refresh, User,
  Setting, MoreFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import type { Project, Standard, Assessment, Tag, ScheduledAssessment, ScheduledAssessmentStatus } from '@/types'
import StateBadge from '@/components/shared/StateBadge.vue'
import TagInput from '@/components/shared/TagInput.vue'
import ProjectDashboard from '@/components/shared/ProjectDashboard.vue'
import { tagPillStyle } from '@/utils/tagColor'
import {
  getScheduledAssessments,
  createScheduledAssessment,
  updateScheduledAssessment,
  deleteScheduledAssessment,
} from '@/api/scheduler'
import client from '@/api/client'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

// ── Project data ─────────────────────────────────────────────────────

const loading = ref(true)
const error = ref('')
const pdfExporting = ref(false)
const project = ref<(Project & { startDate?: string; dueDate?: string }) | null>(null)
const projectStandards = ref<Standard[]>([])
const projectTags = ref<Tag[]>([])
const assessments = ref<Assessment[]>([])
const assessmentsLoading = ref(true)
const activeTab = ref('overview')
const dashboardKey = ref(0)

const refreshDashboard = () => { dashboardKey.value++ }

// ── Stats from dashboard endpoint ────────────────────────────────────

const stats = ref<{
  assessmentCompletion: { total: number; completed: number; inProgress: number; percent: number }
  timeline: { projectDueDate: string | null; overdue: number; upcomingDueDates: Array<{ id: string; title: string; dueDate: string; state: string }> }
  evidenceCoverage: { totalRequirements: number; requirementsWithEvidence: number; totalEvidenceItems: number; percent: number | null }
  conformance: { averageScore: number | null; assessments: Array<{ id: string; title: string; score: number; state: string }> }
  warnings: Array<{ type: string; severity: 'critical' | 'warning' | 'info'; message: string; assessmentId?: string }>
} | null>(null)

async function fetchStats() {
  try {
    const { data } = await client.get(`/projects/${encodeURIComponent(String(route.params.id))}/stats`)
    stats.value = data
  } catch { /* non-fatal */ }
}

// ── KPI classes ──────────────────────────────────────────────────────

const kpiCompletionClass = computed(() => {
  const p = stats.value?.assessmentCompletion.percent ?? 0
  return p === 100 ? 'kpi-success' : p >= 50 ? 'kpi-primary' : 'kpi-warning'
})
const kpiConformanceClass = computed(() => {
  const s = stats.value?.conformance.averageScore
  if (s == null) return ''
  return s >= 80 ? 'kpi-success' : s >= 50 ? 'kpi-warning' : 'kpi-danger'
})
const kpiEvidenceClass = computed(() => {
  const p = stats.value?.evidenceCoverage.percent
  if (p == null) return ''
  return p >= 80 ? 'kpi-success' : p >= 50 ? 'kpi-warning' : 'kpi-danger'
})
const kpiScheduleClass = computed(() => overdueScheduled.value.length > 0 ? 'kpi-danger' : upcomingScheduled.value.length > 0 ? 'kpi-primary' : '')
const kpiWarningClass = computed(() => {
  const c = stats.value?.warnings.filter(w => w.severity === 'critical').length ?? 0
  return c > 0 ? 'kpi-danger' : stats.value?.warnings.length ? 'kpi-warning' : 'kpi-success'
})

const isOverdue = computed(() => {
  if (!project.value?.dueDate) return false
  return new Date(project.value.dueDate) < new Date()
})

// ── Schedule data ────────────────────────────────────────────────────

const SCHEDULE_STATUS_META = [
  { key: 'scheduled' as ScheduledAssessmentStatus, label: 'Scheduled', color: '#909399' },
  { key: 'in_progress' as ScheduledAssessmentStatus, label: 'In Progress', color: '#409EFF' },
  { key: 'on_hold' as ScheduledAssessmentStatus, label: 'On Hold', color: '#E6A23C' },
  { key: 'warning' as ScheduledAssessmentStatus, label: 'Warning', color: '#F56C6C' },
  { key: 'complete' as ScheduledAssessmentStatus, label: 'Complete', color: '#67C23A' },
  { key: 'failed' as ScheduledAssessmentStatus, label: 'Failed', color: '#C0392B' },
]

const scheduleLoading = ref(false)
const scheduledItems = ref<ScheduledAssessment[]>([])
const scheduleFilter = ref<ScheduledAssessmentStatus | null>(null)
const assessorOptions = ref<{ id: string; displayName: string }[]>([])

const filteredSchedule = computed(() =>
  scheduleFilter.value
    ? scheduledItems.value.filter(i => i.status === scheduleFilter.value)
    : scheduledItems.value
)

const now = new Date()
const upcomingScheduled = computed(() =>
  scheduledItems.value
    .filter(i => new Date(i.scheduledDate) >= now && i.status !== 'complete' && i.status !== 'failed')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
)
const overdueScheduled = computed(() =>
  scheduledItems.value.filter(i => {
    const due = i.dueDate || i.scheduledDate
    return new Date(due) < now && i.status !== 'complete' && i.status !== 'failed'
  })
)

function scheduleStatusColor(status: ScheduledAssessmentStatus) {
  return SCHEDULE_STATUS_META.find(s => s.key === status)?.color ?? '#909399'
}
function scheduleStatusLabel(status: ScheduledAssessmentStatus) {
  return SCHEDULE_STATUS_META.find(s => s.key === status)?.label ?? status
}

async function fetchScheduledItems() {
  scheduleLoading.value = true
  try {
    scheduledItems.value = await getScheduledAssessments({ projectId: route.params.id as string })
  } catch { /* non-fatal */ } finally {
    scheduleLoading.value = false
  }
}

async function fetchAssessorOptions() {
  try {
    const { data } = await client.get('/users', { params: { pageSize: 200 } })
    assessorOptions.value = (data.data ?? []).map((u: { id: string; displayName?: string; username: string }) => ({
      id: u.id,
      displayName: u.displayName || u.username,
    }))
  } catch { /* non-fatal */ }
}

// ── Schedule dialog ──────────────────────────────────────────────────

const scheduleDialogVisible = ref(false)
const scheduleSaving = ref(false)
const editingSchedule = ref<ScheduledAssessment | null>(null)
const scheduleFormRef = ref<FormInstance>()

const scheduleForm = ref({
  title: '',
  assessorId: null as string | null,
  standardId: null as string | null,
  scheduledDate: '',
  dueDate: null as string | null,
  recurrence: 'none',
  status: 'scheduled' as ScheduledAssessmentStatus,
  notes: '',
})

const scheduleFormRules: FormRules = {
  title: [{ required: true, message: 'Title is required', trigger: 'blur' }],
  scheduledDate: [{ required: true, message: 'Date is required', trigger: 'change' }],
}

function openScheduleCreate() {
  editingSchedule.value = null
  scheduleForm.value = {
    title: '',
    assessorId: null,
    standardId: projectStandards.value[0]?.id ?? null,
    scheduledDate: new Date().toISOString().slice(0, 10),
    dueDate: null,
    recurrence: 'none',
    status: 'scheduled',
    notes: '',
  }
  scheduleDialogVisible.value = true
}

function openScheduleEdit(item: ScheduledAssessment) {
  editingSchedule.value = item
  scheduleForm.value = {
    title: item.title,
    assessorId: item.assessorId ?? null,
    standardId: item.standardId ?? null,
    scheduledDate: item.scheduledDate.slice(0, 10),
    dueDate: item.dueDate ? item.dueDate.slice(0, 10) : null,
    recurrence: item.recurrence,
    status: item.status,
    notes: item.notes ?? '',
  }
  scheduleDialogVisible.value = true
}

function resetScheduleForm() {
  editingSchedule.value = null
  scheduleFormRef.value?.clearValidate()
}

async function handleScheduleSave() {
  const valid = await scheduleFormRef.value?.validate().catch(() => false)
  if (!valid) return
  scheduleSaving.value = true
  try {
    const payload = {
      title: scheduleForm.value.title,
      projectId: route.params.id as string,
      assessorId: scheduleForm.value.assessorId || null,
      standardId: scheduleForm.value.standardId || null,
      scheduledDate: scheduleForm.value.scheduledDate,
      dueDate: scheduleForm.value.dueDate || null,
      recurrence: scheduleForm.value.recurrence as ScheduledAssessment['recurrence'],
      status: scheduleForm.value.status,
      notes: scheduleForm.value.notes || null,
    }
    if (editingSchedule.value) {
      await updateScheduledAssessment(editingSchedule.value.id, payload)
      ElMessage.success('Scheduled assessment updated')
    } else {
      await createScheduledAssessment(payload as Parameters<typeof createScheduledAssessment>[0])
      ElMessage.success('Assessment scheduled')
    }
    scheduleDialogVisible.value = false
    await fetchScheduledItems()
    refreshDashboard()
  } catch {
    ElMessage.error('Failed to save')
  } finally {
    scheduleSaving.value = false
  }
}

async function handleScheduleDelete() {
  if (!editingSchedule.value) return
  await ElMessageBox.confirm(
    `Delete "${editingSchedule.value.title}"?`,
    'Confirm Delete',
    { type: 'warning', confirmButtonText: 'Delete', confirmButtonClass: 'el-button--danger' }
  )
  try {
    await deleteScheduledAssessment(editingSchedule.value.id)
    ElMessage.success('Deleted')
    scheduleDialogVisible.value = false
    await fetchScheduledItems()
  } catch {
    ElMessage.error('Failed to delete')
  }
}

// ── Project fetch ─────────────────────────────────────────────────────

onMounted(async () => {
  await fetchProject()
  await Promise.all([fetchAssessments(), fetchStats(), fetchScheduledItems(), fetchAssessorOptions()])
})

async function fetchProject() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await client.get(`/projects/${encodeURIComponent(String(route.params.id))}`)
    project.value = data.project
    projectStandards.value = data.standards || []
    projectTags.value = data.tags || []
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    error.value = e.response?.data?.error || 'Failed to load project'
  } finally {
    loading.value = false
  }
}

async function fetchAssessments() {
  assessmentsLoading.value = true
  try {
    const { data } = await client.get('/assessments', { params: { projectId: route.params.id } })
    assessments.value = data.data || []
  } catch { /* non-fatal */ } finally {
    assessmentsLoading.value = false
  }
}

// ── Assessment helpers ───────────────────────────────────────────────

function scoreClass(score: number) {
  return score >= 80 ? 'score-good' : score >= 50 ? 'score-warn' : 'score-bad'
}
function isAssessmentOverdue(row: Assessment) {
  return row.dueDate && new Date(row.dueDate) < new Date() && row.state !== 'complete' && row.state !== 'archived'
}

// ── Edit project ──────────────────────────────────────────────────────

const showEditDialog = ref(false)
const editSaving = ref(false)
const availableStandards = ref<Standard[]>([])
const editForm = ref({ name: '', description: '', state: 'new', standardIds: [] as string[], tags: [] as string[], startDate: null as Date | null, dueDate: null as Date | null })

async function openEditDialog() {
  editForm.value = {
    name: project.value?.name || '',
    description: project.value?.description || '',
    state: project.value?.state || 'new',
    standardIds: projectStandards.value.map(s => s.id),
    tags: projectTags.value.map(t => t.name),
    startDate: project.value?.startDate ? new Date(project.value.startDate) : null,
    dueDate: project.value?.dueDate ? new Date(project.value.dueDate) : null,
  }
  try {
    const { data } = await client.get('/standards')
    availableStandards.value = data.data || []
  } catch { /* non-fatal */ }
  showEditDialog.value = true
}

async function saveProject() {
  if (!editForm.value.name) { ElMessage.error('Name is required'); return }
  if (!editForm.value.standardIds.length) { ElMessage.error('At least one standard is required'); return }
  editSaving.value = true
  try {
    await client.put(`/projects/${encodeURIComponent(String(route.params.id))}`, {
      name: editForm.value.name,
      description: editForm.value.description,
      state: editForm.value.state,
      standardIds: editForm.value.standardIds,
      tags: editForm.value.tags,
      startDate: editForm.value.startDate ? new Date(editForm.value.startDate).toISOString().split('T')[0] : null,
      dueDate: editForm.value.dueDate ? new Date(editForm.value.dueDate).toISOString().split('T')[0] : null,
    })
    ElMessage.success(t('projects.projectUpdated'))
    showEditDialog.value = false
    await fetchProject()
    refreshDashboard()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to update project')
  } finally {
    editSaving.value = false
  }
}

function resetEditForm() {
  editForm.value = { name: '', description: '', state: 'new', standardIds: [], tags: [], startDate: null, dueDate: null }
}

// ── New assessment ────────────────────────────────────────────────────

const showAssessmentDialog = ref(false)
const assessmentSaving = ref(false)
const assessmentForm = ref({ title: '', description: '', dueDate: null as Date | null })

async function createAssessmentAction() {
  if (!assessmentForm.value.title) { ElMessage.error('Title is required'); return }
  assessmentSaving.value = true
  try {
    await client.post('/assessments', {
      title: assessmentForm.value.title,
      description: assessmentForm.value.description || undefined,
      projectId: route.params.id,
      dueDate: assessmentForm.value.dueDate ? assessmentForm.value.dueDate.toISOString().split('T')[0] : null,
    })
    ElMessage.success(t('assessments.assessmentCreated'))
    showAssessmentDialog.value = false
    resetAssessmentForm()
    await fetchAssessments()
    refreshDashboard()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error || 'Failed to create assessment')
  } finally {
    assessmentSaving.value = false
  }
}

function resetAssessmentForm() {
  assessmentForm.value = { title: '', description: '', dueDate: null }
}

// ── Archive / Export ──────────────────────────────────────────────────

async function handleArchiveProject() {
  try {
    await ElMessageBox.confirm(t('projects.confirmArchive'), t('projects.archiveProject'), { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
    await client.post(`/projects/${encodeURIComponent(String(route.params.id))}/archive`)
    ElMessage.success(t('projects.projectArchived'))
    await fetchProject()
  } catch (e: unknown) {
    if (e !== 'cancel') ElMessage.error(t('common.errorOccurred'))
  }
}

function handleExportCycloneDX() {
  window.open(`/api/v1/export/project/${encodeURIComponent(String(route.params.id))}`, '_blank')
}

async function handleExportProjectPDF() {
  pdfExporting.value = true
  try {
    const response = await client.get(`/export/project/${encodeURIComponent(String(route.params.id))}/pdf`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.value?.name || 'project'}-report.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    ElMessage.success('Report exported')
  } catch {
    ElMessage.error('Failed to export report')
  } finally {
    pdfExporting.value = false
  }
}

// ── Shared ────────────────────────────────────────────────────────────

function formatDate(date: string | null | undefined) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function navigateToAssessment(rowOrId: string | Assessment) {
  const id = typeof rowOrId === 'string' ? rowOrId : rowOrId.id
  router.push(`/assessments/${id}`)
}

function navigateToStandard(row: Standard) {
  router.push(`/standards/${row.id}`)
}
</script>

<style scoped lang="scss">
.project-detail-container {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

// ── Breadcrumb ────────────────────────────────────────────────────────
.project-breadcrumb {
  padding: 12px 24px;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-secondary);
}

// ── Hero ──────────────────────────────────────────────────────────────
.project-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-secondary);
}

.hero-left {
  flex: 1;
  min-width: 0;
}

.hero-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.project-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--cat-text-primary);
  margin: 0;
  line-height: 1.2;
}

.overdue-tag {
  display: flex;
  align-items: center;
  gap: 4px;
}

.project-description {
  font-size: 13px;
  color: var(--cat-text-secondary);
  margin: 0 0 8px;
  line-height: 1.5;
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--cat-text-secondary);

  .el-icon {
    font-size: 12px;
  }
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

// ── KPI ribbon ────────────────────────────────────────────────────────
.kpi-ribbon {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-surface);
}

.kpi-card {
  flex: 1;
  padding: 14px 16px;
  border-right: 1px solid var(--cat-border-default);
  text-align: center;
  transition: background 0.15s;

  &:last-child { border-right: none; }

  &.kpi-success  { background: color-mix(in srgb, var(--cat-success) 6%, transparent); }
  &.kpi-primary  { background: color-mix(in srgb, var(--cat-accent-primary) 6%, transparent); }
  &.kpi-warning  { background: color-mix(in srgb, var(--cat-warning) 8%, transparent); }
  &.kpi-danger   { background: color-mix(in srgb, var(--cat-danger) 8%, transparent); }
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--cat-text-primary);
  line-height: 1.1;
}

.kpi-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--cat-text-secondary);
  margin: 3px 0 2px;
}

.kpi-sub {
  font-size: 11px;
  color: var(--cat-text-tertiary);
}

// ── Tabs ──────────────────────────────────────────────────────────────
.main-tabs-card {
  flex: 1;
  padding: 0 24px 24px;
  background: var(--cat-bg-primary);
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;

  .tab-badge {
    margin-left: 4px;
  }
}

.tab-content {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

// ── Upcoming strip (Overview tab) ─────────────────────────────────────
.upcoming-strip {
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  overflow: hidden;
}

.upcoming-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--cat-fill-color-light, var(--cat-bg-secondary));
  font-size: 13px;
  font-weight: 600;
  color: var(--cat-text-primary);
  border-bottom: 1px solid var(--cat-border-default);
}

.upcoming-list {
  display: flex;
  flex-direction: column;
}

.upcoming-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cat-border-color-lighter, var(--cat-border-default));
  cursor: pointer;
  transition: background 0.1s;

  &:last-child { border-bottom: none; }
  &:hover { background: var(--cat-bg-hover); }
}

.upcoming-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.upcoming-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.upcoming-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upcoming-meta {
  font-size: 11px;
  color: var(--cat-text-secondary);
}

.upcoming-date {
  font-size: 12px;
  color: var(--cat-text-secondary);
  white-space: nowrap;
}

// ── Timeline tab additions ────────────────────────────────────────────
.timeline-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--cat-text-secondary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ldot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;

  &.ldot-scheduled {
    background: #909399;
    border: 1px dashed #555;
  }

  &.ldot-overdue-sched {
    background: #C0392B;
  }
}

.legend-sep {
  color: var(--cat-border-default);
}

.sched-timeline-section {
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  overflow: hidden;
}

.sched-timeline-label {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cat-text-secondary);
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sched-timeline-rows {
  display: flex;
  flex-direction: column;
}

.sched-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cat-border-color-lighter, var(--cat-border-default));
  cursor: pointer;
  transition: background 0.1s;

  &:last-child { border-bottom: none; }
  &:hover { background: var(--cat-bg-hover); }
}

.sched-row-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sched-row-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--cat-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sched-row-assessor {
  font-size: 11px;
  color: var(--cat-text-secondary);
}

.sched-row-dates {
  font-size: 12px;
  color: var(--cat-text-secondary);
  white-space: nowrap;
}

.sched-status-tag { white-space: nowrap; }

// ── Schedule tab ──────────────────────────────────────────────────────
.schedule-tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.schedule-status-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.status-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--cat-border-default);
  color: var(--cat-text-secondary);
  transition: all 0.15s;
  user-select: none;

  &:hover { opacity: 0.8; }
}

.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.chip-count {
  font-size: 11px;
  opacity: 0.7;
}

.schedule-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.schedule-card {
  display: flex;
  border: 1px solid var(--cat-border-default);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.1s;

  &:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    transform: translateY(-1px);
  }
}

.scard-status-bar {
  width: 4px;
  flex-shrink: 0;
}

.scard-body {
  flex: 1;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.scard-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cat-text-primary);
  line-height: 1.3;
}

.scard-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scard-meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--cat-text-secondary);
}

.scard-notes {
  font-size: 11px;
  color: var(--cat-text-tertiary);
  margin: 0;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

// ── Assessments tab ───────────────────────────────────────────────────
.tab-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tab-count {
  font-size: 13px;
  color: var(--cat-text-secondary);
}

.score-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;

  &.score-good { background: color-mix(in srgb, var(--cat-success) 15%, transparent); color: var(--cat-success); }
  &.score-warn { background: color-mix(in srgb, var(--cat-warning) 15%, transparent); color: var(--cat-warning); }
  &.score-bad  { background: color-mix(in srgb, var(--cat-danger) 15%, transparent); color: var(--cat-danger); }
}

.no-score { color: var(--cat-text-tertiary); }

.overdue-text {
  color: var(--cat-danger);
  font-weight: 500;
}

// ── Settings tab ──────────────────────────────────────────────────────
.settings-section {
  gap: 20px;
}

.settings-standards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.std-chip {
  padding: 2px 10px;
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: 12px;
  font-size: 12px;
  color: var(--cat-text-primary);
}

.settings-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 8px;
}

// ── Shared ────────────────────────────────────────────────────────────
.tag-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px;
  color: var(--cat-text-secondary);
}

.tab-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--cat-text-secondary);
}

.no-data {
  text-align: center;
  padding: 32px;
  color: var(--cat-text-tertiary);
}

.m-24 { margin: 24px; }
.mr-1 { margin-right: 4px; }
.ml-1 { margin-left: 4px; }
.w-full { width: 100%; }

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer-right {
  display: flex;
  gap: 8px;
}

:deep(.desc-label) {
  font-size: 12px;
  font-weight: 500;
  color: var(--cat-text-secondary);
  white-space: nowrap;
}

:deep(.el-table tbody tr) {
  cursor: pointer;
  &:hover > td { background-color: var(--cat-bg-hover) !important; }
}

.clickable-table :deep(tbody tr) { cursor: pointer; }

:deep(.project-tabs .el-tabs__header) {
  margin-bottom: 0;
  padding-top: 4px;
}
</style>
