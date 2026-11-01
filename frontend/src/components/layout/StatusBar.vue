<template>
  <footer class="status-bar">
    <div class="status-left">
      <span class="status-text">CycloneDX Assessors Studio v{{ version }}</span>
    </div>

    <div class="status-right">
      <span class="status-role" aria-label="Current user role">{{ authStore.user?.role }}</span>
      <div class="status-indicator" :class="statusClass" :title="statusTitle" role="status" :aria-label="statusTitle">
        <div class="status-dot"></div>
        <span class="status-label">{{ statusLabel }}</span>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { version } from '../../../package.json'
import client from '@/api/client'

const authStore = useAuthStore()

const backendStatus = ref<'connected' | 'disconnected'>('disconnected')
let pollTimer: ReturnType<typeof setInterval> | null = null

const checkHealth = async () => {
  try {
    const { data } = await client.get('/api/health', { baseURL: '/', timeout: 5000 })
    backendStatus.value = data.status === 'healthy' ? 'connected' : 'disconnected'
  } catch {
    backendStatus.value = 'disconnected'
  }
}

const statusClass = computed(() => backendStatus.value)

const statusLabel = computed(() =>
  backendStatus.value === 'connected' ? 'Connected' : 'Disconnected'
)

const statusTitle = computed(() =>
  backendStatus.value === 'connected'
    ? 'Backend is reachable'
    : 'Cannot reach the backend server'
)

onMounted(() => {
  checkHealth()
  pollTimer = setInterval(checkHealth, 30000)
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<style scoped lang="scss">
.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--cat-statusbar-height);
  background-color: var(--cat-bg-sidebar);
  border-top: 1px solid var(--cat-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--cat-spacing-4);
  z-index: var(--cat-z-fixed);
  font-size: var(--cat-font-size-xs);
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
}

.status-text {
  color: var(--cat-text-tertiary);
}

.status-role {
  color: var(--cat-text-tertiary);
  text-transform: capitalize;
  padding: 2px 6px;
  background-color: var(--cat-bg-elevated);
  border-radius: var(--cat-radius-sm);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--cat-text-tertiary);
  cursor: default;

  &.connected {
    color: var(--cat-success);
  }

  &.disconnected {
    color: #f85149;
  }
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
}

.status-label {
  font-size: var(--cat-font-size-xs);
}
</style>
