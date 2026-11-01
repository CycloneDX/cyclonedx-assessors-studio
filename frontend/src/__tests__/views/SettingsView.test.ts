import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn(() => Promise.resolve()) }))

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({
    route: { path: '/settings' },
    router: () => ({ push: pushSpy, replace: vi.fn() }),
  })
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
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

// The password policy store fetches via @/api/auth; pin the server bounds.
vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getPasswordPolicy: vi.fn().mockResolvedValue({ minLength: 12, maxLength: 128 }),
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import SettingsView from '@/views/SettingsView.vue'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const VALID = 'Str0ng-Passw0rd!'

function mountView() {
  return mount(SettingsView, { shallow: true })
}

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(client.get).mockResolvedValue({ data: { rules: [] } })
    vi.mocked(client.put).mockResolvedValue({ data: {} })
    vi.mocked(client.post).mockResolvedValue({ data: {} })
  })

  it('loads the user notification rules on mount', async () => {
    mountView()
    await flushPromises()
    expect(client.get).toHaveBeenCalledWith('/notification-rules')
  })

  describe('change password', () => {
    it('requires the current password', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.passwordForm = { currentPassword: '', newPassword: VALID, confirmPassword: VALID }
      await wrapper.vm.handleChangePassword()
      expect(ElMessage.error).toHaveBeenCalledWith('settings.currentPasswordRequired')
      expect(client.put).not.toHaveBeenCalled()
    })

    it('rejects a new password below the policy minimum', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.passwordForm = { currentPassword: 'old', newPassword: 'short', confirmPassword: 'short' }
      await wrapper.vm.handleChangePassword()
      expect(ElMessage.error).toHaveBeenCalledWith('settings.passwordTooShort')
      expect(client.put).not.toHaveBeenCalled()
    })

    it('rejects a confirmation that does not match', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.passwordForm = { currentPassword: 'old', newPassword: VALID, confirmPassword: VALID + 'x' }
      await wrapper.vm.handleChangePassword()
      expect(ElMessage.error).toHaveBeenCalledWith('settings.passwordMismatch')
      expect(client.put).not.toHaveBeenCalled()
    })

    it('sends only current and new password, then clears the form', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.passwordForm = { currentPassword: 'old-pass', newPassword: VALID, confirmPassword: VALID }
      await wrapper.vm.handleChangePassword()
      expect(client.put).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'old-pass',
        newPassword: VALID,
      })
      expect(ElMessage.success).toHaveBeenCalledWith('settings.passwordChanged')
      expect(wrapper.vm.passwordForm).toEqual({ currentPassword: '', newPassword: '', confirmPassword: '' })
    })

    // The server answers a wrong current password with 400 (not 401), so
    // the user stays signed in, sees the message, and keeps their input.
    it('shows the server message on a wrong current password and keeps the user here', async () => {
      vi.mocked(client.put).mockRejectedValueOnce({
        response: { status: 400, data: { error: 'Current password is incorrect' } },
      })
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.passwordForm = { currentPassword: 'typo', newPassword: VALID, confirmPassword: VALID }
      await wrapper.vm.handleChangePassword()
      expect(ElMessage.error).toHaveBeenCalledWith('Current password is incorrect')
      expect(wrapper.vm.passwordForm.newPassword).toBe(VALID)
      expect(wrapper.vm.savingPassword).toBe(false)
      expect(pushSpy).not.toHaveBeenCalled()
    })
  })

  describe('profile', () => {
    it('saves only the display name and updates the signed-in user', async () => {
      const authStore = useAuthStore()
      authStore.user = { id: 'u1', username: 'jdoe', email: 'j@example.test', displayName: 'Old' } as typeof authStore.user
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.profileForm.displayName = 'New Name'
      await wrapper.vm.handleSaveProfile()
      expect(client.put).toHaveBeenCalledWith('/auth/profile', { displayName: 'New Name' })
      expect(authStore.user?.displayName).toBe('New Name')
    })

    it('surfaces a server error without changing the signed-in user', async () => {
      const authStore = useAuthStore()
      authStore.user = { id: 'u1', username: 'jdoe', email: 'j@example.test', displayName: 'Old' } as typeof authStore.user
      vi.mocked(client.put).mockRejectedValueOnce({ response: { data: { error: 'Display name too long' } } })
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.profileForm.displayName = 'x'.repeat(500)
      await wrapper.vm.handleSaveProfile()
      expect(ElMessage.error).toHaveBeenCalledWith('Display name too long')
      expect(authStore.user?.displayName).toBe('Old')
    })
  })

  describe('log out all sessions', () => {
    it('does nothing when the confirmation is cancelled', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleLogoutAll()
      expect(client.post).not.toHaveBeenCalledWith('/auth/logout-all')
      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(pushSpy).not.toHaveBeenCalled()
    })

    it('revokes every session and returns to login when confirmed', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleLogoutAll()
      expect(client.post).toHaveBeenCalledWith('/auth/logout-all')
      expect(pushSpy).toHaveBeenCalledWith('/login')
    })
  })
})
