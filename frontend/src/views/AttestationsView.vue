<template>
  <div class="attestations-container">
    <PageHeader :title="t('attestations.title')">
      <template #actions>
        <el-button v-if="canCreate" type="primary" @click="openNewAttestationDialog">{{ t('common.create') }}</el-button>
      </template>
    </PageHeader>

    <div class="attestations-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchAttestations" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <div v-else-if="attestations.length === 0" class="empty-state-contextual">
        <el-icon :size="48"><Stamp /></el-icon>
        <h3>{{ t('attestations.noAttestations') }}</h3>
        <p>{{ t('attestations.noAttestationsDescription') }}</p>
        <el-button v-if="canCreate" type="primary" @click="openNewAttestationDialog">{{ t('common.create') }}</el-button>
      </div>

      <div v-else class="content">
        <el-table :data="pagedAttestations" stripe border aria-label="Attestations table">
          <el-table-column min-width="260">
            <template #header>
              <span>{{ t('attestations.summary') }} <HelpTip content="Attestations are formal records that link assessment results to signed declarations of conformance." /></span>
            </template>
            <template #default="{ row }">
              <span v-if="row.summary">{{ row.summary }}</span>
              <span v-else class="text-tertiary">&#8212;</span>
            </template>
          </el-table-column>

          <el-table-column prop="assessmentTitle" :label="t('attestations.assessment')" min-width="160" sortable>
            <template #default="{ row }">
              {{ row.assessmentTitle || row.assessmentId }}
            </template>
          </el-table-column>

          <el-table-column label="Assessor" min-width="140" sortable>
            <template #default="{ row }">
              <span v-if="row.assessorEntityName">
                {{ row.assessorEntityName }}
                <el-tag v-if="row.assessorThirdParty" type="info" size="small" class="ml-2">3rd Party</el-tag>
              </span>
              <span v-else class="text-tertiary">&#8212;</span>
            </template>
          </el-table-column>

          <el-table-column prop="signatoryName" label="Signatory" min-width="140" sortable>
            <template #default="{ row }">
              <span v-if="row.signatoryName">{{ row.signatoryName }}</span>
              <span v-else class="text-tertiary">&#8212;</span>
            </template>
          </el-table-column>

          <el-table-column label="Requirements" min-width="110" align="center">
            <template #header>
              <span>Requirements <HelpTip content="Number of requirements assessed in this attestation." /></span>
            </template>
            <template #default="{ row }">
              <el-tag :type="(row.requirementCount ?? 0) > 0 ? 'success' : 'info'" size="small">
                {{ row.requirementCount ?? 0 }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="Conformance" min-width="110" align="center">
            <template #header>
              <span>Conformance <HelpTip content="Average conformance score across all assessed requirements (0–100%)." /></span>
            </template>
            <template #default="{ row }">
              <span v-if="row.avgConformanceScore !== null && row.avgConformanceScore !== undefined" :class="conformanceClass(row.avgConformanceScore)">
                {{ formatConformance(row.avgConformanceScore) }}
              </span>
              <span v-else class="text-tertiary">&#8212;</span>
            </template>
          </el-table-column>

          <el-table-column label="Claims" min-width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="(row.claimCount ?? 0) > 0 ? 'primary' : 'info'" size="small">
                {{ row.claimCount ?? 0 }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="createdAt" :label="t('common.created')" min-width="130" sortable>
            <template #default="{ row }">
              {{ formatDate(row.createdAt) }}
            </template>
          </el-table-column>

          <el-table-column :label="t('common.actions')" min-width="100">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button
                  v-if="canExport"
                  size="small"
                  @click="handleExport(row)"
                >
                  {{ t('attestations.export') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          v-model:current-page="currentPage"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
        />
      </div>
    </div>

    <!--
      PR3.6: The per-attestation Sign / Verify / Rescind flows on this
      view were removed. Signing is now driven by the assessment
      affirmation and cascades into every attestation on that
      assessment. See the Affirmation panel on the assessment detail
      screen for the new flow.
    -->
    <el-dialog v-model="showDialog" title="New Attestation" width="520px">
      <el-alert
        title="Attestation records link a completed assessment to signed declarations."
        description="After creating the record here, open the Assessment to add per-requirement scores, link claims, and manage signatories via the Affirmation panel."
        type="info"
        :closable="false"
        style="margin-bottom: 20px"
      />

      <el-form :model="form" label-width="120px" @submit.prevent="handleSave">
        <el-form-item :label="t('attestations.assessment')" required>
          <el-select v-model="form.assessmentId" :placeholder="t('attestations.assessment')" clearable aria-required="true" style="width: 100%">
            <el-option v-for="item in completedAssessments" :key="item.id" :label="item.title" :value="item.id" />
          </el-select>
          <div v-if="completedAssessments.length === 0" class="field-hint">
            Only completed assessments can be attested. Mark an assessment complete first.
          </div>
        </el-form-item>

        <el-form-item :label="t('attestations.summary')">
          <el-input v-model="form.summary" placeholder="Optional description of this attestation record" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="!form.assessmentId" @click="handleSave">
          {{ t('common.save') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import client from '@/api/client'
import { ref, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Loading, Stamp } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import HelpTip from '@/components/shared/HelpTip.vue'
import { formatDate } from '@/utils/dateFormat'
import { apiErrorMessage } from '@/utils/errorMessage'
import { useAuthStore } from '@/stores/auth'
import type { Assessment } from '@/types'

const { t } = useI18n()
const authStore = useAuthStore()

const attestations = ref<Record<string, unknown>[]>([])
const assessments = ref<Assessment[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const loading = ref(false)
const error = ref('')
const showDialog = ref(false)
const saving = ref(false)

const canCreate = computed(() => authStore.hasPermission('attestations.create'))
const canExport = computed(() => authStore.hasPermission('attestations.export'))

const completedAssessments = computed(() => assessments.value.filter((a: Assessment) => a.state === 'complete'))

const pagedAttestations = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return attestations.value.slice(start, end)
})

const form = ref({
  summary: '',
  assessmentId: '',
})

const formatConformance = (score: number) => `${Math.round(score * 100)}%`

const conformanceClass = (score: number) => {
  if (score >= 0.8) return 'conformance-high'
  if (score >= 0.5) return 'conformance-mid'
  return 'conformance-low'
}

const fetchAttestations = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await client.get('/attestations', { params: { limit: 100 } })
    attestations.value = response.data.data || []
    total.value = response.data.pagination?.total ?? attestations.value.length
  } catch (err: unknown) {
    error.value = apiErrorMessage(err, 'Failed to fetch attestations')
  } finally {
    loading.value = false
  }
}

const fetchAssessments = async () => {
  try {
    const response = await client.get('/assessments', { params: { limit: 100 } })
    assessments.value = response.data.data || []
  } catch (err: unknown) {
    console.error('Failed to fetch assessments:', err)
  }
}

const openNewAttestationDialog = () => {
  form.value = { summary: '', assessmentId: '' }
  showDialog.value = true
}

const handleSave = async () => {
  if (!form.value.assessmentId) {
    ElMessage.error('Please select an assessment')
    return
  }

  saving.value = true
  try {
    await client.post('/attestations', {
      summary: form.value.summary || undefined,
      assessmentId: form.value.assessmentId,
    })

    ElMessage.success('Attestation created. Open the Assessment to configure requirements and signatories.')
    showDialog.value = false
    fetchAttestations()
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Failed to create attestation'))
  } finally {
    saving.value = false
  }
}

const handleExport = async (row: Record<string, unknown>) => {
  try {
    const response = await client.get(`/attestations/${row.id as string}/export`, {
      responseType: 'blob',
    })
    const blob = new Blob([response.data], { type: 'application/vnd.cyclonedx+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // Filename is set server-side via Content-Disposition; fallback for browsers that ignore it
    const disposition = response.headers['content-disposition'] as string | undefined
    const match = disposition?.match(/filename="([^"]+)"/)
    link.download = match?.[1] ?? `attestation-${row.id as string}.cdx.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Failed to export attestation'))
  }
}

// Reset to page 1 when total changes (e.g. after refresh)
watch(total, () => { currentPage.value = 1 })

onMounted(() => {
  fetchAttestations()
  fetchAssessments()
})
</script>

<style scoped lang="scss">
.attestations-container {
  padding: 0;
}

.attestations-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
}

.content {
  width: 100%;

  :deep(.el-pagination) {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--cat-spacing-4);
  }
}

.row-actions {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

:deep(.el-table tbody tr) {
  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
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
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);

  .retry-button {
    margin-top: 16px;
  }
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
    max-width: 400px;
    line-height: 1.5;
  }
}

.text-tertiary {
  color: var(--cat-text-tertiary);
}

.ml-2 {
  margin-left: 4px;
}

.conformance-high {
  color: var(--cat-color-success, #67c23a);
  font-weight: 600;
}

.conformance-mid {
  color: var(--cat-color-warning, #e6a23c);
  font-weight: 600;
}

.conformance-low {
  color: var(--cat-color-danger, #f56c6c);
  font-weight: 600;
}

.field-hint {
  font-size: 12px;
  color: var(--cat-text-tertiary);
  margin-top: 4px;
  line-height: 1.4;
}
</style>
