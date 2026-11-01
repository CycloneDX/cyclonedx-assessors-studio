import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

const route = reactive<{ name: string; path: string; hash: string }>({ name: 'ForgotPassword', path: '/forgot-password', hash: '' })
const router = { push: vi.fn(), replace: vi.fn() }

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => router,
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const api = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  getPasswordPolicy: vi.fn(),
}))
vi.mock('@/api/auth', () => api)

import PasswordResetView from '@/views/PasswordResetView.vue'

const stubs = {
  ElInput: {
    template: '<input :id="id" :type="type || \'text\'" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'type', 'id'],
    emits: ['update:modelValue'],
  },
  ElButton: { template: '<button type="submit"><slot /></button>' },
  ElAlert: { template: '<div class="alert"><slot /></div>' },
  RouterLink: { template: '<a><slot /></a>' },
}

function mountView() {
  return mount(PasswordResetView, { global: { stubs } })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getPasswordPolicy.mockResolvedValue({ minLength: 12, maxLength: 128 })
  api.requestPasswordReset.mockResolvedValue(undefined)
  api.resetPassword.mockResolvedValue(undefined)
})

describe('PasswordResetView: request a link', () => {
  beforeEach(() => {
    Object.assign(route, { name: 'ForgotPassword', path: '/forgot-password', hash: '' })
  })

  it('sends the address and shows the neutral confirmation', async () => {
    const w = mountView()
    await w.find('#reset-email').setValue('me@example.test')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.requestPasswordReset).toHaveBeenCalledWith('me@example.test')
    expect(w.text()).toContain('passwordReset.requestSent')
    expect(w.find('form').exists()).toBe(false)
  })

  it('does not call the API without an address', async () => {
    const w = mountView()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.requestPasswordReset).not.toHaveBeenCalled()
    expect(w.text()).toContain('passwordReset.enterEmail')
  })
})

describe('PasswordResetView: choose a new password', () => {
  beforeEach(() => {
    Object.assign(route, { name: 'ResetPassword', path: '/reset-password', hash: '#token=abc_DEF-123' })
  })

  it('reads the token from the fragment and removes it from the address bar', async () => {
    mountView()
    await flushPromises()
    expect(router.replace).toHaveBeenCalledWith({ path: '/reset-password', hash: '' })
  })

  it('resets with the token and returns to sign in', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('#reset-new').setValue('Long-Enough-Passw0rd!')
    await w.find('#reset-confirm').setValue('Long-Enough-Passw0rd!')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.resetPassword).toHaveBeenCalledWith('abc_DEF-123', 'Long-Enough-Passw0rd!')
    expect(router.push).toHaveBeenCalledWith({ path: '/login', query: { reset: '1' } })
  })

  it('refuses mismatched or short passwords before calling the server', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('#reset-new').setValue('short')
    await w.find('#reset-confirm').setValue('short')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('passwordReset.minLength')
    await w.find('#reset-new').setValue('Long-Enough-Passw0rd!')
    await w.find('#reset-confirm').setValue('Different-Passw0rd!')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.text()).toContain('passwordReset.mismatch')
    expect(api.resetPassword).not.toHaveBeenCalled()
  })

  it("shows the server's reason for a rejected link as text", async () => {
    // The shape the shared API client rejects with for an HTTP 400.
    api.resetPassword.mockRejectedValue({
      response: { status: 400, data: { error: '<b>This reset link is invalid or has expired.</b>' } },
    })
    const w = mountView()
    await flushPromises()
    await w.find('#reset-new').setValue('Long-Enough-Passw0rd!')
    await w.find('#reset-confirm').setValue('Long-Enough-Passw0rd!')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('.alert').text()).toBe('<b>This reset link is invalid or has expired.</b>')
    expect(w.find('.alert b').exists()).toBe(false)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('explains an incomplete link instead of showing the form', async () => {
    route.hash = ''
    const w = mountView()
    await flushPromises()
    expect(w.find('form').exists()).toBe(false)
    expect(w.text()).toContain('passwordReset.missingToken')
  })
})
