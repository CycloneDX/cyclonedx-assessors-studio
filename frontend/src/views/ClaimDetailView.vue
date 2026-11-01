<template>
  <div class="cdv-root">
    <!-- Page header -->
    <div class="cdv-page-header">
      <div class="cdv-page-header-title">
        <div class="cdv-record-type">Claim</div>
        <div class="cdv-record-name">{{ pageTitle }}</div>
      </div>
      <div class="cdv-header-actions">
        <span v-if="form.isCounterClaim" class="cdv-counter-flag">
          <el-icon><Warning /></el-icon> Counter-Claim
        </span>
        <el-button size="small" @click="router.back()">Back</el-button>
        <el-button size="small" :loading="saving" @click="saveClaim">
          <el-icon><Document /></el-icon> Save
        </el-button>
        <el-button size="small" type="success" :loading="saving" @click="submitClaim">
          <el-icon><CircleCheck /></el-icon> Submit
        </el-button>
      </div>
    </div>

    <div v-if="loading" class="cdv-loading">
      <el-icon class="is-loading" :size="20"><Loading /></el-icon>
      <span>Loading…</span>
    </div>
    <el-alert v-else-if="loadError" type="error" show-icon :closable="false" style="margin:16px 24px;">{{ loadError }}</el-alert>

    <div v-else class="cdv-body">
      <!-- ══ MAIN COLUMN ══ -->
      <div class="cdv-main">

        <!-- Claim Details card -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title">
              <ScaleIcon class="cdv-title-icon" /> Claim Details
            </span>
            <span class="cdv-id-chip">{{ claimDisplayId }}</span>
          </div>
          <div class="cdv-card-body">
            <div class="cdv-form-grid">

              <div class="cdv-field span-2">
                <label>Name <span class="cdv-req">*</span></label>
                <el-input v-model="form.name" :class="{ 'is-error': errors.name }"
                  placeholder="Short descriptive name for this claim" />
                <span v-if="errors.name" class="cdv-field-error">{{ errors.name }}</span>
              </div>

              <div class="cdv-field">
                <label>
                  Predicate <span class="cdv-req">*</span>
                  <span class="cdv-label-hint">(CycloneDX: claim.predicate)</span>
                </label>
                <el-input v-model="form.predicate" :class="{ 'is-error': errors.predicate }"
                  type="textarea" :rows="3"
                  placeholder="e.g. This component satisfies NIST SP 800-218 practice task PO.1.1 based on the attached evidence." />
                <span v-if="errors.predicate" class="cdv-field-error">{{ errors.predicate }}</span>
                <span class="cdv-field-hint">A full statement asserting what this claim declares — unbounded per CycloneDX spec.</span>
              </div>

              <div class="cdv-field">
                <label>Status</label>
                <div class="cdv-status-row">
                  <span class="cdv-badge" :class="statusBadgeClass(form.status)">{{ form.status }}</span>
                  <el-select v-model="form.status" style="max-width:160px;">
                    <el-option label="Draft" value="Draft" />
                    <el-option label="Under Review" value="Under Review" />
                    <el-option label="Accepted" value="Accepted" />
                    <el-option label="Rejected" value="Rejected" />
                  </el-select>
                </div>
              </div>

              <div class="cdv-field span-2">
                <label>
                  Reasoning <span class="cdv-req">*</span>
                  <span class="cdv-label-hint">(CycloneDX: claim.reasoning)</span>
                </label>
                <el-input v-model="form.reasoning" :class="{ 'is-error': errors.reasoning }"
                  type="textarea" :rows="5" maxlength="250" show-word-limit
                  placeholder="Explain the basis for this claim, including why the referenced evidence supports or refutes the requirement…" />
                <span v-if="errors.reasoning" class="cdv-field-error">{{ errors.reasoning }}</span>
              </div>

              <!-- Counter-claim toggle -->
              <div class="cdv-field span-2">
                <label>Counter-Claim</label>
                <div class="cdv-toggle-row" :class="{ active: form.isCounterClaim }"
                  @click="form.isCounterClaim = !form.isCounterClaim">
                  <el-switch v-model="form.isCounterClaim" active-color="#c0392b" @click.stop />
                  <div class="cdv-toggle-label">
                    <strong :class="{ 'cdv-counter-text': form.isCounterClaim }">
                      {{ form.isCounterClaim ? 'This is a Counter-Claim' : 'Mark as Counter-Claim' }}
                    </strong>
                    <span>{{ form.isCounterClaim
                      ? 'This claim disputes or refutes another claim or piece of evidence.'
                      : 'Enable if this claim opposes an existing claim or evidence record.' }}</span>
                  </div>
                  <span v-if="form.isCounterClaim" class="cdv-badge cdv-badge-danger">
                    <el-icon><Warning /></el-icon> Counter
                  </span>
                </div>
                <span class="cdv-field-hint" style="margin-top:4px;">
                  Maps to CycloneDX <code>claim.counterEvidence</code> boolean.
                </span>
              </div>

            </div>
          </div>
        </div>

        <!-- Mitigation Strategies card -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title">
              <ShieldIcon class="cdv-title-icon" /> Mitigation Strategies
              <span class="cdv-badge cdv-badge-info" style="margin-left:6px;">{{ form.linkedMitigations?.length ?? 0 }}</span>
            </span>
            <el-button size="small" type="primary" @click="openMitigationPicker">
              <el-icon><Link /></el-icon> Link from Registry
            </el-button>
          </div>
          <div class="cdv-card-body">
            <div class="cdv-search-box">
              <el-icon class="cdv-search-icon"><Search /></el-icon>
              <el-input v-model="mitigationSearch" placeholder="Search linked mitigations…" />
            </div>
            <div class="cdv-inner-table-wrap">
              <div class="cdv-inner-table-head">
                <span>MIT ID</span>
                <span>Title</span>
                <span>Type</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Owner</span>
                <span></span>
              </div>
              <div v-if="filteredMitigations.length === 0" class="cdv-empty-inner">
                <ShieldIcon style="font-size:28px;color:var(--el-border-color);" />
                <span>{{ mitigationSearch ? 'No matching mitigations.' : 'No mitigations linked yet. Click Link from Registry to add.' }}</span>
              </div>
              <div v-for="m in filteredMitigations" :key="m.id" class="cdv-inner-row">
                <span><span class="cdv-id-chip cdv-id-chip-sm">{{ formatMitId(m) }}</span></span>
                <span class="cdv-link-text">{{ m.title }}</span>
                <span><span class="cdv-badge cdv-badge-neutral">{{ m.type }}</span></span>
                <span><span class="cdv-badge" :class="mitigationStatusBadge(m.status)">{{ m.status }}</span></span>
                <span><span class="cdv-badge" :class="priorityBadge(m.priority)">{{ m.priority }}</span></span>
                <span class="cdv-muted">{{ m.owner || '—' }}</span>
                <span>
                  <el-button type="danger" text size="small" @click="unlinkMitigation(m.id)" :aria-label="`Unlink mitigation ${m.title}`">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </span>
              </div>
            </div>
            <div class="cdv-table-footer">{{ form.linkedMitigations?.length ?? 0 }} strategy record{{ (form.linkedMitigations?.length ?? 0) !== 1 ? 's' : '' }}</div>
          </div>
        </div>

        <!-- Linked Evidence card -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title">
              <el-icon><FolderOpened /></el-icon> Linked Evidence
              <span class="cdv-badge cdv-badge-info" style="margin-left:6px;">{{ form.linkedEvidence?.length ?? 0 }}</span>
            </span>
            <el-button size="small" type="primary" @click="openEvidencePicker">
              <el-icon><Link /></el-icon> Link Evidence
            </el-button>
          </div>
          <div class="cdv-card-body">

            <div v-if="(form.linkedEvidence?.length ?? 0) > 0">
              <div class="cdv-section-label">Linked to this Claim</div>
              <div class="cdv-inner-table-wrap" style="margin-bottom:16px;">
                <div class="cdv-inner-table-head cdv-ev-head">
                  <span>Evidence ID</span>
                  <span>Name</span>
                  <span>State</span>
                  <span></span>
                </div>
                <div v-for="ev in form.linkedEvidence" :key="ev.id" class="cdv-inner-row cdv-ev-row">
                  <span><span class="cdv-id-chip cdv-id-chip-sm">{{ formatEvId(ev) }}</span></span>
                  <span class="cdv-link-text">{{ ev.name }}</span>
                  <span><span class="cdv-badge" :class="stateBadge(ev.state)">{{ ev.state }}</span></span>
                  <span>
                    <el-button type="danger" text size="small" @click="unlinkEvidence(ev.id)" :aria-label="`Unlink evidence ${ev.name}`">
                      <el-icon><Delete /></el-icon>
                    </el-button>
                  </span>
                </div>
              </div>
            </div>

            <div class="cdv-drop-zone" @click="openEvidencePicker">
              <el-icon style="font-size:22px;color:var(--el-text-color-placeholder);"><FolderAdd /></el-icon>
              <span style="font-size:13px;font-weight:600;color:var(--el-text-color-secondary);">Link additional evidence records</span>
              <el-button size="small" @click.stop="openEvidencePicker">
                <el-icon><Search /></el-icon> Browse Evidence
              </el-button>
              <span class="cdv-muted" style="font-size:12px;">Click to search and attach evidence from the Evidence Registry.</span>
            </div>

          </div>
          <div class="cdv-card-footer">
            <el-button size="small" :loading="saving" @click="saveClaim">
              <el-icon><Document /></el-icon> Save Changes
            </el-button>
            <div style="margin-left:auto;">
              <el-button size="small" type="success" :loading="saving" @click="submitClaim">
                <el-icon><CircleCheck /></el-icon> Submit
              </el-button>
            </div>
          </div>
        </div>

        <!-- JSON Output card -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title">
              <el-icon><DataLine /></el-icon> JSON Output
              <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--el-text-color-placeholder);margin-left:6px;">CycloneDX-mapped</span>
            </span>
            <div style="display:flex;gap:8px;">
              <el-button size="small" @click="copyJson"><el-icon><CopyDocument /></el-icon> Copy</el-button>
              <el-button size="small" @click="downloadJson"><el-icon><Download /></el-icon> Download</el-button>
            </div>
          </div>
          <div class="cdv-json-preview">
            <pre v-html="highlightedJson"></pre>
          </div>
        </div>

      </div><!-- /main -->

      <!-- ══ SIDE COLUMN ══ -->
      <div class="cdv-side">

        <!-- Project Context -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title"><el-icon><Grid /></el-icon> Project Context</span>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Project Name</div>
            <el-input v-model="form.projectName" size="small" placeholder="e.g. Product BSIMM 2025" />
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Project Requirement</div>
            <el-input v-model="form.projectRequirement" size="small" placeholder="e.g. AA1.4" />
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Framework</div>
            <el-input v-model="form.framework" size="small" placeholder="e.g. BSIMM, SOC 2" />
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Assessor</div>
            <el-input v-model="form.assessor" size="small" placeholder="Assessor name" />
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Claim Date</div>
            <el-input v-model="form.claimDate" size="small" type="date" />
          </div>
        </div>

        <!-- Classification -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title"><el-icon><PriceTag /></el-icon> Classification</span>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Claim Type</div>
            <el-select v-model="form.claimType" size="small" placeholder="Select type" style="width:100%;">
              <el-option label="Conformance" value="Conformance" />
              <el-option label="Non-Conformance" value="Non-Conformance" />
              <el-option label="Exemption" value="Exemption" />
              <el-option label="Compensating Control" value="Compensating Control" />
            </el-select>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Confidence</div>
            <el-select v-model="form.confidence" size="small" placeholder="Select confidence" style="width:100%;">
              <el-option label="High" value="High" />
              <el-option label="Medium" value="Medium" />
              <el-option label="Low" value="Low" />
            </el-select>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Status</div>
            <span class="cdv-badge" :class="statusBadgeClass(form.status)">{{ form.status }}</span>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">CycloneDX Ref</div>
            <div class="cdv-meta-ref">claim / {{ claimDisplayId }}</div>
          </div>
          <div class="cdv-meta-row">
            <div class="cdv-meta-label">Created</div>
            <div class="cdv-meta-value cdv-muted">{{ formatDate(claim?.createdAt) }}</div>
          </div>
          <div class="cdv-meta-row cdv-meta-row--last">
            <div class="cdv-meta-label">Updated</div>
            <div class="cdv-meta-value cdv-muted">{{ formatDate(claim?.updatedAt) }}</div>
          </div>
        </div>

        <!-- Work Notes -->
        <div class="cdv-card">
          <div class="cdv-card-header">
            <span class="cdv-card-title"><el-icon><EditPen /></el-icon> Work Notes</span>
          </div>
          <div style="padding:12px 16px;">
            <el-input v-model="form.workNotes" type="textarea" :rows="4" placeholder="Internal notes for this claim…" />
          </div>
        </div>

      </div><!-- /side -->
    </div>

    <!-- ══ MITIGATION PICKER MODAL ══ -->
    <el-dialog v-model="showMitigationPicker" title="Mitigation Registry — Link to this Claim" width="700px" destroy-on-close>
      <div class="cdv-picker-search">
        <el-icon><Search /></el-icon>
        <el-input v-model="mitPickerSearch" placeholder="Search by title, ID, type, status…" />
      </div>
      <div class="cdv-picker-table-wrap">
        <div class="cdv-inner-table-head cdv-picker-head">
          <span style="width:32px;"></span>
          <span>MIT ID</span>
          <span>Title</span>
          <span>Type</span>
          <span>Status</span>
          <span>Priority</span>
        </div>
        <div v-if="filteredMitPool.length === 0" class="cdv-empty-inner">No matching mitigations.</div>
        <div v-for="m in filteredMitPool" :key="m.id"
          class="cdv-inner-row cdv-selectable"
          :class="{ 'cdv-selected': isMitPicked(m.id) }"
          @click="toggleMitPick(m)">
          <span style="width:32px;"><el-checkbox :model-value="isMitPicked(m.id)" :aria-label="`Select mitigation ${m.title}`" @click.stop /></span>
          <span><span class="cdv-id-chip cdv-id-chip-sm">{{ formatMitId(m) }}</span></span>
          <span style="font-weight:600;">{{ m.title }}</span>
          <span><span class="cdv-badge cdv-badge-neutral">{{ m.type }}</span></span>
          <span><span class="cdv-badge" :class="mitigationStatusBadge(m.status)">{{ m.status }}</span></span>
          <span><span class="cdv-badge" :class="priorityBadge(m.priority)">{{ m.priority }}</span></span>
        </div>
      </div>
      <template #footer>
        <span style="font-size:12px;color:var(--el-text-color-secondary);flex:1;">{{ mitPickerSel.length }} selected</span>
        <el-button @click="showMitigationPicker = false">Cancel</el-button>
        <el-button type="primary" :disabled="mitPickerSel.length === 0" @click="confirmMitPick">
          <el-icon><Link /></el-icon> Link Selected
        </el-button>
      </template>
    </el-dialog>

    <!-- ══ EVIDENCE PICKER MODAL ══ -->
    <el-dialog v-model="showEvidencePicker" title="Evidence Registry — Select Evidence to Link" width="700px" destroy-on-close>
      <div class="cdv-picker-search">
        <el-icon><Search /></el-icon>
        <el-input v-model="evidenceSearch" placeholder="Search by name, ID, state, author…" />
      </div>
      <div class="cdv-picker-table-wrap">
        <div class="cdv-inner-table-head cdv-ev-picker-head">
          <span style="width:32px;"></span>
          <span>Evidence ID</span>
          <span>Name</span>
          <span>State</span>
        </div>
        <div v-if="filteredEvidencePool.length === 0" class="cdv-empty-inner">No evidence records match your search.</div>
        <div v-for="ev in filteredEvidencePool" :key="ev.id"
          class="cdv-inner-row cdv-selectable"
          :class="{ 'cdv-selected': isEvPicked(ev.id) }"
          @click="toggleEvPick(ev)">
          <span style="width:32px;"><el-checkbox :model-value="isEvPicked(ev.id)" :aria-label="`Select evidence ${ev.name}`" @click.stop /></span>
          <span><span class="cdv-id-chip cdv-id-chip-sm">{{ formatEvId(ev) }}</span></span>
          <span style="font-weight:600;">{{ ev.name }}</span>
          <span><span class="cdv-badge" :class="stateBadge(ev.state)">{{ ev.state }}</span></span>
        </div>
      </div>
      <template #footer>
        <span style="font-size:12px;color:var(--el-text-color-secondary);flex:1;">{{ evPickerSel.length }} selected</span>
        <el-button @click="showEvidencePicker = false">Cancel</el-button>
        <el-button type="primary" :disabled="evPickerSel.length === 0" @click="confirmEvPick">
          <el-icon><Link /></el-icon> Link Selected
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import client from '@/api/client'
import { ElMessage } from 'element-plus'
import {
  Loading, Document, CircleCheck, Warning, Link, Search, Delete,
  FolderOpened, FolderAdd, DataLine, CopyDocument, Download, Grid,
  PriceTag, EditPen
} from '@element-plus/icons-vue'
import type { Claim } from '@/types'
import { apiErrorMessage } from '@/utils/errorMessage'

// ── Inline SVG icons (not in EP icon set) ──────────────────────────────
const ScaleIcon = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', width: '16', height: '16' }, [
  h('path', { d: 'M12 3v18' }), h('path', { d: 'M3 9l9-6 9 6' }),
  h('circle', { cx: '6', cy: '15', r: '3' }), h('circle', { cx: '18', cy: '15', r: '3' }),
  h('path', { d: 'M3 15h6m6 0h6' }),
]) }
const ShieldIcon = { render: () => h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', width: '16', height: '16' }, [
  h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
]) }

type ClaimForm = {
  name: string
  predicate: string
  status: string
  reasoning: string
  isCounterClaim: boolean
  claimType: string | null
  confidence: string | null
  projectName: string | null
  projectRequirement: string | null
  framework: string | null
  assessor: string | null
  claimDate: string | null
  workNotes: string | null
  linkedMitigations: { id: string; displayId?: number; title: string; status: string; priority: string; type: string; owner?: string | null }[]
  linkedEvidence: { id: string; displayId?: number; name: string; state: string }[]
}

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const claim = ref<Claim | null>(null)
const form = ref<ClaimForm>({
  name: '', predicate: '', status: 'Draft', reasoning: '', isCounterClaim: false,
  claimType: null, confidence: null, projectName: null, projectRequirement: null,
  framework: null, assessor: null, claimDate: null, workNotes: null,
  linkedMitigations: [], linkedEvidence: [],
})
const errors = ref<Record<string, string>>({})

// Pickers
const showMitigationPicker = ref(false)
const mitPickerSearch = ref('')
const mitPickerSel = ref<{ id: string; title: string; status: string; priority: string; type: string; owner?: string | null }[]>([])
const mitigationSearch = ref('')
const allMitigations = ref<{ id: string; displayId?: number; title: string; status: string; priority: string; type: string; owner?: string | null }[]>([])

const showEvidencePicker = ref(false)
const evidenceSearch = ref('')
const evPickerSel = ref<{ id: string; name: string; state: string }[]>([])
const allEvidence = ref<{ id: string; displayId?: number; name: string; state: string }[]>([])

onMounted(fetchClaim)

async function fetchClaim() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await client.get(`/claims/${encodeURIComponent(String(route.params.id))}`)
    const c = data.claim ?? data
    claim.value = {
      ...c,
      displayId: c.display_id ?? c.displayId,
      linkedMitigations: data.linkedMitigations ?? [],
      linkedEvidence: data.evidence ?? [],
    }
    form.value = {
      name: c.name ?? '',
      predicate: c.predicate ?? '',
      status: c.status ?? 'Draft',
      reasoning: c.reasoning ?? '',
      isCounterClaim: c.is_counter_claim ?? c.isCounterClaim ?? false,
      claimType: c.claim_type ?? c.claimType ?? null,
      confidence: c.confidence ?? null,
      projectName: c.project_name ?? c.projectName ?? null,
      projectRequirement: c.project_requirement ?? c.projectRequirement ?? null,
      framework: c.framework ?? null,
      assessor: c.assessor ?? null,
      claimDate: c.claim_date ? (c.claim_date as string).slice(0, 10) : null,
      workNotes: c.work_notes ?? c.workNotes ?? null,
      linkedMitigations: data.linkedMitigations ?? [],
      linkedEvidence: data.evidence ?? [],
    }
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load claim')
  } finally {
    loading.value = false
  }
}

const claimDisplayId = computed(() => {
  if (claim.value?.displayId) return 'CLM-' + String(claim.value.displayId).padStart(4, '0')
  const id = (route.params.id as string) ?? ''
  return 'CLM-' + id.slice(0, 8).toUpperCase()
})
const pageTitle = computed(() => form.value.name ? `${claimDisplayId.value} – ${form.value.name}` : claimDisplayId.value)

// ── Validation ───────────────────────────────────────────────────────────
function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.value.name.trim()) e.name = 'Name is required.'
  if (!form.value.predicate.trim()) e.predicate = 'Predicate is required.'
  if (!form.value.reasoning.trim()) e.reasoning = 'Reasoning is required.'
  errors.value = e
  return Object.keys(e).length === 0
}

// ── Save / Submit ────────────────────────────────────────────────────────
async function saveClaim() {
  saving.value = true
  try {
    const payload = buildPayload()
    await client.put(`/claims/${encodeURIComponent(String(route.params.id))}`, payload)
    ElMessage.success('Claim saved')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to save claim'))
  } finally {
    saving.value = false
  }
}

async function submitClaim() {
  if (!validate()) { ElMessage.error('Please fill in all required fields.'); return }
  saving.value = true
  try {
    const payload = buildPayload({ status: 'Under Review' })
    await client.put(`/claims/${encodeURIComponent(String(route.params.id))}`, payload)
    form.value.status = 'Under Review'
    ElMessage.success('Claim submitted for review.')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to submit claim'))
  } finally {
    saving.value = false
  }
}

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: form.value.name,
    predicate: form.value.predicate,
    reasoning: form.value.reasoning,
    isCounterClaim: form.value.isCounterClaim,
    status: form.value.status,
    claimType: form.value.claimType,
    confidence: form.value.confidence,
    projectName: form.value.projectName,
    projectRequirement: form.value.projectRequirement,
    framework: form.value.framework,
    assessor: form.value.assessor,
    claimDate: form.value.claimDate,
    workNotes: form.value.workNotes,
    ...overrides,
  }
}

// ── Mitigation linking ───────────────────────────────────────────────────
async function openMitigationPicker() {
  mitPickerSel.value = []
  mitPickerSearch.value = ''
  if (allMitigations.value.length === 0) {
    try {
      const { data } = await client.get('/mitigations')
      allMitigations.value = (data.data ?? data) as typeof allMitigations.value
    } catch { /* ignore */ }
  }
  showMitigationPicker.value = true
}

const filteredMitPool = computed(() => {
  const linked = new Set(form.value.linkedMitigations.map(m => m.id))
  let pool = allMitigations.value.filter(m => !linked.has(m.id))
  if (mitPickerSearch.value) {
    const q = mitPickerSearch.value.toLowerCase()
    pool = pool.filter(m => m.title.toLowerCase().includes(q) || m.status.toLowerCase().includes(q) || m.type.toLowerCase().includes(q))
  }
  return pool
})

function isMitPicked(id: string) { return mitPickerSel.value.some(m => m.id === id) }
function toggleMitPick(m: typeof allMitigations.value[0]) {
  const idx = mitPickerSel.value.findIndex(x => x.id === m.id)
  if (idx >= 0) mitPickerSel.value.splice(idx, 1); else mitPickerSel.value.push(m)
}

async function confirmMitPick() {
  const claimId = route.params.id as string
  await Promise.all(mitPickerSel.value.map(m =>
    client.post(`/claims/${claimId}/mitigations/${m.id}`).catch(() => null)
  ))
  form.value.linkedMitigations.push(...mitPickerSel.value.filter(m => !form.value.linkedMitigations.find(x => x.id === m.id)))
  showMitigationPicker.value = false
  ElMessage.success(`${mitPickerSel.value.length} mitigation(s) linked.`)
  mitPickerSel.value = []
}

async function unlinkMitigation(mitigationId: string) {
  const claimId = route.params.id as string
  try {
    await client.delete(`/claims/${claimId}/mitigations/${mitigationId}`)
    form.value.linkedMitigations = form.value.linkedMitigations.filter(m => m.id !== mitigationId)
    ElMessage.success('Mitigation unlinked.')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to unlink mitigation'))
  }
}

const filteredMitigations = computed(() => {
  if (!mitigationSearch.value) return form.value.linkedMitigations
  const q = mitigationSearch.value.toLowerCase()
  return form.value.linkedMitigations.filter(m =>
    m.title.toLowerCase().includes(q) || m.type.toLowerCase().includes(q) || (m.owner ?? '').toLowerCase().includes(q)
  )
})

// ── Evidence linking ─────────────────────────────────────────────────────
async function openEvidencePicker() {
  evPickerSel.value = []
  evidenceSearch.value = ''
  if (allEvidence.value.length === 0) {
    try {
      const { data } = await client.get('/evidence')
      allEvidence.value = (data.data ?? data) as typeof allEvidence.value
    } catch { /* ignore */ }
  }
  showEvidencePicker.value = true
}

const filteredEvidencePool = computed(() => {
  const linked = new Set(form.value.linkedEvidence.map(e => e.id))
  let pool = allEvidence.value.filter(e => !linked.has(e.id))
  if (evidenceSearch.value) {
    const q = evidenceSearch.value.toLowerCase()
    pool = pool.filter(e => (e.name ?? '').toLowerCase().includes(q) || (e.state ?? '').toLowerCase().includes(q))
  }
  return pool
})

function isEvPicked(id: string) { return evPickerSel.value.some(e => e.id === id) }
function toggleEvPick(ev: typeof allEvidence.value[0]) {
  const idx = evPickerSel.value.findIndex(e => e.id === ev.id)
  if (idx >= 0) evPickerSel.value.splice(idx, 1); else evPickerSel.value.push(ev)
}

async function confirmEvPick() {
  const claimId = route.params.id as string
  await Promise.all(evPickerSel.value.map(ev =>
    client.post(`/claims/${claimId}/evidence/${ev.id}`).catch(() => null)
  ))
  form.value.linkedEvidence.push(...evPickerSel.value.filter(ev => !form.value.linkedEvidence.find(x => x.id === ev.id)))
  showEvidencePicker.value = false
  ElMessage.success(`${evPickerSel.value.length} evidence record(s) linked.`)
  evPickerSel.value = []
}

async function unlinkEvidence(evidenceId: string) {
  const claimId = route.params.id as string
  try {
    await client.delete(`/claims/${claimId}/evidence/${evidenceId}`)
    form.value.linkedEvidence = form.value.linkedEvidence.filter(e => e.id !== evidenceId)
    ElMessage.success('Evidence unlinked.')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to unlink evidence'))
  }
}

// ── JSON output ──────────────────────────────────────────────────────────
const jsonOutput = computed(() => ({
  schema_version: '1.0',
  record_type: 'claim',
  bom_ref: claimDisplayId.value,
  claim: {
    bom_ref: claimDisplayId.value,
    target: form.value.projectRequirement || null,
    predicate: form.value.predicate || null,
    reasoning: form.value.reasoning || null,
    counter_evidence: form.value.isCounterClaim,
    mitigations: form.value.linkedMitigations.map(m => ({ bom_ref: formatMitId(m), title: m.title, type: m.type, status: m.status, priority: m.priority })),
    evidence: form.value.linkedEvidence.map(e => ({ bom_ref: formatEvId(e), name: e.name, state: e.state })),
  },
  context: {
    project_name: form.value.projectName || null,
    project_requirement: form.value.projectRequirement || null,
    framework: form.value.framework || null,
    assessor: form.value.assessor || null,
    claim_date: form.value.claimDate || null,
    claim_type: form.value.claimType,
    confidence: form.value.confidence,
    status: form.value.status,
  },
}))

const highlightedJson = computed(() => {
  const json = JSON.stringify(jsonOutput.value, null, 2)
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "(.*?)"/g, (_m: string, v: string) => `: <span class="jv-str">"${v}"</span>`)
    .replace(/: (\d+\.?\d*)/g, ': <span class="jv-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="jv-bool">$1</span>')
    .replace(/: null/g, ': <span class="jv-null">null</span>')
})

function copyJson() {
  navigator.clipboard.writeText(JSON.stringify(jsonOutput.value, null, 2))
    .then(() => ElMessage.success('JSON copied to clipboard.'))
    .catch(() => ElMessage.error('Could not copy — try manually.'))
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(jsonOutput.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${claimDisplayId.value}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('JSON downloaded.')
}

// ── Helpers ──────────────────────────────────────────────────────────────
function formatMitId(row: { id: string; displayId?: number }) {
  if (row.displayId) return 'MIT-' + String(row.displayId).padStart(4, '0')
  return 'MIT-' + row.id.slice(0, 6).toUpperCase()
}
function formatEvId(row: { id: string; displayId?: number }) {
  if (row.displayId) return 'EVD-' + String(row.displayId).padStart(4, '0')
  return 'EVD-' + row.id.slice(0, 6).toUpperCase()
}
function formatDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function statusBadgeClass(status: string) {
  const map: Record<string, string> = {
    'Accepted': 'cdv-badge-success',
    'Under Review': 'cdv-badge-warning',
    'Draft': 'cdv-badge-neutral',
    'Rejected': 'cdv-badge-danger',
  }
  return map[status] ?? 'cdv-badge-neutral'
}

function mitigationStatusBadge(status: string) {
  const map: Record<string, string> = {
    'Implemented': 'cdv-badge-success', 'Verified': 'cdv-badge-success',
    'In Progress': 'cdv-badge-warning', 'Proposed': 'cdv-badge-neutral',
    'Closed': 'cdv-badge-neutral', 'Rejected': 'cdv-badge-danger',
  }
  return map[status] ?? 'cdv-badge-neutral'
}

function priorityBadge(p: string) {
  const map: Record<string, string> = { 'Critical': 'cdv-badge-danger', 'High': 'cdv-badge-warning', 'Medium': 'cdv-badge-info', 'Low': 'cdv-badge-neutral' }
  return map[p] ?? 'cdv-badge-neutral'
}

function stateBadge(state: string) {
  if (state === 'approved' || state === 'accepted') return 'cdv-badge-success'
  if (state === 'submitted' || state === 'in_review') return 'cdv-badge-warning'
  return 'cdv-badge-neutral'
}
</script>

<style scoped lang="scss">
.cdv-root {
  padding: 0;
  min-height: 100%;
}

/* Page header */
.cdv-page-header {
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
}
.cdv-page-header-title { flex: 1; }
.cdv-record-type { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--el-text-color-placeholder); font-weight: 600; }
.cdv-record-name { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); line-height: 1.2; }
.cdv-header-actions { display: flex; align-items: center; gap: 8px; }
.cdv-counter-flag {
  display: inline-flex; align-items: center; gap: 5px;
  background: #fff0f0; border: 1px solid rgba(192,57,43,.2); border-radius: 20px;
  padding: 3px 10px; font-size: 12px; font-weight: 700; color: #c0392b;
}

/* Loading */
.cdv-loading { display: flex; align-items: center; gap: 8px; padding: 48px 24px; color: var(--el-text-color-secondary); }

/* Two-column body */
.cdv-body {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 60px;
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}
.cdv-main { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.cdv-side { display: flex; flex-direction: column; gap: 20px; position: sticky; top: 64px; }

/* Card */
.cdv-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,.06);
}
.cdv-card-header {
  padding: 12px 18px;
  border-bottom: 1px solid var(--el-border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--el-fill-color-blank);
}
.cdv-card-title {
  font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary);
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; gap: 7px;
}
.cdv-title-icon { font-size: 14px; color: var(--el-color-primary); }
.cdv-card-body { padding: 18px; }
.cdv-card-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
}

/* ID chip */
.cdv-id-chip {
  font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700;
  background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2);
  padding: 3px 9px; border-radius: 5px; letter-spacing: 0.5px;
}
.cdv-id-chip-sm { font-size: 11px; padding: 2px 7px; }

/* Form grid */
.cdv-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
.span-2 { grid-column: span 2; }

.cdv-field {
  display: flex; flex-direction: column; gap: 5px;
  label {
    font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary);
    text-transform: uppercase; letter-spacing: 0.4px;
    display: flex; align-items: center; gap: 4px;
  }
}
.cdv-req { color: var(--el-color-danger); font-size: 14px; line-height: 1; }
.cdv-label-hint { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; color: var(--el-text-color-placeholder); }
.cdv-field-error { font-size: 12px; color: var(--el-color-danger); }
.cdv-field-hint { font-size: 12px; color: var(--el-text-color-placeholder); }

/* Status row */
.cdv-status-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* Counter-claim toggle */
.cdv-toggle-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 6px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  cursor: pointer;
  transition: border-color .15s, background .15s;
  user-select: none;
  &:hover { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  &.active { border-color: rgba(192,57,43,.3); background: #fff0f0; }
}
.cdv-toggle-label {
  flex: 1;
  strong { font-size: 13px; font-weight: 700; display: block; }
  span { font-size: 12px; color: var(--el-text-color-secondary); }
}
.cdv-counter-text { color: #c0392b !important; }

/* Badges */
.cdv-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.cdv-badge-success { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.cdv-badge-warning { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.cdv-badge-info    { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.cdv-badge-neutral { background: var(--el-fill-color); color: var(--el-text-color-secondary); }
.cdv-badge-danger  { background: #fff0f0; color: #c0392b; }

/* Inner tables */
.cdv-search-box {
  position: relative;
  margin-bottom: 10px;
  .cdv-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); z-index: 1; color: var(--el-text-color-placeholder); font-size: 13px; pointer-events: none; }
  :deep(.el-input__wrapper) { padding-left: 30px; }
}

$mit-cols: 90px 1fr 110px 120px 90px 120px 40px;
$ev-cols: 90px 1fr 120px 40px;

.cdv-inner-table-wrap {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.cdv-inner-table-head {
  display: grid;
  grid-template-columns: $mit-cols;
  background: var(--el-fill-color-light);
  padding: 8px 12px;
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
  color: var(--el-text-color-secondary);
  gap: 10px;
  border-bottom: 1px solid var(--el-border-color);
}

.cdv-inner-row {
  display: grid;
  grid-template-columns: $mit-cols;
  padding: 9px 12px;
  gap: 10px;
  align-items: center;
  font-size: 13px;
  border-bottom: 1px solid var(--el-border-color);
  &:last-child { border-bottom: none; }
  &:hover { background: var(--el-fill-color-blank); }
}

.cdv-ev-head { grid-template-columns: $ev-cols !important; }
.cdv-ev-row  { grid-template-columns: $ev-cols !important; }

.cdv-empty-inner {
  padding: 28px;
  text-align: center;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.cdv-table-footer { padding: 8px 0 0; font-size: 12px; color: var(--el-text-color-placeholder); }

/* Evidence drop zone */
.cdv-drop-zone {
  border: 2px dashed var(--el-border-color);
  border-radius: 10px;
  padding: 20px;
  background: var(--el-fill-color-light);
  cursor: pointer;
  transition: border-color .15s, background .15s;
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  &:hover { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
}

/* Section label */
.cdv-section-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--el-text-color-placeholder); margin-bottom: 10px;
  display: flex; align-items: center; gap: 6px;
  &::after { content: ''; flex: 1; height: 1px; background: var(--el-border-color); }
}

/* Side meta */
.cdv-meta-row {
  padding: 11px 16px;
  border-bottom: 1px solid var(--el-border-color);
  display: flex; flex-direction: column; gap: 5px;
}
.cdv-meta-row--last { border-bottom: none; }
.cdv-meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--el-text-color-placeholder); }
.cdv-meta-value { font-size: 13px; font-weight: 600; }
.cdv-meta-ref { font-size: 12px; font-family: 'Courier New', monospace; color: var(--el-color-primary-dark-2); }
.cdv-muted { font-size: 12px; color: var(--el-text-color-secondary); }
.cdv-link-text { font-weight: 600; color: var(--el-color-primary); }

/* Picker modal */
.cdv-picker-search {
  position: relative; margin-bottom: 12px;
  .el-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); z-index: 1; color: var(--el-text-color-placeholder); pointer-events: none; }
  :deep(.el-input__wrapper) { padding-left: 30px; }
}
.cdv-picker-table-wrap { border: 1px solid var(--el-border-color); border-radius: 6px; overflow: hidden; max-height: 380px; overflow-y: auto; }
$mit-picker-cols: 32px 90px 1fr 110px 120px 90px;
.cdv-picker-head { grid-template-columns: $mit-picker-cols !important; }
.cdv-inner-row.cdv-selectable { grid-template-columns: $mit-picker-cols; cursor: pointer; }
.cdv-ev-picker-head { grid-template-columns: 32px 90px 1fr 120px !important; }
.cdv-selectable:hover { background: var(--el-color-primary-light-9); }
.cdv-selected { background: var(--el-color-primary-light-9) !important; }

/* JSON */
.cdv-json-preview {
  background: #1a1d23; padding: 16px; overflow: auto; max-height: 320px;
  pre { font-family: 'Courier New', monospace; font-size: 12px; color: #c5cdd8; margin: 0; white-space: pre-wrap; word-break: break-all; }
  :deep(.jk) { color: #5ba0f7; }
  :deep(.jv-str) { color: #7ec67e; }
  :deep(.jv-num) { color: #f5a623; }
  :deep(.jv-bool) { color: #e07db0; }
  :deep(.jv-null) { color: #a0aab4; }
}

@media (max-width: 860px) {
  .cdv-body { grid-template-columns: 1fr; }
  .cdv-side { position: static; }
  .cdv-form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: span 1; }
}
</style>
