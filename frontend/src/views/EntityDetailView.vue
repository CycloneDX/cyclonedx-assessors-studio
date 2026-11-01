<template>
  <div class="entity-detail-container">
    <div class="entity-detail-header">
      <el-breadcrumb :separator-icon="ArrowRight">
        <el-breadcrumb-item :to="{ path: '/entities' }">{{ t('nav.entities') }}</el-breadcrumb-item>
        <el-breadcrumb-item>{{ entity?.name || t('common.loading') }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>{{ t('common.loading') }}</span>
    </div>

    <el-alert v-else-if="error" type="error" show-icon :closable="false" class="m-24">
      {{ error }}
    </el-alert>

    <div v-else-if="entity" class="entity-detail-content">
      <!-- Entity Info Card -->
      <el-card class="entity-info-card">
        <template #header>
          <div class="card-header">
            <div class="entity-title-section">
              <h2>{{ entity.name }}</h2>
              <div class="entity-badges">
                <el-tag type="info">{{ formatEntityType(entity.entityType) }}</el-tag>
                <StateBadge :state="entity.state" />
              </div>
            </div>
            <div class="action-buttons">
              <el-button v-if="isAdmin" size="small" @click="openEditDialog">
                <el-icon class="mr-2"><EditIcon /></el-icon>
                {{ t('common.edit') }}
              </el-button>
              <el-dropdown v-if="isAdmin" trigger="click">
                <el-button size="small">{{ t('common.moreActions') }} <el-icon><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item class="text-el-danger" @click="handleArchiveEntity">
                      {{ t('common.archive') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </template>

        <el-row :gutter="20">
          <el-col :span="12">
            <div v-if="entity.description" class="info-field">
              <label id="entity-desc-label">{{ t('common.description') }}</label>
              <p class="description-text" aria-labelledby="entity-desc-label">{{ entity.description }}</p>
            </div>
          </el-col>
          <el-col :span="12">
            <div v-if="entityTags.length > 0" class="info-field">
              <label id="entity-tags-label">{{ t('common.tags') }}</label>
              <div class="info-pill-list" aria-labelledby="entity-tags-label">
                <span v-for="tag in entityTags" :key="tag.id" class="tag-display-pill" :style="tagPillStyle(tag.color)">
                  {{ tag.name }}
                </span>
              </div>
            </div>
          </el-col>
        </el-row>

        <!-- Geo strip — only for location-bearing types -->
        <div v-if="isGeoType(entity.entityType) && (entity.country || entity.region || entity.locality || entity.timezone)" class="geo-strip">
          <span v-if="entity.locality" class="geo-item"><el-icon><Location /></el-icon> {{ entity.locality }}</span>
          <span v-if="entity.region" class="geo-item geo-sep">{{ entity.region }}</span>
          <span v-if="entity.country" class="geo-item geo-sep">{{ entity.country }}</span>
          <span v-if="entity.timezone" class="geo-item geo-tz"><el-icon><Clock /></el-icon> {{ entity.timezone }}</span>
        </div>
      </el-card>

      <!-- Tabs -->
      <el-card class="entity-tabs-card">
        <el-tabs v-model="activeTab">
          <!-- Tab 1: Relationships & Hierarchy -->
          <el-tab-pane :label="t('entities.relationships')" name="relationships">
            <div class="tab-content">
              <div v-if="relationshipsLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>{{ t('common.loading') }}</span>
              </div>
              <div v-else>
                <div class="relationships-view-toggle">
                  <el-radio-group v-model="relationshipsView" size="small">
                    <el-radio-button value="table">
                      <el-icon><Grid /></el-icon>
                    </el-radio-button>
                    <el-radio-button value="graph">
                      <el-icon><Share /></el-icon>
                    </el-radio-button>
                  </el-radio-group>
                  <el-button v-if="isAdmin" type="primary" size="small" @click="showAddRelationshipDialog = true">
                    {{ t('entities.addRelationship') }}
                  </el-button>
                </div>

                <!-- Table View -->
                <div v-if="relationshipsView === 'table'">
                  <el-table v-if="allRelationshipRows.length > 0" :data="allRelationshipRows" stripe border>
                    <el-table-column :label="t('entities.relatedEntity')" min-width="200">
                      <template #default="{ row }">
                        <router-link :to="`/entities/${row.relatedEntityId}`" class="subtle-link">
                          {{ row.relatedEntityName }}
                        </router-link>
                      </template>
                    </el-table-column>
                    <el-table-column :label="t('entities.direction')" min-width="100">
                      <template #default="{ row }">
                        <el-tag :type="row.direction === 'parent' ? 'info' : 'success'" size="small">
                          {{ row.direction === 'parent' ? t('relationships.inbound') : t('relationships.outbound') }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column :label="t('entities.relationshipType')" min-width="140">
                      <template #default="{ row }">
                        <el-tag size="small" :style="{ borderColor: relationshipColor(row.relationshipType), color: relationshipColor(row.relationshipType), backgroundColor: relationshipColor(row.relationshipType) + '18' }">
                          {{ formatRelationshipType(row.relationshipType) }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column v-if="isAdmin" min-width="60" align="center">
                      <template #default="{ row }">
                        <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="removeRelationshipAction(row.id)" />
                      </template>
                    </el-table-column>
                  </el-table>
                  <div v-else class="empty-state">{{ t('common.noData') }}</div>
                </div>

                <!-- Graph View -->
                <div v-else>
                  <RelationshipGraph
                    :entity-id="entity!.id"
                    :entity-name="entity!.name"
                    :relationships="allRelationshipRows"
                    :graph-edges="graphEdges"
                    :graph-entities="graphEntities"
                    @navigate="(id: string) => router.push(`/entities/${id}`)"
                  />
                </div>
              </div>
            </div>
          </el-tab-pane>

          <!-- Tab 2: Assessments -->
          <el-tab-pane :label="t('nav.assessments')" name="assessments">
            <div class="tab-content">
              <div class="tab-toolbar">
                <el-select v-model="assessmentStateFilter" placeholder="Filter by state" clearable class="w-200">
                  <el-option label="All" value="" />
                  <el-option :label="t('states.new')" value="new" />
                  <el-option :label="t('states.pending')" value="pending" />
                  <el-option :label="t('states.in_progress')" value="in_progress" />
                  <el-option :label="t('states.complete')" value="complete" />
                </el-select>
                <el-button type="primary" size="small" @click="showNewAssessmentDialog = true">
                  {{ t('assessments.newAssessment') }}
                </el-button>
              </div>

              <div v-if="assessmentsLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>{{ t('common.loading') }}</span>
              </div>
              <el-table v-else :data="filteredAssessments" stripe border @row-click="navigateToAssessment">
                <el-table-column prop="title" :label="t('assessments.titleField')" min-width="200" sortable></el-table-column>
                <el-table-column prop="standardName" :label="t('standards.name')" min-width="150" sortable></el-table-column>
                <el-table-column :label="t('assessments.state')" min-width="120">
                  <template #default="{ row }">
                    <StateBadge :state="row.state" />
                  </template>
                </el-table-column>
                <el-table-column v-if="showConformanceScore" prop="conformanceScore" :label="t('assessments.conformanceScore')" min-width="120" sortable>
                  <template #default="{ row }">
                    {{ row.conformanceScore ? `${Math.round(row.conformanceScore)}%` : '-' }}
                  </template>
                </el-table-column>
                <el-table-column :label="t('assessments.dueDate')" min-width="140">
                  <template #default="{ row }">
                    {{ formatDate(row.dueDate) }}
                  </template>
                </el-table-column>
                <el-table-column :label="t('common.created')" min-width="140">
                  <template #default="{ row }">
                    {{ formatDate(row.createdAt) }}
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="!assessmentsLoading && assessments.length === 0" class="no-data">
                {{ t('common.noData') }}
              </div>
            </div>
          </el-tab-pane>

          <!-- Tab 3: Compliance Policies -->
          <el-tab-pane :label="t('entities.compliancePolicies')" name="policies">
            <div class="tab-content">
              <div v-if="policiesLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>{{ t('common.loading') }}</span>
              </div>
              <el-table v-else :data="allPolicies" stripe border>
                <el-table-column prop="standard.name" :label="t('standards.name')" min-width="200" sortable>
                  <template #default="{ row }">
                    <router-link :to="`/standards/${row.standard?.id}`" class="subtle-link">
                      {{ row.standard?.name }}<span v-if="row.standard?.version"> v{{ row.standard.version }}</span>
                    </router-link>
                  </template>
                </el-table-column>
                <el-table-column :label="t('entities.policySource')" min-width="150">
                  <template #default="{ row }">
                    <span v-if="row.isInherited" class="inherited-badge">{{ t('entities.inherited') }}</span>
                    <span v-else>{{ t('entities.direct') }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="description" :label="t('common.description')" min-width="250" sortable></el-table-column>
                <el-table-column v-if="isAdmin" min-width="90" align="center">
                  <template #default="{ row }">
                    <div class="flex gap-1 justify-center">
                      <IconButton :icon="EditIcon" :tooltip="t('common.edit')" @click="openEditPolicyDialog(row)" />
                      <IconButton :icon="Delete" variant="danger" :tooltip="t('common.delete')" @click="removePolicyAction(row.id)" />
                    </div>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="!policiesLoading && allPolicies.length === 0" class="no-data">
                {{ t('common.noData') }}
              </div>

              <!-- Add Policy Button -->
              <div class="tab-footer" v-if="isAdmin">
                <el-button type="primary" size="small" @click="showAddPolicyDialog = true">
                  {{ t('entities.addPolicy') }}
                </el-button>
              </div>
            </div>
          </el-tab-pane>

          <!-- Tab: Children -->
          <el-tab-pane :label="t('entities.children')" name="children">
            <div class="tab-content">
              <div v-if="childrenLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>{{ t('common.loading') }}</span>
              </div>
              <div v-else-if="childEntities.length === 0" class="empty-state">
                {{ t('entities.noChildren') }}
              </div>
              <el-table v-else :data="childEntities" stripe border @row-click="(row: Record<string, unknown>) => router.push(`/entities/${row.id as string}`)">
                <el-table-column :label="t('common.name')" min-width="200">
                  <template #default="{ row }">
                    <router-link :to="`/entities/${row.id as string}`" class="subtle-link" @click.stop>
                      {{ row.name }}
                    </router-link>
                  </template>
                </el-table-column>
                <el-table-column :label="t('entities.entityType')" min-width="140">
                  <template #default="{ row }">
                    <el-tag type="info" size="small">{{ formatEntityType(row.entityType as string) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column :label="t('common.state')" min-width="120">
                  <template #default="{ row }">
                    <StateBadge :state="row.state as string" />
                  </template>
                </el-table-column>
                <el-table-column :label="t('entities.relationshipType')" min-width="140">
                  <template #default="{ row }">
                    <el-tag size="small" :style="{ borderColor: relationshipColor(row.relationshipType as string), color: relationshipColor(row.relationshipType as string), backgroundColor: relationshipColor(row.relationshipType as string) + '18' }">
                      {{ formatRelationshipType(row.relationshipType as string) }}
                    </el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-tab-pane>

          <!-- Tab: Activity (Audit history for this entity) -->
          <el-tab-pane :label="t('entities.activity')" name="activity">
            <div class="tab-content">
              <EntityAuditTab
                v-if="entity"
                entity-type="entity"
                :entity-id="entity.id"
              />
            </div>
          </el-tab-pane>

          <!-- Tab 4: Progress -->
          <el-tab-pane :label="t('entities.progress')" name="progress">
            <div class="tab-content">
              <div v-if="progressLoading" class="tab-loading">
                <el-icon class="is-loading" :size="20"><Loading /></el-icon>
                <span>{{ t('common.loading') }}</span>
              </div>
              <div v-else>
                <div v-if="progressData.length === 0" class="empty-state">
                  {{ t('entities.noAssessmentHistory') }}
                </div>
                <div v-for="standard in progressData" :key="standard.standardName" class="progress-section">
                  <h3>{{ standard.standardName }} <span class="version">v{{ standard.standardVersion }}</span></h3>
                  <el-table v-if="standard.assessments.length > 0" :data="standard.assessments" stripe border>
                    <el-table-column :label="t('common.date')" min-width="140">
                      <template #default="{ row }">
                        {{ formatDate(row.completedAt) }}
                      </template>
                    </el-table-column>
                    <el-table-column prop="title" :label="t('assessments.titleField')" min-width="200" sortable></el-table-column>
                    <el-table-column :label="t('assessments.conformanceScore')" min-width="120">
                      <template #default="{ row }">
                        <span v-if="row.conformanceScore !== null">{{ Math.round(row.conformanceScore) }}%</span>
                        <span v-else>-</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="t('assessments.state')" min-width="120">
                      <template #default="{ row }">
                        <StateBadge :state="row.state" />
                      </template>
                    </el-table-column>
                  </el-table>
                  <div v-else class="no-data-compact">{{ t('common.noData') }}</div>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <!-- Edit Entity Dialog -->
    <el-dialog v-model="showEditDialog" :title="t('common.edit')" width="600px" @close="resetEditForm">
      <el-form :model="editForm" label-width="120px" ref="editFormRef">
        <el-form-item :label="t('common.name')" required>
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item :label="t('common.description')">
          <el-input v-model="editForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item :label="t('common.state')">
          <el-select v-model="editForm.state">
            <el-option :label="t('states.active')" value="active" />
            <el-option :label="t('states.inactive')" value="inactive" />
            <el-option :label="t('states.archived')" value="archived" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.tags')">
          <TagInput v-model="editForm.tags" />
        </el-form-item>
        <template v-if="isGeoType(entity?.entityType)">
          <el-divider content-position="left"><el-icon><Location /></el-icon> Location</el-divider>
          <el-form-item label="Country">
            <el-input v-model="editForm.country" placeholder="e.g. United States" />
          </el-form-item>
          <el-form-item label="Region">
            <el-input v-model="editForm.region" placeholder="e.g. California, eu-west-1" />
          </el-form-item>
          <el-form-item label="City / Site">
            <el-input v-model="editForm.locality" placeholder="e.g. San Francisco" />
          </el-form-item>
          <el-form-item label="Timezone">
            <el-select v-model="editForm.timezone" filterable clearable placeholder="Select timezone" class="w-full">
              <el-option v-for="tz in TIMEZONES" :key="tz" :label="tz" :value="tz" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEntity">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- Add Relationship Dialog -->
    <el-dialog v-model="showAddRelationshipDialog" :title="t('entities.addRelationship')" width="500px" @close="resetAddRelationshipForm">
      <el-form :model="addRelationshipForm" label-width="120px">
        <el-form-item :label="t('entities.targetEntity')" required>
          <SearchSelect
            v-model="addRelationshipForm.targetEntityId"
            :options="entitySearchOptions"
            :loading="entitySearchLoading"
            :remote="true"
            :remote-method="searchEntities"
            placeholder="Select an entity..."
            search-placeholder="Search by name..."
          />
        </el-form-item>
        <el-form-item :label="t('entities.relationshipType')" required>
          <SearchSelect
            v-model="addRelationshipForm.relationshipType"
            :options="relationshipTypeOptions"
            placeholder="Select relationship..."
            search-placeholder="Filter types..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddRelationshipDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="addingRelationship" @click="saveRelationship">{{ t('common.add') }}</el-button>
      </template>
    </el-dialog>

    <!-- New Assessment Dialog -->
    <el-dialog v-model="showNewAssessmentDialog" :title="t('assessments.newAssessment')" width="500px" @close="resetAssessmentForm">
      <el-form :model="assessmentForm" label-width="120px">
        <el-form-item :label="t('assessments.titleField')" required>
          <el-input v-model="assessmentForm.title" />
        </el-form-item>
        <el-form-item :label="t('standards.name')" required>
          <SearchSelect
            v-model="assessmentForm.standardId"
            :options="policyStandardOptions"
            placeholder="Select a standard..."
            search-placeholder="Search standards..."
          />
        </el-form-item>
        <el-form-item :label="t('common.description')">
          <el-input v-model="assessmentForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item :label="t('assessments.dueDate')">
          <el-date-picker v-model="assessmentForm.dueDate" type="date" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewAssessmentDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="assessmentCreating" @click="createAssessment">{{ t('common.create') }}</el-button>
      </template>
    </el-dialog>

    <!-- Add Policy Dialog -->
    <el-dialog v-model="showAddPolicyDialog" :title="t('entities.addPolicy')" width="500px" @open="onShowAddPolicyDialog" @close="resetAddPolicyForm">
      <el-form :model="addPolicyForm" label-width="120px">
        <el-form-item :label="t('standards.name')" required>
          <SearchSelect
            v-model="addPolicyForm.standardId"
            :options="standardOptions"
            placeholder="Select a standard..."
            search-placeholder="Search standards..."
          />
        </el-form-item>
        <el-form-item :label="t('common.description')">
          <el-input v-model="addPolicyForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddPolicyDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="addingPolicy" @click="savePolicy">{{ t('common.add') }}</el-button>
      </template>
    </el-dialog>

    <!-- Edit Policy Dialog -->
    <el-dialog v-model="showEditPolicyDialog" :title="t('entities.editPolicy')" width="500px" @open="onShowEditPolicyDialog">
      <el-form :model="editPolicyForm" label-width="120px">
        <el-form-item :label="t('standards.name')" required>
          <SearchSelect
            v-model="editPolicyForm.standardId"
            :options="standardOptions"
            placeholder="Select a standard..."
            search-placeholder="Search standards..."
          />
        </el-form-item>
        <el-form-item :label="t('common.description')">
          <el-input v-model="editPolicyForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPolicyDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="updatingPolicy" @click="updatePolicyAction">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Loading, Edit as EditIcon, ArrowDown, Delete, Grid, Share, Location, Clock } from '@element-plus/icons-vue'
import IconButton from '@/components/shared/IconButton.vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import client from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import StateBadge from '@/components/shared/StateBadge.vue'
import TagInput from '@/components/shared/TagInput.vue'
import SearchSelect from '@/components/shared/SearchSelect.vue'
import type { SelectOption } from '@/components/shared/SearchSelect.vue'
import RelationshipGraph from '@/components/shared/RelationshipGraph.vue'
import EntityAuditTab from '@/components/shared/EntityAuditTab.vue'
import * as entitiesAPI from '@/api/entities'
import type { Entity, EntityRelationship, CompliancePolicy, AssessmentProgress, Tag } from '@/types'
import type { GraphEdge } from '@/components/shared/RelationshipGraph.vue'
import { tagPillStyle } from '@/utils/tagColor'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()

// Loading states
const loading = ref(true)
const error = ref('')
const assessmentsLoading = ref(false)
const relationshipsLoading = ref(false)
const policiesLoading = ref(false)
const progressLoading = ref(false)
const childrenLoading = ref(false)

// Entity data
const entity = ref<Entity | null>(null)
const entityTags = ref<Tag[]>([])
const assessments = ref<Record<string, unknown>[]>([])
const relationships = ref<EntityRelationship[]>([])
const policies = ref<CompliancePolicy[]>([])
const progressData = ref<AssessmentProgress[]>([])
const childEntities = ref<Record<string, unknown>[]>([])
const availableStandards = ref<Record<string, unknown>[]>([])
const graphEdges = ref<GraphEdge[]>([])
const graphEntities = ref<Array<{ id: string; name: string }>>([])

// UI state
const activeTab = ref('relationships')
const assessmentStateFilter = ref('')
const relationshipsView = ref<'table' | 'graph'>('table')

// Dialog states
const showEditDialog = ref(false)
const showAddRelationshipDialog = ref(false)
const showNewAssessmentDialog = ref(false)
const showAddPolicyDialog = ref(false)
const showEditPolicyDialog = ref(false)

// Loading states for async actions
const editSaving = ref(false)
const addingRelationship = ref(false)
const assessmentCreating = ref(false)
const addingPolicy = ref(false)
const updatingPolicy = ref(false)
const entitySearchLoading = ref(false)

// Form data
const GEO_TYPES = new Set(['organization', 'business_unit', 'team', 'service'])
const isGeoType = (type?: string) => !!type && GEO_TYPES.has(type)

const TIMEZONES = Intl.supportedValuesOf('timeZone')

const editForm = ref({
  name: '',
  description: '',
  state: 'active',
  tags: [] as string[],
  country: null as string | null,
  region: null as string | null,
  locality: null as string | null,
  timezone: null as string | null,
})

const addRelationshipForm = ref({
  targetEntityId: '',
  relationshipType: 'owns',
})

const assessmentForm = ref({
  title: '',
  standardId: '',
  description: '',
  dueDate: null as Date | null,
})

const editPolicyForm = ref({
  id: '',
  standardId: '',
  description: '',
})

const addPolicyForm = ref({
  standardId: '',
  description: '',
})

// Search results for entity selector
const searchResults = ref<Entity[]>([])

// Computed properties
const showConformanceScore = computed(() => {
  return assessments.value.some((a: Record<string, unknown>) => a.conformanceScore !== null && a.conformanceScore !== undefined)
})

// Unified relationship rows for table and graph views
const allRelationshipRows = computed(() => {
  return relationships.value
    .map((rel: EntityRelationship) => {
      const isSource = rel.sourceEntityId === entity.value?.id
      const relatedEntityId = isSource ? rel.targetEntity?.id : rel.sourceEntity?.id
      const relatedEntityName = isSource ? rel.targetEntity?.name : rel.sourceEntity?.name
      return {
        id: rel.id,
        relatedEntityId: relatedEntityId ?? '',
        relatedEntityName: relatedEntityName ?? '',
        relationshipType: rel.relationshipType,
        direction: isSource ? 'child' as const : 'parent' as const,
      }
    })
    .filter(row => row.relatedEntityId !== '')
})

// SearchSelect option adapters
const entitySearchOptions = computed<SelectOption[]>(() => {
  return searchResults.value
    .filter((e: Entity) => e.id !== entity.value?.id)
    .map((e: Entity) => ({
      value: e.id,
      label: e.name,
      description: formatEntityType(e.entityType),
    }))
})

const standardOptions = computed<SelectOption[]>(() => {
  return availableStandards.value.map((s: Record<string, unknown>) => ({
    value: s.id as string,
    label: s.name as string,
    description: s.version ? `v${s.version as string}` : undefined,
  }))
})

const relationshipTypeOptions: SelectOption[] = [
  { value: 'owns', label: 'Owns', description: 'Parent ownership' },
  { value: 'governs', label: 'Governs', description: 'Governance relationship' },
  { value: 'contains', label: 'Contains', description: 'Containment hierarchy' },
  { value: 'supplies', label: 'Supplies', description: 'Supply chain' },
  { value: 'depends_on', label: 'Depends On', description: 'Dependency' },
  { value: 'consumes', label: 'Consumes', description: 'Consumption' },
]

const relationshipColor = (type: string): string => {
  const colors: Record<string, string> = {
    owns: '#3fb950',
    governs: '#a371f7',
    contains: '#2f81f7',
    supplies: '#f0883e',
    depends_on: '#f85149',
    consumes: '#db61a2',
    assesses: '#d2a8ff',
    produces: '#7ee787',
  }
  return colors[type] || '#6e7681'
}

const filteredAssessments = computed(() => {
  if (!assessmentStateFilter.value) {
    return assessments.value
  }
  return assessments.value.filter((a: Record<string, unknown>) => a.state === assessmentStateFilter.value)
})

const allPolicies = computed(() => {
  return policies.value.sort((a: CompliancePolicy, b: CompliancePolicy) => {
    // Direct policies first, then inherited
    if (a.isInherited === b.isInherited) return 0
    return a.isInherited ? 1 : -1
  })
})

// Standards available for assessment creation (from compliance policies)
const policyStandardOptions = computed<SelectOption[]>(() => {
  const seen = new Set<string>()
  return policies.value
    .filter((p: CompliancePolicy) => {
      const standardId = p.standard?.id
      if (seen.has(standardId || '')) return false
      seen.add(standardId || '')
      return true
    })
    .map((p: CompliancePolicy) => ({
      value: p.standard?.id || p.standardId,
      label: p.standard?.name || 'Unknown',
      description: p.standard?.version ? `v${p.standard.version}` : undefined,
    }))
})

// Lifecycle
onMounted(async () => {
  await fetchEntity()
  // Pre-fetch transitive graph data for the relationship graph view
  fetchRelationshipGraph()
})

// Re-fetch all data when navigating between entities (same route, different param)
watch(() => route.params.id, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    await fetchEntity()
    fetchRelationshipGraph()
  }
})

// Re-fetch graph data when switching to graph view (in case relationships changed)
watch(relationshipsView, (view) => {
  if (view === 'graph') {
    fetchRelationshipGraph()
  }
})

// Data fetching
const fetchEntity = async () => {
  loading.value = true
  error.value = ''
  try {
    const entityData = await entitiesAPI.getEntity(route.params.id as string)
    entity.value = entityData.entity
    entityTags.value = entityData.tags || []

    // Extract relationships from the detail response
    // camelCaseResponse middleware transforms snake_case keys automatically
    const parentRels = (entityData.parents || []).map((r: Record<string, unknown>) => ({
      ...r,
      sourceEntity: { id: r.sourceEntityId as string, name: r.sourceName as string },
      targetEntity: { id: r.targetEntityId as string, name: entityData.entity?.name },
    }))
    const childRels = (entityData.children || []).map((r: Record<string, unknown>) => ({
      ...r,
      sourceEntity: { id: r.sourceEntityId as string, name: entityData.entity?.name },
      targetEntity: { id: r.targetEntityId as string, name: r.targetName as string },
    }))
    relationships.value = [...parentRels, ...childRels]

    // Extract policies from the detail response
    // camelCaseResponse middleware transforms snake_case keys automatically
    policies.value = (entityData.policies || []).map((p: Record<string, unknown>) => ({
      ...p,
      standard: { id: p.standardId as string, name: p.standardName as string, version: p.standardVersion as string, description: p.standardDescription as string },
    }))

    // Fetch remaining data that requires separate endpoints
    await Promise.all([
      fetchAssessments(),
      fetchProgress(),
      fetchChildren(),
    ])
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || 'Failed to load entity'
  } finally {
    loading.value = false
  }
}

const fetchAssessments = async () => {
  assessmentsLoading.value = true
  try {
    const data = await entitiesAPI.getEntityAssessments(route.params.id as string)
    assessments.value = data.data || []
  } catch (err: unknown) {
    console.error('Failed to load assessments:', err)
  } finally {
    assessmentsLoading.value = false
  }
}


const fetchProgress = async () => {
  progressLoading.value = true
  try {
    const data = await entitiesAPI.getEntityProgress(route.params.id as string)
    progressData.value = data.data || []
  } catch (err: unknown) {
    console.error('Failed to load progress:', err)
  } finally {
    progressLoading.value = false
  }
}

const fetchChildren = async () => {
  childrenLoading.value = true
  try {
    // camelCaseResponse middleware transforms entity_type/relationship_type
    // into entityType/relationshipType before the payload lands here.
    const data = await entitiesAPI.getEntityChildren(route.params.id as string)
    childEntities.value = (data.data || []) as Record<string, unknown>[]
  } catch (err: unknown) {
    console.error('Failed to load children:', err)
    childEntities.value = []
  } finally {
    childrenLoading.value = false
  }
}


const fetchRelationshipGraph = async () => {
  try {
    const data = await entitiesAPI.getEntityRelationshipGraph(route.params.id as string)
    graphEdges.value = data.edges || []
    graphEntities.value = data.entities || []
  } catch (err: unknown) {
    console.error('Failed to load relationship graph:', err)
    // Fallback: graph component will use direct relationships
    graphEdges.value = []
    graphEntities.value = []
  }
}

const fetchAvailableStandards = async () => {
  try {
    const { data } = await client.get('/standards')
    availableStandards.value = data.data || []
  } catch (err: unknown) {
    console.error('Failed to load standards:', err)
  }
}

const searchEntities = async (query: string) => {
  entitySearchLoading.value = true
  try {
    const { data } = await client.get('/entities', { params: { search: query || undefined, limit: 20 } })
    searchResults.value = data.data || []
  } catch (err: unknown) {
    console.error('Failed to search entities:', err)
  } finally {
    entitySearchLoading.value = false
  }
}

// Computed property to check if user has entity edit/delete permissions
const isAdmin = computed(() => authStore.hasAnyPermission('entities.edit', 'entities.delete'))

// Formatters
const formatEntityType = (type: string): string => {
  const map: Record<string, string> = {
    organization: 'Organization',
    business_unit: 'Business Unit',
    team: 'Team',
    product: 'Product',
    product_version: 'Product Version',
    component: 'Component',
    supplier: 'Supplier',
    project: 'Project',
  }
  return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const formatRelationshipType = (type: string): string => {
  const map: Record<string, string> = {
    owns: 'Owns',
    supplies: 'Supplies',
    depends_on: 'Depends On',
    governs: 'Governs',
    contains: 'Contains',
    consumes: 'Consumes',
    assesses: 'Assesses',
    produces: 'Produces',
  }
  return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const formatDate = (date: string | null): string => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Actions - Edit Entity
const openEditDialog = async () => {
  if (!entity.value) return
  editForm.value = {
    name: entity.value.name,
    description: entity.value.description || '',
    state: entity.value.state,
    tags: entityTags.value.map((t: Tag) => t.name),
    country: entity.value.country ?? null,
    region: entity.value.region ?? null,
    locality: entity.value.locality ?? null,
    timezone: entity.value.timezone ?? null,
  }
  showEditDialog.value = true
}

const saveEntity = async () => {
  if (!editForm.value.name) {
    ElMessage.error('Name is required')
    return
  }
  editSaving.value = true
  try {
    await entitiesAPI.updateEntity(route.params.id as string, {
      name: editForm.value.name,
      description: editForm.value.description,
      state: editForm.value.state,
      tags: editForm.value.tags,
      ...(isGeoType(entity.value?.entityType) ? {
        country: editForm.value.country,
        region: editForm.value.region,
        locality: editForm.value.locality,
        timezone: editForm.value.timezone,
      } : {}),
    })
    ElMessage.success('Entity updated successfully')
    showEditDialog.value = false
    await fetchEntity()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to update entity')
  } finally {
    editSaving.value = false
  }
}

const resetEditForm = () => {
  editForm.value = { name: '', description: '', state: 'active', tags: [], country: null, region: null, locality: null, timezone: null }
}

// Actions - Archive Entity
const handleArchiveEntity = async () => {
  try {
    await ElMessageBox.confirm('Are you sure you want to archive this entity?', 'Archive Entity', {
      confirmButtonText: 'Confirm',
      cancelButtonText: 'Cancel',
      type: 'warning',
    })
    await entitiesAPI.updateEntity(route.params.id as string, { state: 'archived' })
    ElMessage.success('Entity archived successfully')
    await fetchEntity()
  } catch (error: unknown) {
    if (error !== 'cancel') {
      const e = error as { response?: { data?: { error?: string } }; message?: string }
      ElMessage.error(e.response?.data?.error || 'Failed to archive entity')
    }
  }
}

// Actions - Relationships
const saveRelationship = async () => {
  if (!addRelationshipForm.value.targetEntityId || !addRelationshipForm.value.relationshipType) {
    ElMessage.error('Please fill in all fields')
    return
  }
  addingRelationship.value = true
  try {
    await entitiesAPI.addRelationship(
      route.params.id as string,
      addRelationshipForm.value.targetEntityId,
      addRelationshipForm.value.relationshipType
    )
    ElMessage.success('Relationship added successfully')
    showAddRelationshipDialog.value = false
    resetAddRelationshipForm()
    await fetchEntity()
    fetchRelationshipGraph()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to add relationship')
  } finally {
    addingRelationship.value = false
  }
}

const removeRelationshipAction = async (relId: string) => {
  try {
    await ElMessageBox.confirm('Are you sure?', 'Remove Relationship', {
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      type: 'warning',
    })
    await entitiesAPI.removeRelationship(route.params.id as string, relId)
    ElMessage.success('Relationship removed')
    await fetchEntity()
    fetchRelationshipGraph()
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error('Failed to remove relationship')
    }
  }
}

const resetAddRelationshipForm = () => {
  addRelationshipForm.value = { targetEntityId: '', relationshipType: 'owns' }
  searchResults.value = []
}

// Actions - Assessments
const createAssessment = async () => {
  if (!assessmentForm.value.title) {
    ElMessage.error('Title is required')
    return
  }
  if (!assessmentForm.value.standardId) {
    ElMessage.error('Standard is required')
    return
  }
  assessmentCreating.value = true
  try {
    await client.post('/assessments', {
      title: assessmentForm.value.title,
      description: assessmentForm.value.description || undefined,
      entityId: route.params.id,
      standardId: assessmentForm.value.standardId,
      dueDate: assessmentForm.value.dueDate
        ? assessmentForm.value.dueDate.toISOString().split('T')[0]
        : null,
    })
    ElMessage.success('Assessment created successfully')
    showNewAssessmentDialog.value = false
    resetAssessmentForm()
    await fetchAssessments()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to create assessment')
  } finally {
    assessmentCreating.value = false
  }
}

const resetAssessmentForm = () => {
  assessmentForm.value = { title: '', standardId: '', description: '', dueDate: null }
}

const navigateToAssessment = (row: Record<string, unknown>) => {
  router.push(`/assessments/${row.id as string}`)
}

// Actions - Policies
const savePolicy = async () => {
  if (!addPolicyForm.value.standardId) {
    ElMessage.error('Please select a standard')
    return
  }
  addingPolicy.value = true
  try {
    await entitiesAPI.createPolicy(
      route.params.id as string,
      addPolicyForm.value.standardId,
      addPolicyForm.value.description || undefined
    )
    ElMessage.success('Policy added successfully')
    showAddPolicyDialog.value = false
    resetAddPolicyForm()
    await fetchEntity()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to add policy')
  } finally {
    addingPolicy.value = false
  }
}

const removePolicyAction = async (policyId: string) => {
  try {
    await ElMessageBox.confirm('Are you sure?', 'Remove Policy', {
      confirmButtonText: 'Yes',
      cancelButtonText: 'No',
      type: 'warning',
    })
    await entitiesAPI.removePolicy(route.params.id as string, policyId)
    ElMessage.success('Policy removed')
    await fetchEntity()
  } catch (error: unknown) {
    if (error !== 'cancel') {
      ElMessage.error('Failed to remove policy')
    }
  }
}

const resetAddPolicyForm = () => {
  addPolicyForm.value = { standardId: '', description: '' }
}

// When Add Policy dialog opens, fetch available standards
const onShowAddPolicyDialog = () => {
  if (!availableStandards.value.length) {
    fetchAvailableStandards()
  }
}

const openEditPolicyDialog = (row: Record<string, unknown>) => {
  editPolicyForm.value = {
    id: row.id as string,
    standardId: (row.standard as Record<string, unknown> | undefined)?.id as string || (row.standardId as string),
    description: row.description as string || '',
  }
  showEditPolicyDialog.value = true
}

const onShowEditPolicyDialog = () => {
  if (!availableStandards.value.length) {
    fetchAvailableStandards()
  }
}

const updatePolicyAction = async () => {
  if (!editPolicyForm.value.standardId) {
    ElMessage.error('Please select a standard')
    return
  }
  updatingPolicy.value = true
  try {
    await entitiesAPI.updatePolicy(
      route.params.id as string,
      editPolicyForm.value.id,
      {
        standardId: editPolicyForm.value.standardId,
        description: editPolicyForm.value.description,
      }
    )
    ElMessage.success('Policy updated successfully')
    showEditPolicyDialog.value = false
    await fetchEntity()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to update policy')
  } finally {
    updatingPolicy.value = false
  }
}
</script>

<style scoped lang="scss">
.entity-detail-container {
  padding: 0;
}

.entity-detail-header {
  padding: var(--cat-spacing-6);
  border-bottom: 1px solid var(--cat-border-default);
  background-color: var(--cat-bg-secondary);
}

.entity-detail-content {
  padding: var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
  gap: var(--cat-spacing-4);
}

.entity-title-section {
  flex: 1;

  h2 {
    margin: 0 0 var(--cat-spacing-3) 0;
    font-size: var(--cat-font-size-2xl);
    font-weight: var(--cat-font-weight-bold);
    color: var(--cat-text-primary);
  }

  .entity-badges {
    display: flex;
    gap: var(--cat-spacing-2);
    flex-wrap: wrap;
  }
}

.action-buttons {
  display: flex;
  gap: var(--cat-spacing-2);
  flex-shrink: 0;
}

.tab-content {
  padding: var(--cat-spacing-4);
  max-height: calc(100vh - 400px);
  overflow-y: auto;
}

.tab-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--cat-spacing-4);
  gap: var(--cat-spacing-4);
}

.tab-footer {
  display: flex;
  justify-content: flex-start;
  margin-top: var(--cat-spacing-4);
}

.geo-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--cat-border-subtle);
  color: var(--cat-text-secondary);
  font-size: 0.83rem;
  flex-wrap: wrap;

  .el-icon { vertical-align: -2px; margin-right: 3px; }

  .geo-sep::before {
    content: '·';
    margin-right: 6px;
    opacity: 0.4;
  }

  .geo-tz {
    margin-left: auto;
    background: var(--cat-bg-hover);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: monospace;
    font-size: 0.78rem;
  }
}

.info-field {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 14px;

  &:last-child {
    margin-bottom: 0;
  }

  label {
    flex-shrink: 0;
    min-width: 90px;
    font-size: var(--cat-font-size-xs);
    font-weight: var(--cat-font-weight-medium);
    color: var(--cat-text-secondary);
    white-space: nowrap;
  }

  p {
    margin: 0;
    color: var(--cat-text-primary);
    font-size: var(--cat-font-size-sm);
  }

  .info-pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
}

.description-text {
  line-height: var(--cat-line-height-lg);
}

.relationships-view-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--cat-spacing-4);
}

.entity-link {
  color: var(--cat-brand-primary);
  text-decoration: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.subtle-link {
  color: var(--cat-text-primary, #e6edf3);
  text-decoration: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.empty-state {
  padding: var(--cat-spacing-6);
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-sm);
}

.progress-section {
  margin-bottom: var(--cat-spacing-6);

  h3 {
    font-size: var(--cat-font-size-md);
    font-weight: var(--cat-font-weight-semibold);
    margin: 0 0 var(--cat-spacing-3) 0;
    color: var(--cat-text-primary);

    .version {
      font-size: var(--cat-font-size-sm);
      color: var(--cat-text-secondary);
      font-weight: var(--cat-font-weight-normal);
      margin-left: var(--cat-spacing-2);
    }
  }

  .no-data-compact {
    padding: var(--cat-spacing-3);
    text-align: center;
    color: var(--cat-text-tertiary);
    font-size: var(--cat-font-size-sm);
  }
}

.inherited-badge {
  font-style: italic;
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

.tab-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--cat-text-secondary);
}

.no-data {
  text-align: center;
  padding: var(--cat-spacing-6);
  color: var(--cat-text-tertiary);
}

.empty-state {
  text-align: center;
  padding: var(--cat-spacing-6);
  color: var(--cat-text-tertiary);
}

:deep(.el-breadcrumb__item) {
  color: var(--cat-text-primary);
}

:deep(.el-breadcrumb__separator) {
  color: var(--cat-text-tertiary);
}

:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}
</style>
