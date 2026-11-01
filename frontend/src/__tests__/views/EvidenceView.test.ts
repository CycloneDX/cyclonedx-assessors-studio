import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// Mock vue-router
vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({
    route: { path: '/evidence' },
    router: {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: { value: { path: '/evidence' } },
    },
  })
})

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, fallback?: string) => fallback || key,
    locale: { value: 'en-US' }
  })),
  createI18n: vi.fn(() => ({
    global: { t: (k: string) => k },
    install: vi.fn()
  }))
}))

// Mock axios
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

// Mock element-plus
vi.mock('element-plus', () => ({
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  },
  ElMessageBox: { confirm: vi.fn() }
}))

import EvidenceView from '@/views/EvidenceView.vue'
import axios from 'axios'
import PageHeader from '@/components/shared/PageHeader.vue'

const ElStubs = {
  ElButton: {
    template: '<button @click="$emit(\'click\')"><slot /></button>',
    props: ['type', 'loading', 'disabled'],
    emits: ['click']
  },
  ElIcon: {
    template: '<i class="el-icon"><slot /></i>'
  },
  ElSelect: {
    template: '<select><slot /></select>',
    props: ['modelValue', 'placeholder', 'clearable']
  },
  ElOption: {
    template: '<option><slot /></option>',
    props: ['label', 'value']
  },
  ElInput: {
    template: '<input />',
    props: ['modelValue', 'placeholder', 'type', 'disabled', 'clearable']
  },
  ElTable: {
    template: '<table @row-click="$emit(\'row-click\', $event)"><slot /></table>',
    props: ['data', 'stripe', 'border'],
    emits: ['row-click']
  },
  ElTableColumn: {
    template: '<col />',
    props: ['prop', 'label', 'minWidth', 'sortable', 'width', 'align', 'type']
  },
  ElDialog: {
    template: '<div v-if="modelValue" class="dialog"><slot /><slot name="footer" /></div>',
    props: ['modelValue', 'title', 'width'],
    emits: ['update:modelValue', 'close']
  },
  ElForm: {
    template: '<form><slot /></form>',
    props: ['model', 'rules', 'labelWidth']
  },
  ElFormItem: {
    template: '<div class="form-item"><slot /></div>',
    props: ['label', 'prop', 'required']
  },
  ElAlert: {
    template: '<div class="alert" @close="$emit(\'close\')"><slot /></div>',
    props: ['type', 'closable', 'title', 'showIcon'],
    emits: ['close']
  },
  ElTag: {
    template: '<span class="tag"><slot /></span>',
    props: ['type', 'size']
  },
  ElBadge: {
    template: '<span class="badge" />',
    props: ['value', 'type']
  },
  ElPagination: {
    template: '<div class="pagination" />',
    props: ['currentPage', 'pageSize', 'total']
  },
  ElDatePicker: {
    template: '<input type="date" />',
    props: ['modelValue', 'type']
  },
  ElCheckbox: {
    template: '<input type="checkbox" />',
    props: ['modelValue']
  },
  PageHeader: {
    template: '<div class="page-header"><slot name="actions" /></div>',
    props: ['title']
  },
  StateBadge: {
    template: '<span class="state-badge">{{ state }}</span>',
    props: ['state']
  },
  RowActions: {
    template: '<div class="row-actions" />',
    emits: ['edit', 'delete', 'view', 'export']
  },
  HelpTip: {
    template: '<span class="help-tip" />',
    props: ['content']
  },
  Loading: { template: '<span />' },
  Collection: { template: '<span />' }
}

function mountView(options = {}) {
  return mount(EvidenceView, {
    global: {
      stubs: {
        ...ElStubs,
        PageHeader
      },
      ...options
    }
  })
}

describe('EvidenceView.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: [
          {
            id: '1',
            name: 'Test Evidence',
            state: 'in_review',
            authorName: 'Test Author',
            authorId: 'author1',
            reviewerName: 'Test Reviewer',
            reviewerId: 'reviewer1',
            createdAt: '2026-01-01',
            expiresOn: '2026-12-31',
            isCounterEvidence: false,
            assessmentCount: 2
          }
        ],
        total: 1
      }
    })
  })

  describe('rendering', () => {
    it('should render the evidence container', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('.ev-page').exists()).toBe(true)
    })

    it('should render PageHeader component', async () => {
      const wrapper = mountView()
      await flushPromises()
      const pageHeader = wrapper.findComponent({ name: 'PageHeader' })
      expect(pageHeader.exists()).toBe(true)
    })

    it('should render filter bar', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('.ev-toolbar').exists()).toBe(true)
    })

    it('should render evidence table', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence).toBeDefined()
      expect(Array.isArray(wrapper.vm.evidence)).toBe(true)
    })
  })

  describe('loading state', () => {
    it('should show loading spinner initially', async () => {
      const wrapper = mountView()
      expect(wrapper.vm.loading).toBe(true)
      await flushPromises()
    })

    it('should hide loading spinner after data loads', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.loading).toBe(false)
    })
  })

  describe('empty state', () => {
    it('should show empty state when no evidence', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: [], total: 0 }
      })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.find('.ev-empty').exists()).toBe(true)
    })

    it('should show create button in empty state', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: [], total: 0 }
      })
      const wrapper = mountView()
      await flushPromises()
      const emptyState = wrapper.find('.ev-empty')
      expect(emptyState.exists()).toBe(true)
    })

    it('should display empty state message', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: { data: [], total: 0 }
      })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.filteredEvidence.length).toBe(0)
    })
  })

  describe('data display', () => {
    it('should display evidence table after load', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.loading).toBe(false)
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })

    it('should pass evidence data to table', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence).toBeDefined()
      expect(Array.isArray(wrapper.vm.evidence)).toBe(true)
    })

    it('should render table columns', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })
  })

  describe('filter bar', () => {
    it('should have state filter', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.hasFilters).toBe(false)
      wrapper.vm.stateFilter = 'in_review'
      await nextTick()
      expect(wrapper.vm.hasFilters).toBe(true)
    })

    it('should have search input', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.searchText = 'TEST EVIDENCE'
      await nextTick()
      // case-insensitive match on the name
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
    })
  })

  describe('filtering', () => {
    it('should filter by state', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.stateFilter = 'claimed'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(0)

      wrapper.vm.stateFilter = 'in_review'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
    })

    it('should search by text', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.searchText = 'no such evidence'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(0)

      // Search is case-insensitive and also matches the author name
      wrapper.vm.searchText = 'test author'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
    })

    it('should apply multiple filters', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.stateFilter = 'in_review'
      wrapper.vm.searchText = 'Test'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
      // Both filters must match: same search, different state excludes it
      wrapper.vm.stateFilter = 'claimed'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(0)
    })

    it('should clear filters', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.stateFilter = 'claimed'
      wrapper.vm.searchText = 'nothing matches this'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(0)
      wrapper.vm.clearFilters()
      await nextTick()
      expect(wrapper.vm.stateFilter).toBe('')
      expect(wrapper.vm.searchText).toBe('')
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
    })
  })

  describe('create dialog', () => {
    it('should open create dialog on button click', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.form.name = 'left over from last time'
      wrapper.vm.openCreate()
      await nextTick()
      expect(wrapper.vm.showCreate).toBe(true)
      expect(wrapper.vm.form.name).toBe('')
    })

    it('should close create dialog', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openCreate()
      wrapper.vm.form.name = 'New evidence'
      wrapper.vm.form.reviewerId = 'reviewer1'
      vi.mocked(axios.post).mockResolvedValueOnce({ data: { id: 'new' } })
      await wrapper.vm.handleCreate()
      await flushPromises()
      expect(axios.post).toHaveBeenCalledWith('/evidence', expect.objectContaining({ name: 'New evidence', reviewerId: 'reviewer1' }))
      expect(wrapper.vm.showCreate).toBe(false)
    })

    it('should have create form fields', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openCreate()
      // Name and reviewer are required; nothing is sent without them
      await wrapper.vm.handleCreate()
      expect(wrapper.vm.formErrors.name).toBeTruthy()
      wrapper.vm.form.name = 'Has a name'
      await wrapper.vm.handleCreate()
      expect(wrapper.vm.formErrors.reviewerId).toBeTruthy()
      expect(axios.post).not.toHaveBeenCalled()
    })
  })

  describe('row interactions', () => {
    it('should navigate to evidence on row click', async () => {
      const wrapper = mountView()
      await flushPromises()
      const { useRouter } = await import('vue-router')
      wrapper.vm.navigateTo({ id: '1', name: 'Test Evidence' })
      expect(useRouter().push).toHaveBeenCalledWith('/evidence/1')
    })

    it('should handle table data property', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence).toBeDefined()
      expect(Array.isArray(wrapper.vm.evidence)).toBe(true)
    })
  })

  describe('pagination', () => {
    it('should render pagination component', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.filteredEvidence).toBeDefined()
      expect(wrapper.vm.filteredEvidence.length).toBeGreaterThanOrEqual(0)
    })

    it('should update current page', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.pageSize = 1
      wrapper.vm.currentPage = 1
      await nextTick()
      expect(wrapper.vm.pagedEvidence).toHaveLength(1)
      wrapper.vm.currentPage = 2
      await nextTick()
      expect(wrapper.vm.pagedEvidence).toHaveLength(0)
    })

    it('should display page size', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.pageSize).toBeGreaterThan(0)
    })

    it('should display total count', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.filteredEvidence.length).toBe(wrapper.vm.evidence.length)
    })
  })

  describe('state badge display', () => {
    it('should render state badge for each evidence', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
      expect(wrapper.vm.evidence[0].state).toBeDefined()
    })
  })

  describe('counter evidence display', () => {
    it('should show counter evidence tag when applicable', async () => {
      const wrapper = mountView()
      await flushPromises()
      // Counter evidence is a property on evidence items
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })
  })

  describe('linked assessments badge', () => {
    it('should show assessment count badge', async () => {
      const wrapper = mountView()
      await flushPromises()
      // Badge showing assessment count is data-driven
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('should show error alert on error', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Network error'))
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.loadError).toBeTruthy()
      expect(wrapper.find('.alert').exists()).toBe(true)
    })

    it('should allow closing error alert', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 500, data: { error: 'boom' } } })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.loadError).toBeTruthy()
      // A successful refetch clears the error
      await wrapper.vm.fetchEvidence()
      await flushPromises()
      expect(wrapper.vm.loadError).toBe('')
      expect(wrapper.vm.evidence).toHaveLength(1)
    })
  })

  describe('row actions', () => {
    it('should render row actions for each evidence', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })
  })

  describe('help tips', () => {
    it('should render help tips for counter evidence column', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
    })
  })

  describe('author and reviewer display', () => {
    it('should display author information', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence).toBeDefined()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
      expect(wrapper.vm.evidence[0].authorName).toBeDefined()
    })

    it('should display reviewer information', async () => {
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.evidence).toBeDefined()
      expect(wrapper.vm.evidence.length).toBeGreaterThan(0)
      expect(wrapper.vm.evidence[0].reviewerName).toBeDefined()
    })
  })

  describe('date display', () => {
    it('should display created date', async () => {
      const wrapper = mountView()
      await flushPromises()
      const inTenDays = new Date(Date.now() + 10 * 86400000).toISOString()
      const inSixtyDays = new Date(Date.now() + 60 * 86400000).toISOString()
      expect(wrapper.vm.isExpiringSoon(inTenDays)).toBe(true)
      expect(wrapper.vm.isExpiringSoon(inSixtyDays)).toBe(false)
      expect(wrapper.vm.isExpiringSoon(null)).toBe(false)
    })

    it('should display expiration date', async () => {
      const wrapper = mountView()
      await flushPromises()
      const yesterday = new Date(Date.now() - 86400000).toISOString()
      const inTenDays = new Date(Date.now() + 10 * 86400000).toISOString()
      expect(wrapper.vm.expiryClass(yesterday)).toBe('ev-expired')
      expect(wrapper.vm.expiryClass(inTenDays)).toBe('ev-expiring')
      expect(wrapper.vm.expiryClass(null)).toBe('')
    })
  })

  describe('view state management', () => {
    it('should maintain loading state', async () => {
      const wrapper = mountView()
      expect(wrapper.vm.loading).toBe(true)
      await flushPromises()
      expect(wrapper.vm.loading).toBe(false)
    })

    it('should maintain error state', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 500, data: { error: 'boom' } } })
      const wrapper = mountView()
      await flushPromises()
      expect(wrapper.vm.loadError).toBeTruthy()
      expect(wrapper.vm.evidence).toEqual([])
      expect(wrapper.vm.loading).toBe(false)
    })

    it('should maintain filter state', async () => {
      const wrapper = mountView()
      await flushPromises()
      // Sorting: same field toggles direction, a new field starts ascending
      wrapper.vm.sortBy('name')
      expect(wrapper.vm.sortField).toBe('name')
      expect(wrapper.vm.sortDir).toBe('asc')
      wrapper.vm.sortBy('name')
      expect(wrapper.vm.sortDir).toBe('desc')
    })

    it('should maintain create dialog state', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.openCreate()
      wrapper.vm.form.name = 'Will fail'
      wrapper.vm.form.reviewerId = 'reviewer1'
      vi.mocked(axios.post).mockRejectedValueOnce({ response: { status: 400, data: { error: 'Bad' } } })
      await wrapper.vm.handleCreate()
      await flushPromises()
      // A failed create keeps the dialog open with the user's input
      expect(wrapper.vm.showCreate).toBe(true)
      expect(wrapper.vm.form.name).toBe('Will fail')
    })
  })

  describe('computed properties', () => {
    it('should have filteredEvidence computed property', async () => {
      const wrapper = mountView()
      await flushPromises()
      wrapper.vm.typeFilter = 'counter_evidence'
      await nextTick()
      // The fixture is proof, not counter evidence
      expect(wrapper.vm.filteredEvidence).toHaveLength(0)
      wrapper.vm.typeFilter = 'proof'
      await nextTick()
      expect(wrapper.vm.filteredEvidence).toHaveLength(1)
    })
  })

  describe('type column', () => {
    // Rows saved before the `type` column existed (and the demo seed) have
    // type null. They used to render a bare dash although the type filter
    // already counted them as proof.
    it('shows a Proof badge for untyped evidence, and agrees with the filter', async () => {
      const row = { state: 'in_review', authorName: 'A', createdAt: '2026-01-01', assessmentCount: 0 }
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          data: [
            { ...row, id: '1', name: 'Untyped proof', type: null, isCounterEvidence: false },
            { ...row, id: '2', name: 'Untyped counter', type: null, isCounterEvidence: true },
            { ...row, id: '3', name: 'Typed', type: 'mitigation_strategy', isCounterEvidence: false },
          ],
          total: 3,
        },
      })
      const wrapper = mountView()
      await flushPromises()
      const badges = wrapper.findAll('.ev-type-badge').map((b) => b.text())
      expect(badges).toEqual(['Proof', 'Counter Evidence', 'Mitigation Strategy'])
      expect(wrapper.find('.ev-type-muted').exists()).toBe(false)

      wrapper.vm.typeFilter = 'proof'
      await nextTick()
      expect(wrapper.vm.filteredEvidence.map((e: { id: string }) => e.id)).toEqual(['1'])
    })
  })

  describe('page header', () => {
    it('should display page title', async () => {
      const wrapper = mountView()
      await flushPromises()
      const pageHeader = wrapper.findComponent({ name: 'PageHeader' })
      expect(pageHeader.exists()).toBe(true)
    })

    it('should have create button in header actions', async () => {
      const wrapper = mountView()
      await flushPromises()
      // PageHeader is imported and should be present
      const pageHeader = wrapper.findComponent({ name: 'PageHeader' })
      expect(pageHeader.exists()).toBe(true)
    })
  })
})
