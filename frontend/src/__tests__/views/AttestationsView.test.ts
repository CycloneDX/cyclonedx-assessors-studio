import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({ route: { path: '/attestations' } })
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

import AttestationsView from '@/views/AttestationsView.vue'
import client from '@/api/client'
import { ElMessage } from 'element-plus'
import { elStubs } from '@/__tests__/helpers/elStubs'

const attestation = { id: 'a1', summary: 'Q3', conformanceScore: 0.85 }
const assessment = { id: 's1', title: 'SOC 2' }

function mountView() {
  return mount(AttestationsView, { shallow: true, global: { stubs: elStubs } })
}

describe('AttestationsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(client.get).mockImplementation((url: string) =>
      url === '/attestations'
        ? Promise.resolve({ data: { data: [attestation], pagination: { total: 7 } } })
        : Promise.resolve({ data: { data: [assessment] } }),
    )
    vi.mocked(client.post).mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads attestations and assessments on mount', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(client.get).toHaveBeenCalledWith('/attestations', { params: { limit: 100 } })
    expect(client.get).toHaveBeenCalledWith('/assessments', { params: { limit: 100 } })
    expect(wrapper.vm.attestations).toEqual([attestation])
    expect(wrapper.vm.total).toBe(7)
  })

  describe('create attestation', () => {
    it('requires an assessment', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewAttestationDialog()
      wrapper.vm.form = { summary: 'Q4', assessmentId: '' }
      await wrapper.vm.handleSave()
      expect(ElMessage.error).toHaveBeenCalledWith('Please select an assessment')
      expect(client.post).not.toHaveBeenCalled()
    })

    it('omits an empty summary and links the chosen assessment', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openNewAttestationDialog()
      wrapper.vm.form = { summary: '', assessmentId: 's1' }
      await wrapper.vm.handleSave()
      expect(client.post).toHaveBeenCalledWith('/attestations', { summary: undefined, assessmentId: 's1' })
      expect(wrapper.vm.showDialog).toBe(false)
    })
  })

  it('classes conformance at the 80% and 50% thresholds', async () => {
    const wrapper = mountView()
    await flushPromises()
    const c = wrapper.vm.conformanceClass
    expect(c(0.8)).toBe('conformance-high')
    expect(c(0.79)).toBe('conformance-mid')
    expect(c(0.5)).toBe('conformance-mid')
    expect(c(0.49)).toBe('conformance-low')
    expect(wrapper.vm.formatConformance(0.857)).toBe('86%')
  })

  it('exports as a blob and names the file from Content-Disposition', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    const wrapper = mountView()
    await flushPromises()
    vi.mocked(client.get).mockResolvedValueOnce({
      data: '{}',
      headers: { 'content-disposition': 'attachment; filename="q3.cdx.json"' },
    })
    await wrapper.vm.handleExport(attestation)
    expect(client.get).toHaveBeenLastCalledWith('/attestations/a1/export', { responseType: 'blob' })
    expect(downloads).toEqual(['q3.cdx.json'])
  })
})
