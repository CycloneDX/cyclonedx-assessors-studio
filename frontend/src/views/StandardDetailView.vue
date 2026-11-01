<template>
  <div class="standard-detail-container">
    <div class="standard-detail-header">
      <el-breadcrumb :separator-icon="ArrowRight">
        <el-breadcrumb-item :to="{ path: '/standards' }">{{ t('nav.standards') }}</el-breadcrumb-item>
        <el-breadcrumb-item>{{ standard?.name || t('common.loading') }}</el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <div v-if="loading" class="standard-loading">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>{{ t('common.loading') }}</span>
    </div>

    <el-alert v-else-if="error" type="error" show-icon :closable="false" class="m-24">
      {{ error }}
    </el-alert>

    <div v-else-if="standard" class="standard-detail-content">
      <el-card class="standard-info-card">
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="info-group">
              <label>{{ t('standards.name') }}</label>
              <p>{{ standard.name }}</p>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-group">
              <label>{{ t('standards.version') }}</label>
              <p>{{ standard.version || '-' }}</p>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-group">
              <label>{{ t('standards.owner') }}</label>
              <p>{{ standard.owner || '-' }}</p>
            </div>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="6">
            <div class="info-group">
              <label>{{ t('common.state') }}</label>
              <StateBadge :state="standard.state || 'draft'" />
            </div>
          </el-col>
          <el-col :span="6">
            <div class="info-group">
              <label>{{ t('common.status') }}</label>
              <p>{{ standard.is_imported ? t('standards.importStandard') : 'Authored' }}</p>
            </div>
          </el-col>
          <el-col v-if="standard.authored_by" :span="6">
            <div class="info-group">
              <label>Authored by</label>
              <p>{{ standard.authored_by }}</p>
            </div>
          </el-col>
          <el-col v-if="standard.approved_by" :span="6">
            <div class="info-group">
              <label>Approved by</label>
              <p>{{ standard.approved_by }}</p>
            </div>
          </el-col>
        </el-row>

        <el-row v-if="standard.approved_at" :gutter="20">
          <el-col :span="6">
            <div class="info-group">
              <label>Approved at</label>
              <p>{{ formatDate(standard.approved_at) }}</p>
            </div>
          </el-col>
        </el-row>

        <div v-if="standard.description" class="info-group">
          <label>{{ t('standards.description') }}</label>
          <p>{{ standard.description }}</p>
        </div>
      </el-card>

      <!-- Workflow action buttons -->
      <div class="workflow-actions">
        <el-button
          v-if="canEdit"
          type="primary"
          :icon="Edit"
          @click="openEditDialog"
        >
          {{ t('standards.edit') }}
        </el-button>
        <el-button
          v-if="canSubmitForApproval"
          type="warning"
          @click="handleSubmitForApproval"
        >
          {{ t('standards.submitForApproval') }}
        </el-button>
        <el-button
          v-if="canApprove"
          type="success"
          @click="handleApprove"
        >
          {{ t('standards.approve') }}
        </el-button>
        <el-button
          v-if="canReject"
          type="danger"
          @click="handleReject"
        >
          {{ t('standards.reject') }}
        </el-button>
        <el-button
          type="default"
          @click="handleExport"
          :loading="exporting"
        >
          {{ t('standards.exportCycloneDX') }}
        </el-button>
        <el-dropdown v-if="canDuplicate || canRetire" trigger="click">
          <el-button type="default">
            {{ t('standards.more') }} <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="canDuplicate" @click="handleDuplicate">{{ t('standards.duplicate') }}</el-dropdown-item>
              <el-dropdown-item v-if="canRetire" @click="handleRetire">{{ t('standards.retire') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- Levels card -->
      <el-card v-if="levels.length > 0 || canEditRequirements" class="levels-card">
        <template #header>
          <div class="card-header-content">
            <span>{{ t('standards.levels') }} ({{ levels.length }})</span>
            <el-button
              v-if="canEditRequirements"
              type="primary"
              size="small"
              :icon="Plus"
              @click="openAddLevelDialog"
            >
              {{ t('standards.addLevel') }}
            </el-button>
          </div>
        </template>

        <el-table
          :data="levels"
          stripe
          border
          @row-click="canEditRequirements ? toggleLevelExpand($event) : null"
          :row-class-name="levelRowClassName"
        >
          <el-table-column prop="identifier" :label="t('common.id')" min-width="150" sortable>
            <template #default="{ row }">
              <div v-if="editingLevelField?.id === row.id && editingLevelField?.field === 'identifier'" class="inline-edit-compact" @click.stop>
                <el-input v-model="editingLevelValue" size="small" @keydown.enter="saveLevelField(row)" @keydown.escape="editingLevelField = null" />
                <el-button size="small" type="primary" link @click="saveLevelField(row)">&#10003;</el-button>
                <el-button size="small" link @click="editingLevelField = null">&#10005;</el-button>
              </div>
              <span v-else class="editable-text" :class="{ 'clickable': canEditRequirements }" @click.stop="canEditRequirements && startEditLevel(row, 'identifier')">{{ row.identifier }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="title" :label="t('standards.name')" min-width="200" sortable>
            <template #default="{ row }">
              <div v-if="editingLevelField?.id === row.id && editingLevelField?.field === 'title'" class="inline-edit-compact" @click.stop>
                <el-input v-model="editingLevelValue" size="small" @keydown.enter="saveLevelField(row)" @keydown.escape="editingLevelField = null" />
                <el-button size="small" type="primary" link @click="saveLevelField(row)">&#10003;</el-button>
                <el-button size="small" link @click="editingLevelField = null">&#10005;</el-button>
              </div>
              <span v-else class="editable-text" :class="{ 'clickable': canEditRequirements, 'placeholder-text': canEditRequirements && !row.title }" @click.stop="canEditRequirements && startEditLevel(row, 'title')">{{ row.title || (canEditRequirements ? 'Click to add title...' : row.identifier) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="description" :label="t('standards.description')" min-width="250" sortable>
            <template #default="{ row }">
              <div v-if="editingLevelField?.id === row.id && editingLevelField?.field === 'description'" class="inline-edit-compact" @click.stop>
                <el-input v-model="editingLevelValue" size="small" type="textarea" :rows="2" @keydown.escape="editingLevelField = null" />
                <el-button size="small" type="primary" link @click="saveLevelField(row)">&#10003;</el-button>
                <el-button size="small" link @click="editingLevelField = null">&#10005;</el-button>
              </div>
              <span v-else class="editable-text level-description" :class="{ 'clickable': canEditRequirements, 'placeholder-text': canEditRequirements && !row.description }" @click.stop="canEditRequirements && startEditLevel(row, 'description')">{{ row.description || (canEditRequirements ? 'Click to add description...' : '-') }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="requirementsCount" :label="t('standards.requirements')" min-width="140" align="center" sortable>
            <template #default="{ row }">
              <el-button v-if="canEditRequirements" type="primary" link size="small" @click.stop="openLevelRequirementsDialog(row)">
                {{ row.requirementsCount }} {{ row.requirementsCount === 1 ? 'requirement' : 'requirements' }}
              </el-button>
              <span v-else>{{ row.requirementsCount }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canEditRequirements" :label="t('common.actions')" min-width="80" align="center">
            <template #default="{ row }">
              <IconButton
                :icon="Delete"
                variant="danger"
                :tooltip="t('common.delete')"
                @click.stop="handleDeleteLevel(row)"
              />
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- Requirements card -->
      <el-card class="requirements-card">
        <template #header>
          <div class="card-header-content">
            <span>{{ t('standards.requirements') }} ({{ requirementCount }})</span>
            <el-button
              v-if="canEditRequirements"
              type="primary"
              size="small"
              :icon="Plus"
              @click="openAddRequirementDialog"
            >
              {{ t('common.add') }}
            </el-button>
          </div>
        </template>

        <RequirementTree
          :model-value="requirements"
          :editable="canEditRequirements"
          @delete="handleDeleteRequirement"
          @edit="openEditRequirementDialog"
          @save-inline="handleSaveInline"
          @reparent="handleReparent"
        />
      </el-card>

      <!-- Used By card -->
      <el-card class="used-by-card">
        <template #header>
          <span>{{ t('common.status') }}</span>
        </template>

        <div v-if="projectsLoading" class="loading-state">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>{{ t('common.loading') }}</span>
        </div>

        <div v-else-if="projects.length === 0" class="empty-state">
          <p>{{ t('common.noData') }}</p>
        </div>

        <div v-else class="projects-list">
          <div v-for="project in projects" :key="project.id" class="project-item">
            <el-link :href="`#/projects/${project.id}`" type="primary">{{ project.name }}</el-link>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Edit Standard Dialog -->
    <el-dialog
      v-model="editDialogVisible"
      title="Edit Standard"
      width="600px"
      @close="resetEditForm"
    >
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="Name" prop="name" required>
          <el-input v-model="editForm.name" placeholder="Standard name" />
        </el-form-item>
        <el-form-item label="Identifier" prop="identifier">
          <el-input v-model="editForm.identifier" placeholder="Standard identifier" />
        </el-form-item>
        <el-form-item label="Version" prop="version">
          <el-input v-model="editForm.version" placeholder="Version" />
        </el-form-item>
        <el-form-item label="Owner" prop="owner">
          <el-input v-model="editForm.owner" placeholder="Owner" />
        </el-form-item>
        <el-form-item label="Description" prop="description">
          <el-input
            v-model="editForm.description"
            type="textarea"
            :rows="4"
            placeholder="Standard description"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="handleSaveEdit">Save</el-button>
      </template>
    </el-dialog>

    <!-- Add/Edit Requirement Dialog -->
    <el-dialog
      v-model="requirementDialogVisible"
      :title="editingRequirement ? 'Edit Requirement' : 'Add Requirement'"
      width="600px"
      @close="resetRequirementForm"
    >
      <el-form ref="requirementFormRef" :model="requirementForm" label-width="120px">
        <el-form-item label="Identifier" prop="identifier" required>
          <el-input v-model="requirementForm.identifier" placeholder="Requirement identifier" />
        </el-form-item>
        <el-form-item label="Name" prop="name" required>
          <el-input v-model="requirementForm.name" placeholder="Requirement name" />
        </el-form-item>
        <el-form-item label="Description" prop="description">
          <el-input
            v-model="requirementForm.description"
            type="textarea"
            :rows="4"
            placeholder="Requirement description"
          />
        </el-form-item>
        <el-form-item label="Parent" prop="parentId">
          <el-select
            v-model="requirementForm.parentId"
            placeholder="Select parent requirement (optional)"
            clearable
            filterable
          >
            <el-option
              v-for="req in availableParentRequirements"
              :key="req.id"
              :label="req.label"
              :value="req.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requirementDialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="handleSaveRequirement">Save</el-button>
      </template>
    </el-dialog>

    <!-- Add Level Dialog -->
    <el-dialog
      v-model="levelDialogVisible"
      title="Add Level"
      width="500px"
      @close="resetLevelForm"
    >
      <el-form :model="levelForm" label-width="120px">
        <el-form-item label="Identifier" required>
          <el-input v-model="levelForm.identifier" placeholder="e.g. L1, L2, L3" />
        </el-form-item>
        <el-form-item label="Title">
          <el-input v-model="levelForm.title" placeholder="e.g. Level 1: Opportunistic" />
        </el-form-item>
        <el-form-item label="Description">
          <el-input v-model="levelForm.description" type="textarea" :rows="3" placeholder="Level description" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="levelDialogVisible = false">Cancel</el-button>
        <el-button type="primary" @click="handleSaveLevel">Save</el-button>
      </template>
    </el-dialog>

    <!-- Level Requirements Assignment Dialog -->
    <el-dialog
      v-model="levelReqsDialogVisible"
      :title="`Assign Requirements to ${editingLevel?.identifier || 'Level'}`"
      width="700px"
    >
      <p class="mb-4 text-secondary text-sm">
        Select which requirements belong to this level. Use the search box to filter.
      </p>
      <el-input
        v-model="levelReqSearch"
        placeholder="Search requirements..."
        clearable
        class="mb-4"
      />
      <div class="level-reqs-checklist">
        <el-checkbox-group v-model="selectedLevelReqIds">
          <div v-for="req in filteredFlatRequirements" :key="req.id" class="level-req-item" :style="{ paddingLeft: `${req.depth * 20 + 8}px` }">
            <el-checkbox :label="req.id" :value="req.id">
              <span class="level-req-id">{{ req.identifier }}</span>
              <span v-if="req.name !== req.identifier" class="level-req-name">{{ req.name }}</span>
            </el-checkbox>
          </div>
        </el-checkbox-group>
      </div>
      <template #footer>
        <div class="flex items-center justify-between w-full">
          <span class="text-secondary text-sm">{{ selectedLevelReqIds.length }} selected</span>
          <div>
            <el-button @click="levelReqsDialogVisible = false">Cancel</el-button>
            <el-button type="primary" @click="handleSaveLevelRequirements">Save</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, nextTick, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Loading, Edit, Delete, Plus, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import client from '@/api/client'
import StateBadge from '@/components/shared/StateBadge.vue'
import IconButton from '@/components/shared/IconButton.vue'
import RequirementTree, { type RequirementNode } from '@/components/shared/RequirementTree.vue'
import { useAuthStore } from '@/stores/auth'
import { type Standard } from '@/types'

interface ProjectReference {
  id: string
  name: string
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()

const loading = ref(true)
const error = ref('')
const standard = ref<Standard | null>(null)
const requirements = ref<RequirementNode[]>([])
const levels = ref<Record<string, unknown>[]>([])
const projects = ref<ProjectReference[]>([])
const projectsLoading = ref(false)
const exporting = ref(false)

// Edit dialog state
const editDialogVisible = ref(false)
const editForm = ref({
  name: '',
  identifier: '',
  version: '',
  owner: '',
  description: '',
})

// Requirement dialog state
const requirementDialogVisible = ref(false)
const editingRequirement = ref<RequirementNode | null>(null)
const requirementForm = ref({
  identifier: '',
  name: '',
  description: '',
  parentId: null as string | null,
})

// Inline editing is now handled by RequirementTree component

// Level dialog state
const levelDialogVisible = ref(false)
const levelForm = ref({ identifier: '', title: '', description: '' })

// Level inline editing state
const editingLevelField = ref<{ id: string; field: string } | null>(null)
const editingLevelValue = ref('')

// Level requirements assignment dialog
const levelReqsDialogVisible = ref(false)
const editingLevel = ref<Record<string, unknown> | null>(null)
const selectedLevelReqIds = ref<string[]>([])
const levelReqSearch = ref('')

// Flatten requirements for the level assignment checklist
const flatRequirementsWithDepth = computed(() => {
  const result: Array<{ id: string; identifier: string; name: string; depth: number }> = []
  const flatten = (nodes: Record<string, unknown>[], depth: number) => {
    for (const node of nodes) {
      result.push({ id: (node.id as string), identifier: (node.identifier as string), name: (node.name as string), depth })
      if ((node.children as Record<string, unknown>[] | undefined)?.length) flatten((node.children as Record<string, unknown>[]), depth + 1)
    }
  }
  flatten(requirements.value, 0)
  return result
})

const filteredFlatRequirements = computed(() => {
  const search = levelReqSearch.value.toLowerCase()
  if (!search) return flatRequirementsWithDepth.value
  return flatRequirementsWithDepth.value.filter(r =>
    r.identifier.toLowerCase().includes(search) || r.name.toLowerCase().includes(search)
  )
})

// Count total requirements (flattened from tree)
const requirementCount = computed(() => {
  const count = (nodes: Record<string, unknown>[]): number =>
    nodes.reduce((sum, n) => sum + 1 + count((n.children as Record<string, unknown>[] | undefined) || []), 0)
  return count(requirements.value)
})

// Flatten requirements tree for parent selector, excluding the currently edited requirement and its descendants
const availableParentRequirements = computed(() => {
  const editId = editingRequirement.value?.id
  const result: { id: string; label: string }[] = []

  const flatten = (nodes: Record<string, unknown>[], depth: number = 0) => {
    for (const node of nodes) {
      if (editId && (node.id as string) === editId) continue
      const indent = depth > 0 ? '\u00A0'.repeat(depth * 4) : ''
      result.push({
        id: (node.id as string),
        label: `${indent}${node.identifier as string}: ${node.name as string}`,
      })
      if ((node.children as Record<string, unknown>[] | undefined)?.length) {
        flatten((node.children as Record<string, unknown>[]), depth + 1)
      }
    }
  }

  flatten(requirements.value)
  return result
})

// Check if user can perform various actions
const canEdit = computed(() => {
  return standard.value?.state === 'draft' && authStore.hasAnyPermission('standards.create', 'standards.edit')
})

const canSubmitForApproval = computed(() => {
  return standard.value?.state === 'draft' && authStore.hasAnyPermission('standards.create', 'standards.edit')
})

const canApprove = computed(() => {
  return (
    standard.value?.state === 'in_review' &&
    authStore.hasAnyPermission('standards.approve') &&
    authStore.user?.id !== standard.value?.authored_by
  )
})

const canReject = computed(() => {
  return (
    standard.value?.state === 'in_review' &&
    authStore.hasAnyPermission('standards.approve') &&
    authStore.user?.id !== standard.value?.authored_by
  )
})

const canDuplicate = computed(() => {
  return standard.value?.state === 'published' && authStore.hasAnyPermission('standards.create', 'standards.edit')
})

const canRetire = computed(() => {
  return standard.value?.state === 'published' && authStore.hasPermission('admin.settings')
})

const canEditRequirements = computed(() => {
  return standard.value?.state === 'draft' && authStore.hasAnyPermission('standards.create', 'standards.edit')
})

const fetchProjects = async () => {
  if (!standard.value?.id) return
  projectsLoading.value = true
  try {
    const { data } = await client.get(`/projects?standardId=${standard.value.id}`)
    projects.value = data.data || []
  } catch (err: unknown) {
    console.error('Failed to fetch projects:', err)
    projects.value = []
  } finally {
    projectsLoading.value = false
  }
}

// Silent reloads avoid toggling `loading.value`. The full-page loading
// indicator unmounts the requirements tree, which collapses to the top
// of the page and discards the user's scroll position. Mutation handlers
// (reparent, level edits, requirement edits, etc.) want to refresh the
// in-memory model without that visible flicker.
//
// The actual scroll container is `.app-main` from App.vue, which has
// `overflow-y: auto` inside a position:fixed shell. window.scroll* is
// always 0 here, so we have to capture and restore the container's
// scrollTop directly.
const fetchStandard = async (options: { silent?: boolean } = {}) => {
  if (!options.silent) {
    loading.value = true
  }
  error.value = ''
  const scrollContainer = options.silent
    ? (document.querySelector('.app-main') as HTMLElement | null)
    : null
  const scrollLeft = scrollContainer?.scrollLeft ?? 0
  const scrollTop = scrollContainer?.scrollTop ?? 0
  try {
    const { data } = await client.get(`/standards/${encodeURIComponent(String(route.params.id))}`)
    standard.value = data.standard
    requirements.value = data.requirements || []
    levels.value = data.levels || []
    await fetchProjects()
    if (options.silent && scrollContainer) {
      // Wait for Vue to flush the DOM update before restoring scroll.
      await nextTick()
      scrollContainer.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'auto' })
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    error.value = e.response?.data?.error || 'Failed to load standard'
  } finally {
    if (!options.silent) {
      loading.value = false
    }
  }
}

const formatDate = (dateString: string): string => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Edit dialog handlers
const openEditDialog = () => {
  if (standard.value) {
    editForm.value = {
      name: standard.value.name,
      identifier: standard.value.identifier || '',
      version: standard.value.version || '',
      owner: standard.value.owner || '',
      description: standard.value.description || '',
    }
  }
  editDialogVisible.value = true
}

const resetEditForm = () => {
  editForm.value = {
    name: '',
    identifier: '',
    version: '',
    owner: '',
    description: '',
  }
}

const handleSaveEdit = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.put(`/standards/${standard.value.id}`, editForm.value)
    ElMessage.success('Standard updated successfully')
    editDialogVisible.value = false
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to update standard')
  }
}

// Requirement dialog handlers
const openAddRequirementDialog = () => {
  editingRequirement.value = null
  requirementForm.value = {
    identifier: '',
    name: '',
    description: '',
    parentId: null,
  }
  requirementDialogVisible.value = true
}

const openEditRequirementDialog = (requirement: RequirementNode) => {
  editingRequirement.value = requirement
  requirementForm.value = {
    identifier: requirement.identifier,
    name: requirement.name,
    description: requirement.description || '',
    parentId: requirement.parent_id || null,
  }
  requirementDialogVisible.value = true
}

const resetRequirementForm = () => {
  editingRequirement.value = null
  requirementForm.value = {
    identifier: '',
    name: '',
    description: '',
    parentId: null,
  }
}

const handleSaveRequirement = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    if (editingRequirement.value) {
      await client.put(
        `/standards/${standard.value.id}/requirements/${editingRequirement.value.id}`,
        requirementForm.value
      )
      ElMessage.success('Requirement updated successfully')
    } else {
      await client.post(`/standards/${standard.value.id}/requirements`, requirementForm.value)
      ElMessage.success('Requirement added successfully')
    }
    requirementDialogVisible.value = false
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to save requirement')
  }
}

const handleSaveInline = async (row: RequirementNode, field: string, value: string) => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.put(
      `/standards/${standard.value.id}/requirements/${row.id}`,
      { [field]: value }
    )
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || `Failed to update ${field}`)
  }
}

const handleReparent = async (requirementId: string, newParentId: string | null) => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.put(
      `/standards/${standard.value.id}/requirements/${requirementId}/reparent`,
      { parent_id: newParentId }
    )
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to move requirement')
  }
}

// Count descendants recursively. Used to decide whether to warn the user
// that delete will cascade — backend `ON DELETE CASCADE` drops the whole
// subtree, which is the intended behaviour but easy to do by accident.
const countDescendants = (node: RequirementNode): number => {
  const children = node.children || []
  return children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

const handleDeleteRequirement = async (requirement: RequirementNode) => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    const descendantCount = countDescendants(requirement)
    const hasChildren = descendantCount > 0
    // Built as VNodes, not an HTML string: the identifier comes from user
    // input and imported standards, and was rendered as raw HTML
    // (security review W2).
    const message = hasChildren
      ? h('div', [
          h('p', [
            h('strong', String(requirement.identifier)),
            ` has ${descendantCount} child requirement${descendantCount === 1 ? '' : 's'}. Deleting will also remove all descendants. This cannot be undone.`,
          ]),
          h('p', 'Continue?'),
        ])
      : 'This will delete the requirement. Continue?'
    await ElMessageBox.confirm(
      message,
      hasChildren ? 'Delete requirement and its descendants?' : 'Warning',
      {
        confirmButtonText: hasChildren ? `Delete ${descendantCount + 1} requirements` : 'OK',
        cancelButtonText: 'Cancel',
        type: 'warning',
        confirmButtonClass: hasChildren ? 'el-button--danger' : undefined,
      }
    )
    await client.delete(
      `/standards/${standard.value.id}/requirements/${requirement.id}`
    )
    ElMessage.success('Requirement deleted successfully')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to delete requirement')
    }
  }
}

// Level handlers
const openAddLevelDialog = () => {
  levelForm.value = { identifier: '', title: '', description: '' }
  levelDialogVisible.value = true
}

const resetLevelForm = () => {
  levelForm.value = { identifier: '', title: '', description: '' }
}

const handleSaveLevel = async () => {
  if (!levelForm.value.identifier) {
    ElMessage.warning('Identifier is required')
    return
  }
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.post(`/standards/${standard.value.id}/levels`, levelForm.value)
    ElMessage.success('Level added')
    levelDialogVisible.value = false
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to add level')
  }
}

const handleDeleteLevel = async (level: Record<string, unknown>) => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await ElMessageBox.confirm(
      `Delete level "${level.identifier as string}"? This will also remove all requirement assignments for this level.`,
      'Warning',
      { confirmButtonText: 'Delete', cancelButtonText: 'Cancel', type: 'warning' }
    )
    await client.delete(`/standards/${standard.value.id}/levels/${level.id as string}`)
    ElMessage.success('Level deleted')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to delete level')
    }
  }
}

const startEditLevel = (row: Record<string, unknown>, field: string) => {
  editingLevelField.value = { id: (row.id as string), field }
  editingLevelValue.value = (row[field] as string) || ''
}

const saveLevelField = async (row: Record<string, unknown>) => {
  if (!editingLevelField.value) return
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.put(
      `/standards/${standard.value.id}/levels/${row.id as string}`,
      { [editingLevelField.value.field]: editingLevelValue.value }
    )
    editingLevelField.value = null
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to update level')
  }
}

const toggleLevelExpand = (_row: Record<string, unknown>) => {
  // Placeholder for potential future expand behavior
}

const levelRowClassName = (_data: Record<string, unknown>) => {
  return ''
}

const openLevelRequirementsDialog = (level: Record<string, unknown>) => {
  editingLevel.value = level
  selectedLevelReqIds.value = [...((level.requirementIds as string[] | undefined) || [])]
  levelReqSearch.value = ''
  levelReqsDialogVisible.value = true
}

const handleSaveLevelRequirements = async () => {
  if (!editingLevel.value) return
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await client.put(
      `/standards/${standard.value.id}/levels/${editingLevel.value.id as string}/requirements`,
      { requirementIds: selectedLevelReqIds.value }
    )
    ElMessage.success('Level requirements updated')
    levelReqsDialogVisible.value = false
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to update level requirements')
  }
}

// Workflow action handlers
const handleSubmitForApproval = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await ElMessageBox.confirm(
      'Submit this standard for approval? It will be locked from further edits.',
      'Submit for Approval',
      {
        confirmButtonText: 'OK',
        cancelButtonText: 'Cancel',
        type: 'warning',
      }
    )
    await client.post(`/standards/${standard.value.id}/submit`)
    ElMessage.success('Standard submitted for approval')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to submit for approval')
    }
  }
}

const handleApprove = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await ElMessageBox.confirm(
      'Approve this standard? It will become published.',
      'Approve Standard',
      {
        confirmButtonText: 'OK',
        cancelButtonText: 'Cancel',
        type: 'success',
      }
    )
    await client.post(`/standards/${standard.value.id}/approve`)
    ElMessage.success('Standard approved')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to approve standard')
    }
  }
}

const handleReject = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    const { value: reason } = await ElMessageBox.prompt(
      'Please provide a reason for rejection',
      'Reject Standard',
      {
        confirmButtonText: 'OK',
        cancelButtonText: 'Cancel',
        inputType: 'textarea',
      }
    )
    await client.post(`/standards/${standard.value.id}/reject`, { reason })
    ElMessage.success('Standard rejected')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to reject standard')
    }
  }
}

const handleDuplicate = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    const { data } = await client.post(`/standards/${standard.value.id}/duplicate`)
    ElMessage.success('Standard duplicated')
    await router.push(`/standards/${(data as Record<string, unknown>).id as string}`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to duplicate standard')
  }
}

const handleExport = async () => {
  exporting.value = true
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    const response = await client.get(`/standards/${standard.value.id}/export`, {
      responseType: 'blob',
    })
    const blob = new Blob([response.data], { type: 'application/vnd.cyclonedx+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const slug = (standard.value.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const suffix = standard.value.version
      ? (standard.value.version).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
      : new Date().toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, '')
    link.download = `${slug}-${suffix}.cdx.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    ElMessage.error(e.response?.data?.error || 'Failed to export standard')
  } finally {
    exporting.value = false
  }
}

const handleRetire = async () => {
  try {
    if (!standard.value?.id) {
      ElMessage.error('Standard ID is missing')
      return
    }
    await ElMessageBox.confirm(
      'Retire this standard? It will no longer be available for use.',
      'Retire Standard',
      {
        confirmButtonText: 'OK',
        cancelButtonText: 'Cancel',
        type: 'warning',
      }
    )
    await client.post(`/standards/${standard.value.id}/retire`)
    ElMessage.success('Standard retired')
    await fetchStandard({ silent: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    if (e.message !== 'cancel') {
      ElMessage.error(e.response?.data?.error || 'Failed to retire standard')
    }
  }
}

onMounted(fetchStandard)
</script>

<style scoped lang="scss">
.standard-detail-container {
  padding: 0;
}

.standard-detail-header {
  padding: var(--cat-spacing-6);
  border-bottom: 1px solid var(--cat-border-default);
  background-color: var(--cat-bg-secondary);
}

.standard-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--cat-text-secondary);
}

.standard-detail-content {
  padding: var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

.standard-info-card {
  :deep(.el-card__body) {
    border-top: 3px solid var(--cat-accent-primary);
  }
}

.levels-card {
  :deep(.el-card__header) {
    color: var(--cat-chart-purple);
    font-weight: var(--cat-font-weight-semibold);
  }

  :deep(.el-card__body) {
    border-top: 3px solid var(--cat-chart-purple);
  }
}

.requirements-card {
  :deep(.el-card__header) {
    color: var(--cat-chart-green);
    font-weight: var(--cat-font-weight-semibold);
  }

  :deep(.el-card__body) {
    border-top: 3px solid var(--cat-chart-green);
  }
}

.used-by-card {
  :deep(.el-card__header) {
    color: var(--cat-chart-blue);
    font-weight: var(--cat-font-weight-semibold);
  }

  :deep(.el-card__body) {
    border-top: 3px solid var(--cat-chart-blue);
  }
}

.info-group {
  margin-bottom: var(--cat-spacing-4);

  &:last-child {
    margin-bottom: 0;
  }

  label {
    display: block;
    font-size: var(--cat-font-size-sm);
    font-weight: var(--cat-font-weight-medium);
    color: var(--cat-text-secondary);
    margin-bottom: var(--cat-spacing-2);
  }

  p {
    margin: 0;
    color: var(--cat-text-primary);
  }
}

.level-description {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.editable-text {
  min-height: 20px;
  display: inline-block;

  &.clickable {
    cursor: pointer;
    border-radius: var(--cat-radius-sm);
    padding: 1px 4px;
    margin: -1px -4px;

    &:hover {
      background-color: var(--cat-bg-tertiary, rgba(255,255,255,0.05));
    }
  }

  &.placeholder-text {
    color: var(--cat-text-tertiary);
    font-style: italic;
    font-size: var(--cat-font-size-sm);
  }
}

.inline-edit-compact {
  display: flex;
  align-items: center;
  gap: 4px;
}

.level-reqs-checklist {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-sm);
  padding: 8px 0;
}

.level-req-item {
  padding: 4px 12px;

  &:hover {
    background-color: var(--cat-bg-secondary);
  }
}

.level-req-id {
  font-weight: var(--cat-font-weight-medium);
  font-size: var(--cat-font-size-sm);
  margin-right: 8px;
}

.level-req-name {
  color: var(--cat-text-secondary);
  font-size: var(--cat-font-size-sm);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--cat-text-secondary);
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--cat-text-secondary);

  p {
    margin: 0;
  }
}

.projects-list {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
}

.project-item {
  padding: var(--cat-spacing-2) 0;
  border-bottom: 1px solid var(--cat-border-default);

  &:last-child {
    border-bottom: none;
  }
}

:deep(.el-breadcrumb__item) {
  color: var(--cat-text-primary);
}

:deep(.el-breadcrumb__separator) {
  color: var(--cat-text-tertiary);
}

.workflow-actions {
  display: flex;
  gap: var(--cat-spacing-3);
  flex-wrap: wrap;
  padding: var(--cat-spacing-4) 0;
}


.card-header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
</style>
