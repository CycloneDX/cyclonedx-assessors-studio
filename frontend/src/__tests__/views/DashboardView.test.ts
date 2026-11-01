import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('vue-router', async () => {
  const { createVueRouterMock } = await import('@/__tests__/helpers/vueRouterMock')
  return createVueRouterMock({
    route: { path: '/dashboard' },
    router: { push: vi.fn(), replace: vi.fn(), currentRoute: { value: { path: '/dashboard' } } },
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

// Mock axios (the shared client is built from it via axios.create). The
// dashboard widgets render /dashboard/claims-mitigations
// fields directly, so that URL needs a payload of the real shape.
vi.mock('axios', () => {
  const claimsMitigations = {
    claims: { total: 0, counterClaims: 0, byStatus: { draft: 0, underReview: 0, accepted: 0, rejected: 0 } },
    mitigations: {
      total: 0,
      byStatus: { proposed: 0, inProgress: 0, implemented: 0, verified: 0, closed: 0 },
      openByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
    },
    evidence: { inReview: 0, inProgress: 0, claimed: 0, expired: 0 },
    requirements: { attestations: 0, attested: 0, claimed: 0, mitigated: 0 },
    attention: { claimsUnderReview: [], evidenceUnderReview: [], counterClaims: [], overdueMitigations: [] },
  }
  const mockAxiosInstance = {
    get: vi.fn((url: string) => Promise.resolve(
      url === '/dashboard/claims-mitigations' ? { data: claimsMitigations } : { data: { data: [] } },
    )),
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

import DashboardView from '@/views/DashboardView.vue'

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
    template: '<table><slot /></table>',
    props: ['data', 'stripe', 'border']
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
    template: '<div class="alert"><slot /></div>',
    props: ['type', 'closable', 'title']
  },
  ElTag: {
    template: '<span class="tag"><slot /></span>',
    props: ['type', 'size']
  },
  ElPagination: {
    template: '<div class="pagination" />',
    props: ['currentPage', 'pageSize', 'total']
  },
  ElCheckbox: {
    template: '<input type="checkbox" />',
    props: ['modelValue']
  },
  ElDatePicker: {
    template: '<input type="date" />',
    props: ['modelValue', 'type']
  },
  ElUpload: {
    template: '<div class="upload"><slot /></div>',
    props: ['autoUpload', 'limit', 'accept']
  },
  ElRadioGroup: {
    template: '<div><slot /></div>',
    props: ['modelValue']
  },
  ElRadioButton: {
    template: '<label><slot /></label>',
    props: ['value']
  },
  // View-specific stubs
  PageHeader: {
    template: '<div class="page-header"><slot name="actions" /></div>',
    props: ['title']
  },
  OverviewTab: {
    template: '<div class="overview-tab">Overview Content</div>'
  },
  ProgressTab: {
    template: '<div class="progress-tab">Progress Content</div>'
  },
  GettingStartedDialog: {
    template: '<div class="getting-started-dialog" v-if="modelValue">Getting Started</div>',
    props: ['modelValue']
  },
  StateBadge: {
    template: '<span class="state-badge">{{ state }}</span>',
    props: ['state']
  },
  RowActions: {
    template: '<div class="row-actions" />',
    emits: ['edit', 'delete', 'view', 'export']
  },
  // Icon stubs
  Odometer: { template: '<span />' },
  TrendCharts: { template: '<span />' },
  Loading: { template: '<span />' },
  Stamp: { template: '<span />' },
  Collection: { template: '<span />' },
  FolderOpened: { template: '<span />' },
  Upload: { template: '<span />' },
  Plus: { template: '<span />' },
  Grid: { template: '<span />' },
  Share: { template: '<span />' }
}

function mountView(options = {}) {
  return mount(DashboardView, {
    global: {
      stubs: {
        ...ElStubs,
        PageHeader,
        GettingStartedDialog,
        OverviewTab,
        ProgressTab
      },
      ...options
    }
  })
}

// Import the actual components
import PageHeader from '@/components/shared/PageHeader.vue'
import GettingStartedDialog from '@/components/shared/GettingStartedDialog.vue'
import OverviewTab from '@/components/dashboard/OverviewTab.vue'
import ProgressTab from '@/components/dashboard/ProgressTab.vue'

describe('DashboardView.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the dashboard container', () => {
      const wrapper = mountView()
      expect(wrapper.find('.dashboard-container').exists()).toBe(true)
    })

    it('should render PageHeader component', () => {
      const wrapper = mountView()
      const pageHeader = wrapper.findComponent({ name: 'PageHeader' })
      expect(pageHeader.exists()).toBe(true)
    })

    it('should render dashboard tabs', () => {
      const wrapper = mountView()
      expect(wrapper.find('.dashboard-tabs').exists()).toBe(true)
    })

    it('should render tab buttons for each tab', () => {
      const wrapper = mountView()
      const tabButtons = wrapper.findAll('.tab-button')
      expect(tabButtons.length).toBeGreaterThan(0)
    })

    it('should render GettingStartedDialog component', () => {
      const wrapper = mountView()
      const dialog = wrapper.findComponent({ name: 'GettingStartedDialog' })
      expect(dialog.exists()).toBe(true)
    })
  })

  describe('tab navigation', () => {
    it('should have Overview tab by default', () => {
      const wrapper = mountView()
      expect(wrapper.vm.activeTab).toBe('overview')
    })

    it('should have Progress tab available', () => {
      const wrapper = mountView()
      const tabs = wrapper.vm.tabs
      const progressTab = tabs.find((t: any) => t.id === 'progress')
      expect(progressTab).toBeDefined()
    })

    it('should switch to Overview tab on click', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'progress'
      await nextTick()

      const tabButtons = wrapper.findAll('.tab-button')
      const overviewButton = tabButtons[0]
      await overviewButton.trigger('click')

      expect(wrapper.vm.activeTab).toBe('overview')
    })

    it('should switch to Progress tab on click', async () => {
      const wrapper = mountView()
      const tabButtons = wrapper.findAll('.tab-button')
      if (tabButtons.length > 1) {
        await tabButtons[1].trigger('click')
        expect(wrapper.vm.activeTab).toBe('progress')
      }
    })

    it('should mark active tab with active class', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'overview'
      await nextTick()

      const tabButtons = wrapper.findAll('.tab-button')
      const activeButton = tabButtons.find((btn) => btn.classes().includes('active'))
      expect(activeButton).toBeDefined()
    })

    it('should update tab state when clicking tabs', async () => {
      const wrapper = mountView()
      const tabButtons = wrapper.findAll('.tab-button')

      // Click through each tab
      for (const button of tabButtons) {
        await button.trigger('click')
        await nextTick()
        expect(wrapper.vm.activeTab).toBeDefined()
      }
    })
  })

  describe('tab content display', () => {
    it('should show OverviewTab when overview tab is active', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'overview'
      await nextTick()

      const overviewTab = wrapper.findComponent({ name: 'OverviewTab' })
      expect(overviewTab.exists()).toBe(true)
    })

    it('should show ProgressTab when progress tab is active', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'progress'
      await nextTick()

      const progressTab = wrapper.findComponent({ name: 'ProgressTab' })
      expect(progressTab.exists()).toBe(true)
    })

    it('should not show ProgressTab when overview is active', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'overview'
      await nextTick()

      const progressTab = wrapper.findComponent({ name: 'ProgressTab' })
      expect(progressTab.exists()).toBe(false)
    })

    it('should not show OverviewTab when progress is active', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'progress'
      await nextTick()

      const overviewTab = wrapper.findComponent({ name: 'OverviewTab' })
      expect(overviewTab.exists()).toBe(false)
    })
  })

  describe('Getting Started Dialog', () => {
    it('should display GettingStartedDialog', () => {
      const wrapper = mountView()
      const dialog = wrapper.findComponent({ name: 'GettingStartedDialog' })
      expect(dialog.exists()).toBe(true)
    })

    it('should control dialog visibility with showGettingStarted state', async () => {
      const wrapper = mountView()
      wrapper.vm.showGettingStarted = true
      await nextTick()

      const dialog = wrapper.findComponent({ name: 'GettingStartedDialog' })
      expect(dialog.props('modelValue')).toBe(true)
    })

    it('should hide dialog when showGettingStarted is false', async () => {
      const wrapper = mountView()
      wrapper.vm.showGettingStarted = false
      await nextTick()

      const dialog = wrapper.findComponent({ name: 'GettingStartedDialog' })
      expect(dialog.props('modelValue')).toBe(false)
    })
  })

  describe('layout and styling', () => {
    it('should apply dashboard-container class', () => {
      const wrapper = mountView()
      const container = wrapper.find('.dashboard-container')
      expect(container.exists()).toBe(true)
    })

    it('should have dashboard-content div', () => {
      const wrapper = mountView()
      expect(wrapper.find('.dashboard-content').exists()).toBe(true)
    })

    it('should have dashboard-tabs div', () => {
      const wrapper = mountView()
      expect(wrapper.find('.dashboard-tabs').exists()).toBe(true)
    })

    it('should render tab icons', () => {
      const wrapper = mountView()
      const icons = wrapper.findAll('.el-icon')
      expect(icons.length).toBeGreaterThan(0)
    })
  })

  describe('tab labels', () => {
    it('should render tab labels', () => {
      const wrapper = mountView()
      const tabButtons = wrapper.findAll('.tab-button')
      expect(tabButtons.length).toBeGreaterThan(0)
      // Tab buttons should contain text
      const hasText = tabButtons.some((btn) => btn.text().length > 0)
      expect(hasText).toBe(true)
    })

    it('should have Overview label', () => {
      const wrapper = mountView()
      const text = wrapper.text()
      expect(text.toLowerCase()).toContain('overview')
    })

    it('should have Progress label', () => {
      const wrapper = mountView()
      const text = wrapper.text()
      expect(text.toLowerCase()).toContain('progress')
    })
  })

  describe('state management', () => {
    it('should initialize with overview tab active', () => {
      const wrapper = mountView()
      expect(wrapper.vm.activeTab).toBe('overview')
    })

    it('should persist active tab state', async () => {
      const wrapper = mountView()
      wrapper.vm.activeTab = 'progress'
      await nextTick()

      expect(wrapper.vm.activeTab).toBe('progress')
    })

    it('should toggle between tabs correctly', async () => {
      const wrapper = mountView()

      // Switch to progress
      wrapper.vm.activeTab = 'progress'
      await nextTick()
      expect(wrapper.vm.activeTab).toBe('progress')

      // Switch back to overview
      wrapper.vm.activeTab = 'overview'
      await nextTick()
      expect(wrapper.vm.activeTab).toBe('overview')
    })
  })

  describe('computed properties', () => {
    it('should compute tabs array', () => {
      const wrapper = mountView()
      const tabs = wrapper.vm.tabs
      expect(Array.isArray(tabs)).toBe(true)
      expect(tabs.length).toBeGreaterThan(0)
    })

    it('should have id property on each tab', () => {
      const wrapper = mountView()
      const tabs = wrapper.vm.tabs
      tabs.forEach((tab: any) => {
        expect(tab.id).toBeDefined()
      })
    })

    it('should have icon property on each tab', () => {
      const wrapper = mountView()
      const tabs = wrapper.vm.tabs
      tabs.forEach((tab: any) => {
        expect(tab.icon).toBeDefined()
      })
    })

    it('should have label property on each tab', () => {
      const wrapper = mountView()
      const tabs = wrapper.vm.tabs
      tabs.forEach((tab: any) => {
        expect(tab.label).toBeDefined()
      })
    })
  })
})
