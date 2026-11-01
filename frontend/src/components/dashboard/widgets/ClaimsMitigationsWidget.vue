<template>
  <div class="cm-widget">
    <div v-if="loading" class="card-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
    </div>

    <template v-else>
      <!-- ── Claims ─────────────────────────────────────── -->
      <div class="cm-section">
        <div class="cm-section-head">
          <span class="cm-section-title">Claims</span>
          <RouterLink to="/claims" class="cm-view-all">View all</RouterLink>
        </div>

        <div class="cm-stat-row">
          <div class="cm-stat">
            <div class="cm-stat-val">{{ data.claims.total }}</div>
            <div class="cm-stat-lbl">Total</div>
          </div>
          <div class="cm-stat">
            <div class="cm-stat-val muted">{{ data.claims.byStatus.draft }}</div>
            <div class="cm-stat-lbl">Draft</div>
          </div>
          <div class="cm-stat">
            <div class="cm-stat-val warning">{{ data.claims.byStatus.underReview }}</div>
            <div class="cm-stat-lbl">Under review</div>
          </div>
          <div class="cm-stat">
            <div class="cm-stat-val success">{{ data.claims.byStatus.accepted }}</div>
            <div class="cm-stat-lbl">Accepted</div>
          </div>
          <div class="cm-stat">
            <div class="cm-stat-val danger">{{ data.claims.byStatus.rejected }}</div>
            <div class="cm-stat-lbl">Rejected</div>
          </div>
          <div class="cm-stat">
            <div class="cm-stat-val danger">{{ data.claims.counterClaims }}</div>
            <div class="cm-stat-lbl">Counter</div>
          </div>
        </div>

        <div v-if="data.attention.claimsUnderReview.length > 0" class="cm-attention">
          <div class="cm-attention-label">
            <el-icon :size="12"><Warning /></el-icon>
            Awaiting review
          </div>
          <div
            v-for="c in data.attention.claimsUnderReview"
            :key="c.id"
            class="cm-row"
            @click="$router.push(`/claims/${c.id}`)"
          >
            <span class="cm-id">CLM-{{ String(c.displayId).padStart(4, '0') }}</span>
            <span class="cm-name">{{ c.name }}</span>
            <span v-if="c.claimType" class="cm-type">{{ c.claimType }}</span>
          </div>
        </div>
      </div>

      <div class="cm-divider"></div>

      <!-- ── Mitigations ───────────────────────────────── -->
      <div class="cm-section">
        <div class="cm-section-head">
          <span class="cm-section-title">Mitigations</span>
          <RouterLink to="/mitigations" class="cm-view-all">View all</RouterLink>
        </div>

        <div v-if="data.mitigations.total === 0" class="cm-empty">
          No mitigations yet. They appear here once counter-claims or gaps get remediation plans.
        </div>
        <template v-else>
          <!-- Resolution headline -->
          <div class="cm-progress-head">
            <span class="cm-progress-headline" title="Resolved means verified or closed; implemented mitigations still await verification">
              <span class="cm-progress-count">{{ resolvedMitigations }} of {{ data.mitigations.total }}</span>
              mitigations resolved
            </span>
            <span class="cm-progress-pct" :style="{ color: resolvedColor }">{{ resolvedPercent }}%</span>
          </div>

          <!-- Pipeline bar: proposed → in progress → implemented → verified → closed -->
          <div class="cm-pipeline-bar" role="img" :aria-label="pipelineSummary">
            <div
              v-for="seg in mitigationSegments"
              :key="seg.key"
              class="cm-pipeline-seg"
              :style="{ width: seg.pct + '%', background: seg.color }"
              :title="`${seg.label}: ${seg.count}`"
            />
          </div>

          <div class="cm-pipeline-legend">
            <span v-for="seg in mitigationSegments" :key="seg.key" class="cm-legend-item">
              <span class="cm-legend-dot" :style="{ background: seg.color }" />
              {{ seg.label }}
              <span class="cm-legend-count">{{ seg.count }}</span>
            </span>
          </div>

          <!-- Urgency of what's still open -->
          <div v-if="openPriorityItems.length > 0" class="cm-open-row">
            <span class="cm-open-lbl">Open by priority</span>
            <span
              v-for="p in openPriorityItems"
              :key="p.key"
              class="cm-badge"
              :class="`cm-badge--${p.key}`"
            >{{ p.count }} {{ p.label }}</span>
          </div>
        </template>

        <div v-if="data.attention.overdueMitigations.length > 0" class="cm-attention cm-attention--danger">
          <div class="cm-attention-label cm-attention-label--danger">
            <el-icon :size="12"><CircleClose /></el-icon>
            Overdue mitigations
          </div>
          <div
            v-for="m in data.attention.overdueMitigations"
            :key="m.id"
            class="cm-row"
            @click="$router.push(`/mitigations/${m.id}`)"
          >
            <span class="cm-id">MIT-{{ String(m.displayId).padStart(4, '0') }}</span>
            <span class="cm-name">{{ m.title }}</span>
            <span class="cm-badge" :class="`cm-badge--${m.priority.toLowerCase()}`">{{ m.priority }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Loading, Warning, CircleClose } from '@element-plus/icons-vue'
import client from '@/api/client'

const loading = ref(true)

interface ClaimMitData {
  claims: {
    total: number
    counterClaims: number
    byStatus: { draft: number; underReview: number; accepted: number; rejected: number }
  }
  mitigations: {
    total: number
    byStatus: { proposed: number; inProgress: number; implemented: number; verified: number; closed: number }
    openByPriority: { critical: number; high: number; medium: number; low: number }
  }
  attention: {
    claimsUnderReview: { id: string; displayId: number; name: string; status: string; claimType: string | null }[]
    overdueMitigations: { id: string; displayId: number; title: string; status: string; priority: string; targetDate: string }[]
  }
}

const data = ref<ClaimMitData>({
  claims: { total: 0, counterClaims: 0, byStatus: { draft: 0, underReview: 0, accepted: 0, rejected: 0 } },
  mitigations: {
    total: 0,
    byStatus: { proposed: 0, inProgress: 0, implemented: 0, verified: 0, closed: 0 },
    openByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
  },
  attention: { claimsUnderReview: [], overdueMitigations: [] },
})

// ── Mitigation pipeline ───────────────────────────────────────────
// Statuses form a remediation pipeline. "Resolved" means verified or
// closed — the same line the backend draws for overdue/open counts:
// an implemented mitigation still awaits verification, so it stays
// open (amber), and only verification turns the segment green.
const MIT_SEGMENTS = [
  { key: 'proposed',    label: 'Proposed',    color: '#2f81f7' },
  { key: 'inProgress',  label: 'In progress', color: '#a371f7' },
  { key: 'implemented', label: 'Implemented', color: '#d29922' },
  { key: 'verified',    label: 'Verified',    color: '#39d353' },
  { key: 'closed',      label: 'Closed',      color: '#8b949e' },
] as const

const mitigationSegments = computed(() => {
  const total = data.value.mitigations.total
  if (total === 0) return []
  return MIT_SEGMENTS
    .map(s => ({
      ...s,
      count: data.value.mitigations.byStatus[s.key],
      pct: (data.value.mitigations.byStatus[s.key] / total) * 100,
    }))
    .filter(s => s.count > 0)
})

const pipelineSummary = computed(() =>
  mitigationSegments.value.map(s => `${s.label}: ${s.count}`).join(', ')
)

const resolvedMitigations = computed(() => {
  const s = data.value.mitigations.byStatus
  return s.verified + s.closed
})

const resolvedPercent = computed(() =>
  data.value.mitigations.total > 0
    ? Math.round((resolvedMitigations.value / data.value.mitigations.total) * 100)
    : 0
)

const resolvedColor = computed(() => {
  if (resolvedPercent.value >= 67) return '#39d353'
  if (resolvedPercent.value >= 34) return '#d29922'
  return '#f85149'
})

const openPriorityItems = computed(() => {
  const p = data.value.mitigations.openByPriority
  return ([
    { key: 'critical', label: 'critical', count: p.critical },
    { key: 'high',     label: 'high',     count: p.high },
    { key: 'medium',   label: 'medium',   count: p.medium },
    { key: 'low',      label: 'low',      count: p.low },
  ]).filter(i => i.count > 0)
})

onMounted(async () => {
  try {
    const { data: res } = await client.get('/dashboard/claims-mitigations')
    data.value = {
      ...res,
      mitigations: {
        ...res.mitigations,
        openByPriority: res.mitigations?.openByPriority ?? { critical: 0, high: 0, medium: 0, low: 0 },
      },
    }
  } catch (e) {
    console.error('Failed to load claims/mitigations widget:', e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.cm-widget {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-4);
  width: 100%;
}

.card-loading {
  display: flex;
  justify-content: center;
  padding: var(--cat-spacing-8);

  .is-loading {
    color: var(--cat-accent-primary);
    animation: spin 1s linear infinite;
  }
}

.cm-section {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-3);
}

.cm-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cm-section-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cm-view-all {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-accent-primary);
  text-decoration: none;

  &:hover { text-decoration: underline; }
}

// Stat tiles
.cm-stat-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--cat-spacing-2);
}

.cm-stat {
  background: var(--cat-bg-input);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-md);
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  text-align: center;
}

.cm-stat-val {
  font-size: 20px;
  font-weight: var(--cat-font-weight-semibold);
  line-height: 1.2;
  color: var(--cat-text-primary);

  &.muted   { color: var(--cat-text-tertiary); }
  &.warning { color: #d29922; }
  &.success { color: #39d353; }
  &.danger  { color: #f85149; }
  &.accent  { color: var(--cat-accent-primary); }
  &.info    { color: #534AB7; }
}

.cm-stat-lbl {
  font-size: 10px;
  color: var(--cat-text-tertiary);
  margin-top: 2px;
  white-space: nowrap;
}

.cm-divider {
  height: 1px;
  background: var(--cat-border-default);
}

.cm-empty {
  padding: var(--cat-spacing-3);
  text-align: center;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-tertiary);
}

// Mitigation pipeline
.cm-progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.cm-progress-headline {
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
}

.cm-progress-count {
  font-size: var(--cat-font-size-lg);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.cm-progress-pct {
  font-size: var(--cat-font-size-lg);
  font-weight: var(--cat-font-weight-semibold);
}

.cm-pipeline-bar {
  display: flex;
  gap: 2px;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
}

.cm-pipeline-seg {
  min-width: 4px;
  transition: width var(--cat-transition-fast);
}

.cm-pipeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cat-spacing-2) var(--cat-spacing-4);
}

.cm-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--cat-text-tertiary);
}

.cm-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.cm-legend-count {
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.cm-open-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--cat-spacing-2);
}

.cm-open-lbl {
  font-size: 11px;
  color: var(--cat-text-tertiary);
  margin-right: var(--cat-spacing-1);
}

// Attention panels
.cm-attention {
  border: 1px solid var(--cat-border-warning, #d29922);
  border-radius: var(--cat-radius-md);
  overflow: hidden;

  &--danger {
    border-color: var(--cat-border-danger, #f85149);
  }
}

.cm-attention-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  font-size: 11px;
  font-weight: var(--cat-font-weight-semibold);
  background: rgba(210, 153, 34, 0.08);
  color: #d29922;

  &--danger {
    background: rgba(248, 81, 73, 0.08);
    color: #f85149;
  }
}

.cm-row {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-2) var(--cat-spacing-3);
  border-top: 1px solid var(--cat-border-default);
  cursor: pointer;
  transition: background-color var(--cat-transition-fast);

  &:hover { background: var(--cat-bg-hover); }
}

.cm-id {
  font-family: var(--cat-font-mono);
  font-size: 11px;
  color: var(--cat-text-tertiary);
  min-width: 72px;
  flex-shrink: 0;
}

.cm-name {
  flex: 1;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cm-type {
  font-size: 11px;
  color: var(--cat-text-tertiary);
  flex-shrink: 0;
}

.cm-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: var(--cat-font-weight-semibold);
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;

  &--critical, &--high { background: rgba(248, 81, 73, 0.15); color: #f85149; }
  &--medium             { background: rgba(210, 153, 34, 0.15); color: #d29922; }
  &--low                { background: rgba(139, 148, 158, 0.15); color: #8b949e; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
