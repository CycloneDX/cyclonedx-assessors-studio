<template>
  <div class="tag-input-wrapper">
    <div class="tag-input" @click="focusInput">
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="tag-pill"
        :style="pillStyle(tag)"
      >
        <span class="tag-pill__label">{{ tag }}</span>
        <button
          class="tag-pill__close"
          type="button"
          :aria-label="`Remove tag ${tag}`"
          :style="closeStyle(tag)"
          @click.stop="removeTag(tag)"
        >&times;</button>
      </span>
      <div class="input-wrapper">
        <input
          ref="inputRef"
          v-model="inputText"
          class="tag-input__field"
          type="text"
          :placeholder="modelValue.length === 0 ? placeholder : ''"
          :aria-label="`Tag input. Current tags: ${modelValue.join(', ')}`"
          @keydown.enter.prevent="addTag"
          @keydown.space.prevent="addTag"
          @keydown.delete="handleBackspace"
          @blur="handleBlur"
          @input="handleInput"
          @focus="onFocus"
        />
      </div>
    </div>

    <!-- Autocomplete suggestions -->
    <div v-if="showSuggestions && suggestions.length > 0" class="tag-suggestions">
      <div
        v-for="suggestion in suggestions"
        :key="suggestion"
        class="suggestion-item"
        @mousedown.prevent="selectSuggestion(suggestion)"
      >
        {{ suggestion }}
      </div>
    </div>

    <!-- Similarity warning -->
    <div v-if="similarWarning.length > 0" class="similarity-warning" role="alert">
      <span class="similarity-warning__label">Similar tags exist:</span>
      <button
        v-for="name in similarWarning"
        :key="name"
        type="button"
        class="similarity-warning__pill"
        @mousedown.prevent="useSimilar(name)"
      >{{ name }}</button>
      <button type="button" class="similarity-warning__anyway" @mousedown.prevent="confirmAddAnyway">
        Add "{{ pendingTag }}" anyway
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import client from '@/api/client'
import { tagPillStyle, hexToRgba, isValidHexColor } from '@/utils/tagColor'

interface Props {
  modelValue: string[]
  placeholder?: string
  tagColors?: Record<string, string>
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Type a tag and press space',
  tagColors: () => ({})
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const inputText = ref('')
const inputRef = ref<HTMLInputElement>()
const suggestions = ref<string[]>([])
const showSuggestions = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// Similarity-warning state
const allTagNames = ref<string[]>([])
const allTagsLoaded = ref(false)
const similarWarning = ref<string[]>([])
const pendingTag = ref('')

const pillStyle = (tag: string) => tagPillStyle(props.tagColors[tag])

const closeStyle = (tag: string) => {
  const color = props.tagColors[tag]
  if (!isValidHexColor(color)) return {}
  return { color: hexToRgba(color, 0.6) }
}

const focusInput = () => {
  inputRef.value?.focus()
}

// Load full tag list once on first focus so similarity checks work offline.
const onFocus = async () => {
  if (allTagsLoaded.value) return
  try {
    const { data } = await client.get('/tags')
    allTagNames.value = (data.data ?? []).map((t: { name: string }) => t.name)
    allTagsLoaded.value = true
  } catch {
    // non-fatal — similarity check degrades gracefully to no-op
  }
}

const handleInput = () => {
  showSuggestions.value = true
  similarWarning.value = []
  pendingTag.value = ''

  if (debounceTimer) clearTimeout(debounceTimer)

  if (inputText.value.trim().length === 0) {
    suggestions.value = []
    showSuggestions.value = false
    return
  }

  debounceTimer = setTimeout(async () => {
    try {
      const { data } = await client.get('/tags/autocomplete', {
        params: { q: inputText.value.trim() }
      })
      const allSuggestions = data.data || []
      suggestions.value = allSuggestions
        .map((t: string | { name: string }) => typeof t === 'string' ? t : t.name)
        .filter((tag: string) => !props.modelValue.includes(tag))
    } catch {
      suggestions.value = []
    }
  }, 300)
}

// Levenshtein distance between two strings (case-insensitive).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function findSimilar(candidate: string): string[] {
  if (allTagNames.value.length === 0) return []
  const c = candidate.toLowerCase()
  return allTagNames.value.filter(existing => {
    if (props.modelValue.includes(existing)) return false
    if (existing === c) return false // exact match — autocomplete handles this
    const dist = levenshtein(c, existing)
    const maxLen = Math.max(c.length, existing.length)
    // Flag if within edit distance 2, OR similarity ratio ≥ 0.75 for longer tags
    return dist <= 2 || (maxLen > 4 && (maxLen - dist) / maxLen >= 0.75)
  })
}

const addTag = () => {
  // If there's an active similarity warning, dismiss it first
  if (similarWarning.value.length > 0) return

  const tag = inputText.value.trim().toLowerCase()
  if (!tag || props.modelValue.includes(tag)) {
    inputText.value = ''
    showSuggestions.value = false
    return
  }

  // Skip similarity check if tag already exists in canonical list (exact match)
  const isExisting = allTagNames.value.includes(tag)
  if (!isExisting) {
    const similar = findSimilar(tag)
    if (similar.length > 0) {
      pendingTag.value = tag
      similarWarning.value = similar.slice(0, 4)
      inputText.value = ''
      showSuggestions.value = false
      return
    }
  }

  emit('update:modelValue', [...props.modelValue, tag])
  inputText.value = ''
  showSuggestions.value = false
  suggestions.value = []
}

const confirmAddAnyway = () => {
  const tag = pendingTag.value
  similarWarning.value = []
  pendingTag.value = ''
  if (tag && !props.modelValue.includes(tag)) {
    emit('update:modelValue', [...props.modelValue, tag])
    // Register the new tag in the local cache so subsequent entries compare against it
    if (!allTagNames.value.includes(tag)) {
      allTagNames.value = [...allTagNames.value, tag]
    }
  }
  inputRef.value?.focus()
}

const useSimilar = (name: string) => {
  similarWarning.value = []
  pendingTag.value = ''
  if (!props.modelValue.includes(name)) {
    emit('update:modelValue', [...props.modelValue, name])
  }
  inputRef.value?.focus()
}

const selectSuggestion = (tag: string) => {
  similarWarning.value = []
  pendingTag.value = ''
  if (!props.modelValue.includes(tag)) {
    emit('update:modelValue', [...props.modelValue, tag])
  }
  inputText.value = ''
  showSuggestions.value = false
  suggestions.value = []
}

const removeTag = (tag: string) => {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}

const handleBackspace = () => {
  if (inputText.value === '' && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

const handleBlur = () => {
  // Only auto-add on blur if no similarity warning is pending
  if (similarWarning.value.length === 0) {
    addTag()
  }
  showSuggestions.value = false
}
</script>

<style scoped lang="scss">
.tag-input-wrapper {
  position: relative;
  width: 100%;
}

.tag-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px 8px;
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md, 6px);
  cursor: text;
  transition: border-color 0.2s;
  width: 100%;

  &:focus-within {
    border-color: var(--cat-brand-secondary, #2f81f7);
    box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
  }
}

.input-wrapper {
  flex: 1;
  min-width: 80px;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(63, 185, 80, 0.1);
  border: 1px solid rgba(63, 185, 80, 0.4);
  color: #3fb950;
  font-size: var(--cat-font-size-xs, 0.75rem);
  line-height: 1.4;
  white-space: nowrap;

  &__label {
    user-select: none;
  }

  &__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: rgba(63, 185, 80, 0.6);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;

    &:hover {
      background-color: rgba(63, 185, 80, 0.15);
      color: #3fb950;
    }

    &:focus-visible {
      outline: 2px solid var(--cat-brand-secondary, #2f81f7);
      outline-offset: 1px;
    }
  }
}

.tag-input__field {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--cat-text-primary, #e6edf3);
  font-size: var(--cat-font-size-sm, 0.8125rem);
  font-family: inherit;
  line-height: 24px;

  &::placeholder {
    color: var(--cat-text-disabled, #6e7681);
  }
}

.tag-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background-color: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md, 6px);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
}

.suggestion-item {
  padding: 8px 12px;
  color: var(--cat-text-primary);
  cursor: pointer;
  transition: background-color 0.15s;

  &:hover {
    background-color: var(--cat-bg-hover);
    color: var(--cat-text-primary);
  }
}

.similarity-warning {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--cat-radius-md, 6px);
  font-size: var(--cat-font-size-xs, 0.75rem);

  &__label {
    color: var(--cat-text-secondary);
    white-space: nowrap;
  }

  &__pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
    font-size: var(--cat-font-size-xs, 0.75rem);
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.15s;

    &:hover {
      background: rgba(245, 158, 11, 0.22);
    }
  }

  &__anyway {
    margin-left: auto;
    padding: 2px 8px;
    border: none;
    background: transparent;
    color: var(--cat-text-tertiary);
    font-size: var(--cat-font-size-xs, 0.75rem);
    font-family: inherit;
    cursor: pointer;
    text-decoration: underline;
    white-space: nowrap;

    &:hover {
      color: var(--cat-text-secondary);
    }
  }
}
</style>
