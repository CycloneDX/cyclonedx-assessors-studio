import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import EvidenceDetailView from '@/views/EvidenceDetailView.vue'

// A reactive route, so a test can move to another evidence id in place.
const routeState = vi.hoisted(() => ({ route: null as unknown as { path: string; params: { id: string } } }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  routeState.route = reactive({ path: '/evidence/test-id', params: { id: 'test-id' } })
  return createVueRouterMock({ route: () => routeState.route })
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
    prompt: vi.fn().mockResolvedValue({ value: '  Missing scope page  ' }),
  },
}))

import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

const mockEvidence = {
  id: 'test-id',
  name: 'Security Assessment Report',
  description: 'A security assessment report document',
  state: 'in_progress',
  classification: 'confidential',
  // Flat, camelCased as the API returns it (see camelCaseResponse middleware)
  authorId: 'user-1',
  authorName: 'John Doe',
  reviewerId: 'user-2',
  reviewerName: 'Jane Smith',
  createdAt: '2026-01-01T00:00:00Z',
  expiresOn: '2027-01-01T00:00:00Z',
  attachments: [
    { id: 'att-1', name: 'report.pdf', size: 1024, type: 'application/pdf' },
    { id: 'att-2', name: 'findings.xlsx', size: 2048, type: 'application/vnd.ms-excel' },
  ],
}

const stubs = {
  ElBreadcrumb: { template: '<div class="breadcrumb"><slot /></div>' },
  ElBreadcrumbItem: { template: '<span><slot /></span>', props: ['to'] },
  ElIcon: { template: '<i><slot /></i>' },
  ElCard: { template: '<div class="card"><slot /><slot name="header" /></div>' },
  ElButton: { template: '<button><slot /></button>', props: ['type', 'icon'] },
  ElRow: { template: '<div><slot /></div>', props: ['gutter'] },
  ElCol: { template: '<div><slot /></div>', props: ['span'] },
  ElAlert: { template: '<div class="alert"><slot /></div>', props: ['type', 'title'] },
  ElTable: { template: '<table><slot /></table>', props: ['data'] },
  ElTableColumn: { template: '<td><slot /></td>' },
  ElTabs: { template: '<div><slot /></div>', props: ['modelValue'] },
  ElTabPane: { template: '<div><slot /></div>', props: ['label', 'name'] },
  ElDialog: {
    template: '<div v-if="modelValue"><slot /></div>',
    props: ['modelValue', 'title'],
  },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { template: '<div><slot /></div>', props: ['label'] },
  ElInput: { template: '<input />', props: ['modelValue'] },
  ElUpload: { template: '<div />' },
  StateBadge: { template: '<span />', props: ['state'] },
  Loading: { template: '<span />' },
  ArrowRight: { template: '<span />' },
  Edit: { template: '<span />' },
}

describe('EvidenceDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    if (routeState.route) Object.assign(routeState.route, { path: '/evidence/test-id', params: { id: 'test-id' } })
    vi.clearAllMocks()
  })

  it('renders the view correctly', () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    expect(wrapper.find('.evd-page').exists()).toBe(true)
  })

  it('shows loading state while fetching evidence', async () => {
    vi.mocked(axios.get).mockImplementation(() => new Promise(() => {}))

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })
    // loading flips on in onMounted; let the re-render flush
    await nextTick()

    expect(wrapper.find('.evd-loading').exists()).toBe(true)
  })

  it('shows error state when fetch fails', async () => {
    vi.mocked(axios.get).mockRejectedValue({
      response: { data: { error: 'Not found' } },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.find('.alert').exists()).toBe(true)
  })

  it('displays evidence name when loaded', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Security Assessment Report')
  })

  it('displays evidence description', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('A security assessment report document')
  })

  it('displays evidence state badge', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.state).toBeDefined()
  })

  it('displays author information', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.authorName).toBe('John Doe')
  })

  it('displays reviewer information', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.reviewerName).toBe('Jane Smith')
  })

  it('displays creation date', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('displays expiration date', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.expiresOn).toBe('2027-01-01')
  })

  it('displays evidence classification', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.vm.evidence?.classification).toBe('confidential')
  })

  it('renders evidence info card', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.find('.evd-card').exists()).toBe(true)
  })

  it('renders breadcrumb navigation', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { evidence: mockEvidence, data: [] },
    })

    const wrapper = mount(EvidenceDetailView, {
      global: { stubs },
    })

    await flushPromises()

    expect(wrapper.find('.breadcrumb').exists()).toBe(true)
  })

  describe('review workflow', () => {
    async function mountWith(evidence: Record<string, unknown>, notes: unknown[] = [], userId = 'user-2', permissions: string[] = []) {
      const auth = useAuthStore()
      auth.user = { id: userId } as never
      auth.permissions = permissions
      vi.mocked(axios.get).mockResolvedValue({ data: { evidence: { ...mockEvidence, ...evidence }, notes, data: [] } })
      const wrapper = mount(EvidenceDetailView, { global: { stubs } })
      await flushPromises()
      return wrapper
    }

    it('submits through submit-for-review with the chosen reviewer', async () => {
      const w = await mountWith({ state: 'in_progress' }, [], 'user-1')
      await (w.vm as any).submitForReview()
      expect(axios.post).toHaveBeenCalledWith('/evidence/test-id/submit-for-review', { reviewerId: 'user-2' })
      expect(axios.put).not.toHaveBeenCalled()
    })

    it('offers approve/reject only to the assigned reviewer or an admin, never the author', async () => {
      expect((await mountWith({ state: 'in_review' }, [], 'user-2')).vm.canDecide).toBe(true)
      expect((await mountWith({ state: 'in_review' }, [], 'user-1', ['admin.settings'])).vm.canDecide).toBe(false)
      expect((await mountWith({ state: 'in_review' }, [], 'user-9')).vm.canDecide).toBe(false)
      expect((await mountWith({ state: 'in_review' }, [], 'user-9', ['admin.settings'])).vm.canDecide).toBe(true)
      expect((await mountWith({ state: 'in_progress' }, [], 'user-2')).vm.canDecide).toBe(false)
    })

    it('approves and rejects through the review endpoints, with the reason', async () => {
      const w = await mountWith({ state: 'in_review' })
      await (w.vm as any).approveEvidence()
      expect(axios.post).toHaveBeenCalledWith('/evidence/test-id/approve')
      await (w.vm as any).rejectEvidence()
      expect(axios.post).toHaveBeenCalledWith('/evidence/test-id/reject', { note: 'Missing scope page' })
    })

    it('shows the reviewer notes returned with the evidence', async () => {
      const w = await mountWith({ state: 'in_progress' }, [
        { id: 'n1', content: 'Missing scope page', authorDisplayName: 'Jane Smith', createdAt: '2026-10-29T10:00:00Z' },
      ], 'user-1')
      expect((w.vm as any).reviewNotes).toEqual([
        { id: 'n1', content: 'Missing scope page', author: 'Jane Smith', createdAt: '2026-10-29T10:00:00Z' },
      ])
      expect(w.text()).toContain('Missing scope page')
    })

    it('saves without sending the state when it did not change', async () => {
      const w = await mountWith({ state: 'in_review' }, [], 'user-1')
      await (w.vm as any).saveAll()
      const body = vi.mocked(axios.put).mock.calls.at(-1)![1] as Record<string, unknown>
      expect(body).not.toHaveProperty('state')
      ;(w.vm as any).form.state = 'expired'
      ;(w.vm as any).evidence.state = 'in_progress'
      await (w.vm as any).saveAll()
      expect((vi.mocked(axios.put).mock.calls.at(-1)![1] as Record<string, unknown>).state).toBe('expired')
    })
  })

  describe('cited in', () => {
    async function mountWithClaims(claims: unknown) {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (url === '/evidence/test-id/claims') {
          return claims instanceof Error ? Promise.reject(claims) : Promise.resolve({ data: { data: claims } })
        }
        return Promise.resolve({ data: { evidence: mockEvidence, notes: [], data: [] } })
      })
      const wrapper = mount(EvidenceDetailView, {
        global: { stubs: { ...stubs, RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } } },
      })
      await flushPromises()
      return wrapper
    }

    it('lists each claim that cites the evidence with its role and a link', async () => {
      const w = await mountWithClaims([
        { id: 'c1', name: 'MFA enforced', target: 'Product A', predicate: 'Uses MFA', isCounter: false, isMitigation: false },
        { id: 'c2', name: 'Legacy flow', target: 'Product A', predicate: 'Session fixation', isCounter: true, isMitigation: false },
        { id: 'c3', name: 'Patched', target: 'Product A', predicate: 'Fix deployed', isCounter: false, isMitigation: true },
      ])

      expect(axios.get).toHaveBeenCalledWith('/evidence/test-id/claims')
      const rows = w.findAll('.evd-citation')
      expect(rows).toHaveLength(3)
      expect(rows[0].text()).toContain('MFA enforced')
      expect(rows[0].text()).toContain('Supporting')
      expect(rows[0].text()).toContain('Product A: Uses MFA')
      expect(rows[0].find('a').attributes('href')).toBe('/claims/c1')
      expect(rows[1].text()).toContain('Counter evidence')
      expect(rows[2].text()).toContain('Mitigation')
      expect(w.vm.citations).toHaveLength(3)
    })

    it('says when no claim cites the evidence', async () => {
      const w = await mountWithClaims([])
      expect(w.findAll('.evd-citation')).toHaveLength(0)
      expect(w.text()).toContain('No claim cites this evidence yet.')
    })

    it('shows an error without breaking the page when the lookup fails', async () => {
      const w = await mountWithClaims(Object.assign(new Error('boom'), { response: { data: { error: 'Evidence not found' } } }))
      expect(w.text()).toContain('Evidence not found')
      expect(w.text()).toContain('Security Assessment Report')
    })

    it('marks a claim that is itself a counter claim', async () => {
      const w = await mountWithClaims([
        { id: 'c1', name: 'MFA enforced', target: 'A', predicate: 'p', isCounterClaim: false, isCounter: false, isMitigation: false },
        { id: 'c2', name: 'MFA bypass', target: 'A', predicate: 'p', isCounterClaim: true, isCounter: false, isMitigation: false },
      ])
      const rows = w.findAll('.evd-citation')
      expect(rows[0].text()).not.toContain('Counter claim')
      expect(rows[1].text()).toContain('Counter claim')
      expect(rows[1].text()).toContain('Supporting')
    })
  })

  it('reloads when the route moves to another evidence item', async () => {
    vi.mocked(axios.get).mockImplementation((url: string) => {
      const id = url.split('/')[2]
      if (url.endsWith('/claims')) return Promise.resolve({ data: { data: [] } })
      return Promise.resolve({ data: { evidence: { ...mockEvidence, id, name: `Evidence ${id}` }, notes: [], data: [] } })
    })
    const w = mount(EvidenceDetailView, { global: { stubs } })
    await flushPromises()
    expect(w.text()).toContain('Evidence test-id')

    routeState.route.params.id = 'other-id'
    routeState.route.path = '/evidence/other-id'
    await flushPromises()

    expect(axios.get).toHaveBeenCalledWith('/evidence/other-id')
    expect(axios.get).toHaveBeenCalledWith('/evidence/other-id/claims')
    expect(w.text()).toContain('Evidence other-id')
    expect(w.text()).not.toContain('Evidence test-id')
  })
})
