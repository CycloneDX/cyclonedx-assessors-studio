<template>
  <div class="md-page">
    <!-- Page header -->
    <PageHeader :title="mitigation?.title ?? 'Mitigation'">
      <template #subtitle>
        <span class="md-record-type">Mitigation Strategy</span>
      </template>
      <template #actions>
        <el-button @click="router.back()"><el-icon><ArrowLeft /></el-icon> Back</el-button>
        <el-button :loading="saving" @click="saveChanges">Save Changes</el-button>
        <el-button v-if="canRollback" plain style="color:var(--el-color-danger);border-color:var(--el-color-danger)" @click="openTransition(true)">
          <el-icon><RefreshLeft /></el-icon> Rollback
        </el-button>
        <el-button v-if="canAdvance" type="success" @click="openTransition(false)">
          <el-icon><ArrowRight /></el-icon> Advance to {{ nextStatus }}
        </el-button>
      </template>
    </PageHeader>

    <!-- Status pipeline -->
    <div v-if="form" class="md-pipeline">
      <div v-for="(step, idx) in statusSteps" :key="step" class="md-pipe-step">
        <div class="md-pipe-node" :class="pipeClass(idx)">
          <div class="md-pipe-dot">
            <el-icon v-if="statusIndex > idx"><Check /></el-icon>
            <span v-else>{{ idx + 1 }}</span>
          </div>
          <div class="md-pipe-label">{{ step }}</div>
        </div>
        <el-icon v-if="idx < statusSteps.length - 1" class="md-pipe-arrow"><ArrowRight /></el-icon>
      </div>
    </div>

    <div v-if="loading" class="md-loading">
      <el-icon class="is-loading"><Loading /></el-icon> Loading…
    </div>
    <el-alert v-else-if="loadError" type="error" :description="loadError" show-icon :closable="false" style="margin:16px 24px" />

    <div v-else-if="form" class="md-body">
      <!-- MAIN COL -->
      <div class="md-main-col">

        <!-- Core details card -->
        <div class="md-card">
          <div class="md-card-header">
            <span class="md-card-title"><el-icon><ShieldIcon /></el-icon> Mitigation Details</span>
            <span class="md-id-chip">{{ fmtMtgId(mitigation?.displayId) }}</span>
          </div>
          <div class="md-card-body">
            <div class="md-form-grid">
              <div class="md-field md-span-2">
                <label>Title <span class="md-req">*</span></label>
                <el-input v-model="form.title" placeholder="Short descriptive title" :status="formErrors.title ? 'error' : ''" />
                <span v-if="formErrors.title" class="md-field-error">{{ formErrors.title }}</span>
              </div>
              <div class="md-field">
                <label>Type <span class="md-req">*</span></label>
                <el-select v-model="form.type" style="width:100%">
                  <el-option label="Preventive"   value="Preventive" />
                  <el-option label="Detective"    value="Detective" />
                  <el-option label="Corrective"   value="Corrective" />
                  <el-option label="Compensating" value="Compensating" />
                </el-select>
                <span v-if="formErrors.type" class="md-field-error">{{ formErrors.type }}</span>
              </div>
              <div class="md-field">
                <label>Category <span class="md-req">*</span></label>
                <el-select v-model="form.category" style="width:100%">
                  <el-option label="Technical"      value="Technical" />
                  <el-option label="Procedural"     value="Procedural" />
                  <el-option label="Physical"       value="Physical" />
                  <el-option label="Administrative" value="Administrative" />
                </el-select>
                <span v-if="formErrors.category" class="md-field-error">{{ formErrors.category }}</span>
              </div>
              <div class="md-field">
                <label>Priority <span class="md-req">*</span></label>
                <el-select v-model="form.priority" style="width:100%">
                  <el-option label="Critical" value="Critical" />
                  <el-option label="High"     value="High" />
                  <el-option label="Medium"   value="Medium" />
                  <el-option label="Low"      value="Low" />
                </el-select>
                <span v-if="formErrors.priority" class="md-field-error">{{ formErrors.priority }}</span>
              </div>
              <div class="md-field">
                <label>Status</label>
                <div class="md-status-readonly">
                  <span class="md-status-chip" :class="`md-status--${form.status.toLowerCase().replace(' ', '-')}`">{{ form.status }}</span>
                </div>
                <span class="md-field-hint">Use Advance / Rollback to change status. All transitions are logged.</span>
              </div>
              <div class="md-field md-span-2">
                <label>Description <span class="md-req">*</span></label>
                <el-input v-model="form.description" type="textarea" :rows="4" maxlength="500" show-word-limit
                  placeholder="Describe what this mitigation does and how it addresses the risk…"
                  :status="formErrors.description ? 'error' : ''" />
                <span v-if="formErrors.description" class="md-field-error">{{ formErrors.description }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Tabbed card -->
        <div class="md-card">
          <el-tabs v-model="activeTab" class="md-tabs">
            <el-tab-pane name="links">
              <template #label><el-icon><Link /></el-icon> Linked Records</template>
              <div class="md-tab-body">
                <!-- Claims -->
                <div class="md-section-label"><el-icon><ScaleBalanced /></el-icon> Linked Claims
                  <span class="md-count-badge">{{ form.linkedClaims.length }}</span>
                </div>
                <div class="md-linked-table">
                  <div class="md-linked-head">
                    <div>Claim ID</div><div>Name</div><div>Status</div><div></div>
                  </div>
                  <div v-if="form.linkedClaims.length === 0" class="md-linked-empty">No claims linked yet.</div>
                  <div v-for="c in form.linkedClaims" :key="c.id" class="md-linked-row">
                    <div><span class="md-id-chip md-id-chip--sm">{{ fmtClmId(c) }}</span></div>
                    <div class="md-linked-name">{{ c.name }}</div>
                    <div><span class="md-status-chip md-status--sm" :class="`md-claim-${(c.status||'').toLowerCase()}`">{{ c.status || '—' }}</span></div>
                    <div><el-button link type="danger" size="small" @click="unlinkClaim(c.id)" :aria-label="`Unlink claim ${c.name}`"><el-icon><Delete /></el-icon></el-button></div>
                  </div>
                </div>
                <el-button size="small" class="md-link-btn" @click="openClaimPicker"><el-icon><Link /></el-icon> Link Claim</el-button>

                <!-- Evidence -->
                <div class="md-section-label" style="margin-top:20px"><el-icon><FolderOpened /></el-icon> Linked Evidence
                  <span class="md-count-badge">{{ form.linkedEvidence.length }}</span>
                </div>
                <div class="md-linked-table">
                  <div class="md-linked-head">
                    <div>Evidence ID</div><div>Name</div><div>State</div><div></div>
                  </div>
                  <div v-if="form.linkedEvidence.length === 0" class="md-linked-empty">No evidence linked yet.</div>
                  <div v-for="e in form.linkedEvidence" :key="e.id" class="md-linked-row">
                    <div><span class="md-id-chip md-id-chip--sm">{{ fmtEvdId(e) }}</span></div>
                    <div class="md-linked-name">{{ e.name }}</div>
                    <div><span class="md-state-chip">{{ e.state }}</span></div>
                    <div><el-button link type="danger" size="small" @click="unlinkEvidence(e.id)" :aria-label="`Unlink evidence ${e.name}`"><el-icon><Delete /></el-icon></el-button></div>
                  </div>
                </div>
                <el-button size="small" class="md-link-btn" @click="openEvidencePicker"><el-icon><Link /></el-icon> Link Evidence</el-button>
              </div>
            </el-tab-pane>

            <el-tab-pane name="effectiveness">
              <template #label><el-icon><TrendCharts /></el-icon> Effectiveness</template>
              <div class="md-tab-body">
                <el-alert v-if="effLocked" type="warning" :closable="false" show-icon style="margin-bottom:16px">
                  Effectiveness can only be rated after the mitigation reaches <strong>Verified</strong> status.
                </el-alert>
                <div class="md-eff-grid">
                  <div class="md-eff-card" :class="{ 'md-eff--effective': form.effectiveness === 'Effective', 'md-eff--selected': form.effectiveness === 'Effective' }"
                    @click="!effLocked && (form.effectiveness = 'Effective')">
                    <el-icon class="md-eff-icon" style="color:var(--el-color-success)"><CircleCheck /></el-icon>
                    <span class="md-eff-label">Effective</span>
                    <span class="md-eff-desc">Fully addresses the risk</span>
                  </div>
                  <div class="md-eff-card" :class="{ 'md-eff--partial': form.effectiveness === 'Partially Effective', 'md-eff--selected': form.effectiveness === 'Partially Effective' }"
                    @click="!effLocked && (form.effectiveness = 'Partially Effective')">
                    <el-icon class="md-eff-icon" style="color:var(--el-color-warning)"><Warning /></el-icon>
                    <span class="md-eff-label">Partially Effective</span>
                    <span class="md-eff-desc">Reduces but does not eliminate risk</span>
                  </div>
                  <div class="md-eff-card" :class="{ 'md-eff--ineffective': form.effectiveness === 'Not Effective', 'md-eff--selected': form.effectiveness === 'Not Effective' }"
                    @click="!effLocked && (form.effectiveness = 'Not Effective')">
                    <el-icon class="md-eff-icon" style="color:var(--el-color-danger)"><CircleClose /></el-icon>
                    <span class="md-eff-label">Not Effective</span>
                    <span class="md-eff-desc">Did not adequately address the risk</span>
                  </div>
                </div>
                <div class="md-field" style="margin-top:16px">
                  <label>Effectiveness Rationale</label>
                  <el-input v-model="form.effectivenessRationale" type="textarea" :rows="4" :disabled="effLocked"
                    maxlength="500" show-word-limit placeholder="Explain how the effectiveness rating was determined…" />
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane name="notes">
              <template #label><el-icon><Notebook /></el-icon> Notes</template>
              <div class="md-tab-body">
                <el-input v-model="form.notes" type="textarea" :rows="8" maxlength="2000" show-word-limit
                  placeholder="Internal notes, observations, caveats…" />
              </div>
            </el-tab-pane>

            <el-tab-pane name="audit">
              <template #label>
                <el-icon><Clock /></el-icon> Audit Log
                <span class="md-tab-badge">{{ auditLog.length }}</span>
              </template>
              <div class="md-tab-body">
                <div v-if="auditLog.length === 0" class="md-linked-empty" style="padding:32px">
                  <el-icon :size="28"><Clock /></el-icon>
                  <p>No audit entries yet.</p>
                </div>
                <div v-for="entry in auditLog" :key="entry.id" class="md-audit-entry">
                  <div class="md-audit-header">
                    <div class="md-audit-avatar">{{ initials(entry.userDisplayName ?? 'S') }}</div>
                    <div class="md-audit-meta">
                      <div class="md-audit-author">{{ entry.userDisplayName }}</div>
                      <div class="md-audit-date">{{ fmtAuditDate(entry.createdAt) }}</div>
                    </div>
                    <el-tag size="small" :type="auditActionTagType(entry.action)" style="margin-left:auto">{{ auditActionLabel(entry.action) }}</el-tag>
                  </div>
                  <div v-if="entry.action === 'state_change'" class="md-audit-transition" style="margin-top:8px">
                    <span class="md-status-chip md-status-chip--sm">{{ auditChangesGet(entry, 'from') }}</span>
                    <el-icon><ArrowRight /></el-icon>
                    <span class="md-status-chip md-status-chip--sm">{{ auditChangesGet(entry, 'to') }}</span>
                  </div>
                  <div v-else-if="entry.action === 'link' || entry.action === 'unlink'" class="md-audit-body">
                    {{ entry.action === 'link' ? 'Linked' : 'Unlinked' }}
                    {{ auditChangesGet(entry, 'linked') ?? auditChangesGet(entry, 'unlinked') }}:
                    <strong>{{ auditChangesGet(entry, 'claimName') ?? auditChangesGet(entry, 'evidenceName') ?? '—' }}</strong>
                  </div>
                  <div v-else-if="entry.action === 'update' && auditUpdateFields(entry).length > 0" class="md-audit-body">
                    <div v-for="f in auditUpdateFields(entry)" :key="f.field" class="md-audit-field-row">
                      <span class="md-audit-field-name">{{ f.field }}</span>:
                      <span class="md-audit-field-old">{{ fmtAuditValue(f.from) }}</span>
                      <el-icon style="font-size:11px"><ArrowRight /></el-icon>
                      <span class="md-audit-field-new">{{ fmtAuditValue(f.to) }}</span>
                    </div>
                  </div>
                  <div v-else-if="entry.action === 'delete'" class="md-audit-body">
                    Deleted: <strong>{{ auditChangesGet(entry, 'title') ?? '—' }}</strong>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>

          <!-- Bottom save row -->
          <div class="md-card-footer">
            <el-button :loading="saving" @click="saveChanges">Save Changes</el-button>
            <div style="flex:1" />
            <el-button v-if="canRollback" plain style="color:var(--el-color-danger);border-color:var(--el-color-danger)" @click="openTransition(true)">
              <el-icon><RefreshLeft /></el-icon> Rollback
            </el-button>
            <el-button v-if="canAdvance" type="success" @click="openTransition(false)">
              <el-icon><ArrowRight /></el-icon> Advance to {{ nextStatus }}
            </el-button>
          </div>
        </div>

      </div><!-- /main col -->

      <!-- SIDE COL -->
      <div class="md-side-col">

        <!-- Project Context -->
        <div class="md-card">
          <div class="md-card-header">
            <span class="md-card-title"><el-icon><Opportunity /></el-icon> Project Context</span>
          </div>
          <div class="md-meta-list">
            <div class="md-meta-row">
              <div class="md-meta-label">Owner</div>
              <div class="md-meta-value"><el-input v-model="form.owner" placeholder="Owner name" size="small" /></div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Responsible Team</div>
              <div class="md-meta-value"><el-input v-model="form.team" placeholder="Team name" size="small" /></div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Reviewer</div>
              <div class="md-meta-value"><el-input v-model="form.reviewer" placeholder="Reviewer name" size="small" /></div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Linked Assessment</div>
              <div class="md-meta-value"><el-input v-model="form.linkedAssessment" placeholder="e.g. AA1.4" size="small" /></div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Target Date <span class="md-req">*</span></div>
              <div class="md-meta-value">
                <el-date-picker v-model="form.targetDate" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD"
                  size="small" style="width:100%" :class="formErrors.targetDate ? 'md-input-error' : ''" />
                <span v-if="formErrors.targetDate" class="md-field-error">{{ formErrors.targetDate }}</span>
              </div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Completion Date</div>
              <div class="md-meta-value">
                <el-date-picker v-model="form.completionDate" type="date" format="YYYY-MM-DD" value-format="YYYY-MM-DD"
                  size="small" style="width:100%" :disabled="statusIndex < 1" />
              </div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Verified By</div>
              <div class="md-meta-value">
                <el-input v-model="form.verifiedBy" placeholder="Verifier name" size="small" :disabled="verifiedByLocked" />
              </div>
            </div>
          </div>
        </div>

        <!-- Classification -->
        <div class="md-card">
          <div class="md-card-header">
            <span class="md-card-title"><el-icon><PriceTag /></el-icon> Classification</span>
          </div>
          <div class="md-meta-list">
            <div class="md-meta-row">
              <div class="md-meta-label">Status</div>
              <div class="md-meta-value">
                <span class="md-status-chip" :class="`md-status--${form.status.toLowerCase().replace(' ', '-')}`">{{ form.status }}</span>
              </div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Priority</div>
              <div class="md-meta-value">
                <span class="md-pri-chip" :class="`md-pri--${form.priority.toLowerCase()}`">{{ form.priority }}</span>
              </div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Effectiveness</div>
              <div class="md-meta-value">
                <span v-if="form.effectiveness" class="md-eff-chip" :class="`md-eff-chip--${form.effectiveness.toLowerCase().replace(/\s+/g, '-')}`">{{ form.effectiveness }}</span>
                <span v-else class="md-muted">Not rated</span>
              </div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Created</div>
              <div class="md-meta-value md-muted">{{ formatDate(mitigation?.createdAt) }}</div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">Updated</div>
              <div class="md-meta-value md-muted">{{ formatDate(mitigation?.updatedAt) }}</div>
            </div>
            <div class="md-meta-row">
              <div class="md-meta-label">CycloneDX Ref</div>
              <div class="md-meta-value md-cdx-ref">mitigation / {{ fmtMtgId(mitigation?.displayId) }}</div>
            </div>
          </div>
        </div>

      </div><!-- /side col -->
    </div><!-- /body -->

    <!-- STATUS TRANSITION DIALOG -->
    <el-dialog v-model="showTransition" :title="transitionIsRollback ? 'Rollback Status' : 'Advance Status'" width="520px" :close-on-click-modal="false">
      <div class="md-transition-body">
        <div class="md-transition-arrow">
          <div>
            <div class="md-transition-dir-label">From</div>
            <span class="md-status-chip" :class="`md-status--${form?.status.toLowerCase().replace(' ', '-')}`">{{ form?.status }}</span>
          </div>
          <el-icon :size="20" :style="transitionIsRollback ? 'color:var(--el-color-danger)' : 'color:var(--el-color-success)'">
            <component :is="transitionIsRollback ? 'RefreshLeft' : 'ArrowRight'" />
          </el-icon>
          <div>
            <div class="md-transition-dir-label">To</div>
            <span class="md-status-chip" :class="`md-status--${transitionTarget.toLowerCase().replace(' ', '-')}`">{{ transitionTarget }}</span>
          </div>
        </div>

        <!-- Gate warnings -->
        <el-alert v-for="gate in transitionGates" :key="gate" type="warning" :title="gate" show-icon :closable="false" style="margin-bottom:10px" />

        <!-- Rollback reason -->
        <div v-if="transitionIsRollback" class="md-rollback-box">
          <div class="md-rollback-title"><el-icon><Warning /></el-icon> Rollback Reason Required</div>
          <el-input v-model="rollbackReason" type="textarea" :rows="3" :status="rollbackReasonError ? 'error' : ''"
            placeholder="Explain why this mitigation is being rolled back. This entry is immutable once saved." />
          <span v-if="rollbackReasonError" class="md-field-error">A reason is required for all rollbacks.</span>
        </div>

        <!-- Advance note -->
        <div v-if="!transitionIsRollback" class="md-field" style="margin-top:12px">
          <label>Transition Note <span class="md-opt">(optional)</span></label>
          <el-input v-model="advanceNote" type="textarea" :rows="2" placeholder="Optional note about this transition…" />
        </div>
      </div>
      <template #footer>
        <el-button @click="showTransition = false">Cancel</el-button>
        <el-button :type="transitionIsRollback ? 'danger' : 'success'" :disabled="transitionGates.length > 0" @click="confirmTransition">
          <el-icon><component :is="transitionIsRollback ? 'RefreshLeft' : 'ArrowRight'" /></el-icon>
          {{ transitionIsRollback ? 'Confirm Rollback' : 'Confirm Advance' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- CLAIM PICKER DIALOG -->
    <el-dialog v-model="showClaimPicker" title="Link a Claim" width="580px">
      <el-input v-model="claimSearch" placeholder="Search claims…" clearable style="margin-bottom:12px">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <div class="md-picker-table">
        <div class="md-picker-head"><div></div><div>Name</div><div>Status</div></div>
        <div v-if="filteredClaimPool.length === 0" class="md-linked-empty">No matching claims.</div>
        <div v-for="c in filteredClaimPool" :key="c.id" class="md-picker-row" :class="{ 'md-picker-row--selected': isClaimPicked(c.id) }" @click="toggleClaimPick(c)">
          <div><el-checkbox :model-value="isClaimPicked(c.id)" :aria-label="`Select claim ${c.name}`" @click.stop /></div>
          <div class="md-linked-name">{{ c.name }}</div>
          <div><span class="md-state-chip">{{ c.status }}</span></div>
        </div>
      </div>
      <template #footer>
        <span style="font-size:12px;color:var(--cat-text-secondary);flex:1">{{ claimPickSel.length }} selected</span>
        <el-button @click="showClaimPicker = false">Cancel</el-button>
        <el-button type="primary" :disabled="claimPickSel.length === 0" @click="confirmClaimPick">
          <el-icon><Link /></el-icon> Link Selected
        </el-button>
      </template>
    </el-dialog>

    <!-- EVIDENCE PICKER DIALOG -->
    <el-dialog v-model="showEvidencePicker" title="Link Evidence" width="620px">
      <el-input v-model="evidenceSearch" placeholder="Search evidence…" clearable style="margin-bottom:12px">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <div class="md-picker-table">
        <div class="md-picker-head"><div></div><div>Name</div><div>Type</div><div>State</div></div>
        <div v-if="filteredEvidencePool.length === 0" class="md-linked-empty">No matching evidence.</div>
        <div v-for="e in filteredEvidencePool" :key="e.id" class="md-picker-row md-picker-row--4" :class="{ 'md-picker-row--selected': isEvidencePicked(e.id) }" @click="toggleEvidencePick(e)">
          <div><el-checkbox :model-value="isEvidencePicked(e.id)" :aria-label="`Select evidence ${e.name}`" @click.stop /></div>
          <div class="md-linked-name">{{ e.name }}</div>
          <div><span class="md-state-chip">{{ e.type }}</span></div>
          <div><span class="md-state-chip">{{ e.state }}</span></div>
        </div>
      </div>
      <template #footer>
        <span style="font-size:12px;color:var(--cat-text-secondary);flex:1">{{ evidencePickSel.length }} selected</span>
        <el-button @click="showEvidencePicker = false">Cancel</el-button>
        <el-button type="primary" :disabled="evidencePickSel.length === 0" @click="confirmEvidencePick">
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
  Loading, ArrowLeft, ArrowRight, RefreshLeft, Check,
  Link, Delete, FolderOpened, CircleCheck, CircleClose,
  Warning, Clock, Search, Notebook, TrendCharts,
} from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { formatDate } from '@/utils/dateFormat'
import { apiErrorMessage } from '@/utils/errorMessage'
import type { Mitigation } from '@/types'

// Inline icons not in EP icon set
const ShieldIcon = { render: () => h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'width:1em;height:1em' }, [h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })]) }
const Opportunity = { render: () => h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'width:1em;height:1em' }, [h('circle', { cx: '12', cy: '12', r: '10' }), h('path', { d: 'M12 8v4l3 3' })]) }
const PriceTag = { render: () => h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'width:1em;height:1em' }, [h('path', { d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' }), h('line', { x1: '7', y1: '7', x2: '7.01', y2: '7' })]) }
const ScaleBalanced = { render: () => h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: 'width:1em;height:1em' }, [h('line', { x1: '12', y1: '3', x2: '12', y2: '21' }), h('path', { d: 'M3 9l9-6 9 6' }), h('path', { d: 'M3 15h6l-3 6-3-6z' }), h('path', { d: 'M15 15h6l-3 6-3-6z' })]) }

const route  = useRoute()
const router = useRouter()

function fmtMtgId(n?: number): string {
  if (!n) return 'MIT-???'
  return `MIT-${String(n).padStart(4, '0')}`
}

function fmtClmId(row: { id: string; displayId?: number }): string {
  if (row.displayId) return `CLM-${String(row.displayId).padStart(4, '0')}`
  return `CLM-${row.id.slice(0, 6).toUpperCase()}`
}

function fmtEvdId(row: { id: string; displayId?: number }): string {
  if (row.displayId) return `EVD-${String(row.displayId).padStart(4, '0')}`
  return `EVD-${row.id.slice(0, 6).toUpperCase()}`
}

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

// ── State ──────────────────────────────────────────────────────────────────
const loading   = ref(false)
const loadError = ref('')
const saving    = ref(false)
const mitigation = ref<Mitigation | null>(null)
const activeTab = ref('links')

type LinkedClaim    = { id: string; name: string; status?: string }
type LinkedEvidence = { id: string; name: string; state: string; type?: string }

interface FormState extends Mitigation {
  linkedClaims: LinkedClaim[]
  linkedEvidence: LinkedEvidence[]
  team: string
  reviewer: string
  linkedAssessment: string
  targetDate: string
  completionDate: string
  verifiedBy: string
  effectivenessRationale: string
}

const form = ref<FormState | null>(null)
const formErrors = ref<Record<string, string>>({})

// Transition state
const statusSteps = ['Proposed', 'In Progress', 'Implemented', 'Verified', 'Closed']
const showTransition     = ref(false)
const transitionIsRollback = ref(false)
const transitionTarget   = ref('')
const rollbackReason     = ref('')
const rollbackReasonError = ref(false)
const advanceNote        = ref('')

interface AuditEntry {
  id: string
  action: string
  userDisplayName: string
  createdAt: string
  changes: Record<string, unknown> | null
}
const auditLog = ref<AuditEntry[]>([])

async function fetchAuditLog() {
  try {
    const { data } = await client.get(`/mitigations/${encodeURIComponent(String(route.params.id))}/audit`)
    auditLog.value = data.data ?? []
  } catch { /* non-fatal */ }
}

function fmtAuditDate(ts: string) { return new Date(ts).toLocaleString() }
function fmtAuditValue(val: unknown): string {
  if (val === null || val === undefined) return '—'
  const s = String(val)
  // Format ISO date strings cleanly
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
  }
  return s
}
function auditActionLabel(action: string) {
  const map: Record<string, string> = { create: 'Created', update: 'Updated', delete: 'Deleted', state_change: 'Status Change', link: 'Linked', unlink: 'Unlinked' }
  return map[action] ?? action
}
function auditActionTagType(action: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  if (action === 'create') return 'success'
  if (action === 'delete') return 'danger'
  if (action === 'state_change') return 'warning'
  if (action === 'link' || action === 'unlink') return 'info'
  return ''
}
function auditChangesGet(entry: AuditEntry, key: string): unknown {
  return entry.changes ? (entry.changes as Record<string, unknown>)[key] ?? null : null
}
function auditUpdateFields(entry: AuditEntry): { field: string; from: unknown; to: unknown }[] {
  if (!entry.changes) return []
  return Object.entries(entry.changes as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([field, v]) => {
      const pair = v as Record<string, unknown>
      return { field, from: pair.from ?? null, to: pair.to ?? null }
    })
}

// Pickers
const showClaimPicker    = ref(false)
const claimSearch        = ref('')
const claimPickSel       = ref<LinkedClaim[]>([])
const claimPool          = ref<LinkedClaim[]>([])

const showEvidencePicker = ref(false)
const evidenceSearch     = ref('')
const evidencePickSel    = ref<LinkedEvidence[]>([])
const evidencePool       = ref<LinkedEvidence[]>([])

// ── Computed ───────────────────────────────────────────────────────────────
const statusIndex = computed(() => statusSteps.indexOf(form.value?.status ?? 'Proposed'))
const canAdvance  = computed(() => statusIndex.value < statusSteps.length - 1)
const canRollback = computed(() => statusIndex.value > 0)
const nextStatus  = computed(() => statusSteps[statusIndex.value + 1] ?? '')
const prevStatus  = computed(() => statusSteps[statusIndex.value - 1] ?? '')
const effLocked        = computed(() => statusIndex.value < 3)
const verifiedByLocked = computed(() => statusIndex.value < 2)

const transitionGates = computed(() => {
  const gates: string[] = []
  if (!transitionIsRollback.value) {
    const to = nextStatus.value
    if (to === 'Implemented' && !form.value?.completionDate) gates.push('Completion Date is required before marking as Implemented.')
    if (to === 'Verified'    && !form.value?.verifiedBy)    gates.push('Verified By is required before marking as Verified.')
    if (to === 'Closed'      && !form.value?.effectiveness) gates.push('Effectiveness rating is required before closing.')
  }
  return gates
})

const filteredClaimPool = computed(() => {
  const linked = form.value?.linkedClaims.map(c => c.id) ?? []
  const pool = claimPool.value.filter(c => !linked.includes(c.id))
  if (!claimSearch.value) return pool
  const q = claimSearch.value.toLowerCase()
  return pool.filter(c => c.name.toLowerCase().includes(q))
})

const filteredEvidencePool = computed(() => {
  const linked = form.value?.linkedEvidence.map(e => e.id) ?? []
  const pool = evidencePool.value.filter(e => !linked.includes(e.id))
  if (!evidenceSearch.value) return pool
  const q = evidenceSearch.value.toLowerCase()
  return pool.filter(e => e.name.toLowerCase().includes(q))
})

// ── Helpers ────────────────────────────────────────────────────────────────
function pipeClass(idx: number) {
  if (idx < statusIndex.value) return 'md-pipe-node--done'
  if (idx === statusIndex.value) return 'md-pipe-node--current'
  return ''
}

function openTransition(isRollback: boolean) {
  transitionIsRollback.value = isRollback
  transitionTarget.value = isRollback ? prevStatus.value : nextStatus.value
  rollbackReason.value = ''; rollbackReasonError.value = false; advanceNote.value = ''
  showTransition.value = true
}

async function confirmTransition() {
  if (transitionIsRollback.value && !rollbackReason.value.trim()) { rollbackReasonError.value = true; return }
  const to = transitionTarget.value
  form.value!.status = to
  showTransition.value = false
  await saveChanges()
  await fetchAuditLog()
  ElMessage.success(`${transitionIsRollback.value ? 'Rolled back' : 'Advanced'} to ${to}`)
  activeTab.value = 'audit'
}

// ── Data ───────────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchMitigation()
  fetchAuditLog()
})

async function fetchMitigation() {
  loading.value = true; loadError.value = ''
  try {
    const { data } = await client.get(`/mitigations/${encodeURIComponent(String(route.params.id))}`)
    mitigation.value = data
    form.value = {
      ...data,
      linkedClaims:           data.linkedClaims   ?? [],
      linkedEvidence:         data.linkedEvidence  ?? [],
      team:                   data.team            ?? '',
      reviewer:               data.reviewer        ?? '',
      linkedAssessment:       data.linkedAssessment ?? '',
      targetDate:             data.targetDate      ?? '',
      completionDate:         data.completionDate  ?? '',
      verifiedBy:             data.verifiedBy      ?? '',
      effectivenessRationale: data.effectivenessRationale ?? '',
    }
  } catch (err) {
    loadError.value = apiErrorMessage(err, 'Failed to load mitigation')
  } finally {
    loading.value = false
  }
}


function validate() {
  const e: Record<string, string> = {}
  if (!form.value?.title?.trim())   e.title       = 'Title is required.'
  if (!form.value?.type)            e.type        = 'Type is required.'
  if (!form.value?.category)        e.category    = 'Category is required.'
  if (!form.value?.priority)        e.priority    = 'Priority is required.'
  if (!form.value?.description?.trim()) e.description = 'Description is required.'
  if (!form.value?.targetDate)      e.targetDate  = 'Target Date is required.'
  formErrors.value = e
  return Object.keys(e).length === 0
}

async function saveChanges() {
  if (!form.value) return
  if (!validate()) { ElMessage.error('Please fill in all required fields.'); return }
  saving.value = true
  try {
    const { linkedClaims, linkedEvidence, ...rest } = form.value
    await client.put(`/mitigations/${encodeURIComponent(String(route.params.id))}`, {
      title:       rest.title,
      type:        rest.type,
      category:    rest.category || null,
      priority:    rest.priority,
      status:      rest.status,
      description: rest.description || null,
      owner:       rest.owner || null,
      notes:       rest.notes || null,
      effectiveness: rest.effectiveness || null,
      team:        rest.team || null,
      reviewer:    rest.reviewer || null,
      linked_assessment: rest.linkedAssessment || null,
      target_date:   rest.targetDate || null,
      completion_date: rest.completionDate || null,
      verified_by: rest.verifiedBy || null,
      effectiveness_rationale: rest.effectivenessRationale || null,
    })
    ElMessage.success('Mitigation saved')
    mitigation.value = { ...mitigation.value!, ...form.value }
    fetchAuditLog()
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'Failed to save mitigation'))
  } finally {
    saving.value = false
  }
}

async function unlinkClaim(claimId: string) {
  try {
    await client.delete(`/mitigations/${encodeURIComponent(String(route.params.id))}/claims/${claimId}`)
    form.value!.linkedClaims = form.value!.linkedClaims.filter(c => c.id !== claimId)
    fetchAuditLog()
  } catch (err) { ElMessage.error(apiErrorMessage(err, 'Failed to unlink claim')) }
}

async function unlinkEvidence(evidenceId: string) {
  try {
    await client.delete(`/mitigations/${encodeURIComponent(String(route.params.id))}/evidence/${evidenceId}`)
    form.value!.linkedEvidence = form.value!.linkedEvidence.filter(e => e.id !== evidenceId)
    fetchAuditLog()
  } catch (err) { ElMessage.error(apiErrorMessage(err, 'Failed to unlink evidence')) }
}

// ── Claim picker ───────────────────────────────────────────────────────────
async function openClaimPicker() {
  claimSearch.value = ''; claimPickSel.value = []
  if (claimPool.value.length === 0) {
    try {
      const { data } = await client.get('/claims')
      claimPool.value = (data.data ?? data).map((c: Record<string, string>) => ({ id: c.id, name: c.name, status: c.state ?? c.status }))
    } catch { /* ignore */ }
  }
  showClaimPicker.value = true
}
function isClaimPicked(id: string) { return claimPickSel.value.some(c => c.id === id) }
function toggleClaimPick(c: LinkedClaim) {
  const i = claimPickSel.value.findIndex(x => x.id === c.id)
  if (i >= 0) claimPickSel.value.splice(i, 1); else claimPickSel.value.push(c)
}
async function confirmClaimPick() {
  for (const c of claimPickSel.value) {
    if (form.value!.linkedClaims.find(x => x.id === c.id)) continue
    try {
      await client.post(`/mitigations/${encodeURIComponent(String(route.params.id))}/claims/${c.id}`)
      form.value!.linkedClaims.push(c)
    } catch { /* skip */ }
  }
  showClaimPicker.value = false
  fetchAuditLog()
  ElMessage.success('Claim(s) linked.')
}

// ── Evidence picker ────────────────────────────────────────────────────────
async function openEvidencePicker() {
  evidenceSearch.value = ''; evidencePickSel.value = []
  if (evidencePool.value.length === 0) {
    try {
      const { data } = await client.get('/evidence', { params: { limit: 100 } })
      evidencePool.value = (data.data ?? data).map((e: Record<string, string>) => ({ id: e.id, name: e.name, state: e.state, type: e.type }))
    } catch { /* ignore */ }
  }
  showEvidencePicker.value = true
}
function isEvidencePicked(id: string) { return evidencePickSel.value.some(e => e.id === id) }
function toggleEvidencePick(e: LinkedEvidence) {
  const i = evidencePickSel.value.findIndex(x => x.id === e.id)
  if (i >= 0) evidencePickSel.value.splice(i, 1); else evidencePickSel.value.push(e)
}
async function confirmEvidencePick() {
  for (const e of evidencePickSel.value) {
    if (form.value!.linkedEvidence.find(x => x.id === e.id)) continue
    try {
      await client.post(`/mitigations/${encodeURIComponent(String(route.params.id))}/evidence/${e.id}`)
      form.value!.linkedEvidence.push(e)
    } catch { /* skip */ }
  }
  showEvidencePicker.value = false
  fetchAuditLog()
  ElMessage.success('Evidence linked.')
}
</script>

<style scoped lang="scss">
.md-page { padding: 0; min-height: 100vh; }

.md-record-type {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--cat-text-muted);
  font-weight: 600;
}

// Pipeline
.md-pipeline {
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 12px 32px;
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
}

.md-pipe-step {
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}

.md-pipe-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  border-radius: var(--cat-radius-md);
  min-width: 100px;

  &--done .md-pipe-dot   { background: var(--el-color-success-light-9); border-color: var(--el-color-success); color: var(--el-color-success); }
  &--done .md-pipe-label { color: var(--el-color-success); }
  &--current             { background: var(--el-color-primary-light-9); }
  &--current .md-pipe-dot   { background: var(--el-color-primary); border-color: var(--el-color-primary-dark-2); color: #fff; }
  &--current .md-pipe-label { color: var(--el-color-primary); font-weight: 700; }
}

.md-pipe-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--cat-border-default);
  background: var(--cat-bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--cat-text-tertiary);
}

.md-pipe-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--cat-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

.md-pipe-arrow {
  color: var(--cat-border-default);
  font-size: 12px;
  margin: 0 2px;
  flex-shrink: 0;
  margin-bottom: 14px;
}

// Body layout
.md-body {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  padding: 20px 24px 48px;
  max-width: 1280px;
  margin: 0 auto;
  align-items: start;
}

.md-main-col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.md-side-col { display: flex; flex-direction: column; gap: 16px; position: sticky; top: 64px; }

// Card
.md-card {
  background: var(--cat-bg-secondary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.md-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
}

.md-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--cat-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.md-card-body { padding: 20px; }

.md-card-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--cat-border-default);
  background: var(--cat-bg-sidebar);
}

// Tabs
.md-tabs {
  :deep(.el-tabs__header) { margin: 0; padding: 0 20px; }
  :deep(.el-tabs__content) { padding: 0; }
}

.md-tab-body { padding: 20px; }
.md-tab-badge {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 4px;
}

// Form
.md-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}

.md-field {
  display: flex;
  flex-direction: column;
  gap: 5px;

  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--cat-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
}

.md-span-2 { grid-column: span 2; }
.md-req { color: var(--el-color-danger); }
.md-opt { color: var(--cat-text-tertiary); font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 2px; }
.md-field-error { font-size: 12px; color: var(--el-color-danger); }
.md-field-hint  { font-size: 12px; color: var(--cat-text-tertiary); margin-top: 2px; }

.md-status-readonly {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

// ID chip
.md-id-chip {
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary-dark-2);
  padding: 4px 10px;
  border-radius: 5px;
  letter-spacing: 0.5px;

  &--sm { font-size: 11px; padding: 2px 7px; }
}

.md-muted { color: var(--cat-text-tertiary); font-size: 13px; }
.md-cdx-ref { font-family: monospace; font-size: 12px; color: var(--el-color-primary); }

// Status chips
.md-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  white-space: nowrap;
}

.md-status--proposed    { background: var(--el-color-info-light-9);    color: var(--el-color-info); }
.md-status--in-progress { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.md-status--implemented { background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); }
.md-status--verified    { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.md-status--closed      { background: var(--cat-bg-subtle, #f4f4f5);   color: var(--cat-text-secondary); }

// Priority chips
.md-pri-chip {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 20px;
}
.md-pri--critical { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }
.md-pri--high     { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.md-pri--medium   { background: var(--el-color-info-light-9);    color: var(--el-color-info); }
.md-pri--low      { background: var(--cat-bg-subtle, #f4f4f5);   color: var(--cat-text-secondary); }

// Effectiveness chips
.md-eff-chip {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
}
.md-eff-chip--effective           { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.md-eff-chip--partially-effective { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.md-eff-chip--not-effective       { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }
.md-eff-chip--unknown             { background: var(--cat-bg-subtle, #f4f4f5);   color: var(--cat-text-secondary); }

// State chip (generic)
.md-state-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--cat-bg-subtle, #f4f4f5);
  color: var(--cat-text-secondary);
  white-space: nowrap;
}

// Claim status chips
.md-claim-accepted     { background: var(--el-color-success-light-9); color: var(--el-color-success-dark-2); }
.md-claim-draft        { background: var(--cat-bg-subtle, #f4f4f5);   color: var(--cat-text-secondary); }
.md-claim-under-review { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.md-claim-rejected     { background: var(--el-color-danger-light-9);  color: var(--el-color-danger); }

// Meta sidebar
.md-meta-list {}
.md-meta-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--cat-border-default);

  &:last-child { border-bottom: none; }
}

.md-meta-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--cat-text-tertiary);
}

.md-meta-value { font-size: 13px; font-weight: 500; color: var(--cat-text-primary); }

// Section label
.md-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--cat-text-tertiary);
  margin-bottom: 10px;

  &::after { content: ''; flex: 1; height: 1px; background: var(--cat-border-default); }
}

.md-count-badge {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
}

// Linked records table
$link-cols: 90px 1fr 110px 44px;
$link-cols-4: 90px 1fr 110px 110px 44px;

.md-linked-table {
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  margin-bottom: 10px;
  overflow: hidden;
}

.md-linked-head, .md-linked-row {
  display: grid;
  grid-template-columns: $link-cols;
  > div { padding: 8px 12px; }
}

.md-linked-head {
  background: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--cat-text-secondary);
}

.md-linked-row {
  background: var(--cat-bg-primary);
  border-bottom: 1px solid var(--cat-border-default);
  font-size: 13px;
  align-items: center;
  &:last-child { border-bottom: none; }
  &:hover { background: var(--cat-bg-hover); }
}

.md-linked-name { font-weight: 500; color: var(--el-color-primary); }
.md-linked-empty {
  padding: 20px;
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: 13px;
}

.md-link-btn { color: var(--el-color-primary); }

// Effectiveness cards
.md-eff-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.md-eff-card {
  border: 2px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  padding: 16px 12px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;

  &:hover { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  &--selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  &--effective  { border-color: var(--el-color-success) !important; background: var(--el-color-success-light-9) !important; }
  &--partial    { border-color: var(--el-color-warning) !important; background: var(--el-color-warning-light-9) !important; }
  &--ineffective{ border-color: var(--el-color-danger)  !important; background: var(--el-color-danger-light-9)  !important; }
}

.md-eff-icon  { font-size: 24px; }
.md-eff-label { font-size: 13px; font-weight: 700; color: var(--cat-text-primary); }
.md-eff-desc  { font-size: 11px; color: var(--cat-text-tertiary); }

// Audit log
.md-audit-entry {
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  margin-bottom: 10px;
  overflow: hidden;
}

.md-audit-header {
  background: var(--cat-bg-sidebar);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--cat-border-default);
}

.md-audit-avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary-dark-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.md-audit-meta { flex: 1; }
.md-audit-author { font-weight: 600; font-size: 13px; }
.md-audit-date   { font-size: 11px; color: var(--cat-text-tertiary); }

.md-audit-transition {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.md-audit-body {
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--cat-text-secondary);
}
.md-audit-field-row {
  display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 2px;
}
.md-audit-field-name { font-weight: 600; color: var(--cat-text-primary); text-transform: capitalize; }
.md-audit-field-old  { text-decoration: line-through; color: var(--el-color-danger); }
.md-audit-field-new  { color: var(--el-color-success-dark-2); font-weight: 500; }
.md-audit-transition { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 13px; }

// Transition dialog
.md-transition-body { padding: 4px 0; }

.md-transition-arrow {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 16px;
  justify-content: center;
}

.md-transition-dir-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--cat-text-tertiary);
  margin-bottom: 6px;
}

.md-rollback-box {
  background: var(--el-color-danger-light-9);
  border: 1px solid rgba(var(--el-color-danger-rgb), 0.2);
  border-left: 3px solid var(--el-color-danger);
  border-radius: var(--cat-radius-md);
  padding: 14px;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.md-rollback-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--el-color-danger);
  display: flex;
  align-items: center;
  gap: 6px;
}

// Pickers
.md-picker-table {
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  overflow: hidden;
  max-height: 360px;
  overflow-y: auto;
}

$pick-cols: 36px 1fr 120px;

.md-picker-head {
  display: grid;
  grid-template-columns: $pick-cols;
  background: var(--cat-bg-sidebar);
  border-bottom: 1px solid var(--cat-border-default);
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--cat-text-secondary);
  > div { padding: 8px 10px; }
}

.md-picker-row {
  display: grid;
  grid-template-columns: $pick-cols;
  border-bottom: 1px solid var(--cat-border-default);
  cursor: pointer;
  background: var(--cat-bg-primary);
  padding: 0 4px;
  align-items: center;
  &:last-child { border-bottom: none; }
  &:hover { background: var(--cat-bg-hover); }
  &--selected { background: var(--el-color-primary-light-9); }
  &--4 { grid-template-columns: 36px 1fr 110px 100px; }
  > div { padding: 8px 10px; font-size: 13px; }
}

// Loading
.md-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--cat-text-secondary);
}

@media (max-width: 900px) {
  .md-body { grid-template-columns: 1fr; }
  .md-side-col { position: static; }
  .md-form-grid { grid-template-columns: 1fr; }
  .md-span-2 { grid-column: span 1; }
  .md-eff-grid { grid-template-columns: 1fr; }
}
</style>
