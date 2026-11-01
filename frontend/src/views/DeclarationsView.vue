<template>
  <div class="declarations-container">
    <div class="declarations-header">
      <el-breadcrumb :separator-icon="ArrowRight">
        <el-breadcrumb-item :to="{ path: '/assessments' }">{{ t('nav.assessments') }}</el-breadcrumb-item>
        <el-breadcrumb-item :to="{ path: `/assessments/${assessmentId}` }">
          {{ assessmentTitle || t('common.loading') }}
        </el-breadcrumb-item>
        <el-breadcrumb-item>{{ t('declarations.title') }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <PageHeader :title="t('declarations.title')" :subtitle="t('declarations.subtitle')">
      <template #actions>
        <el-button v-if="canManage && affirmation && canSeal" type="success" :loading="sealing" @click="confirmSeal">
          {{ t('declarations.seal') }}
        </el-button>
        <el-button v-if="affirmation?.sealedAt" :loading="verifying" @click="runVerify">
          {{ t('declarations.verify') }}
        </el-button>
        <el-button
          v-if="canManage && affirmation?.sealedAt && !affirmation?.rescindedAt"
          type="danger"
          @click="openRescindDialog"
        >
          {{ t('declarations.rescind') }}
        </el-button>
      </template>
    </PageHeader>

    <div class="declarations-content">
      <div v-if="loading" class="loading-container" role="status" aria-live="polite">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="loadError" class="error-container">
        <el-alert :title="t('common.error')" :description="loadError" type="error" :closable="false" />
        <el-button class="retry-button" @click="fetchAll">{{ t('common.retry') }}</el-button>
      </div>

      <template v-else>
        <el-alert
          v-if="affirmation?.rescindedAt"
          :title="t('declarations.rescindedBanner')"
          :description="affirmation.rescindReason || ''"
          type="warning"
          show-icon
          :closable="false"
          class="declarations-alert"
        />
        <div v-else-if="affirmation?.sealedAt" class="seal-stamp" role="status">
          <img :src="sealMark" alt="" class="seal-stamp-mark" />
          <div class="seal-stamp-text">
            <span class="seal-stamp-title">{{ t('declarations.sealedBanner') }}</span>
            <span v-if="sealedSummary" class="seal-stamp-summary">{{ sealedSummary }}</span>
          </div>
        </div>

        <!-- Empty state when no affirmation exists yet -->
        <div v-if="!affirmation" class="empty-state-contextual">
          <el-icon :size="48"><Document /></el-icon>
          <h3>{{ t('declarations.emptyTitle') }}</h3>
          <p>{{ t('declarations.emptyDescription') }}</p>
          <el-button v-if="canManage" type="primary" @click="openCreateDialog">
            {{ t('declarations.createAffirmation') }}
          </el-button>
        </div>

        <template v-else>
          <!-- Statement editor card -->
          <div class="status-card">
            <div class="status-card-header">
              <h3>
                {{ t('declarations.statement') }}
                <HelpTip :content="t('declarations.statementHelp')" />
              </h3>
              <el-button
                v-if="canManage && isEditable"
                size="small"
                @click="openStatementEditor"
              >
                {{ t('common.edit') }}
              </el-button>
            </div>
            <div class="status-card-body">
              <p class="statement-text">{{ affirmation.statement }}</p>
            </div>
          </div>

          <!-- Slot table -->
          <div class="status-card">
            <div class="status-card-header">
              <h3>
                {{ t('declarations.signatorySlots') }}
                <HelpTip :content="t('declarations.slotsHelp')" />
              </h3>
              <el-button
                v-if="canManage && isEditable"
                size="small"
                type="primary"
                @click="openAddSlotDialog"
              >
                {{ t('declarations.addSlot') }}
              </el-button>
            </div>

            <el-table
              :data="affirmation.signatories"
              stripe
              border
             
              :aria-label="t('declarations.slotsTableLabel')"
            >
              <el-table-column :label="t('declarations.requiredTitle')" min-width="220">
                <template #default="{ row }">
                  <span>{{ row.requiredTitle }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('declarations.pinnedUser')" min-width="180">
                <template #default="{ row }">
                  <span v-if="row.requiredUserId">
                    {{ userDisplayName(row.requiredUserId) }}
                  </span>
                  <span v-else class="muted">{{ t('declarations.anyUser') }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('declarations.claimedSignatory')" min-width="200">
                <template #default="{ row }">
                  <span v-if="row.signedBy">
                    {{ signedByDisplay(row) }}
                  </span>
                  <span v-else class="muted">{{ t('declarations.notSigned') }}</span>
                </template>
              </el-table-column>
              <el-table-column :label="t('declarations.signedAt')" min-width="180">
                <template #default="{ row }">
                  {{ row.signedAt ? formatDateTime(row.signedAt) : '-' }}
                </template>
              </el-table-column>
              <el-table-column :label="t('declarations.status')" min-width="130">
                <template #default="{ row }">
                  <el-tag v-if="row.signedAt" type="success" size="small">
                    {{ t('declarations.signed') }}
                  </el-tag>
                  <el-tag v-else type="info" size="small">
                    {{ t('declarations.pending') }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="t('common.actions')" min-width="220">
                <template #default="{ row }">
                  <div class="row-actions">
                    <el-button
                      v-if="canSignSlot(row)"
                      size="small"
                      type="primary"
                      @click="openSignDialog(row)"
                    >
                      {{ t('declarations.signMySlot') }}
                    </el-button>
                    <el-button
                      v-if="canManage && isEditable && !row.signedAt"
                      size="small"
                      @click="openEditSlotDialog(row)"
                    >
                      {{ t('common.edit') }}
                    </el-button>
                    <el-button
                      v-if="canManage && isEditable"
                      size="small"
                      type="danger"
                      plain
                      @click="confirmDeleteSlot(row)"
                    >
                      {{ t('common.delete') }}
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- Verification result -->
          <div v-if="verifyResult" class="status-card">
            <div class="status-card-header">
              <h3>{{ t('declarations.verifyHeading') }}</h3>
              <el-tag :type="verifyResult.verified ? 'success' : 'danger'" size="small">
                {{ verifyResult.verified ? t('declarations.verified') : t('declarations.notVerified') }}
              </el-tag>
            </div>
            <div class="status-card-body">
              <div class="layers-grid">
                <div class="layer-item">
                  <span class="layer-label">{{ t('declarations.layerSlots') }}</span>
                  <el-tag :type="allSlotsValid ? 'success' : 'danger'" size="small">
                    {{ allSlotsValid ? t('declarations.valid') : t('declarations.invalid') }}
                  </el-tag>
                </div>
                <div class="layer-item">
                  <span class="layer-label">{{ t('declarations.layerDeclarations') }}</span>
                  <el-tag :type="verifyResult.declarations.valid ? 'success' : 'danger'" size="small">
                    {{ verifyResult.declarations.valid ? t('declarations.valid') : t('declarations.invalid') }}
                  </el-tag>
                </div>
                <div class="layer-item">
                  <span class="layer-label">{{ t('declarations.layerDocument') }}</span>
                  <el-tag :type="verifyResult.document.valid ? 'success' : 'danger'" size="small">
                    {{ verifyResult.document.valid ? t('declarations.valid') : t('declarations.invalid') }}
                  </el-tag>
                </div>
              </div>

              <div v-if="verifyResult.issues.length > 0" class="issues-list">
                <h4>{{ t('declarations.issues') }}</h4>
                <ul>
                  <li v-for="(issue, idx) in verifyResult.issues" :key="idx">{{ issue }}</li>
                </ul>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- Create affirmation dialog -->
    <el-dialog v-model="showCreateDialog" :title="t('declarations.createAffirmation')" width="600px">
      <el-form :model="createForm" label-position="top">
        <el-form-item :label="t('declarations.statement')" required>
          <el-input
            v-model="createForm.statement"
            type="textarea"
            :rows="6"
            :placeholder="t('declarations.statementPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Statement editor dialog -->
    <el-dialog v-model="showStatementDialog" :title="t('declarations.editStatement')" width="600px">
      <el-form :model="statementForm" label-position="top">
        <el-form-item :label="t('declarations.statement')" required>
          <el-input v-model="statementForm.statement" type="textarea" :rows="6" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showStatementDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitStatement">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Add or edit slot dialog -->
    <el-dialog
      v-model="showSlotDialog"
      :title="editingSlotId ? t('declarations.editSlot') : t('declarations.addSlot')"
      width="560px"
    >
      <el-form :model="slotForm" label-position="top">
        <el-form-item :label="t('declarations.requiredTitle')" required>
          <el-input
            v-model="slotForm.requiredTitle"
            :placeholder="t('declarations.requiredTitlePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('declarations.pinnedUser')">
          <SearchSelect
            v-model="slotForm.requiredUserId"
            :options="userOptions"
            :placeholder="t('declarations.pinnedUserPlaceholder')"
          />
          <div class="form-help">{{ t('declarations.pinnedUserHelp') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSlotDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitSlot">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Sign slot dialog -->
    <el-dialog v-model="showSignDialog" :title="t('declarations.signMySlot')" width="640px">
      <div v-if="signLoading" class="loading-container">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>
      <div v-else-if="mySignatures.length === 0" class="empty-state-small">
        <p>{{ t('declarations.noStoredSignatures') }}</p>
        <el-button type="primary" @click="goToSignatureSettings">
          {{ t('declarations.addSignature') }}
        </el-button>
      </div>
      <el-form v-else :model="signForm" label-position="top">
        <el-form-item :label="t('declarations.chooseSignature')" required>
          <SearchSelect
            v-model="signForm.userSignatureId"
            :options="signatureOptions"
            :placeholder="t('declarations.chooseSignaturePlaceholder')"
          />
        </el-form-item>
        <template v-if="selectedStoredSignature?.signatureType === 'digital'">
          <el-alert
            :title="t('declarations.digitalSigningTitle')"
            :description="t('declarations.digitalSigningDesc')"
            type="info"
            show-icon
            :closable="false"
            class="declarations-alert"
          />
          <el-form-item v-if="canonicalHash" :label="t('declarations.canonicalHash')">
            <el-input :model-value="canonicalHash" readonly>
              <template #append>
                <el-button size="small" @click="copyCanonicalHash">
                  {{ t('common.copy') }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item :label="t('declarations.signatureValue')" required>
            <el-input
              v-model="signForm.signatureValue"
              type="textarea"
              :rows="4"
              :placeholder="t('declarations.signatureValuePlaceholder')"
            />
          </el-form-item>
          <el-button v-if="!canonicalHash" @click="prepareDigitalSign" :loading="preparing">
            {{ t('declarations.preparePayload') }}
          </el-button>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showSignDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!canSubmitSign"
          @click="submitSign"
        >
          {{ t('declarations.submitSignature') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Rescind dialog -->
    <el-dialog v-model="showRescindDialog" :title="t('declarations.rescindTitle')" width="520px">
      <el-form :model="rescindForm" label-position="top">
        <el-form-item :label="t('declarations.rescindReason')" required>
          <el-input
            v-model="rescindForm.reason"
            type="textarea"
            :rows="4"
            :placeholder="t('declarations.rescindReasonPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRescindDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="saving" @click="submitRescind">
          {{ t('declarations.rescind') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Document, ArrowRight } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import HelpTip from '@/components/shared/HelpTip.vue'
import SearchSelect from '@/components/shared/SearchSelect.vue'
import type { SelectOption } from '@/components/shared/SearchSelect.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/dateFormat'
import sealMark from '@/assets/images/attestation-seal.svg'
import {
  getAffirmationByAssessment,
  createAffirmation,
  updateAffirmation,
  addSlot,
  updateSlot,
  deleteSlot,
  prepareSlotSignature,
  signSlot,
  sealAffirmation,
  verifyAffirmation,
  rescindAffirmation,
  type Affirmation,
  type AffirmationSlot,
  type VerifyResult,
} from '@/api/affirmations'
import { listMySignatures, type StoredSignature } from '@/api/me-signatures'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()

const assessmentId = computed(() => route.params.id as string)

const affirmation = ref<Affirmation | null>(null)
const assessmentTitle = ref('')
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const sealing = ref(false)
const verifying = ref(false)
const verifyResult = ref<VerifyResult | null>(null)

const users = ref<Array<{ id: string; displayName: string; username: string }>>([])

const canManage = computed(() => authStore.hasPermission('affirmations.manage'))
const canSign = computed(() => authStore.hasPermission('signatures.sign'))

const isEditable = computed(
  () => !!affirmation.value && !affirmation.value.sealedAt && !affirmation.value.rescindedAt,
)

const canSeal = computed(() => {
  if (!affirmation.value) return false
  if (affirmation.value.sealedAt || affirmation.value.rescindedAt) return false
  if (affirmation.value.signatories.length === 0) return false
  return affirmation.value.signatories.every((s) => !!s.signedAt)
})

const sealedSummary = computed(() => {
  if (!affirmation.value?.sealedAt) return ''
  const fingerprint = affirmation.value.platformKeyFingerprint
    ? ` (${shortFingerprint(affirmation.value.platformKeyFingerprint)})`
    : ''
  return `${t('declarations.sealedAt')}: ${formatDateTime(affirmation.value.sealedAt)}${fingerprint}`
})

const allSlotsValid = computed(() => {
  const results = verifyResult.value?.slots ?? []
  if (results.length === 0) return false
  return results.every((r) => r.valid === true)
})

function shortFingerprint(fp: string | null): string {
  if (!fp) return ''
  return fp.length > 16 ? `${fp.slice(0, 8)}...${fp.slice(-8)}` : fp
}

function userDisplayName(userId: string | null | undefined): string {
  if (!userId) return ''
  const match = users.value.find((u) => u.id === userId)
  return match ? match.displayName || match.username : userId
}

function signedByDisplay(slot: AffirmationSlot): string {
  if (!slot.signature || typeof slot.signature !== 'object') {
    return slot.signedBy ? userDisplayName(slot.signedBy) : ''
  }
  const envelope = slot.signature as Record<string, unknown>
  const signatory = envelope.signatory as Record<string, unknown> | undefined
  if (signatory && typeof signatory.name === 'string') {
    return signatory.name
  }
  return slot.signedBy ? userDisplayName(slot.signedBy) : ''
}

const userOptions = computed<SelectOption[]>(() =>
  users.value.map((u) => ({
    value: u.id,
    label: u.displayName || u.username,
    description: u.username,
  })),
)

function canSignSlot(slot: AffirmationSlot): boolean {
  if (!canSign.value) return false
  if (!isEditable.value) return false
  if (slot.signedAt) return false
  const currentUserId = authStore.user?.id
  if (!currentUserId) return false
  if (slot.requiredUserId && slot.requiredUserId !== currentUserId) return false
  return true
}

// --- Data fetch ---

async function fetchAssessment(): Promise<void> {
  try {
    const response = await client.get(
      `/assessments/${encodeURIComponent(assessmentId.value)}`,
    )
    assessmentTitle.value = response.data?.data?.title || ''
  } catch {
    // Title is cosmetic; swallow and let the breadcrumb fall back
    assessmentTitle.value = ''
  }
}

async function fetchAffirmation(): Promise<void> {
  affirmation.value = await getAffirmationByAssessment(assessmentId.value)
}

async function fetchUsers(): Promise<void> {
  try {
    const response = await client.get('/users/assignable')
    users.value = response.data?.data || []
  } catch {
    users.value = []
  }
}

async function fetchAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([fetchAssessment(), fetchAffirmation(), fetchUsers()])
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    loadError.value = e.response?.data?.error || e.message || t('declarations.loadError')
  } finally {
    loading.value = false
  }
}

// --- Create affirmation ---

const showCreateDialog = ref(false)
const createForm = ref({ statement: '' })

function openCreateDialog(): void {
  createForm.value = { statement: '' }
  showCreateDialog.value = true
}

async function submitCreate(): Promise<void> {
  if (!createForm.value.statement.trim()) {
    ElMessage.error(t('declarations.statementRequired'))
    return
  }
  saving.value = true
  try {
    affirmation.value = await createAffirmation({
      assessmentId: assessmentId.value,
      statement: createForm.value.statement.trim(),
    })
    ElMessage.success(t('declarations.createSuccess'))
    showCreateDialog.value = false
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('declarations.createError'))
  } finally {
    saving.value = false
  }
}

// --- Edit statement ---

const showStatementDialog = ref(false)
const statementForm = ref({ statement: '' })

function openStatementEditor(): void {
  if (!affirmation.value) return
  statementForm.value = { statement: affirmation.value.statement }
  showStatementDialog.value = true
}

async function submitStatement(): Promise<void> {
  if (!affirmation.value) return
  if (!statementForm.value.statement.trim()) {
    ElMessage.error(t('declarations.statementRequired'))
    return
  }
  saving.value = true
  try {
    affirmation.value = await updateAffirmation(affirmation.value.id, {
      statement: statementForm.value.statement.trim(),
    })
    ElMessage.success(t('common.success'))
    showStatementDialog.value = false
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

// --- Slot add/edit/delete ---

const showSlotDialog = ref(false)
const editingSlotId = ref<string | null>(null)
const slotForm = ref<{ requiredTitle: string; requiredUserId: string }>({
  requiredTitle: '',
  requiredUserId: '',
})

function openAddSlotDialog(): void {
  editingSlotId.value = null
  slotForm.value = { requiredTitle: '', requiredUserId: '' }
  showSlotDialog.value = true
}

function openEditSlotDialog(slot: AffirmationSlot): void {
  editingSlotId.value = slot.id
  slotForm.value = {
    requiredTitle: slot.requiredTitle,
    requiredUserId: slot.requiredUserId || '',
  }
  showSlotDialog.value = true
}

async function submitSlot(): Promise<void> {
  if (!affirmation.value) return
  if (!slotForm.value.requiredTitle.trim()) {
    ElMessage.error(t('declarations.requiredTitleRequired'))
    return
  }
  saving.value = true
  try {
    const payload = {
      requiredTitle: slotForm.value.requiredTitle.trim(),
      requiredUserId: slotForm.value.requiredUserId || null,
    }
    if (editingSlotId.value) {
      await updateSlot(affirmation.value.id, editingSlotId.value, payload)
    } else {
      await addSlot(affirmation.value.id, payload)
    }
    await fetchAffirmation()
    showSlotDialog.value = false
    ElMessage.success(t('common.success'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

async function confirmDeleteSlot(slot: AffirmationSlot): Promise<void> {
  if (!affirmation.value) return
  try {
    await ElMessageBox.confirm(
      t('declarations.deleteSlotConfirmDesc', { title: slot.requiredTitle }),
      t('declarations.deleteSlotConfirmTitle'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  try {
    await deleteSlot(affirmation.value.id, slot.id)
    await fetchAffirmation()
    ElMessage.success(t('common.success'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  }
}

// --- Sign slot ---

const showSignDialog = ref(false)
const signLoading = ref(false)
const preparing = ref(false)
const mySignatures = ref<StoredSignature[]>([])
const signForm = ref<{ userSignatureId: string; signatureValue: string }>({
  userSignatureId: '',
  signatureValue: '',
})
const canonicalHash = ref('')
const activeSlotId = ref<string | null>(null)

const selectedStoredSignature = computed(
  () =>
    mySignatures.value.find((s) => s.id === signForm.value.userSignatureId) ?? null,
)

const signatureOptions = computed<SelectOption[]>(() =>
  mySignatures.value.map((s) => ({
    value: s.id,
    label: s.label,
    description:
      s.signatureType === 'electronic'
        ? t('declarations.electronicSignature')
        : `${t('declarations.digitalSignature')} (${s.signatureFormat?.toUpperCase() || ''})`,
  })),
)

const canSubmitSign = computed(() => {
  if (!signForm.value.userSignatureId) return false
  if (selectedStoredSignature.value?.signatureType === 'digital') {
    return !!signForm.value.signatureValue.trim() && !!canonicalHash.value
  }
  return true
})

async function openSignDialog(slot: AffirmationSlot): Promise<void> {
  activeSlotId.value = slot.id
  signForm.value = { userSignatureId: '', signatureValue: '' }
  canonicalHash.value = ''
  showSignDialog.value = true
  signLoading.value = true
  try {
    const response = await listMySignatures()
    mySignatures.value = response.data
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    signLoading.value = false
  }
}

watch(
  () => signForm.value.userSignatureId,
  () => {
    canonicalHash.value = ''
    signForm.value.signatureValue = ''
  },
)

async function prepareDigitalSign(): Promise<void> {
  if (!affirmation.value || !activeSlotId.value) return
  if (!signForm.value.userSignatureId) {
    ElMessage.error(t('declarations.chooseSignatureFirst'))
    return
  }
  preparing.value = true
  try {
    const result = await prepareSlotSignature(
      affirmation.value.id,
      activeSlotId.value,
      signForm.value.userSignatureId,
    )
    canonicalHash.value = result.canonicalPayloadHash
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    preparing.value = false
  }
}

async function copyCanonicalHash(): Promise<void> {
  if (!canonicalHash.value) return
  try {
    await navigator.clipboard.writeText(canonicalHash.value)
    ElMessage.success(t('common.copied'))
  } catch {
    ElMessage.error(t('common.copyError'))
  }
}

async function submitSign(): Promise<void> {
  if (!affirmation.value || !activeSlotId.value) return
  saving.value = true
  try {
    const payload: {
      userSignatureId: string
      signatureValue?: string
      canonicalPayloadHash?: string
    } = {
      userSignatureId: signForm.value.userSignatureId,
    }
    if (selectedStoredSignature.value?.signatureType === 'digital') {
      payload.signatureValue = signForm.value.signatureValue.trim()
      payload.canonicalPayloadHash = canonicalHash.value
    }
    await signSlot(affirmation.value.id, activeSlotId.value, payload)
    await fetchAffirmation()
    showSignDialog.value = false
    ElMessage.success(t('declarations.signSuccess'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('declarations.signError'))
  } finally {
    saving.value = false
  }
}

function goToSignatureSettings(): void {
  router.push('/settings')
}

// --- Seal ---

async function confirmSeal(): Promise<void> {
  if (!affirmation.value) return
  try {
    await ElMessageBox.confirm(
      t('declarations.sealConfirmDesc'),
      t('declarations.sealConfirmTitle'),
      {
        confirmButtonText: t('declarations.seal'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }
  sealing.value = true
  try {
    affirmation.value = await sealAffirmation(affirmation.value.id)
    ElMessage.success(t('declarations.sealSuccess'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('declarations.sealError'))
  } finally {
    sealing.value = false
  }
}

// --- Verify ---

async function runVerify(): Promise<void> {
  if (!affirmation.value) return
  verifying.value = true
  try {
    verifyResult.value = await verifyAffirmation(affirmation.value.id)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    verifying.value = false
  }
}

// --- Rescind ---

const showRescindDialog = ref(false)
const rescindForm = ref({ reason: '' })

function openRescindDialog(): void {
  rescindForm.value = { reason: '' }
  showRescindDialog.value = true
}

async function submitRescind(): Promise<void> {
  if (!affirmation.value) return
  if (!rescindForm.value.reason.trim()) {
    ElMessage.error(t('declarations.rescindReasonRequired'))
    return
  }
  saving.value = true
  try {
    await rescindAffirmation(affirmation.value.id, rescindForm.value.reason.trim())
    await fetchAffirmation()
    showRescindDialog.value = false
    verifyResult.value = null
    ElMessage.success(t('declarations.rescindSuccess'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || e.message || t('common.error'))
  } finally {
    saving.value = false
  }
}

onMounted(fetchAll)
</script>

<style scoped lang="scss">
.declarations-container {
  padding: 0;
}

.declarations-header {
  padding: var(--cat-spacing-4) var(--cat-spacing-6) 0;
}

.declarations-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

.declarations-alert {
  margin-bottom: var(--cat-spacing-2);
}

/* Attestation seal — shown when the affirmation is cryptographically sealed. */
.seal-stamp {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  margin-bottom: var(--cat-spacing-2);
  background: rgba(31, 157, 104, 0.08);
  border: 1px solid rgba(31, 157, 104, 0.35);
  border-radius: var(--cat-radius-lg);
}

.seal-stamp-mark {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.seal-stamp-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.seal-stamp-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.seal-stamp-summary {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--cat-text-secondary);
}

.error-container {
  padding: var(--cat-spacing-3) 0;

  .retry-button {
    margin-top: 16px;
  }
}

.status-card {
  background: var(--cat-bg-primary);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.status-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  background: var(--cat-bg-secondary);
  border-bottom: 1px solid var(--cat-border-default);

  h3 {
    margin: 0;
    font-size: var(--cat-font-size-md);
    font-weight: var(--cat-font-weight-semibold);
    color: var(--cat-text-primary);
    display: inline-flex;
    align-items: center;
    gap: var(--cat-spacing-2);
  }
}

.status-card-body {
  padding: var(--cat-spacing-4);
}

.statement-text {
  margin: 0;
  white-space: pre-wrap;
  color: var(--cat-text-primary);
  line-height: 1.6;
}

.row-actions {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.muted {
  color: var(--cat-text-tertiary);
}

.form-help {
  margin-top: 4px;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
}

.empty-state-contextual {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--cat-text-secondary);

  .el-icon {
    color: var(--cat-text-tertiary);
    margin-bottom: 16px;
  }

  h3 {
    margin: 0 0 8px;
    color: var(--cat-text-primary);
    font-size: 16px;
  }

  p {
    margin: 0 0 20px;
    max-width: 480px;
    line-height: 1.5;
  }
}

.empty-state-small {
  text-align: center;
  padding: var(--cat-spacing-4) 0;

  p {
    color: var(--cat-text-secondary);
    margin-bottom: var(--cat-spacing-3);
  }
}

.layers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--cat-spacing-3);
  margin-bottom: var(--cat-spacing-4);
}

.layer-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--cat-spacing-3);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  background: var(--cat-bg-secondary);
}

.layer-label {
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  color: var(--cat-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.issues-list {
  margin-top: var(--cat-spacing-3);

  h4 {
    margin: 0 0 8px;
    color: var(--cat-text-primary);
    font-size: var(--cat-font-size-sm);
  }

  ul {
    margin: 0;
    padding-left: 20px;
    color: var(--cat-text-secondary);
    font-size: var(--cat-font-size-sm);
  }

  li {
    margin-bottom: 4px;
  }
}
</style>
