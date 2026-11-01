<template>
  <div class="evd-page">
    <!-- Loading / error -->
    <div v-if="loading" class="evd-loading"><el-icon class="is-loading"><Loading /></el-icon> Loading…</div>
    <el-alert v-else-if="loadError" type="error" :description="loadError" show-icon :closable="false" style="margin:24px" />

    <template v-else-if="evidence">
      <!-- Breadcrumb + page sub-header -->
      <div class="evd-subheader">
        <el-breadcrumb :separator-icon="ArrowRight">
          <el-breadcrumb-item :to="{ path: '/evidence' }">Evidence Registry</el-breadcrumb-item>
          <el-breadcrumb-item>{{ evidence.name }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="evd-title-row">
          <div>
            <div class="evd-record-type">Evidence</div>
            <div class="evd-record-name">{{ evidence.name }}</div>
          </div>
          <div class="evd-header-actions">
            <el-button :icon="ArrowLeft" @click="router.push('/evidence')">Back</el-button>
            <el-button v-if="evidence.state === 'in_progress'" type="warning" @click="submitForReview">Submit for Review</el-button>
            <template v-if="canDecide">
              <el-button type="success" :loading="deciding" @click="approveEvidence">Approve</el-button>
              <el-button type="danger" :loading="deciding" @click="rejectEvidence">Reject</el-button>
            </template>
            <el-button type="primary" :loading="saving" @click="saveAll">Save Changes</el-button>
          </div>
        </div>
      </div>

      <div class="evd-content">

        <!-- Immutability banner -->
        <el-alert v-if="immutable" type="warning" show-icon :closable="false" style="margin-bottom:16px">
          This evidence is locked — it has been {{ evidence.state === 'claimed' ? 'claimed' : 'cited in a claim or completed assessment' }} and cannot be edited.
        </el-alert>

        <!-- ── CORE DETAILS CARD ── -->
        <div class="evd-card">
          <div class="evd-card-header">
            <span class="evd-card-title"><el-icon><DocumentChecked /></el-icon> Evidence Details</span>
            <span class="evd-id-chip">{{ fmtEvdId(evidence.displayId) }}</span>
          </div>

          <!-- Manage Attachments bar -->
          <div class="evd-attach-bar">
            <el-icon><Paperclip /></el-icon>
            <span>Manage Attachments ({{ attachedFiles.length }})</span>
            <el-divider direction="vertical" />
            <el-button link type="primary" size="small" @click="activeTab = 'attachments'">
              <el-icon><Paperclip /></el-icon> Go to Attachments
            </el-button>
          </div>

          <div class="evd-card-body">
            <div class="evd-form-grid">
              <div class="evd-field">
                <label>Name <span class="evd-req">*</span></label>
                <el-input v-model="form.name" :disabled="immutable" />
              </div>
              <div class="evd-field">
                <label>State <span class="evd-req">*</span></label>
                <div style="display:flex;align-items:center;gap:10px">
                  <StateBadge :state="evidence.state" />
                  <!-- Review starts with "Submit for Review" and ends with the
                       reviewer's approve/reject, so it is not a choice here. -->
                  <el-select v-if="!immutable && evidence.state !== 'in_review'" v-model="form.state" size="small" style="width:140px">
                    <el-option label="In Progress" value="in_progress" />
                    <el-option label="Expired" value="expired" />
                  </el-select>
                </div>
              </div>
              <div class="evd-field">
                <label>Type <span class="evd-req">*</span></label>
                <el-select v-model="form.type" :disabled="immutable" style="width:100%">
                  <el-option label="Proof" value="proof" />
                  <el-option label="Counter Evidence" value="counter_evidence" />
                  <el-option label="Mitigation Strategy" value="mitigation_strategy" />
                </el-select>
              </div>
              <div class="evd-field">
                <label>Expires On</label>
                <el-date-picker v-model="form.expiresOn" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD" :disabled="immutable" style="width:100%" />
              </div>
              <div class="evd-field">
                <label>Author</label>
                <el-input :model-value="evidence.authorName || authStore.user?.displayName || '—'" disabled />
              </div>
              <div class="evd-field">
                <label>Reviewer <span class="evd-req">*</span></label>
                <el-select
                  v-model="form.reviewerId"
                  :disabled="immutable"
                  filterable
                  clearable
                  placeholder="Select reviewer…"
                  style="width:100%"
                >
                  <el-option
                    v-for="u in reviewerOptions"
                    :key="u.id"
                    :label="u.displayName"
                    :value="u.id"
                  />
                </el-select>
              </div>
              <div class="evd-field evd-span-2">
                <label>Owner <span class="evd-opt">(optional)</span></label>
                <el-input v-model="form.owner" :disabled="immutable" placeholder="Person or team responsible for this evidence record" />
              </div>
            </div>
          </div>
        </div>

        <!-- ── DESCRIPTION + EVIDENCE NOTES TABS ── -->
        <div class="evd-card">
          <el-tabs v-model="activeTab" class="evd-tabs">
            <el-tab-pane label="Description" name="description">
              <div class="evd-tab-body">
                <div class="evd-field">
                  <label>Notes</label>
                  <el-input
                    v-model="form.description"
                    type="textarea"
                    :rows="8"
                    :disabled="immutable"
                    :maxlength="4000"
                    show-word-limit
                    placeholder="Describe the evidence, context, and how it satisfies the requirement…"
                  />
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane :label="`Review Notes (${reviewNotes.length})`" name="reviewNotes">
              <div class="evd-tab-body">
                <p v-if="!reviewNotes.length" class="evd-empty-notes">No review notes yet. A reviewer's reason for sending evidence back appears here.</p>
                <div v-for="n in reviewNotes" :key="n.id" class="evd-review-note">
                  <div class="evd-review-note-meta">{{ n.author }} · {{ n.createdAt ? new Date(n.createdAt).toLocaleString() : '' }}</div>
                  <div class="evd-review-note-body">{{ n.content }}</div>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="Evidence Notes" name="evidenceNotes">
              <div class="evd-tab-body">
                <div class="evd-field">
                  <label>Evidence Notes</label>
                  <el-input
                    v-model="form.evidenceNotes"
                    type="textarea"
                    :rows="8"
                    :disabled="immutable"
                    :maxlength="2000"
                    show-word-limit
                    placeholder="Internal notes — review observations, concerns, follow-up actions…"
                  />
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="Attachments" name="attachments">
              <div class="evd-tab-body">
                <!-- Drop zone -->
                <div
                  class="evd-drop-zone"
                  :class="{ 'evd-drag-over': isDragOver }"
                  @dragover.prevent="isDragOver = true"
                  @dragleave="isDragOver = false"
                  @drop.prevent="handleDrop"
                  @click="!immutable && fileInput?.click()"
                >
                  <input ref="fileInput" type="file" multiple style="display:none" @change="handleFileSelect" />
                  <el-icon :size="28" style="color:var(--cat-text-tertiary);display:block;margin-bottom:8px"><Upload /></el-icon>
                  <span class="evd-drop-label"><span>Click to upload</span> or drag and drop</span>
                  <span class="evd-drop-hint">Any file type accepted · Max 50 MB per file</span>
                </div>

                <div v-if="attachedFiles.length > 0" class="evd-attached-list">
                  <div v-for="(f, i) in attachedFiles" :key="f.id ?? i" class="evd-attached-file">
                    <el-icon style="color:var(--el-color-primary);font-size:18px"><Document /></el-icon>
                    <div class="evd-file-info">
                      <div class="evd-file-name">{{ f.name }}</div>
                      <div class="evd-file-meta">{{ f.sizeLabel }} · {{ f.addedAt }}</div>
                    </div>
                    <el-button v-if="f.id" link type="primary" title="Download" @click="downloadAttachment(f)">
                      <el-icon><Download /></el-icon>
                    </el-button>
                    <el-button v-if="!immutable" link type="danger" title="Remove" @click="removeAttachment(i)">
                      <el-icon><Close /></el-icon>
                    </el-button>
                  </div>
                </div>
                <div v-else class="evd-no-files">No files attached yet.</div>
              </div>
            </el-tab-pane>
            <el-tab-pane label="Related Links" name="links">
              <div class="evd-tab-body">
                <div v-if="relatedLinks.length === 0" class="evd-no-files">
                  No related links yet.
                </div>
                <div v-for="(lnk, i) in relatedLinks" :key="i" class="evd-link-row">
                  <el-input v-model="lnk.url" placeholder="https://…" style="flex:2" :disabled="immutable" />
                  <el-input v-model="lnk.label" placeholder="Label (optional)" style="flex:1" :disabled="immutable" />
                  <el-button v-if="!immutable" link type="danger" @click="relatedLinks.splice(i, 1)" :aria-label="`Remove link ${lnk.label || lnk.url || i + 1}`"><el-icon><Delete /></el-icon></el-button>
                </div>
                <el-button v-if="!immutable" :icon="Plus" style="margin-top:10px" @click="relatedLinks.push({ url: '', label: '' })">Add Link</el-button>
              </div>
            </el-tab-pane>
            <el-tab-pane :label="`Cited in (${citations.length})`" name="citedIn">
              <div class="evd-tab-body">
                <p v-if="citationsError" class="evd-empty-notes">{{ citationsError }}</p>
                <p v-else-if="!citations.length" class="evd-empty-notes">No claim cites this evidence yet.</p>
                <div v-for="c in citations" :key="c.id" class="evd-citation">
                  <div class="evd-citation-head">
                    <router-link :to="`/claims/${c.id}`" class="evd-citation-name">{{ c.name }}</router-link>
                    <el-tag v-if="c.isCounterClaim" size="small" type="danger" effect="plain" disable-transitions>Counter claim</el-tag>
                    <el-tag size="small" :type="citationRoleType(c)" disable-transitions>{{ citationRole(c) }}</el-tag>
                  </div>
                  <div class="evd-citation-body">{{ c.target }}: {{ c.predicate }}</div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>

          <div class="evd-tab-footer">
            <el-button v-if="evidence.state === 'in_progress' && !immutable" type="warning" @click="submitForReview">Submit for Review</el-button>
            <el-button v-if="!immutable" type="primary" :loading="saving" @click="saveAll">Save Changes</el-button>
          </div>
        </div>

        <!-- ── GEOLOCATION ── -->
        <div class="evd-card">
          <div class="evd-card-header">
            <span class="evd-card-title"><el-icon><Location /></el-icon> Geolocation <span class="evd-opt" style="text-transform:none;letter-spacing:0;margin-left:6px;">(optional)</span></span>
          </div>
          <div class="evd-card-body">
            <div class="evd-geo-row">
              <div class="evd-field">
                <label>Latitude</label>
                <el-input
                  v-model="form.geoLatitude"
                  :disabled="immutable"
                  placeholder="e.g. 37.7749"
                />
              </div>
              <div class="evd-field">
                <label>Longitude</label>
                <el-input
                  v-model="form.geoLongitude"
                  :disabled="immutable"
                  placeholder="e.g. -122.4194"
                />
              </div>
              <el-button :disabled="immutable" :loading="geoLoading" @click="detectLocation" style="align-self:flex-end">
                <el-icon><Aim /></el-icon> Detect
              </el-button>
            </div>
            <div v-if="form.geoLatitude && form.geoLongitude" class="evd-geo-detected">
              <el-icon style="color:var(--el-color-success)"><CircleCheck /></el-icon>
              Location: {{ form.geoLatitude }}, {{ form.geoLongitude }}
            </div>
            <el-alert v-if="geoError" type="error" :description="geoError" :closable="false" show-icon style="margin-top:10px" />
            <div class="evd-field" style="margin-top:14px">
              <label>Location Label <span class="evd-opt">(optional)</span></label>
              <el-input v-model="form.geoLabel" :disabled="immutable" placeholder="e.g. HQ – San Francisco, CA" />
            </div>
          </div>
        </div>

        <!-- ── JSON OUTPUT ── -->
        <div class="evd-card">
          <div class="evd-card-header">
            <span class="evd-card-title"><el-icon><DataLine /></el-icon> JSON Output</span>
            <div style="display:flex;gap:8px">
              <el-button size="small" :icon="CopyDocument" @click="copyJson">Copy</el-button>
              <el-button size="small" :icon="Download" @click="downloadJson">Download</el-button>
            </div>
          </div>
          <div class="evd-json-wrap">
            <pre class="evd-json" v-html="highlightedJson"></pre>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Loading, ArrowRight, ArrowLeft, DocumentChecked, Paperclip, Upload,
  Document, Close, Delete, Plus, DataLine, CopyDocument, Download,
  Location, Aim, CircleCheck,
} from '@element-plus/icons-vue'
import StateBadge from '@/components/shared/StateBadge.vue'
import { apiErrorMessage } from '@/utils/errorMessage'
import { useAuthStore } from '@/stores/auth'
import type { Evidence } from '@/types'

const route     = useRoute()
const router    = useRouter()
const authStore = useAuthStore()

function fmtEvdId(n?: number): string {
  if (!n) return 'EVD-???'
  return `EVD-${String(n).padStart(4, '0')}`
}

// ── State ───────────────────────────────────────────────────────────────────
const loading   = ref(false)
const loadError = ref('')
const saving    = ref(false)
const deciding  = ref(false)
interface ReviewNote { id: string; content: string; author: string; createdAt: string }
const reviewNotes = ref<ReviewNote[]>([])
const evidence  = ref<Evidence | null>(null)
const immutable = ref(false)
const activeTab = ref('description')

// Claims that cite this evidence, as supporting, counter or mitigation evidence
interface Citation {
  id: string; name: string; target: string; predicate: string
  isCounterClaim: boolean; isCounter: boolean; isMitigation: boolean
}
const citations = ref<Citation[]>([])
const citationsError = ref('')

// Reviewer user list
interface AssignableUser { id: string; displayName: string; username: string }
const reviewerOptions = ref<AssignableUser[]>([])

const form = ref({
  name: '', state: 'in_progress', type: 'proof' as string,
  expiresOn: '', owner: '', reviewerId: '' as string | null,
  description: '', evidenceNotes: '',
  geoLatitude: '' as string,
  geoLongitude: '' as string,
  geoLabel: '',
})

const geoLoading  = ref(false)
const geoDetected = ref(false)
const geoError    = ref('')

interface AttachedFile { id?: string; name: string; size: number; sizeLabel: string; addedAt: string }
interface RelatedLink  { url: string; label: string }

const attachedFiles = ref<AttachedFile[]>([])
const relatedLinks  = ref<RelatedLink[]>([])
const isDragOver    = ref(false)
const fileInput     = ref<HTMLInputElement | null>(null)

// ── Computed ────────────────────────────────────────────────────────────────
const jsonOutput = computed(() => {
  if (!evidence.value) return {}
  return {
    schema_version: '1.0',
    record_type: 'evidence',
    evidence_id: evidence.value.id,
    name: form.value.name,
    state: form.value.state,
    type: form.value.type || null,
    owner: form.value.owner || null,
    expires_on: form.value.expiresOn || null,
    notes: form.value.description || null,
    evidence_notes: form.value.evidenceNotes || null,
    attachments: attachedFiles.value.map(f => ({ name: f.name, size_bytes: f.size, added_at: f.addedAt })),
    related_links: relatedLinks.value.filter(l => l.url).map(l => ({ url: l.url, label: l.label || null })),
    geolocation: (form.value.geoLatitude || form.value.geoLongitude) ? {
      latitude: form.value.geoLatitude ? parseFloat(form.value.geoLatitude) : null,
      longitude: form.value.geoLongitude ? parseFloat(form.value.geoLongitude) : null,
      label: form.value.geoLabel || null,
    } : null,
  }
})

const highlightedJson = computed(() =>
  JSON.stringify(jsonOutput.value, null, 2)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "(.*?)"/g, (_, v) => `: <span class="jvs">"${v}"</span>`)
    .replace(/: (\d+\.?\d*)/g, ': <span class="jvn">$1</span>')
    .replace(/: (true|false)/g, ': <span class="jvb">$1</span>')
    .replace(/: null/g, ': <span class="jvx">null</span>')
)

// ── Data ────────────────────────────────────────────────────────────────────
async function fetchCitations() {
  citationsError.value = ''
  try {
    const { data } = await client.get(`/evidence/${encodeURIComponent(String(route.params.id))}/claims`)
    citations.value = (data.data ?? []) as Citation[]
  } catch (e: unknown) {
    citations.value = []
    citationsError.value = apiErrorMessage(e, 'Could not load the claims that cite this evidence')
  }
}

function citationRole(c: Citation): string {
  if (c.isMitigation) return 'Mitigation'
  return c.isCounter ? 'Counter evidence' : 'Supporting'
}

function citationRoleType(c: Citation): string {
  if (c.isMitigation) return 'warning'
  return c.isCounter ? 'danger' : 'success'
}

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
    const { data } = await client.get(`/evidence/${encodeURIComponent(String(route.params.id))}`)
    // camelCaseResponse middleware transforms all keys before they reach here,
    // so the evidence object already has camelCase keys.
    const raw = data.evidence ?? data
    const normalised: Evidence = {
      id:               raw.id,
      displayId:        raw.displayId,
      name:             raw.name || '',
      description:      raw.description || '',
      evidenceNotes:    raw.evidenceNotes || null,
      state:            raw.state || 'in_progress',
      classification:   raw.classification || '',
      author:           raw.authorName || raw.authorId || '',
      authorName:       raw.authorName || undefined,
      authorId:         raw.authorId || undefined,
      reviewer:         raw.reviewerName || undefined,
      reviewerName:     raw.reviewerName || undefined,
      reviewerId:       raw.reviewerId || undefined,
      isCounterEvidence: raw.isCounterEvidence ?? false,
      type:             raw.type || (raw.isCounterEvidence ? 'counter_evidence' : null),
      owner:            raw.owner || null,
      geoLatitude:      raw.geoLatitude ?? null,
      geoLongitude:     raw.geoLongitude ?? null,
      geoLabel:         raw.geoLabel ?? null,
      createdAt:        raw.createdAt || '',
      updatedAt:        raw.updatedAt || '',
      expiresOn:        raw.expiresOn ? String(raw.expiresOn).slice(0, 10) : undefined,
      attachments:      [],
    }
    evidence.value = normalised
    immutable.value = normalised.state === 'claimed'
    reviewNotes.value = ((data.notes ?? []) as Record<string, string>[]).map((n) => ({
      id: n.id,
      content: n.content,
      author: n.authorDisplayName || n.authorUsername || '—',
      createdAt: n.createdAt,
    }))

    form.value = {
      name:          normalised.name,
      state:         normalised.state,
      type:          normalised.type || 'proof',
      expiresOn:     normalised.expiresOn || '',
      owner:         normalised.owner || '',
      reviewerId:    normalised.reviewerId || null,
      description:   normalised.description || '',
      evidenceNotes: normalised.evidenceNotes || '',
      geoLatitude:   normalised.geoLatitude != null ? String(normalised.geoLatitude) : '',
      geoLongitude:  normalised.geoLongitude != null ? String(normalised.geoLongitude) : '',
      geoLabel:      normalised.geoLabel || '',
    }
    geoDetected.value = !!(normalised.geoLatitude && normalised.geoLongitude)

    const rawAttachments: { id: string; filename: string; sizeBytes: number; createdAt: string }[] = data.attachments ?? []
    attachedFiles.value = rawAttachments.map(a => ({
      id: a.id,
      name: a.filename,
      size: a.sizeBytes ?? 0,
      sizeLabel: fmtBytes(a.sizeBytes ?? 0),
      addedAt: a.createdAt?.slice(0, 10) ?? '',
    }))
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load evidence')
  } finally {
    loading.value = false
  }
}

function detectLocation() {
  if (!navigator.geolocation) { geoError.value = 'Geolocation is not supported by this browser.'; return }
  geoLoading.value = true; geoError.value = ''; geoDetected.value = false
  navigator.geolocation.getCurrentPosition(
    pos => {
      form.value.geoLatitude  = pos.coords.latitude.toFixed(6)
      form.value.geoLongitude = pos.coords.longitude.toFixed(6)
      geoDetected.value  = true
      geoLoading.value   = false
      ElMessage.success('Location detected')
    },
    err => { geoLoading.value = false; geoError.value = 'Unable to detect location: ' + err.message },
    { timeout: 10000 }
  )
}

async function saveAll() {
  if (!form.value.name.trim()) { ElMessage.error('Name is required'); return }
  if (!form.value.reviewerId) { ElMessage.error('Reviewer is required'); return }
  saving.value = true
  try {
    await client.put(`/evidence/${encodeURIComponent(String(route.params.id))}`, {
      name:          form.value.name.trim(),
      // Only a real change: evidence in review keeps its state until the
      // reviewer decides, and PUT refuses 'in_review'.
      ...(form.value.state !== evidence.value?.state ? { state: form.value.state } : {}),
      type:          form.value.type || null,
      expiresOn:     form.value.expiresOn || null,
      owner:         form.value.owner || null,
      reviewerId:    form.value.reviewerId,
      description:   form.value.description || null,
      evidenceNotes: form.value.evidenceNotes || null,
      geoLatitude:   form.value.geoLatitude !== '' ? parseFloat(form.value.geoLatitude) : null,
      geoLongitude:  form.value.geoLongitude !== '' ? parseFloat(form.value.geoLongitude) : null,
      geoLabel:      form.value.geoLabel || null,
    })
    ElMessage.success('Evidence saved')
    await fetchEvidence()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to save'))
  } finally {
    saving.value = false
  }
}

// Review goes through its own endpoints, which check the reviewer and
// notify the people involved.
const canDecide = computed(() => {
  const ev = evidence.value
  const me = authStore.user?.id
  if (!ev || ev.state !== 'in_review' || !me || ev.authorId === me) return false
  return ev.reviewerId === me || authStore.hasPermission('admin.settings')
})

async function approveEvidence() {
  try {
    await ElMessageBox.confirm('Approve this evidence? Approved evidence is locked.', 'Approve evidence', { type: 'warning', confirmButtonText: 'Approve' })
  } catch { return }
  deciding.value = true
  try {
    await client.post(`/evidence/${encodeURIComponent(String(route.params.id))}/approve`)
    ElMessage.success('Evidence approved')
    await fetchEvidence()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to approve'))
  } finally {
    deciding.value = false
  }
}

async function rejectEvidence() {
  let note: string
  try {
    const { value } = await ElMessageBox.prompt('Tell the author what to change. They see this note.', 'Reject evidence', {
      confirmButtonText: 'Reject',
      inputType: 'textarea',
      inputValidator: (v: string) => (v && v.trim().length > 0) || 'A reason is required',
    })
    note = value.trim()
  } catch { return }
  deciding.value = true
  try {
    await client.post(`/evidence/${encodeURIComponent(String(route.params.id))}/reject`, { note })
    ElMessage.success('Evidence sent back to the author')
    await fetchEvidence()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to reject'))
  } finally {
    deciding.value = false
  }
}

async function submitForReview() {
  if (!form.value.reviewerId) { ElMessage.error('Choose a reviewer first'); return }
  saving.value = true
  try {
    await client.post(`/evidence/${encodeURIComponent(String(route.params.id))}/submit-for-review`, { reviewerId: form.value.reviewerId })
    ElMessage.success('Submitted for review')
    await fetchEvidence()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to submit'))
  } finally {
    saving.value = false
  }
}

// ── File handling ────────────────────────────────────────────────────────────
function fmtBytes(b: number) {
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

async function processFiles(files: File[]) {
  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) { ElMessage.error(`${f.name} exceeds the 50 MB limit`); continue }
    try {
      const fd = new FormData()
      fd.append('file', f)
      const { data } = await client.post(
        `/evidence/${encodeURIComponent(String(route.params.id))}/attachments`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      // response: { attachments: [{ id, filename, sizeBytes, createdAt, ... }] }
      const uploaded = Array.isArray(data.attachments) ? data.attachments : []
      for (const a of uploaded) {
        attachedFiles.value.push({
          id: a.id,
          name: a.filename,
          size: a.sizeBytes ?? f.size,
          sizeLabel: fmtBytes(a.sizeBytes ?? f.size),
          addedAt: a.createdAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        })
      }
      ElMessage.success(`${f.name} uploaded`)
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, `Failed to upload ${f.name}`))
    }
  }
}

async function removeAttachment(index: number) {
  const f = attachedFiles.value[index]
  if (f.id) {
    try {
      await client.delete(`/evidence/${encodeURIComponent(String(route.params.id))}/attachments/${f.id}`)
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, 'Failed to remove attachment'))
      return
    }
  }
  attachedFiles.value.splice(index, 1)
}

function downloadAttachment(f: AttachedFile) {
  if (!f.id) return
  const a = document.createElement('a')
  a.href = `/api/v1/evidence/${encodeURIComponent(String(route.params.id))}/attachments/${f.id}/download`
  a.download = f.name
  a.click()
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  processFiles(Array.from(target.files ?? []))
  target.value = ''
}

function handleDrop(e: DragEvent) {
  isDragOver.value = false
  processFiles(Array.from(e.dataTransfer?.files ?? []))
}

// ── JSON export ──────────────────────────────────────────────────────────────
function copyJson() {
  navigator.clipboard.writeText(JSON.stringify(jsonOutput.value, null, 2))
    .then(() => ElMessage.success('JSON copied to clipboard'))
    .catch(() => ElMessage.error('Could not copy'))
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(jsonOutput.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = `evidence-${encodeURIComponent(String(route.params.id))}.json`; a.click(); URL.revokeObjectURL(a.href)
  ElMessage.success('JSON downloaded')
}

onMounted(() => { fetchEvidence(); fetchReviewers(); fetchCitations() })

// The route reuses this component when moving from one evidence item to
// another, so reload when the id changes instead of showing the old item.
watch(() => route.params.id, (id, previous) => {
  if (!id || id === previous) return
  activeTab.value = 'description'
  fetchEvidence()
  fetchCitations()
})
</script>

<style scoped lang="scss">
.evd-page { padding: 0; min-height: 100vh; }

.evd-loading {
  display: flex; align-items: center; justify-content: center;
  gap: 8px; padding: 64px; color: var(--cat-text-secondary);
}

.evd-subheader {
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 12px 24px 0;
}

.evd-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 14px;
}

.evd-record-type {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--cat-text-tertiary); font-weight: 600;
}

.evd-record-name {
  font-size: 16px; font-weight: 700; color: var(--cat-text-primary); margin-top: 2px;
}

.evd-header-actions { display: flex; gap: 8px; }

.evd-content {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 24px 60px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

// Cards
.evd-card {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.evd-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
}

.evd-card-title {
  font-size: 13px; font-weight: 600; color: var(--cat-text-secondary);
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; gap: 7px; flex: 1;
  .el-icon { color: var(--el-color-primary); }
}

.evd-id-chip {
  font-family: monospace; font-size: 12px; font-weight: 700;
  background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2);
  padding: 3px 9px; border-radius: 5px; letter-spacing: 0.5px;
}

.evd-attach-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px;
  background: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
  font-size: 12px; color: var(--cat-text-secondary);
}

.evd-card-body { padding: 18px; }

// Form grid
.evd-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
}

.evd-field {
  display: flex; flex-direction: column; gap: 5px;
  label {
    font-size: 12px; font-weight: 600; color: var(--cat-text-secondary);
    text-transform: uppercase; letter-spacing: 0.4px;
  }
}

.evd-span-2 { grid-column: span 2; }
.evd-req { color: var(--el-color-danger); }
.evd-opt { color: var(--cat-text-tertiary); font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 3px; }

// Tabs
.evd-tabs {
  :deep(.el-tabs__header) { margin: 0; border-bottom: 1px solid var(--cat-border-default); padding: 0 18px; }
  :deep(.el-tabs__content) { padding: 0; }
}

.evd-tab-body { padding: 18px; }
.evd-tab-footer {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 12px 18px; border-top: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
}

// Drop zone
.evd-drop-zone {
  border: 2px dashed var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  background: var(--cat-bg-primary);

  &:hover, &.evd-drag-over {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}

.evd-drop-label {
  display: block; font-size: 14px; font-weight: 600;
  color: var(--cat-text-secondary); margin-bottom: 4px;
  span { color: var(--el-color-primary); text-decoration: underline; }
}

.evd-drop-hint { font-size: 12px; color: var(--cat-text-tertiary); }

.evd-attached-list { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }

.evd-attached-file {
  display: flex; align-items: center; gap: 10px;
  background: var(--cat-bg-secondary); border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-sm); padding: 8px 12px; font-size: 13px;
}

.evd-file-info { flex: 1; min-width: 0; }
.evd-file-name { font-weight: 600; color: var(--cat-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evd-file-meta { font-size: 11px; color: var(--cat-text-tertiary); margin-top: 1px; }

.evd-no-files {
  text-align: center; padding: 24px; color: var(--cat-text-tertiary); font-size: 13px;
}

.evd-link-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }

// Geolocation
.evd-geo-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: start;
}

.evd-geo-detected {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; padding: 8px 12px;
  background: var(--el-color-success-light-9);
  border: 1px solid var(--el-color-success-light-5);
  border-radius: var(--cat-radius-sm);
  font-size: 13px; color: var(--el-color-success-dark-2);
}

// JSON
.evd-json-wrap {
  background: #1a1d23;
  padding: 16px;
  max-height: 360px;
  overflow: auto;
}

.evd-json {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #c5cdd8;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;

  :deep(.jk)  { color: #5ba0f7; }
  :deep(.jvs) { color: #7ec67e; }
  :deep(.jvn) { color: #f5a623; }
  :deep(.jvb) { color: #e07db0; }
  :deep(.jvx) { color: #a0aab4; }
}

.evd-empty-notes { color: var(--cat-text-tertiary); font-size: 13px; margin: 0; }
.evd-review-note { padding: 10px 0; border-bottom: 1px solid var(--cat-border-muted); }
.evd-review-note:last-child { border-bottom: none; }
.evd-review-note-meta { font-size: 12px; color: var(--cat-text-tertiary); margin-bottom: 4px; }
.evd-review-note-body { white-space: pre-wrap; font-size: 14px; }
.evd-citation { padding: 10px 0; border-bottom: 1px solid var(--cat-border-muted); }
.evd-citation:last-child { border-bottom: none; }
.evd-citation-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.evd-citation-name { font-size: 14px; font-weight: 500; color: var(--el-color-primary); text-decoration: none; }
.evd-citation-name:hover { text-decoration: underline; }
.evd-citation-body { font-size: 13px; color: var(--cat-text-secondary); }
</style>
