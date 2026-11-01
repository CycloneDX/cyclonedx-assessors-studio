<template>
  <el-dialog
    v-model="visible"
    title=""
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    class="getting-started-dialog"
  >
    <div class="gs-content">
      <!-- Step indicator dots -->
      <div class="gs-steps">
        <div
          v-for="(_s, i) in steps"
          :key="i"
          class="step-dot"
          :class="{ active: i === currentStep, completed: i < currentStep }"
        />
      </div>

      <!-- Step 0: Welcome -->
      <div v-if="currentStep === 0" class="gs-step">
        <div class="gs-icon">
          <el-icon :size="48" color="var(--el-color-primary)"><Promotion /></el-icon>
        </div>
        <h2 class="gs-title">{{ t('gettingStarted.welcome') }}</h2>
        <p class="gs-description">
          {{ t('gettingStarted.welcomeDescription') }}
        </p>
      </div>

      <!-- Step 1: Entities & Standards -->
      <div v-if="currentStep === 1" class="gs-step">
        <div class="gs-icon">
          <el-icon :size="48" color="var(--el-color-primary)"><OfficeBuilding /></el-icon>
        </div>
        <h2 class="gs-title">{{ t('gettingStarted.entitiesTitle') }}</h2>
        <p class="gs-description">
          {{ t('gettingStarted.entitiesDescription') }}
        </p>
      </div>

      <!-- Step 2: Assessments -->
      <div v-if="currentStep === 2" class="gs-step">
        <div class="gs-icon">
          <el-icon :size="48" color="var(--el-color-primary)"><DocumentChecked /></el-icon>
        </div>
        <h2 class="gs-title">{{ t('gettingStarted.assessmentsTitle') }}</h2>
        <p class="gs-description">
          {{ t('gettingStarted.assessmentsDescription') }}
        </p>
      </div>

      <!-- Step 3: Attestations & Progress -->
      <div v-if="currentStep === 3" class="gs-step">
        <div class="gs-icon">
          <el-icon :size="48" color="var(--el-color-primary)"><Stamp /></el-icon>
        </div>
        <h2 class="gs-title">{{ t('gettingStarted.attestationsTitle') }}</h2>
        <p class="gs-description">
          {{ t('gettingStarted.attestationsDescription') }}
        </p>
      </div>

      <!-- Step 4: Built for Automation -->
      <div v-if="currentStep === 4" class="gs-step">
        <div class="gs-icon">
          <el-icon :size="48" color="var(--el-color-primary)"><SetUp /></el-icon>
        </div>
        <h2 class="gs-title">{{ t('gettingStarted.automationTitle') }}</h2>
        <p class="gs-description">
          {{ t('gettingStarted.automationDescription') }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="gs-footer">
        <el-button v-if="currentStep > 0" @click="currentStep--">
          {{ t('gettingStarted.previous') }}
        </el-button>
        <div class="gs-footer-spacer"></div>
        <el-button v-if="currentStep < steps.length - 1" type="primary" @click="currentStep++">
          {{ t('gettingStarted.next') }}
        </el-button>
        <el-button v-else type="primary" @click="handleDismiss">
          {{ t('gettingStarted.getStarted') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Promotion,
  OfficeBuilding,
  DocumentChecked,
  Stamp,
  SetUp,
} from '@element-plus/icons-vue'
import client from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = ref(props.modelValue)
const currentStep = ref(0)

watch(() => props.modelValue, (val) => { visible.value = val })
watch(visible, (val) => { emit('update:modelValue', val) })

const steps = [
  { title: 'Welcome' },
  { title: 'Entities & Standards' },
  { title: 'Assessments' },
  { title: 'Attestations & Progress' },
  { title: 'Built for Automation' },
]

const authStore = useAuthStore()

const handleDismiss = async () => {
  visible.value = false
  try {
    await client.post('/auth/complete-onboarding')
    if (authStore.user) {
      authStore.user.hasCompletedOnboarding = true
    }
  } catch (err) {
    console.error('Failed to mark onboarding as complete:', err)
  }
}
</script>

<style scoped lang="scss">
.gs-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.gs-steps {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 32px;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--cat-border-default, var(--el-border-color));
  transition: all 0.2s ease;

  &.active {
    width: 24px;
    border-radius: 4px;
    background-color: var(--cat-brand-primary, var(--el-color-primary));
  }

  &.completed {
    background-color: var(--el-color-success);
  }
}

.gs-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  min-height: 200px;
}

.gs-icon {
  margin-bottom: 4px;
}

.gs-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--cat-text-primary, var(--el-text-color-primary));
  margin: 0;
}

.gs-description {
  font-size: 0.875rem;
  color: var(--cat-text-secondary, var(--el-text-color-secondary));
  margin: 0;
  line-height: 1.6;
  max-width: 400px;
}

.gs-footer {
  display: flex;
  align-items: center;
  width: 100%;
}

.gs-footer-spacer {
  flex: 1;
}
</style>
