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

import AdminUsersView from '@/views/AdminUsersView.vue'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { elStubs } from '@/__tests__/helpers/elStubs'

const alice = { id: 'u1', username: 'alice', email: 'alice@example.test', displayName: 'Alice', role: 'assessor', isActive: true }
const bob = { id: 'u2', username: 'bob', email: 'bob@example.test', displayName: 'Bob', role: 'assessee', isActive: false }

function mountView() {
  return mount(AdminUsersView, { shallow: true, global: { stubs: elStubs } })
}

function newUserForm(overrides = {}) {
  return {
    username: 'carol', email: 'carol@example.test', displayName: 'Carol',
    password: 'Str0ng-Passw0rd!', confirmPassword: 'Str0ng-Passw0rd!',
    role: 'assessee', isActive: true, ...overrides,
  }
}

describe('AdminUsersView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(client.get).mockResolvedValue({ data: { data: [alice, bob] } })
    vi.mocked(client.post).mockResolvedValue({ data: {} })
    vi.mocked(client.put).mockResolvedValue({ data: {} })
  })

  describe('loading', () => {
    it('fetches the user list on mount', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(client.get).toHaveBeenCalledWith('/users')
      expect(wrapper.vm.users).toEqual([alice, bob])
      expect(wrapper.vm.loading).toBe(false)
    })

    it('shows the server error when the list fails to load', async () => {
      vi.mocked(client.get).mockRejectedValueOnce({ response: { status: 500, data: { error: 'db down' } } })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.error).toBeTruthy()
      expect(wrapper.vm.users).toEqual([])
    })
  })

  describe('create user', () => {
    it('requires username, email, display name and role', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewUserDialog()
      wrapper.vm.form = newUserForm({ role: '' })
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalledWith('Please fill in all required fields')
      expect(client.post).not.toHaveBeenCalled()
    })

    it('rejects a password confirmation that does not match', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewUserDialog()
      wrapper.vm.form = newUserForm({ confirmPassword: 'different' })
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalledWith('Passwords do not match')
      expect(client.post).not.toHaveBeenCalled()
    })

    it('posts the new user without the confirmation field, then closes and reloads', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewUserDialog()
      wrapper.vm.form = newUserForm()
      await wrapper.vm.handleSave()
      expect(client.post).toHaveBeenCalledWith('/users', {
        username: 'carol', email: 'carol@example.test', displayName: 'Carol',
        password: 'Str0ng-Passw0rd!', role: 'assessee',
      })
      expect(wrapper.vm.showDialog).toBe(false)
      expect(client.get).toHaveBeenCalledTimes(2)
    })

    it('keeps the dialog open and shows the server error when creation fails', async () => {
      vi.mocked(client.post).mockRejectedValueOnce({ response: { status: 409, data: { error: 'Username taken' } } })
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewUserDialog()
      wrapper.vm.form = newUserForm()
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalled()
      expect(wrapper.vm.showDialog).toBe(true)
      expect(wrapper.vm.saving).toBe(false)
    })
  })

  describe('edit user', () => {
    it('updates profile, role and status without sending a password or username', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleEdit(alice)
      wrapper.vm.form.role = 'admin'
      await wrapper.vm.handleSave()
      expect(client.put).toHaveBeenCalledWith('/users/u1', {
        email: 'alice@example.test', displayName: 'Alice', role: 'admin', isActive: true,
      })
      expect(client.post).not.toHaveBeenCalled()
    })
  })

  describe('deactivate and reactivate', () => {
    it('does not deactivate when the confirmation is cancelled', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleDelete(alice)
      expect(client.put).not.toHaveBeenCalled()
    })

    it('deactivates the confirmed user', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleDelete(alice)
      expect(client.put).toHaveBeenCalledWith('/users/u1/deactivate')
    })

    it('reactivates the confirmed user', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleReactivate(bob)
      expect(client.put).toHaveBeenCalledWith('/users/u2/activate')
    })
  })

  describe('bulk actions', () => {
    it('refuses a bulk role change with no role chosen', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleSelectionChange([alice, bob])
      wrapper.vm.bulkRoleChange = ''
      await wrapper.vm.handleBulkRoleChange()
      expect(ElMessage.error).toHaveBeenCalledWith('Please select a role')
      expect(client.put).not.toHaveBeenCalled()
    })

    it('changes the role of every selected user, then clears the selection', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleSelectionChange([alice, bob])
      wrapper.vm.bulkRoleChange = 'assessor'
      await wrapper.vm.handleBulkRoleChange()
      expect(client.put).toHaveBeenCalledWith('/users/u1', { role: 'assessor' })
      expect(client.put).toHaveBeenCalledWith('/users/u2', { role: 'assessor' })
      expect(wrapper.vm.selectedUsers).toEqual([])
    })

    it('asks before deactivating the selection, naming the count', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleSelectionChange([alice, bob])
      await wrapper.vm.handleBulkDeactivate()
      expect(vi.mocked(ElMessageBox.confirm).mock.calls[0][0]).toContain('2 selected users')
      expect(client.put).not.toHaveBeenCalled()
      expect(wrapper.vm.selectedUsers).toEqual([alice, bob])
    })

    it('deactivates every selected user once confirmed', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.handleSelectionChange([alice, bob])
      await wrapper.vm.handleBulkDeactivate()
      expect(client.put).toHaveBeenCalledWith('/users/u1/deactivate')
      expect(client.put).toHaveBeenCalledWith('/users/u2/deactivate')
      expect(wrapper.vm.selectedUsers).toEqual([])
    })
  })
})
