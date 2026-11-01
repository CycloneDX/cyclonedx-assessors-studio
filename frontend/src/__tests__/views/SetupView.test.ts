import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const { validateMock } = vi.hoisted(() => ({ validateMock: vi.fn() }))

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({ route: { path: '/setup' } })
})

vi.mock('@/router', () => ({ markSetupDone: vi.fn(), default: {} }))

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key, locale: { value: 'en-US' } })),
  createI18n: vi.fn(() => ({ global: { t: (k: string) => k, locale: { value: 'en-US' } }, install: vi.fn() })),
}))

vi.mock('@/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getPasswordPolicy: vi.fn().mockResolvedValue({ minLength: 12, maxLength: 128 }),
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import SetupView from '@/views/SetupView.vue'
import client from '@/api/client'
import { markSetupDone } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { elStubs } from '@/__tests__/helpers/elStubs'

const admin = { id: 'u1', username: 'admin', email: 'admin@example.test', displayName: 'Admin', role: 'admin' }

// The form is validated through the el-form instance; expose validate().
const ElForm = { template: '<form><slot /></form>', methods: { validate: validateMock } }

let wrapper: VueWrapper | undefined

function mountView() {
  wrapper = mount(SetupView, { shallow: true, global: { stubs: { ...elStubs, ElForm } } })
  return wrapper
}

async function onAccountStep(w: VueWrapper) {
  w.vm.step = 1
  await nextTick()
  Object.assign(w.vm.form, {
    setupToken: ' token-from-log ',
    username: 'admin', email: 'admin@example.test', displayName: 'Admin',
    password: 'Str0ng-Passw0rd!', confirmPassword: 'Str0ng-Passw0rd!',
  })
}

describe('SetupView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    validateMock.mockResolvedValue(true)
    vi.mocked(client.get).mockResolvedValue({ data: { standards: [] } })
    vi.mocked(client.post).mockResolvedValue({ data: { user: admin, permissions: ['admin.settings'] } })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('starts on the welcome step and Enter moves to the account step', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.vm.step).toBe(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(w.vm.step).toBe(1)
  })

  it('stops listening for Enter once unmounted', async () => {
    const w = mountView()
    await flushPromises()
    const vm = w.vm
    w.unmount()
    wrapper = undefined
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(vm.step).toBe(0)
  })

  it('rejects a confirmation that does not match the password', async () => {
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    w.vm.form.confirmPassword = 'different'
    const callback = vi.fn()
    w.vm.validatePasswordMatch({}, w.vm.form.confirmPassword, callback)
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('does not submit when form validation fails', async () => {
    validateMock.mockRejectedValueOnce(new Error('invalid'))
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    await w.vm.submitSetup()
    expect(client.post).not.toHaveBeenCalled()
    expect(w.vm.step).toBe(1)
  })

  it('creates the admin without the confirmation field, signs in and moves on', async () => {
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    await w.vm.submitSetup()
    await flushPromises()
    expect(client.post).toHaveBeenCalledWith('/setup', {
      setupToken: 'token-from-log',
      username: 'admin', email: 'admin@example.test', displayName: 'Admin', password: 'Str0ng-Passw0rd!',
    })
    expect(useAuthStore().user).toEqual(admin)
    expect(markSetupDone).toHaveBeenCalled()
    expect(w.vm.step).toBe(2)
    expect(client.get).toHaveBeenCalledWith('/setup/standards-feed')
  })

  it('joins server validation details into one error and stays on the step', async () => {
    vi.mocked(client.post).mockRejectedValueOnce({
      response: { status: 400, data: { details: [{ message: 'Username taken' }, { message: 'Email invalid' }] } },
    })
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    await w.vm.submitSetup()
    expect(w.vm.error).toBe('Username taken. Email invalid')
    expect(w.vm.step).toBe(1)
    expect(markSetupDone).not.toHaveBeenCalled()
    expect(w.vm.loading).toBe(false)
  })

  it('shows the server message when the setup token is wrong', async () => {
    vi.mocked(client.post).mockRejectedValueOnce({
      response: { status: 403, data: { error: 'Invalid setup token', message: 'Enter the setup token shown in the server log.' } },
    })
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    await w.vm.submitSetup()
    expect(w.vm.error).toBe('Enter the setup token shown in the server log.')
    expect(w.vm.step).toBe(1)
  })

  it('falls back to the server error message', async () => {
    vi.mocked(client.post).mockRejectedValueOnce({ response: { status: 409, data: { error: 'Setup already complete' } } })
    const w = mountView()
    await flushPromises()
    await onAccountStep(w)
    await w.vm.submitSetup()
    expect(w.vm.error).toBe('Setup already complete')
  })
})
