<template>
  <div class="dashboard-container">
    <PageHeader :title="t('dashboard.title')" />

    <!-- Getting Started Dialog (first login only) -->
    <GettingStartedDialog v-model="showGettingStarted" />

    <div class="dashboard-content">
      <!-- Tab Navigation -->
      <div class="dashboard-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <el-icon class="tab-icon"><component :is="tab.icon" /></el-icon>
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab Content -->
      <OverviewTab v-if="activeTab === 'overview'" />
      <ProgressTab v-else-if="activeTab === 'progress'" />
      <ProjectHealthTab v-else-if="activeTab === 'projecthealth'" />
      <ActivityTab v-else-if="activeTab === 'activity'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Odometer, TrendCharts, Histogram, List } from '@element-plus/icons-vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import GettingStartedDialog from '@/components/shared/GettingStartedDialog.vue'
import OverviewTab from '@/components/dashboard/OverviewTab.vue'
import ProgressTab from '@/components/dashboard/ProgressTab.vue'
import ProjectHealthTab from '@/components/dashboard/ProjectHealthTab.vue'
import ActivityTab from '@/components/dashboard/ActivityTab.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const authStore = useAuthStore()

const showGettingStarted = ref(!authStore.user?.hasCompletedOnboarding)
const activeTab = ref('overview')

const tabs = computed(() => [
  { id: 'overview',     label: t('dashboard.overviewTab', 'Overview'),        icon: Odometer },
  { id: 'progress',     label: t('dashboard.progressTab', 'Progress'),         icon: TrendCharts },
  { id: 'projecthealth',label: t('dashboard.projectHealthTab', 'Project health'), icon: Histogram },
  { id: 'activity',     label: t('dashboard.activityTab', 'Activity'),          icon: List },
])
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.dashboard-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--cat-bg-primary);
}

.dashboard-content {
  padding: 0 var(--cat-spacing-6) var(--cat-spacing-6);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

// ============================================================================
// Tab Navigation
// ============================================================================

.dashboard-tabs {
  display: flex;
  gap: var(--cat-spacing-1);
  border-bottom: 1px solid var(--cat-border-default);
  padding-bottom: 0;
}

.tab-button {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-spacing-2);
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--cat-text-secondary);
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-medium);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  margin-bottom: -1px;

  &:hover {
    color: var(--cat-text-primary);
  }

  &.active {
    color: var(--cat-accent-primary);
    border-bottom-color: var(--cat-accent-primary);
    font-weight: var(--cat-font-weight-semibold);
  }
}

.tab-icon {
  font-size: 16px;
}
</style>
