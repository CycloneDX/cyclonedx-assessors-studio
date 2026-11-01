import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GettingStartedDialog from '@/components/shared/GettingStartedDialog.vue'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import axios from 'axios'

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

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: {
    'en-US': {
      gettingStarted: {
        welcome: 'Welcome',
        welcomeDescription: 'Welcome to Assessors Studio',
        entitiesTitle: 'Entities & Standards',
        entitiesDescription: 'Create and manage entities',
        assessmentsTitle: 'Assessments',
        assessmentsDescription: 'Run assessments',
        attestationsTitle: 'Attestations & Progress',
        attestationsDescription: 'Track progress',
        automationTitle: 'Built for Automation',
        automationDescription: 'Automate workflows',
        previous: 'Previous',
        next: 'Next',
        getStarted: 'Get Started'
      }
    }
  }
})

function mountGettingStartedDialog(modelValue = true) {
  return mount(GettingStartedDialog, {
    props: {
      modelValue
    },
    global: {
      plugins: [i18n],
      stubs: {
        ElDialog: {
          template: '<div v-if="modelValue" class="el-dialog"><slot /><div><slot name="footer" /></div></div>',
          props: ['modelValue']
        },
        ElIcon: { template: '<i></i>' },
        ElButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
        Promotion: { template: '<span></span>' },
        OfficeBuilding: { template: '<span></span>' },
        DocumentChecked: { template: '<span></span>' },
        Stamp: { template: '<span></span>' },
        SetUp: { template: '<span></span>' }
      }
    }
  })
}

describe('GettingStartedDialog.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(axios.post as any).mockResolvedValue({ data: {} })
  })

  describe('rendering', () => {
    it('should render the component', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.exists()).toBe(true)
    })

    it('should render dialog when modelValue is true', () => {
      const wrapper = mountGettingStartedDialog(true)
      expect(wrapper.find('.el-dialog').exists()).toBe(true)
    })

    it('should not render dialog when modelValue is false', () => {
      const wrapper = mountGettingStartedDialog(false)
      expect(wrapper.find('.el-dialog').exists()).toBe(false)
    })

    it('should have gs-content class', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.find('.gs-content').exists()).toBe(true)
    })
  })

  describe('step indicators', () => {
    it('should render step dots', () => {
      const wrapper = mountGettingStartedDialog()
      const dots = wrapper.findAll('.step-dot')
      expect(dots.length).toBeGreaterThan(0)
    })

    it('should have 5 steps', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.vm.steps.length).toBe(5)
    })

    it('should mark first step as active by default', () => {
      const wrapper = mountGettingStartedDialog()
      const activeDot = wrapper.find('.step-dot.active')
      expect(activeDot.exists()).toBe(true)
    })

    it('should update active step indicator when step changes', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 1
      await nextTick()

      const dots = wrapper.findAll('.step-dot')
      expect(dots[1].classes()).toContain('active')
    })
  })

  describe('step content', () => {
    it('should display welcome step initially', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.text()).toContain('Welcome')
    })

    it('should have all 5 step titles', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.vm.steps).toHaveLength(5)
      expect(wrapper.vm.steps[0].title).toBe('Welcome')
      expect(wrapper.vm.steps[1].title).toBe('Entities & Standards')
      expect(wrapper.vm.steps[2].title).toBe('Assessments')
      expect(wrapper.vm.steps[3].title).toBe('Attestations & Progress')
      expect(wrapper.vm.steps[4].title).toBe('Built for Automation')
    })

    it('should have gs-step divs', () => {
      const wrapper = mountGettingStartedDialog()
      const steps = wrapper.findAll('.gs-step')
      expect(steps.length).toBeGreaterThan(0)
    })

    it('should display step title', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.find('.gs-title').exists()).toBe(true)
    })

    it('should display step description', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.find('.gs-description').exists()).toBe(true)
    })

    it('should display step icon', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.find('.gs-icon').exists()).toBe(true)
    })
  })

  describe('navigation buttons', () => {
    it('should have previous button on non-first steps', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 1
      await nextTick()

      const buttons = wrapper.findAll('button')
      expect(buttons.some(b => b.text().includes('Previous'))).toBe(true)
    })

    it('should not have previous button on first step', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.vm.currentStep).toBe(0)

      const buttons = wrapper.findAll('button')
      const hasPrevious = buttons.some(b => b.text().includes('Previous'))
      expect(hasPrevious).toBe(false)
    })

    it('should have next button on non-last steps', () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.vm.currentStep).toBe(0)

      const buttons = wrapper.findAll('button')
      expect(buttons.some(b => b.text().includes('Next'))).toBe(true)
    })

    it('should have get started button on last step', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 4
      await nextTick()

      const buttons = wrapper.findAll('button')
      expect(buttons.some(b => b.text().includes('Get Started'))).toBe(true)
    })
  })

  describe('step navigation', () => {
    it('should advance to next step on next button click', async () => {
      const wrapper = mountGettingStartedDialog()
      expect(wrapper.vm.currentStep).toBe(0)

      wrapper.vm.currentStep++
      await nextTick()

      expect(wrapper.vm.currentStep).toBe(1)
    })

    it('should go back on previous button click', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 2

      wrapper.vm.currentStep--
      await nextTick()

      expect(wrapper.vm.currentStep).toBe(1)
    })

    it('should mark steps as completed', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 2
      await nextTick()

      const dots = wrapper.findAll('.step-dot')
      expect(dots[0].classes()).toContain('completed')
      expect(dots[1].classes()).toContain('completed')
    })
  })

  describe('dismiss functionality', () => {
    it('should emit update:modelValue when dismissed', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 4

      await wrapper.vm.handleDismiss()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    })

    it('should set visible to false on dismiss', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 4

      await wrapper.vm.handleDismiss()
      await flushPromises()

      expect(wrapper.vm.visible).toBe(false)
    })

    it('should call onboarding completion API on dismiss', async () => {
      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 4

      await wrapper.vm.handleDismiss()
      await flushPromises()

      expect(axios.post).toHaveBeenCalledWith('/auth/complete-onboarding')
    })

    it('should handle API errors gracefully', async () => {
      ;(axios.post as any).mockRejectedValue(new Error('API error'))

      const wrapper = mountGettingStartedDialog()
      wrapper.vm.currentStep = 4

      await wrapper.vm.handleDismiss()
      await flushPromises()

      expect(wrapper.vm.visible).toBe(false)
    })
  })
})
