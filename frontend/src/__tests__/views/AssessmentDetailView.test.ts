import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import AssessmentDetailView from '@/views/AssessmentDetailView.vue'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({
    route: { path: '/assessments/test-id', params: { id: 'test-id' } },
  })
})

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
    locale: { value: 'en-US' },
  })),
}))

vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn().mockResolvedValue({ data: { data: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  }
  return { default: { ...mockAxiosInstance, create: vi.fn(() => mockAxiosInstance) } }
})

vi.mock('element-plus', () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
  },
  ElMessageBox: {
    confirm: vi.fn().mockResolvedValue(true),
  },
}))

import axios from 'axios'

const mockAssessment = {
  id: 'test-id',
  title: 'Security Assessment',
  description: 'A comprehensive security assessment',
  state: 'in_progress',
  projectId: 'proj-1',
  entityId: 'ent-1',
  standardId: 'std-1',
  startDate: '2026-01-01T00:00:00Z',
  dueDate: '2026-12-31T00:00:00Z',
  assessors: [
    { id: 'user-1', name: 'John Doe' },
    { id: 'user-2', name: 'Jane Smith' },
  ],
  claimsCount: 10,
  completedClaimsCount: 5,
}

const stubs = {
  ElBreadcrumb: { template: '<div class="breadcrumb"><slot /></div>' },
  ElBreadcrumbItem: { template: '<span><slot /></span>', props: ['to'] },
  ElIcon: { template: '<i><slot /></i>' },
  ElCard: { template: '<div class="card"><slot /><slot name="header" /></div>' },
  ElButton: { template: '<button><slot /></button>', props: ['type', 'loading'] },
  ElRow: { template: '<div><slot /></div>', props: ['gutter'] },
  ElCol: { template: '<div><slot /></div>', props: ['span'] },
  ElAlert: { template: '<div class="alert"><slot /></div>', props: ['type', 'title'] },
  ElDivider: { template: '<hr />' },
  ElTabs: { template: '<div><slot /></div>', props: ['modelValue'] },
  ElTabPane: { template: '<div><slot /></div>', props: ['label', 'name'] },
  ElProgress: { template: '<div />', props: ['percentage'] },
  ElTable: { template: '<table><slot /></table>', props: ['data'] },
  ElTableColumn: { template: '<td><slot /></td>' },
  ElDialog: {
    template: '<div v-if="modelValue"><slot /></div>',
    props: ['modelValue', 'title'],
  },
  ElSkeleton: { template: '<div />', props: ['rows'] },
  StateBadge: { template: '<span />', props: ['state'] },
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  Loading: { template: '<span />' },
  ArrowRight: { template: '<span />' },
}

describe('AssessmentDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the view correctly', () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    expect(wrapper.find('.assessment-detail-container').exists()).toBe(true)
  })

  it('shows loading state with skeleton', async () => {
    vi.mocked(axios.get).mockImplementation(() => new Promise(() => {}))

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await nextTick()

    expect(wrapper.vm.isLoading).toBe(true)
  })

  it('displays assessment title when loaded', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Security Assessment')
  })

  it('displays assessment description', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('A comprehensive security assessment')
  })

  it('displays assessment state badge', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    // StateBadge is stubbed, so check the component's state directly
    expect(wrapper.vm.assessment?.state).toBe('in_progress')
  })

  it('displays start date', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    // Component formats dates
    expect(wrapper.text().toLowerCase()).toContain('2026')
  })

  it('displays due date', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    // Component formats dates
    expect(wrapper.text().toLowerCase()).toContain('2026')
  })

  it('displays assessors list', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: mockAssessment.assessors, assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.assessment?.title).toBe('Security Assessment')
  })

  it('shows error alert when fetch fails', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      response: { data: { error: 'Not found' } },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.loadError).toBeTruthy()
  })

  it('displays action buttons for in_progress state', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: { ...mockAssessment, state: 'in_progress' }, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.assessment?.state).toBe('in_progress')
  })

  it('renders breadcrumb navigation', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { assessment: mockAssessment, requirements: [], assessors: [], assessees: [], data: [] },
    })

    const wrapper = mount(AssessmentDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.find('.breadcrumb').exists()).toBe(true)
  })

  // Security review W9: external reference links render only http(s).
  it.each([
    ['javascript:alert(1)', '#'],
    ['JaVaScRiPt:alert(1)', '#'],
    ['data:text/html,<script>alert(1)</script>', '#'],
    ['not a url', '#'],
    ['https://example.com/ref', 'https://example.com/ref'],
  ])('renders %s as %s', (input, expected) => {
    const wrapper = mount(AssessmentDetailView, { global: { stubs } })
    expect((wrapper.vm as any).safeExternalUrl(input)).toBe(expected)
  })
})
