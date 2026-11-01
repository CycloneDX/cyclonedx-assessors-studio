import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({ route: { path: '/admin/webhooks' } })
})

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key, locale: { value: 'en-US' } })),
  createI18n: vi.fn(() => ({ global: { t: (k: string) => k, locale: { value: 'en-US' } }, install: vi.fn() })),
}))

vi.mock('@/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import AdminWebhooksView from '@/views/AdminWebhooksView.vue'
import client from '@/api/client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { elStubs } from '@/__tests__/helpers/elStubs'

const hook = { id: 'w1', name: 'CI', url: 'https://ci.example.test/hook', eventTypes: ['evidence.created'], isActive: true }
const saveData = { name: 'CI', url: 'https://ci.example.test/hook', eventTypes: ['evidence.created'], isActive: false, regenerateSecret: false }

function mountView() {
  return mount(AdminWebhooksView, { shallow: true, global: { stubs: elStubs } })
}

describe('AdminWebhooksView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(client.get).mockImplementation((url: string) =>
      url === '/webhooks'
        ? Promise.resolve({ data: { data: [hook] } })
        : Promise.resolve({ data: { data: [{ id: 'd1' }], pagination: { total: 41 } } }),
    )
    vi.mocked(client.post).mockResolvedValue({ data: {} })
    vi.mocked(client.put).mockResolvedValue({ data: {} })
    vi.mocked(client.delete).mockResolvedValue({ data: {} })
  })

  it('loads the webhooks on mount', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(client.get).toHaveBeenCalledWith('/webhooks')
    expect(wrapper.vm.webhooks).toEqual([hook])
  })

  describe('create', () => {
    it('posts name, url and event types only, and reveals the returned secret once', async () => {
      vi.mocked(client.post).mockResolvedValueOnce({ data: { secret: 'whsec_123' } })
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openCreateDialog()
      await wrapper.vm.handleSave(saveData)
      expect(client.post).toHaveBeenCalledWith('/webhooks', {
        name: 'CI', url: 'https://ci.example.test/hook', eventTypes: ['evidence.created'],
      })
      expect(wrapper.vm.createdSecret).toBe('whsec_123')
      expect(wrapper.vm.showSecretDialog).toBe(true)
      expect(wrapper.vm.showDialog).toBe(false)
    })

    it('keeps the dialog open and shows the server error on failure', async () => {
      vi.mocked(client.post).mockRejectedValueOnce({ response: { data: { error: 'URL must be https' } } })
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openCreateDialog()
      await wrapper.vm.handleSave(saveData)
      expect(ElMessage.error).toHaveBeenCalledWith('URL must be https')
      expect(wrapper.vm.showDialog).toBe(true)
      expect(wrapper.vm.saving).toBe(false)
    })
  })

  describe('edit', () => {
    it('updates the edited webhook without regenerating its secret by default', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openEditDialog(hook)
      await wrapper.vm.handleSave(saveData)
      expect(client.put).toHaveBeenCalledWith('/webhooks/w1', {
        name: 'CI', url: 'https://ci.example.test/hook', eventTypes: ['evidence.created'], isActive: false,
      })
      expect(client.post).not.toHaveBeenCalled()
    })

    it('asks for a new secret only when requested', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openEditDialog(hook)
      await wrapper.vm.handleSave({ ...saveData, regenerateSecret: true })
      expect(vi.mocked(client.put).mock.calls[0][1]).toMatchObject({ regenerateSecret: true })
    })
  })

  describe('delete', () => {
    it('does not delete when the confirmation is cancelled', async () => {
      vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleDelete(hook)
      expect(client.delete).not.toHaveBeenCalled()
    })

    it('deletes the confirmed webhook', async () => {
      vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
      const wrapper = mountView()
      await flushPromises()
      await wrapper.vm.handleDelete(hook)
      expect(client.delete).toHaveBeenCalledWith('/webhooks/w1')
    })
  })

  it('loads the first page of deliveries for the selected webhook', async () => {
    const wrapper = mountView()
    await flushPromises()
    wrapper.vm.selectWebhook(hook)
    await flushPromises()
    const [url, config] = vi.mocked(client.get).mock.calls.at(-1)!
    expect(url).toBe('/webhooks/w1/deliveries')
    expect(config).toMatchObject({ params: { offset: 0 } })
    expect(wrapper.vm.deliveryTotal).toBe(41)
  })

  it('sends a test event to the webhook', async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ data: { eventId: 'evt_9' } })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.vm.handleTest(hook)
    expect(client.post).toHaveBeenCalledWith('/webhooks/w1/test')
    expect(ElMessage.success).toHaveBeenCalled()
  })
})
