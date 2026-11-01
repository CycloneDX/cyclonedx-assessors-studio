import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TagInput from '@/components/shared/TagInput.vue'
import { nextTick } from 'vue'

// Mock the shared API client
vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn()
  }
}))

import client from '@/api/client'

describe('TagInput.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render the component', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should have tag-input class', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      expect(wrapper.find('.tag-input').exists()).toBe(true)
    })

    it('should render input field', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      expect(wrapper.find('.tag-input__field').exists()).toBe(true)
    })
  })

  describe('existing tags', () => {
    it('should render existing tags', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2', 'tag3']
        }
      })

      expect(wrapper.text()).toContain('tag1')
      expect(wrapper.text()).toContain('tag2')
      expect(wrapper.text()).toContain('tag3')
    })

    it('should render tags as tag-pill elements', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2']
        }
      })

      const pills = wrapper.findAll('.tag-pill')
      expect(pills.length).toBe(2)
    })

    it('should display correct tag labels', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['javascript', 'vue', 'typescript']
        }
      })

      expect(wrapper.text()).toContain('javascript')
      expect(wrapper.text()).toContain('vue')
      expect(wrapper.text()).toContain('typescript')
    })

    it('should render empty when no tags provided', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const pills = wrapper.findAll('.tag-pill')
      expect(pills.length).toBe(0)
    })

    it('should handle tags with special characters', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag-with-dash', 'tag_with_underscore', 'tag.with.dot']
        }
      })

      expect(wrapper.text()).toContain('tag-with-dash')
      expect(wrapper.text()).toContain('tag_with_underscore')
      expect(wrapper.text()).toContain('tag.with.dot')
    })
  })

  describe('placeholder', () => {
    it('should render default placeholder', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('placeholder')).toBe('Type a tag and press space')
    })

    it('should render custom placeholder', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: [],
          placeholder: 'Enter your tags here'
        }
      })

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('placeholder')).toBe('Enter your tags here')
    })

    it('should hide placeholder when tags exist', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1']
        }
      })

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('placeholder')).toBe('')
    })

    it('should show placeholder again when all tags are removed', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1']
        }
      })

      // Click the close button to trigger removal
      const closeButtons = wrapper.findAll('.tag-pill__close')
      await closeButtons[0].trigger('click')
      await nextTick()

      // The component emits the new value; simulate the parent updating the prop
      await wrapper.setProps({ modelValue: [] })
      await nextTick()

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('placeholder')).toBe('Type a tag and press space')
    })
  })

  describe('adding tags', () => {
    it('should emit update:modelValue when tag is added via enter key', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('newtag')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['newtag']])
    })

    it('should emit update:modelValue when tag is added via space key', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('newtag')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    })

    it('should add tag to existing tags', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['existing']
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('newtag')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['existing', 'newtag']])
    })

    it('should trim whitespace from input', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('  newtag  ')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['newtag']])
    })

    it('should convert tag to lowercase', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('NewTag')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['newtag']])
    })

    it('should not add empty tags', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('   ')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })

    it('should not add duplicate tags', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['existing']
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('existing')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })

    it('should clear input field after adding tag', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('newtag')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter' })
      )
      await nextTick()

      expect(wrapper.vm.inputText).toBe('')
    })
  })

  describe('removing tags', () => {
    it('should emit update:modelValue when tag is removed', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2']
        }
      })

      const closeButton = wrapper.find('.tag-pill__close')
      await closeButton.trigger('click')
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['tag2']])
    })

    it('should remove tag via backspace when input is empty', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2']
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['tag1']])
    })

    it('should not remove tag via backspace when input has text', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2']
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('text')
      await (input.element as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace' })
      )
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })

    it('should remove correct tag when close button is clicked', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2', 'tag3']
        }
      })

      const closeButtons = wrapper.findAll('.tag-pill__close')
      await closeButtons[1].trigger('click')
      await nextTick()

      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['tag1', 'tag3']])
    })
  })

  describe('focus and input', () => {
    it('should focus input when wrapper is clicked', async () => {
      // attachTo is required for jsdom to track focus / document.activeElement
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        },
        attachTo: document.body
      })

      const tagInput = wrapper.find('.tag-input')
      await tagInput.trigger('click')
      await nextTick()

      expect(document.activeElement).toBe(wrapper.find('.tag-input__field').element)

      wrapper.unmount()
    })

    it('should add tag on blur if input is not empty', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('newtag')
      await input.trigger('blur')
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    })

    it('should hide suggestions on blur', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      // Set suggestions to visible
      wrapper.vm.showSuggestions = true
      await nextTick()

      const input = wrapper.find('.tag-input__field')
      await input.trigger('blur')
      await nextTick()

      expect(wrapper.vm.showSuggestions).toBe(false)
    })
  })

  describe('suggestions', () => {
    it('should show suggestions dropdown when input has value', async () => {
      vi.mocked(client.get).mockResolvedValue({
        data: { data: ['suggestion1', 'suggestion2'] }
      })

      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('sug')
      await nextTick()

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 400))
      await nextTick()

      expect(wrapper.vm.showSuggestions).toBe(true)
    })

    it('should filter out already-added tags from suggestions', async () => {
      vi.mocked(client.get).mockResolvedValue({
        data: { data: ['tag1', 'tag2', 'tag3'] }
      })

      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1']
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('tag')
      await nextTick()

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 400))
      await nextTick()

      expect(wrapper.vm.suggestions).not.toContain('tag1')
    })

    it('should hide suggestions when input is empty', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      await input.setValue('')
      await nextTick()

      expect(wrapper.vm.showSuggestions).toBe(false)
    })
  })

  describe('suggestion selection', () => {
    // Suggestions select on mousedown (not click) so the input doesn't blur first
    it('should add tag when suggestion is clicked', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      // Manually set suggestions to test the selection
      wrapper.vm.suggestions = ['suggestion1', 'suggestion2']
      wrapper.vm.showSuggestions = true
      await nextTick()

      const suggestion = wrapper.find('.suggestion-item')
      await suggestion.trigger('mousedown')
      await nextTick()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['suggestion1']])
    })

    it('should clear input after selecting suggestion', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      wrapper.vm.suggestions = ['suggestion1']
      wrapper.vm.showSuggestions = true
      await nextTick()

      const suggestion = wrapper.find('.suggestion-item')
      await suggestion.trigger('mousedown')
      await nextTick()

      expect(wrapper.vm.inputText).toBe('')
    })

    it('should hide suggestions after selection', async () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      wrapper.vm.suggestions = ['suggestion1']
      wrapper.vm.showSuggestions = true
      await nextTick()

      const suggestion = wrapper.find('.suggestion-item')
      await suggestion.trigger('mousedown')
      await nextTick()

      expect(wrapper.vm.showSuggestions).toBe(false)
    })
  })

  describe('accessibility', () => {
    it('should have aria-label on input', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1', 'tag2']
        }
      })

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('aria-label')).toContain('Tag input')
    })

    it('should include current tags in aria-label', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['javascript', 'vue']
        }
      })

      const input = wrapper.find('.tag-input__field')
      const ariaLabel = input.attributes('aria-label')
      expect(ariaLabel).toContain('javascript')
      expect(ariaLabel).toContain('vue')
    })

    it('should have aria-label on close buttons', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: ['tag1']
        }
      })

      const closeButton = wrapper.find('.tag-pill__close')
      expect(closeButton.attributes('aria-label')).toBe('Remove tag tag1')
    })

    it('should have type text on input', () => {
      const wrapper = mount(TagInput, {
        props: {
          modelValue: []
        }
      })

      const input = wrapper.find('.tag-input__field')
      expect(input.attributes('type')).toBe('text')
    })
  })
})
