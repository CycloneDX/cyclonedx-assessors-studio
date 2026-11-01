<template>
  <div class="rel-tab">
    <!-- KPI Ribbon -->
    <div v-if="props.entities.length > 0" class="rel-kpi-ribbon">
      <div
        v-for="kpi in entityKpis"
        :key="kpi.type"
        class="rel-kpi-tile"
        :class="[`rel-kpi-tile--${kpi.type}`, { 'rel-kpi-tile--active': activeType === kpi.type }]"
        role="button"
        :aria-pressed="activeType === kpi.type"
        :title="activeType === kpi.type ? 'Clear filter' : `Show ${kpi.label} only`"
        @click="activeType = activeType === kpi.type ? '' : kpi.type"
      >
        <span class="rel-kpi-count">{{ kpi.count }}</span>
        <span class="rel-kpi-label">{{ kpi.label }}</span>
      </div>
    </div>

    <!-- Main grid -->
    <div class="rel-grid">
      <!-- World Map -->
      <div class="rel-panel rel-panel--map">
        <div class="rel-panel-header">
          <el-icon><Location /></el-icon>
          <span>Global Entity Distribution</span>
          <span v-if="activeType" class="rel-panel-filter-badge">
            Filtered: {{ activeTypeLabel }}
          </span>
        </div>
        <div class="rel-map-body">
          <EntityWorldMap
            :entities="filteredEntities"
            :graph-edges="props.graphEdges"
            :active-type="activeType"
          />
        </div>
      </div>

      <!-- Compliance Status Tiles -->
      <div class="rel-panel rel-panel--compliance">
        <div class="rel-panel-header">
          <el-icon><Checked /></el-icon>
          <span>Compliance Coverage</span>
        </div>
        <div class="compliance-tiles">
          <div
            v-for="tile in complianceTiles"
            :key="tile.key"
            class="compliance-tile"
            :class="`compliance-tile--${tile.variant}`"
          >
            <span class="ct-count">{{ tile.count }}</span>
            <span class="ct-label">{{ tile.label }}</span>
            <span class="ct-sub">{{ tile.sub }}</span>
          </div>
        </div>
      </div>

      <!-- 2026 Projects -->
      <div class="rel-panel rel-panel--projects">
        <div class="rel-panel-header">
          <el-icon><Folder /></el-icon>
          <span>{{ currentYear }} Projects</span>
          <span class="rel-panel-count">{{ currentYearProjects.length }}</span>
        </div>
        <div v-if="projectsLoading" class="rel-panel-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
        <div v-else-if="currentYearProjects.length === 0" class="rel-panel-empty">
          No projects for {{ currentYear }}
        </div>
        <ul v-else class="project-list">
          <li v-for="p in currentYearProjects" :key="p.id" class="project-row">
            <span class="project-row-name" :title="p.name">{{ p.name }}</span>
            <span class="project-state-badge" :class="`project-state--${p.state}`">
              {{ formatState(p.state) }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Standards Coverage -->
      <div class="rel-panel rel-panel--standards">
        <div class="rel-panel-header">
          <el-icon><DocumentChecked /></el-icon>
          <span>Standards Coverage</span>
        </div>
        <div v-if="standardsCoverage.length === 0" class="rel-panel-empty">
          No standards linked
        </div>
        <ul v-else class="standards-coverage-list">
          <li v-for="s in standardsCoverage.slice(0, 8)" :key="s.name" class="standards-coverage-row">
            <span class="sc-name" :title="s.name">{{ s.name }}</span>
            <div class="sc-bar-wrap">
              <div class="sc-bar" :style="{ width: `${(s.count / maxStandardCount) * 100}%` }" />
            </div>
            <span class="sc-count">{{ s.count }}</span>
          </li>
        </ul>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Location, Checked, Folder, Loading, DocumentChecked } from '@element-plus/icons-vue'
import EntityWorldMap from '@/components/shared/EntityWorldMap.vue'
import { getProjects } from '@/api/projects'
import type { Entity, Project } from '@/types'
import type { GraphEdge } from '@/components/shared/RelationshipGraph.vue'

const props = defineProps<{
  entities: Entity[]
  graphEdges: GraphEdge[]
}>()

const activeType = ref('')
const currentYear = new Date().getFullYear()

const TYPE_LABELS: Record<string, string> = {
  organization: 'Organizations', business_unit: 'Business Units', team: 'Teams',
  product: 'Products', product_version: 'Versions', component: 'Components',
  service: 'Services', project: 'Projects',
}

const activeTypeLabel = computed(() => activeType.value ? (TYPE_LABELS[activeType.value] || activeType.value) : '')

// ── KPI Ribbon ────────────────────────────────────────────────────────────────
const entityKpis = computed(() => {
  const counts: Record<string, number> = {}
  for (const e of props.entities) {
    if (e.state === 'archived') continue
    counts[e.entityType] = (counts[e.entityType] || 0) + 1
  }
  const order = ['organization', 'business_unit', 'team', 'product', 'product_version', 'component', 'service']
  return order.filter(t => counts[t]).map(t => ({ type: t, label: TYPE_LABELS[t], count: counts[t] }))
})

const filteredEntities = computed(() =>
  activeType.value ? props.entities.filter(e => e.entityType === activeType.value) : props.entities
)

// ── Compliance Coverage Tiles ─────────────────────────────────────────────────
const complianceTiles = computed(() => {
  const scoped = activeType.value
    ? props.entities.filter(e => e.entityType === activeType.value)
    : props.entities

  const withStandards = scoped.filter(e => (e.standards || []).length > 0).length
  const withoutStandards = scoped.filter(e => (e.standards || []).length === 0).length

  const entityIds = new Set(scoped.map(e => e.id))
  const connectedIds = new Set<string>()
  for (const edge of props.graphEdges) {
    if (entityIds.has(edge.sourceEntityId)) connectedIds.add(edge.sourceEntityId)
    if (entityIds.has(edge.targetEntityId)) connectedIds.add(edge.targetEntityId)
  }
  const inNetwork = connectedIds.size
  const isolated = scoped.length - inNetwork

  const active = scoped.filter(e => e.state === 'active').length
  const inactive = scoped.filter(e => e.state === 'inactive').length
  const archived = scoped.filter(e => e.state === 'archived').length

  return [
    { key: 'standards', label: 'Standards Linked', sub: 'entities covered', count: withStandards, variant: 'green' },
    { key: 'no-standards', label: 'No Standards', sub: 'coverage gap', count: withoutStandards, variant: 'red' },
    { key: 'network', label: 'In Network', sub: 'have relationships', count: inNetwork, variant: 'blue' },
    { key: 'isolated', label: 'Isolated', sub: 'no connections', count: isolated, variant: 'gray' },
    { key: 'active', label: 'Active', sub: 'current state', count: active, variant: 'teal' },
    { key: 'inactive', label: 'Inactive / Archived', sub: 'needs review', count: inactive + archived, variant: 'amber' },
  ]
})

// ── Projects ──────────────────────────────────────────────────────────────────
const projectsLoading = ref(false)
const allProjects = ref<Project[]>([])

const currentYearProjects = computed(() =>
  allProjects.value.filter(p => new Date(p.createdAt).getFullYear() === currentYear)
)

function formatState(s: string) {
  const m: Record<string, string> = {
    new: 'New', in_progress: 'In Progress', on_hold: 'On Hold',
    complete: 'Complete', operational: 'Operational', retired: 'Retired',
  }
  return m[s] || s
}

// ── Standards Coverage ────────────────────────────────────────────────────────
const standardsCoverage = computed(() => {
  const counts: Record<string, number> = {}
  const scoped = activeType.value
    ? props.entities.filter(e => e.entityType === activeType.value)
    : props.entities
  for (const e of scoped) {
    for (const s of (e.standards || [])) {
      const key = s.name + (s.version ? ` v${s.version}` : '')
      counts[key] = (counts[key] || 0) + 1
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
})

const maxStandardCount = computed(() =>
  standardsCoverage.value.length > 0 ? standardsCoverage.value[0].count : 1
)


// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  projectsLoading.value = true
  try {
    const result = await getProjects(1, 100)
    allProjects.value = result.data || result
  } catch {
    allProjects.value = []
  } finally {
    projectsLoading.value = false
  }
})
</script>

<style scoped lang="scss">
.rel-tab {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
}

// ── KPI Ribbon ────────────────────────────────────────────────────────────────
.rel-kpi-ribbon {
  display: flex;
  gap: var(--cat-spacing-3);
  flex-wrap: wrap;
}

.rel-kpi-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 18px;
  border-radius: var(--cat-radius-md);
  background: var(--cat-bg-card);
  border: 1.5px solid var(--cat-border-subtle);
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s, transform 0.1s;
  user-select: none;
  min-width: 90px;

  &:hover { transform: translateY(-1px); border-color: var(--cat-border-default); }

  &--organization    { --kpi-color: #6366f1; }
  &--business_unit   { --kpi-color: #0ea5e9; }
  &--team            { --kpi-color: #10b981; }
  &--product         { --kpi-color: #f59e0b; }
  &--product_version { --kpi-color: #f97316; }
  &--component       { --kpi-color: #8b5cf6; }
  &--service         { --kpi-color: #ec4899; }

  &--active {
    border-color: var(--kpi-color, #6366f1);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--kpi-color, #6366f1) 20%, transparent);
  }
}

.rel-kpi-count {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
  color: var(--kpi-color, var(--cat-text-primary));
}

.rel-kpi-label {
  font-size: 0.72rem;
  color: var(--cat-text-secondary);
  margin-top: 4px;
  text-align: center;
}

// ── Grid Layout ───────────────────────────────────────────────────────────────
.rel-grid {
  display: grid;
  grid-template-columns: 3fr 1.6fr;
  grid-template-rows: auto auto;
  gap: var(--cat-spacing-4);

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
}

.rel-panel {
  background: var(--cat-bg-card);
  border: 1px solid var(--cat-border-subtle);
  border-radius: var(--cat-radius-md);
  overflow: hidden;

  &--map { grid-column: 1; grid-row: 1; }
  &--compliance { grid-column: 2; grid-row: 1; }
  &--projects { grid-column: 1 / 2; grid-row: 2; }
  &--standards { grid-column: 2; grid-row: 2; }
}

.rel-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cat-border-subtle);
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--cat-text-primary);
  background: var(--cat-bg-subtle);

  .el-icon { color: var(--cat-text-secondary); flex-shrink: 0; }
}

.rel-panel-filter-badge {
  margin-left: auto;
  font-size: 0.72rem;
  font-weight: 500;
  color: #6366f1;
  background: color-mix(in srgb, #6366f1 12%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
}

.rel-panel-count {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--cat-text-secondary);
  background: var(--cat-bg-default);
  border: 1px solid var(--cat-border-subtle);
  border-radius: 999px;
  padding: 1px 8px;
  font-weight: 600;
}

.rel-panel-loading,
.rel-panel-empty {
  padding: 24px 16px;
  color: var(--cat-text-secondary);
  font-size: 0.82rem;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

// ── Map ───────────────────────────────────────────────────────────────────────
.rel-map-body {
  :deep(.world-map-wrap) {
    margin-bottom: 0;
  }

  :deep(.world-map-svg) {
    height: 300px;
  }

  :deep(.world-map-empty) {
    margin-bottom: 0;
    border: none;
    border-radius: 0;
  }
}

// ── Compliance Tiles ──────────────────────────────────────────────────────────
.compliance-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--cat-border-subtle);
}

.compliance-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 10px;
  background: var(--cat-bg-card);
  gap: 3px;

  .ct-count {
    font-size: 1.7rem;
    font-weight: 700;
    line-height: 1;
  }
  .ct-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-align: center;
  }
  .ct-sub {
    font-size: 0.66rem;
    color: var(--cat-text-secondary);
    text-align: center;
  }

  &--green  { .ct-count { color: #10b981; } .ct-label { color: #10b981; } }
  &--red    { .ct-count { color: #ef4444; } .ct-label { color: #ef4444; } }
  &--blue   { .ct-count { color: #0ea5e9; } .ct-label { color: #0ea5e9; } }
  &--gray   { .ct-count { color: #6b7280; } .ct-label { color: #6b7280; } }
  &--teal   { .ct-count { color: #06b6d4; } .ct-label { color: #06b6d4; } }
  &--amber  { .ct-count { color: #f59e0b; } .ct-label { color: #f59e0b; } }
}

// ── Projects List ─────────────────────────────────────────────────────────────
.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}

.project-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--cat-border-subtle);
  gap: 10px;

  &:last-child { border-bottom: none; }
}

.project-row-name {
  font-size: 0.82rem;
  color: var(--cat-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.project-state-badge {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;

  &.project-state--new         { background: #f1f5f9; color: #475569; }
  &.project-state--in_progress { background: #dbeafe; color: #1d4ed8; }
  &.project-state--on_hold     { background: #fef3c7; color: #92400e; }
  &.project-state--complete    { background: #dcfce7; color: #15803d; }
  &.project-state--operational { background: #ede9fe; color: #5b21b6; }
  &.project-state--retired     { background: #f3f4f6; color: #6b7280; }
}

// ── Standards Coverage ────────────────────────────────────────────────────────
.standards-coverage-list {
  list-style: none;
  margin: 0;
  padding: 8px 0;
  max-height: 260px;
  overflow-y: auto;
}

.standards-coverage-row {
  display: grid;
  grid-template-columns: 1fr 60px 28px;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
}

.sc-name {
  font-size: 0.78rem;
  color: var(--cat-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-bar-wrap {
  height: 6px;
  background: var(--cat-bg-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.sc-bar {
  height: 100%;
  background: #6366f1;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.sc-count {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--cat-text-secondary);
  text-align: right;
}


// ── Dark mode tweaks ──────────────────────────────────────────────────────────
:deep(.el-icon.is-loading) {
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
