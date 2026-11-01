import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({ route: { path: '/admin/user-management' } })
})

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key, locale: { value: 'en-US' } })),
  createI18n: vi.fn(() => ({ global: { t: (k: string) => k, locale: { value: 'en-US' } }, install: vi.fn() })),
}))

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import AdminRolesView from '@/views/AdminRolesView.vue'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { elStubs } from '@/__tests__/helpers/elStubs'

const auditorRole = { id: 'r1', name: 'Auditor', key: 'auditor', description: 'Read-only', isSystem: false }
const permissions = [
  { id: 'p1', key: 'evidence.view', name: 'View evidence', category: 'Evidence' },
  { id: 'p2', key: 'evidence.edit', name: 'Edit evidence', category: 'Evidence' },
  { id: 'p3', key: 'admin.settings', name: 'Settings', category: 'Admin' },
]

// Route each GET to a payload of the real shape.
function mockGets() {
  vi.mocked(client.get).mockImplementation((url: string) => {
    if (url === '/roles') return Promise.resolve({ data: { data: [auditorRole] } })
    if (url === '/roles/permissions') return Promise.resolve({ data: { data: permissions } })
    if (url === '/roles/r1') return Promise.resolve({ data: { role: auditorRole, permissions: [permissions[0]] } })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

function mountView() {
  return mount(AdminRolesView, { shallow: true, global: { stubs: elStubs } })
}

describe('AdminRolesView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockGets()
    vi.mocked(client.post).mockResolvedValue({ data: {} })
    vi.mocked(client.put).mockResolvedValue({ data: {} })
    vi.mocked(client.delete).mockResolvedValue({ data: {} })
  })

  it('loads the roles on mount', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(client.get).toHaveBeenCalledWith('/roles')
    expect(wrapper.vm.roles).toEqual([auditorRole])
    expect(wrapper.vm.totalCount).toBe(1)
  })

  it('shows the server error when roles fail to load', async () => {
    vi.mocked(client.get).mockRejectedValueOnce({ response: { status: 500, data: { error: 'db down' } } })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.vm.error).toBeTruthy()
    expect(wrapper.vm.roles).toEqual([])
  })

  describe('create role', () => {
    it('loads permissions grouped by category when the dialog opens', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.openNewRoleDialog()
      expect(client.get).toHaveBeenCalledWith('/roles/permissions')
      expect(Object.keys(wrapper.vm.groupedPermissions).sort()).toEqual(['Admin', 'Evidence'])
      expect(wrapper.vm.groupedPermissions.Evidence).toHaveLength(2)
    })

    it('requires a name and key', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.openNewRoleDialog()
      wrapper.vm.form = { name: '', key: 'k', description: '', permissionIds: ['p1'], isSystem: false }
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalled()
      expect(client.post).not.toHaveBeenCalled()
    })

    it('refuses a role with no permissions', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.openNewRoleDialog()
      wrapper.vm.form = { name: 'Empty', key: 'empty', description: '', permissionIds: [], isSystem: false }
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalledWith('common.error: Please select at least one permission')
      expect(client.post).not.toHaveBeenCalled()
    })

    it('posts name, key, description and permission ids, then closes and reloads', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.openNewRoleDialog()
      wrapper.vm.form = { name: 'Reviewer', key: 'reviewer', description: 'Reviews', permissionIds: ['p1', 'p2'], isSystem: false }
      await wrapper.vm.handleSave()
      expect(client.post).toHaveBeenCalledWith('/roles', {
        name: 'Reviewer', key: 'reviewer', description: 'Reviews', permissionIds: ['p1', 'p2'],
      })
      expect(wrapper.vm.showDialog).toBe(false)
    })
  })

  describe('edit role', () => {
    it('loads the role with its current permission ids', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleEdit(auditorRole)
      expect(client.get).toHaveBeenCalledWith('/roles/r1')
      expect(wrapper.vm.form.permissionIds).toEqual(['p1'])
      expect(wrapper.vm.isEditing).toBe(true)
    })

    it('saves changes to the edited role, not a new one', async () => {
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleEdit(auditorRole)
      wrapper.vm.form.permissionIds = ['p1', 'p3']
      await wrapper.vm.handleSave()
      expect(client.put).toHaveBeenCalledWith('/roles/r1', {
        name: 'Auditor', key: 'auditor', description: 'Read-only', permissionIds: ['p1', 'p3'],
      })
      expect(client.post).not.toHaveBeenCalled()
    })
  })

  describe('delete role', () => {
    it('does not delete when the confirmation is cancelled', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleDelete(auditorRole)
      await flushPromises()
      expect(client.delete).not.toHaveBeenCalled()
    })

    it('deletes the confirmed role and reloads the list', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleDelete(auditorRole)
      await flushPromises()
      expect(client.delete).toHaveBeenCalledWith('/roles/r1')
      expect(client.get).toHaveBeenCalledTimes(2)
    })
  })
})
