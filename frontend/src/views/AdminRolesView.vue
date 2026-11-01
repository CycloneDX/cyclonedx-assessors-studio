<template>
  <div class="admin-roles-container" :class="{ 'admin-roles-container--embedded': embedded }">
    <PageHeader v-if="!embedded" :title="t('admin.roleManagement')">
      <template #actions>
        <el-button type="primary" @click="openNewRoleDialog">{{ t('admin.createRole') }}</el-button>
      </template>
    </PageHeader>

    <div v-if="embedded" class="admin-roles-toolbar">
      <el-button type="primary" @click="openNewRoleDialog">{{ t('admin.createRole') }}</el-button>
    </div>

    <div class="admin-roles-content">
      <div v-if="loading" class="loading-container">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>{{ t('common.loading') }}</span>
      </div>

      <div v-else-if="error" class="error-container">
        <el-alert :title="t('common.error')" :description="error" type="error" :closable="false" />
        <el-button @click="fetchRoles" class="retry-button">{{ t('common.retry') }}</el-button>
      </div>

      <el-table v-else :data="paginatedRoles" stripe border aria-label="Roles table">
        <el-table-column prop="name" :label="t('common.name')" min-width="150" sortable></el-table-column>
        <el-table-column prop="key" :label="t('admin.roleKey')" min-width="120" sortable></el-table-column>
        <el-table-column prop="description" :label="t('common.description')" min-width="250" sortable></el-table-column>
        <el-table-column :label="t('admin.systemRole')" min-width="100">
          <template #default="{ row }">
            <span class="system-badge" :class="row.isSystem ? 'system-badge--system' : 'system-badge--custom'">
              {{ row.isSystem ? t('admin.systemRole') : t('admin.customRole') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="permissionCount" :label="t('admin.permissionCount')" min-width="130" align="center" sortable></el-table-column>
        <el-table-column :label="t('common.actions')" min-width="100">
          <template #default="{ row }">
            <RowActions
              :show-edit="true"
              :show-delete="!row.isSystem"
              @edit="handleEdit(row)"
              @delete="handleDelete(row)"
            />
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="currentPage"
        :page-size="pageSize"
        :total="totalCount"
        layout="total, prev, pager, next"
      />
    </div>

    <el-dialog v-model="showDialog" :title="dialogTitle" width="600px" @close="closeDialog">
      <el-form :model="form" label-width="120px">
        <el-form-item :label="t('admin.roleName')" required>
          <el-input v-model="form.name" :placeholder="t('admin.roleName')" />
        </el-form-item>

        <el-form-item :label="t('admin.roleKey')" required>
          <el-input
            v-model="form.key"
            :placeholder="t('admin.roleKey')"
            :disabled="isEditing && form.isSystem"
          />
        </el-form-item>

        <el-form-item :label="t('common.description')">
          <el-input
            v-model="form.description"
            :placeholder="t('common.description')"
            type="textarea"
            :rows="3"
          />
        </el-form-item>

        <el-form-item :label="t('admin.permissions')">
          <div class="permissions-container">
            <div v-for="(perms, category) in groupedPermissions" :key="category" class="permission-group">
              <h4 class="permission-category">{{ category }}</h4>
              <el-checkbox-group v-model="form.permissionIds">
                <el-checkbox v-for="perm in perms" :key="perm.id" :label="perm.id">
                  {{ perm.name }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import RowActions from '@/components/shared/RowActions.vue'
import { apiErrorMessage } from '@/utils/errorMessage'

interface Role {
  id: string
  name: string
  key: string
  description: string
  isSystem: boolean
  permissionCount: number
}

interface Permission {
  id: string
  name: string
  key: string
  category?: string
}

const { t } = useI18n()

// When rendered inside User Management tabs, the parent owns the page
// heading so this view hides its own PageHeader and exposes the create
// action via a compact toolbar instead.
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const roles = ref<Role[]>([])
const permissions = ref<Permission[]>([])
const loading = ref(false)
const error = ref('')
const showDialog = ref(false)
const saving = ref(false)
const isEditing = ref(false)
const dialogTitle = ref(t('admin.createRole'))
const editingRoleId = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

const form = ref({
  name: '',
  key: '',
  description: '',
  permissionIds: [] as string[],
  isSystem: false
})

const groupedPermissions = computed(() => {
  const grouped: { [key: string]: Permission[] } = {}
  permissions.value.forEach((perm) => {
    const category = perm.category || 'Other'
    if (!grouped[category]) {
      grouped[category] = []
    }
    grouped[category].push(perm)
  })
  return grouped
})

const totalCount = computed(() => roles.value.length)

const paginatedRoles = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return roles.value.slice(start, end)
})

const fetchRoles = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await client.get('/roles')
    roles.value = response.data.data || []
    currentPage.value = 1
  } catch (err: unknown) {
    error.value = apiErrorMessage(err, 'Failed to fetch roles')
  } finally {
    loading.value = false
  }
}

const fetchPermissions = async () => {
  try {
    const response = await client.get('/roles/permissions')
    permissions.value = response.data.data || []
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Failed to fetch permissions'))
  }
}


const openNewRoleDialog = async () => {
  form.value = {
    name: '',
    key: '',
    description: '',
    permissionIds: [],
    isSystem: false
  }
  isEditing.value = false
  showDialog.value = true
  dialogTitle.value = t('admin.createRole')
  await fetchPermissions()
}

const handleEdit = async (row: Role) => {
  loading.value = true
  try {
    const response = await client.get(`/roles/${row.id}`)
    const roleData = response.data.role || response.data
    const permissionIds = (response.data.permissions || []).map((p: Permission) => p.id)

    form.value = {
      name: roleData.name,
      key: roleData.key,
      description: roleData.description || '',
      permissionIds: permissionIds,
      isSystem: roleData.isSystem
    }
    isEditing.value = true
    editingRoleId.value = row.id
    showDialog.value = true
    dialogTitle.value = t('admin.editRole')
    await fetchPermissions()
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Failed to fetch role details'))
  } finally {
    loading.value = false
  }
}

const handleDelete = async (row: Role) => {
  ElMessageBox.confirm(
    t('admin.confirmDeleteRole'),
    t('common.warning'),
    {
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    }
  ).then(async () => {
    saving.value = true
    try {
      await client.delete(`/roles/${row.id}`)
      ElMessage.success(t('admin.roleDeleted'))
      fetchRoles()
    } catch (err: unknown) {
      ElMessage.error(apiErrorMessage(err, 'Failed to delete role'))
    } finally {
      saving.value = false
    }
  }).catch(() => {
    // User cancelled the delete
  })
}

const handleSave = async () => {
  if (!form.value.name || !form.value.key) {
    ElMessage.error(`${t('common.error')}: Please fill in all required fields`)
    return
  }

  if (form.value.permissionIds.length === 0) {
    ElMessage.error(`${t('common.error')}: Please select at least one permission`)
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      key: form.value.key,
      description: form.value.description,
      permissionIds: form.value.permissionIds
    }

    if (isEditing.value) {
      await client.put(`/roles/${editingRoleId.value}`, payload)
      ElMessage.success(t('admin.roleUpdated'))
    } else {
      await client.post('/roles', payload)
      ElMessage.success(t('admin.roleCreated'))
    }

    showDialog.value = false
    fetchRoles()
  } catch (err: unknown) {
    ElMessage.error(apiErrorMessage(err, 'Failed to save role'))
  } finally {
    saving.value = false
  }
}

const closeDialog = () => {
  form.value = {
    name: '',
    key: '',
    description: '',
    permissionIds: [],
    isSystem: false
  }
}

onMounted(() => {
  fetchRoles()
})
</script>

<style scoped lang="scss">
.admin-roles-container {
  padding: 0;
}

.admin-roles-container--embedded {
  .admin-roles-content {
    padding: 0;
  }
}

.admin-roles-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--cat-spacing-3);
}

.admin-roles-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
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

.system-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cat-font-size-xs);
  font-weight: var(--cat-font-weight-medium);
  line-height: 1.6;
  white-space: nowrap;

  &--system {
    background-color: rgba(47, 129, 247, 0.15);
    color: #2f81f7;
  }

  &--custom {
    background-color: rgba(163, 113, 247, 0.15);
    color: #a371f7;
  }
}

:deep(.el-table tbody tr) {
  cursor: pointer;

  &:hover > td {
    background-color: var(--cat-bg-hover) !important;
  }
}

.permissions-container {
  max-height: 260px;
  width: 100%;
  overflow-y: auto;
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  padding: var(--cat-spacing-4);
}

.permission-group {
  margin-bottom: var(--cat-spacing-4);

  &:last-child {
    margin-bottom: 0;
  }

  .permission-category {
    margin: 0 0 var(--cat-spacing-2) 0;
    font-size: var(--cat-font-size-sm);
    font-weight: var(--cat-font-weight-semibold);
    color: var(--cat-text-primary);
    text-transform: capitalize;
  }

  :deep(.el-checkbox-group) {
    display: flex;
    flex-direction: column;
    gap: var(--cat-spacing-2);
  }

  :deep(.el-checkbox) {
    margin-right: 0;
  }
}
</style>
