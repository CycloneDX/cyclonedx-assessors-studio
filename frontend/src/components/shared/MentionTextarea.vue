<template>
  <div class="mention-textarea-wrapper">
    <textarea
      ref="textareaRef"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      class="mention-textarea"
      @input="handleInput"
      @keydown="handleKeydown"
      @blur="handleBlur"
    />
    <Teleport to="body">
      <div
        v-if="showSuggestions && filteredParticipants.length > 0"
        class="mention-suggestions"
        :style="suggestionsStyle"
      >
        <div
          v-for="(participant, index) in filteredParticipants"
          :key="participant.id"
          class="mention-suggestion-item"
          :class="{ 'is-active': index === activeIndex }"
          @mousedown.prevent="selectParticipant(participant)"
          @mouseenter="activeIndex = index"
        >
          <span class="suggestion-display-name">{{ participant.displayName }}</span>
          <span class="suggestion-username">@{{ participant.username }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'

interface Participant {
  id: string
  username: string
  displayName: string
  role?: string
}

const props = defineProps<{
  modelValue: string
  participants: Participant[]
  rows?: number
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showSuggestions = ref(false)
const mentionQuery = ref('')
const mentionStartPos = ref(0)
const activeIndex = ref(0)
const suggestionsStyle = ref<Record<string, string>>({})

const filteredParticipants = computed(() => {
  if (!mentionQuery.value) return props.participants
  const query = mentionQuery.value.toLowerCase()
  return props.participants.filter(
    p =>
      p.username.toLowerCase().includes(query) ||
      p.displayName.toLowerCase().includes(query)
  )
})

watch(() => filteredParticipants.value.length, () => {
  if (activeIndex.value >= filteredParticipants.value.length) {
    activeIndex.value = 0
  }
})

const handleInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)

  const cursorPos = target.selectionStart
  const textBefore = target.value.substring(0, cursorPos)

  // Find the last @ that could be a mention trigger
  const lastAtIndex = textBefore.lastIndexOf('@')

  if (lastAtIndex >= 0) {
    // Check that the @ is at start or preceded by whitespace
    const charBefore = lastAtIndex > 0 ? textBefore[lastAtIndex - 1] : ' '
    if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
      const query = textBefore.substring(lastAtIndex + 1)
      // Only show if there's no space in the query (still typing the username)
      if (!query.includes(' ') && !query.includes('\n')) {
        mentionQuery.value = query
        mentionStartPos.value = lastAtIndex
        activeIndex.value = 0
        showSuggestions.value = true
        positionSuggestions()
        return
      }
    }
  }

  showSuggestions.value = false
}

const positionSuggestions = async () => {
  await nextTick()
  const textarea = textareaRef.value
  if (!textarea) return

  // Position suggestions below the textarea
  const rect = textarea.getBoundingClientRect()
  suggestionsStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.bottom + 4}px`,
    width: `${rect.width}px`,
    zIndex: '9999',
  }
}

const handleKeydown = (e: KeyboardEvent) => {
  if (!showSuggestions.value || filteredParticipants.value.length === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % filteredParticipants.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value =
      (activeIndex.value - 1 + filteredParticipants.value.length) %
      filteredParticipants.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (showSuggestions.value && filteredParticipants.value.length > 0) {
      e.preventDefault()
      selectParticipant(filteredParticipants.value[activeIndex.value])
    }
  } else if (e.key === 'Escape') {
    showSuggestions.value = false
  }
}

const handleBlur = () => {
  // Small delay to allow click on suggestion item
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

const selectParticipant = (participant: Participant) => {
  const textarea = textareaRef.value
  if (!textarea) return

  const currentValue = props.modelValue
  const before = currentValue.substring(0, mentionStartPos.value)
  const after = currentValue.substring(textarea.selectionStart)
  const newValue = `${before}@${participant.username} ${after}`

  emit('update:modelValue', newValue)
  showSuggestions.value = false

  // Restore cursor position after the inserted mention
  nextTick(() => {
    const newCursorPos = mentionStartPos.value + participant.username.length + 2 // @username + space
    textarea.setSelectionRange(newCursorPos, newCursorPos)
    textarea.focus()
  })
}
</script>

<style scoped lang="scss">
.mention-textarea-wrapper {
  position: relative;
  width: 100%;
}

.mention-textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px 12px;
  background: var(--cat-bg-secondary, #161b22);
  border: 1px solid var(--cat-border-primary, #30363d);
  border-radius: var(--cat-radius-sm, 6px);
  color: var(--cat-text-primary, #e6edf3);
  font-family: inherit;
  font-size: var(--cat-font-size-sm, 14px);
  line-height: var(--cat-line-height-base, 1.5);
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease;

  &::placeholder {
    color: var(--cat-text-tertiary, #484f58);
  }

  &:focus {
    border-color: var(--cat-primary, #58a6ff);
  }
}

.mention-suggestions {
  background: var(--cat-bg-secondary, #161b22);
  border: 1px solid var(--cat-border-primary, #30363d);
  border-radius: var(--cat-radius-sm, 6px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  max-height: 200px;
  overflow-y: auto;
}

.mention-suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover,
  &.is-active {
    background-color: rgba(88, 166, 255, 0.1);
  }
}

.suggestion-display-name {
  color: var(--cat-text-primary, #e6edf3);
  font-weight: 500;
  font-size: var(--cat-font-size-sm, 14px);
}

.suggestion-username {
  color: var(--cat-text-tertiary, #484f58);
  font-size: var(--cat-font-size-xs, 12px);
}
</style>
