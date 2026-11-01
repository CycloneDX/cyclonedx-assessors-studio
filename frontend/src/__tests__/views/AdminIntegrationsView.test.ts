import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({ route: { path: '/admin/integrations' } })
})

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key, locale: { value: 'en-US' } })),
  createI18n: vi.fn(() => ({ global: { t: (k: string) => k, locale: { value: 'en-US' } }, install: vi.fn() })),
}))

vi.mock('@/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import AdminIntegrationsView from '@/views/AdminIntegrationsView.vue'
import client from '@/api/client'
import { elStubs } from '@/__tests__/helpers/elStubs'

const status = { smtp: { configured: true, host: 'smtp.example.test' }, metrics: { enabled: false } }

function mountView() {
  return mount(AdminIntegrationsView, { shallow: true, global: { stubs: elStubs } })
}

describe('AdminIntegrationsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(client.get).mockResolvedValue({ data: status })
  })

  it('loads the integration status on mount', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(client.get).toHaveBeenCalledWith('/admin/integrations/status')
    expect(wrapper.vm.status).toEqual(status)
    expect(wrapper.vm.loading).toBe(false)
  })

  it('shows the server error when the status fails to load', async () => {
    vi.mocked(client.get).mockRejectedValueOnce({ response: { data: { error: 'Forbidden' } } })
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.vm.error).toBe('Forbidden')
  })

  describe('SMTP test', () => {
    it('reports success with the server message', async () => {
      vi.mocked(client.post).mockResolvedValueOnce({ data: { message: 'Sent to admin@example.test' } })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.testSmtp()
      expect(client.post).toHaveBeenCalledWith('/admin/integrations/test/smtp')
      expect(wrapper.vm.smtpTestResult).toEqual({ success: true, message: 'Sent to admin@example.test' })
      expect(wrapper.vm.testingSmtp).toBe(false)
    })

    it('reports failure with the server reason', async () => {
      vi.mocked(client.post).mockRejectedValueOnce({ response: { status: 502, data: { error: 'Connection refused' } } })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.testSmtp()
      expect(wrapper.vm.smtpTestResult.success).toBe(false)
      expect(wrapper.vm.smtpTestResult.message).toContain('Connection refused')
      expect(wrapper.vm.testingSmtp).toBe(false)
    })
  })

  describe('storage test', () => {
    it('reports success with the server message', async () => {
      vi.mocked(client.post).mockResolvedValueOnce({ data: { success: true, message: 'Database storage verified' } })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.testStorage()
      expect(client.post).toHaveBeenCalledWith('/admin/integrations/test/storage')
      expect(wrapper.vm.storageTestResult).toEqual({ success: true, message: 'Database storage verified' })
      expect(wrapper.vm.testingStorage).toBe(false)
    })

    it('reports failure with the server message', async () => {
      vi.mocked(client.post).mockRejectedValueOnce({ response: { status: 502, data: { success: false, message: 'S3 connection failed: AccessDenied' } } })
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.testStorage()
      expect(wrapper.vm.storageTestResult.success).toBe(false)
      expect(wrapper.vm.storageTestResult.message).toContain('AccessDenied')
      expect(wrapper.vm.testingStorage).toBe(false)
    })
  })

  it('formats file sizes at each unit boundary', async () => {
    const wrapper = mountView()
    await flushPromises()
    const f = wrapper.vm.formatFileSize
    expect(f(undefined)).toBe('N/A')
    expect(f(0)).toBe('N/A')
    expect(f(1023)).toBe('1023 B')
    expect(f(1024)).toBe('1 KB')
    expect(f(1048576)).toBe('1 MB')
    expect(f(1073741824)).toBe('1.0 GB')
  })
})
