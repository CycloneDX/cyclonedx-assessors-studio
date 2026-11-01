<template>
  <div class="req-detail-container">
    <div class="req-detail-header">
      <el-breadcrumb :separator-icon="ArrowRight">
        <el-breadcrumb-item :to="{ path: '/assessments' }">Assessments</el-breadcrumb-item>
        <el-breadcrumb-item :to="{ path: `/assessments/${assessmentId}` }">
          {{ assessment?.title || 'Assessment' }}
        </el-breadcrumb-item>
        <el-breadcrumb-item>{{ requirement?.identifier || 'Requirement' }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <div v-if="isLoading" class="loading-state">
      <el-skeleton :rows="8" animated />
    </div>
    <el-alert v-else-if="loadError" type="error" show-icon :closable="false">{{ loadError }}</el-alert>

    <template v-else-if="requirement">
      <!-- Page title bar -->
      <div class="req-page-header">
        <div class="req-page-title">
          <div class="record-type">Control Requirement</div>
          <div class="record-name">
            <el-tag size="small" class="mono-tag">{{ requirement.identifier }}</el-tag>
            {{ requirement.title || requirement.name }}
          </div>
        </div>
        <div class="req-page-actions">
          <el-button :disabled="isReadOnly" @click="handleSave">
            <el-icon><RefreshRight /></el-icon> Update
          </el-button>
          <el-button type="success" :disabled="isReadOnly" @click="handleMarkComplete">
            <el-icon><CircleCheck /></el-icon> Mark Complete
          </el-button>
        </div>
      </div>

      <!-- ── REQUIREMENT DETAILS ── -->
      <el-card class="detail-card">
        <template #header>
          <div class="card-head">
            <div class="card-head-title"><el-icon><Document /></el-icon> Requirement Details</div>
            <el-tag type="info" size="small" class="mono-tag">{{ requirement.identifier }}</el-tag>
          </div>
        </template>
        <div class="form-grid">
          <div class="field span-2">
            <label class="field-label">Description</label>
            <div class="description-box">{{ requirement.description || '—' }}</div>
          </div>
          <div class="field">
            <label class="field-label">Status</label>
            <div class="flex-row gap-8">
              <el-tag :type="resultTagType(form.result)" size="large">
                <el-icon><component :is="resultIcon(form.result)" /></el-icon>
                {{ form.result ? resultLabel(form.result) : 'Not assessed' }}
              </el-tag>
              <el-select v-model="form.result" :disabled="isReadOnly" placeholder="Change status" size="small" style="max-width:160px">
                <el-option label="Yes" value="yes" />
                <el-option label="No" value="no" />
                <el-option label="Partial" value="partial" />
                <el-option label="Not Applicable" value="not_applicable" />
              </el-select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">Framework / Standard</label>
            <div class="readonly-chip">{{ standardName || '—' }}</div>
          </div>
          <div class="field">
            <label class="field-label">Requirement ID</label>
            <div class="readonly-chip mono">{{ requirement.identifier }}</div>
          </div>
          <div class="field">
            <label class="field-label">Requirement Name</label>
            <div class="readonly-chip">{{ requirement.title || requirement.name }}</div>
          </div>
        </div>
      </el-card>

      <!-- ── OWNERSHIP & ENTITY ── -->
      <el-card class="detail-card">
        <template #header>
          <div class="card-head">
            <div class="card-head-title"><el-icon><OfficeBuilding /></el-icon> Ownership &amp; Entity</div>
          </div>
        </template>
        <div class="form-grid three-col">
          <div class="field">
            <label class="field-label">Owner</label>
            <el-input v-model="form.owner" placeholder="Requirement owner name" :disabled="isReadOnly" />
            <span class="field-hint">Primary accountable person</span>
          </div>
          <div class="field">
            <label class="field-label">Owner Email</label>
            <el-input v-model="form.ownerEmail" placeholder="owner@company.com" :disabled="isReadOnly" />
          </div>
          <div class="field">
            <label class="field-label">Owner Role</label>
            <el-input v-model="form.ownerRole" placeholder="e.g. CISO, Security Lead" :disabled="isReadOnly" />
          </div>
          <div class="field">
            <label class="field-label">OE Entity</label>
            <el-input v-model="form.oeEntity" placeholder="Organisational entity" :disabled="isReadOnly" />
          </div>
          <div class="field">
            <label class="field-label">Business Unit</label>
            <el-input v-model="form.businessUnit" placeholder="e.g. Product Engineering" :disabled="isReadOnly" />
          </div>
          <div class="field">
            <label class="field-label">Region</label>
            <el-select v-model="form.region" placeholder="— Select region —" :disabled="isReadOnly" class="w-full" clearable>
              <el-option label="Global" value="Global" />
              <el-option label="Americas" value="Americas" />
              <el-option label="EMEA" value="EMEA" />
              <el-option label="APAC" value="APAC" />
            </el-select>
          </div>
        </div>
      </el-card>

      <!-- ── ASSESSMENT + WORK NOTES TABS ── -->
      <el-card class="detail-card">
        <el-tabs v-model="activeTab">
          <!-- Requirement tab -->
          <el-tab-pane name="assessment">
            <template #label><span><el-icon><DocumentChecked /></el-icon> Requirement</span></template>
            <div class="form-grid">
              <div class="field">
                <label class="field-label">Result <span class="required">*</span></label>
                <el-select v-model="form.result" placeholder="— Select —" :disabled="isReadOnly" class="w-full">
                  <el-option label="Yes" value="yes" />
                  <el-option label="No" value="no" />
                  <el-option label="Partial" value="partial" />
                  <el-option label="Not Applicable" value="not_applicable" />
                </el-select>
              </div>
              <div class="field">
                <label class="field-label">Assessed By</label>
                <el-input v-model="form.assessedBy" placeholder="Assessor name" :disabled="isReadOnly" />
              </div>
              <div class="field">
                <label class="field-label">Assessment Date</label>
                <el-input v-model="form.assessmentDate" placeholder="YYYY-MM-DD" :disabled="isReadOnly" />
              </div>
              <div class="field">
                <label class="field-label">Next Review Date</label>
                <el-input v-model="form.nextReviewDate" placeholder="YYYY-MM-DD" :disabled="isReadOnly" />
              </div>
              <div class="field span-2">
                <label class="field-label">
                  Rationale <span class="required">*</span>
                  <span class="word-count" :class="{ weak: rationaleWordCount < 15 && rationaleWordCount > 0, ok: rationaleWordCount >= 15 }">
                    {{ rationaleWordCount }} / 15 words
                  </span>
                </label>
                <el-input v-model="form.rationale" type="textarea" :rows="4"
                  placeholder="Describe why this result was selected…" :disabled="isReadOnly" />
                <div v-if="rationaleWordCount > 0 && rationaleWordCount < 15" class="field-warning">
                  <el-icon><Warning /></el-icon>
                  Rationale should be at least 15 words ({{ rationaleWordCount }} / 15)
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Work Notes tab -->
          <el-tab-pane name="worknotes">
            <template #label>
              <span>
                <el-icon><Memo /></el-icon> Work Notes
                <el-badge v-if="workNotes.length > 0" :value="workNotes.length" class="tab-badge" />
              </span>
            </template>
            <div class="work-notes-section">
              <el-button v-if="!isReadOnly" type="primary" size="small" class="mb-4" @click="showAddNoteDialog = true">
                Add Work Note
              </el-button>
              <div v-if="isLoadingNotes" class="loading-state"><el-skeleton :rows="2" animated /></div>
              <div v-else-if="workNotes.length === 0" class="empty-state">
                <el-icon :size="32"><Memo /></el-icon>
                <p>No work notes yet.</p>
              </div>
              <div v-else class="work-notes-list">
                <div v-for="note in workNotes" :key="note.id" class="work-note-item">
                  <div class="work-note-header">
                    <div class="work-note-avatar">{{ initials(note.authorName || '?') }}</div>
                    <div class="work-note-meta">
                      <span class="work-note-author">{{ note.authorName || 'Unknown' }}</span>
                      <span class="work-note-date">{{ formatDate(note.createdAt) }}</span>
                    </div>
                  </div>
                  <div class="work-note-body">{{ note.content }}</div>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <div class="card-footer-actions">
          <el-button :disabled="isReadOnly" @click="handleSave">
            <el-icon><RefreshRight /></el-icon> Update
          </el-button>
          <el-button type="success" :disabled="isReadOnly" @click="handleMarkComplete">
            <el-icon><CircleCheck /></el-icon> Mark Complete
          </el-button>
        </div>
      </el-card>

      <!-- ── EVIDENCE ── -->
      <el-card class="detail-card">
        <template #header>
          <div class="card-head">
            <div class="card-head-title">
              <el-icon><FolderOpened /></el-icon> Evidences
              <el-badge v-if="linkedEvidence.length > 0" :value="linkedEvidence.length" />
            </div>
            <el-button size="small" @click="goToAssessmentEvidence">
              <el-icon><Plus /></el-icon> Add Evidence
            </el-button>
          </div>
        </template>
        <div v-if="isLoadingEvidence" class="loading-state"><el-skeleton :rows="2" animated /></div>
        <div v-else-if="linkedEvidence.length === 0" class="empty-state">
          <p>No evidence linked to this requirement. Use the assessment page to link evidence.</p>
        </div>
        <template v-else>
          <el-table :data="linkedEvidence" border stripe class="clickable-table" @row-click="navigateToEvidence">
            <el-table-column type="selection" width="40" />
            <el-table-column label="Evidence" min-width="160">
              <template #default="{ row }">
                <span class="evidence-link">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Name" min-width="160">
              <template #default="{ row }">
                <span class="evidence-link">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Description" min-width="200">
              <template #default="{ row }">
                <span class="text-secondary">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Type" width="150">
              <template #default="{ row }">
                <el-tag :type="row.isCounterEvidence ? '' : 'info'" size="small">
                  {{ row.isCounterEvidence ? 'Counter Evidence' : 'Proof' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="State" width="140">
              <template #default="{ row }">
                <el-tag :type="evidenceStateType(row.state)" size="small">{{ evidenceStateLabel(row.state) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Reviewer" min-width="140">
              <template #default="{ row }">{{ row.reviewerName || '—' }}</template>
            </el-table-column>
          </el-table>
          <div class="evidence-count">{{ linkedEvidence.length }} record{{ linkedEvidence.length !== 1 ? 's' : '' }}</div>
        </template>
      </el-card>

      <!-- ── JSON OUTPUT ── -->
      <el-card class="detail-card">
        <template #header>
          <div class="card-head">
            <div class="card-head-title"><el-icon><DataLine /></el-icon> JSON Output</div>
            <div class="flex-row gap-8">
              <el-button size="small" @click="copyJson"><el-icon><CopyDocument /></el-icon> Copy</el-button>
              <el-button size="small" @click="downloadJson"><el-icon><Download /></el-icon> Download</el-button>
            </div>
          </div>
        </template>
        <div class="json-preview">
          <pre v-html="highlightedJson"></pre>
        </div>
      </el-card>
    </template>

    <!-- Add work note dialog -->
    <el-dialog v-model="showAddNoteDialog" title="Add Work Note" width="480px">
      <el-form label-position="top">
        <el-form-item label="Note">
          <el-input v-model="newNoteContent" type="textarea" :rows="4" placeholder="Write your work note here…" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddNoteDialog = false">Cancel</el-button>
        <el-button type="primary" :loading="savingNote" @click="handleAddNote">Post Note</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import client from '@/api/client'
import { ElMessage } from 'element-plus'
import {
  ArrowRight, Document, DocumentChecked, FolderOpened,
  RefreshRight, CircleCheck, Warning, Memo, OfficeBuilding,
  Plus, DataLine, CopyDocument, Download, CircleCheckFilled,
  CircleCloseFilled, WarningFilled, RemoveFilled,
} from '@element-plus/icons-vue'
import { formatDate } from '@/utils/dateFormat'
import { apiErrorMessage } from '@/utils/errorMessage'
import type { Assessment, AssessmentRequirement, Requirement } from '@/types'

interface WorkNoteRow {
  id: string
  content: string
  authorName?: string
  createdAt?: string
}

interface EvidenceRow {
  id: string
  name: string
  description?: string
  state: string
  isCounterEvidence?: boolean
  authorName?: string
  reviewerName?: string
}

const route = useRoute()
const router = useRouter()

const assessmentId = route.params.id as string
const requirementId = route.params.requirementId as string

const isLoading = ref(true)
const loadError = ref('')
const assessment = ref<Assessment | null>(null)
const assessmentReq = ref<AssessmentRequirement | null>(null)
const requirement = ref<Requirement | null>(null)
const standardName = ref('')
const linkedEvidence = ref<EvidenceRow[]>([])
const workNotes = ref<WorkNoteRow[]>([])
const isLoadingEvidence = ref(false)
const isLoadingNotes = ref(false)
const showAddNoteDialog = ref(false)
const newNoteContent = ref('')
const savingNote = ref(false)
const activeTab = ref('assessment')

const form = ref({
  result: '',
  rationale: '',
  owner: '',
  ownerEmail: '',
  ownerRole: '',
  oeEntity: '',
  businessUnit: '',
  region: '',
  assessedBy: '',
  assessmentDate: '',
  nextReviewDate: '',
})

const isReadOnly = computed(() => {
  const s = assessment.value?.state
  return s === 'complete' || s === 'archived' || s === 'cancelled'
})

const rationaleWordCount = computed(() => {
  if (!form.value.rationale) return 0
  return form.value.rationale.trim().split(/\s+/).filter(w => w.length > 0).length
})

const jsonOutput = computed(() => ({
  schema_version: '1.0',
  record_type: 'assessment_requirement',
  requirement_id: requirement.value?.identifier,
  requirement: requirement.value?.title || requirement.value?.name,
  framework: standardName.value || null,
  status: form.value.result ? resultLabel(form.value.result) : null,
  result: form.value.result || null,
  rationale: form.value.rationale || null,
  assessed_by: form.value.assessedBy || null,
  assessment_date: form.value.assessmentDate || null,
  next_review_date: form.value.nextReviewDate || null,
  ownership: {
    owner: form.value.owner || null,
    owner_email: form.value.ownerEmail || null,
    owner_role: form.value.ownerRole || null,
    oe_entity: form.value.oeEntity || null,
    business_unit: form.value.businessUnit || null,
    region: form.value.region || null,
  },
  evidences: linkedEvidence.value.map(e => ({
    name: e.name,
    type: e.isCounterEvidence ? 'Counter Evidence' : 'Proof',
    state: e.state,
    reviewer: e.reviewerName || null,
    description: e.description || null,
  })),
  description: requirement.value?.description || null,
}))

const highlightedJson = computed(() => {
  const json = JSON.stringify(jsonOutput.value, null, 2)
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "(.*?)"/g, (_m, v) => `: <span class="jvs">"${v}"</span>`)
    .replace(/: (\d+\.?\d*)/g, ': <span class="jvn">$1</span>')
    .replace(/: (true|false)/g, ': <span class="jvb">$1</span>')
    .replace(/: null/g, ': <span class="jvx">null</span>')
})

onMounted(loadAll)

async function loadAll() {
  isLoading.value = true
  loadError.value = ''
  try {
    const { data } = await client.get(`/assessments/${assessmentId}`)
    assessment.value = data.assessment
    standardName.value = data.assessment?.standardName || data.assessment?.standard?.name || ''

    const reqs: AssessmentRequirement[] = data.requirements || []
    const found = reqs.find(r => r.requirementId === requirementId || r.id === requirementId)
    if (!found) {
      loadError.value = 'Requirement not found in this assessment.'
      return
    }
    assessmentReq.value = found
    const raw = found as unknown as Record<string, unknown>
    requirement.value = raw.requirement as Requirement || {
      id: requirementId,
      identifier: raw.identifier as string || '',
      name: raw.name as string || '',
      title: raw.title as string || '',
      description: raw.description as string || '',
      openCre: null,
      parentId: null,
      standardId: '',
    }

    form.value = {
      result: found.result || '',
      rationale: found.rationale || '',
      owner: found.owner || '',
      ownerEmail: found.ownerEmail || '',
      ownerRole: found.ownerRole || '',
      oeEntity: found.oeEntity || '',
      businessUnit: found.businessUnit || '',
      region: found.region || '',
      assessedBy: found.assessedBy || '',
      assessmentDate: found.assessmentDate || '',
      nextReviewDate: found.nextReviewDate || '',
    }
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load assessment')
  } finally {
    isLoading.value = false
  }
  loadEvidence()
  loadWorkNotes()
}

async function loadEvidence() {
  isLoadingEvidence.value = true
  try {
    const { data } = await client.get(`/assessments/${assessmentId}/requirements/${requirementId}/evidence`)
    const rows = data.data || data || []
    linkedEvidence.value = rows.map((e: Record<string, unknown>) => ({
      id: e.id as string,
      name: e.name as string,
      description: e.description as string || '',
      state: e.state as string,
      isCounterEvidence: Boolean(e.is_counter_evidence),
      authorName: e.author_name as string || '',
      reviewerName: e.reviewer_name as string || '',
    }))
  } catch {
    linkedEvidence.value = []
  } finally {
    isLoadingEvidence.value = false
  }
}

async function loadWorkNotes() {
  isLoadingNotes.value = true
  try {
    const { data } = await client.get(`/assessments/${assessmentId}/notes`)
    const rows = data.data || []
    workNotes.value = rows.map((n: Record<string, unknown>) => ({
      id: n.id as string,
      content: n.content as string,
      authorName: n.author_name as string || n.authorName as string || 'Unknown',
      createdAt: n.created_at as string || n.createdAt as string,
    }))
  } catch {
    workNotes.value = []
  } finally {
    isLoadingNotes.value = false
  }
}

async function handleSave() {
  if (rationaleWordCount.value > 0 && rationaleWordCount.value < 15) {
    ElMessage.error('Rationale must be at least 15 words.')
    return
  }
  try {
    await client.put(`/assessments/${assessmentId}/requirements/${requirementId}`, {
      result: form.value.result || null,
      rationale: form.value.rationale || null,
      owner: form.value.owner || null,
      owner_email: form.value.ownerEmail || null,
      owner_role: form.value.ownerRole || null,
      oe_entity: form.value.oeEntity || null,
      business_unit: form.value.businessUnit || null,
      region: form.value.region || null,
      assessed_by: form.value.assessedBy || null,
      assessment_date: form.value.assessmentDate || null,
      next_review_date: form.value.nextReviewDate || null,
    })
    ElMessage.success('Requirement updated.')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to update requirement'))
  }
}

async function handleMarkComplete() {
  if (rationaleWordCount.value < 15) {
    ElMessage.error('Rationale must be at least 15 words.')
    return
  }
  await handleSave()
}

async function handleAddNote() {
  if (!newNoteContent.value.trim()) {
    ElMessage.error('Note content is required.')
    return
  }
  savingNote.value = true
  try {
    await client.post(`/assessments/${assessmentId}/notes`, { content: newNoteContent.value })
    ElMessage.success('Work note added.')
    newNoteContent.value = ''
    showAddNoteDialog.value = false
    await loadWorkNotes()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to add work note'))
  } finally {
    savingNote.value = false
  }
}

function navigateToEvidence(row: EvidenceRow) {
  if (row.id) router.push(`/evidence/${row.id}`)
}

function goToAssessmentEvidence() {
  router.push(`/assessments/${assessmentId}?tab=evidence`)
}

function copyJson() {
  navigator.clipboard.writeText(JSON.stringify(jsonOutput.value, null, 2))
    .then(() => ElMessage.success('JSON copied to clipboard.'))
    .catch(() => ElMessage.error('Could not copy.'))
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(jsonOutput.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${requirement.value?.identifier || 'requirement'}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('JSON downloaded.')
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

function resultLabel(result: string): string {
  const map: Record<string, string> = { yes: 'Yes', no: 'No', partial: 'Partial', not_applicable: 'N/A' }
  return map[result] || result
}

function resultTagType(result: string): '' | 'success' | 'warning' | 'info' | 'danger' {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    yes: 'success', no: 'danger', partial: 'warning', not_applicable: 'info',
  }
  return map[result] ?? ''
}

function resultIcon(result: string) {
  const map: Record<string, unknown> = {
    yes: CircleCheckFilled, no: CircleCloseFilled, partial: WarningFilled, not_applicable: RemoveFilled,
  }
  return map[result] || null
}

function evidenceStateType(state: string): '' | 'success' | 'warning' | 'info' | 'danger' {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    claimed: 'success', in_review: 'warning', in_progress: 'info', expired: 'danger',
  }
  return map[state] ?? ''
}

function evidenceStateLabel(state: string): string {
  const map: Record<string, string> = {
    claimed: 'Accepted', in_review: 'Ready to review', in_progress: 'In Progress', expired: 'Expired',
  }
  return map[state] || state
}
</script>

<style scoped lang="scss">
.req-detail-container {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
  max-width: 1100px;
}

.req-detail-header {
  padding: var(--cat-spacing-4) 0;
}

.req-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: var(--cat-spacing-4);
  flex-wrap: wrap;
}

.req-page-title {
  .record-type {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--cat-text-tertiary);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .record-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--cat-text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.req-page-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.detail-card {
  margin-bottom: var(--cat-spacing-4);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  .card-head-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--cat-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
  &.three-col { grid-template-columns: 1fr 1fr 1fr; }
  .span-2 { grid-column: span 2; }
  .span-3 { grid-column: span 3; }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--cat-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  display: flex;
  align-items: center;
  gap: 8px;
  .required { color: var(--el-color-danger); font-size: 14px; }
}

.field-hint {
  font-size: 12px;
  color: var(--cat-text-tertiary);
}

.word-count {
  font-size: 11px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  &.weak { color: var(--el-color-warning); }
  &.ok { color: var(--el-color-success); }
}

.description-box {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-left: 3px solid var(--el-color-primary);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px;
  font-size: 13px;
  color: var(--cat-text-secondary);
  line-height: 1.7;
}

.readonly-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--el-border-radius-base);
  font-size: 13px;
  color: var(--cat-text-secondary);
  &.mono { font-family: monospace; font-weight: 700; }
}

.mono-tag { font-family: monospace; font-weight: 700; }

.flex-row {
  display: flex;
  align-items: center;
  &.gap-8 { gap: 8px; }
}

.field-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-color-warning);
  padding: 4px 8px;
  background: var(--el-color-warning-light-9);
  border-radius: var(--el-border-radius-base);
}

.card-footer-actions {
  display: flex;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--cat-border-default);
  margin-top: 16px;
}

.work-notes-section { .mb-4 { margin-bottom: 16px; } }

.work-notes-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.work-note-item {
  border: 1px solid var(--cat-border-default);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
}

.work-note-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
}

.work-note-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary-dark-2);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}

.work-note-meta { display: flex; flex-direction: column; gap: 2px; }
.work-note-author { font-weight: 600; font-size: 13px; }
.work-note-date { font-size: 12px; color: var(--cat-text-tertiary); }
.work-note-body { padding: 12px 14px; font-size: 13px; line-height: 1.6; color: var(--cat-text-secondary); }

.evidence-count {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--cat-text-tertiary);
  border-top: 1px solid var(--cat-border-default);
}

.json-preview {
  background: #1a1d23;
  border-radius: var(--el-border-radius-base);
  padding: 16px;
  overflow: auto;
  max-height: 360px;

  pre {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #c5cdd8;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  :deep(.jk)  { color: #5ba0f7; }
  :deep(.jvs) { color: #7ec67e; }
  :deep(.jvn) { color: #f5a623; }
  :deep(.jvb) { color: #e07db0; }
  :deep(.jvx) { color: #a0aab4; }
}

.loading-state { padding: 24px 0; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
  color: var(--cat-text-tertiary);
  p { margin: 0; }
}

.text-secondary { color: var(--cat-text-secondary); }

.clickable-table {
  :deep(tbody tr) {
    cursor: pointer;
    &:hover > td { background-color: var(--cat-bg-hover) !important; }
  }
}

.evidence-link {
  color: var(--el-color-primary);
  font-weight: 500;
}

.tab-badge {
  margin-left: 6px;
  :deep(.el-badge__content) {
    background-color: var(--el-color-primary);
    font-size: 10px;
    padding: 2px 6px;
  }
}

@media (max-width: 800px) {
  .form-grid { grid-template-columns: 1fr; .span-2 { grid-column: span 1; } }
  .form-grid.three-col { grid-template-columns: 1fr; }
}
</style>
