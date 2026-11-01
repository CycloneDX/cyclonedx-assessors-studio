<template>
  <div class="activity-content">
    <p class="tab-intro">What needs your action, and what's happened recently.</p>

    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>Loading activity data…</p>
    </div>

    <template v-else>
      <!-- ── Needs attention ─────────────────────────────────────── -->
      <div class="stat-section">
        <div class="stat-section-head">
          <span class="stat-section-label">Needs attention</span>
        </div>
        <div class="panels-grid">
          <!-- Claims awaiting review -->
          <el-card class="panel-card">
            <template #header>
              <div class="panel-head">
                <span class="panel-title">
                  <el-icon :size="14" style="vertical-align: -2px; margin-right: 4px"><Warning /></el-icon>
                  Claims awaiting review
                </span>
                <el-badge v-if="d.attention.claimsUnderReview.length" :value="d.attention.claimsUnderReview.length" type="warning" />
              </div>
            </template>
            <div v-if="d.attention.claimsUnderReview.length === 0" class="panel-empty">
              No claims pending review.
            </div>
            <div v-else>
              <div
                v-for="c in d.attention.claimsUnderReview"
                :key="c.id"
                class="panel-row"
                @click="$router.push(`/claims/${c.id}`)"
              >
                <span class="mono-id">CLM-{{ String(c.displayId).padStart(4, '0') }}</span>
                <span class="panel-name">{{ c.name }}</span>
                <span class="panel-meta">{{ c.claimType ?? '—' }}</span>
              </div>
            </div>
          </el-card>

          <!-- Evidence awaiting review -->
          <el-card class="panel-card">
            <template #header>
              <div class="panel-head">
                <span class="panel-title">
                  <el-icon :size="14" style="vertical-align: -2px; margin-right: 4px"><Warning /></el-icon>
                  Evidence awaiting review
                </span>
                <el-badge v-if="d.attention.evidenceUnderReview.length" :value="d.attention.evidenceUnderReview.length" type="warning" />
              </div>
            </template>
            <div v-if="d.attention.evidenceUnderReview.length === 0" class="panel-empty">
              No evidence pending review.
            </div>
            <div v-else>
              <div
                v-for="e in d.attention.evidenceUnderReview"
                :key="e.id"
                class="panel-row"
                @click="$router.push(`/evidence/${e.id}`)"
              >
                <span class="mono-id">EVD-{{ String(e.displayId).padStart(4, '0') }}</span>
                <span class="panel-name">{{ e.name }}</span>
              </div>
            </div>
          </el-card>

          <!-- Counter-claims flagged -->
          <el-card class="panel-card">
            <template #header>
              <div class="panel-head">
                <span class="panel-title">
                  <el-icon :size="14" style="vertical-align: -2px; margin-right: 4px"><Minus /></el-icon>
                  Counter-claims flagged
                </span>
                <el-badge v-if="d.attention.counterClaims.length" :value="d.attention.counterClaims.length" type="danger" />
              </div>
            </template>
            <div v-if="d.attention.counterClaims.length === 0" class="panel-empty">
              No active counter-claims.
            </div>
            <div
              v-for="c in d.attention.counterClaims"
              :key="c.id"
              class="panel-row"
              @click="$router.push(`/claims/${c.id}`)"
            >
              <span class="mono-id">CLM-{{ String(c.displayId).padStart(4, '0') }}</span>
              <span class="panel-name">{{ c.name }}</span>
              <span class="counter-pill">Counter</span>
            </div>
          </el-card>

          <!-- Overdue mitigations -->
          <el-card class="panel-card">
            <template #header>
              <div class="panel-head">
                <span class="panel-title">
                  <el-icon :size="14" style="vertical-align: -2px; margin-right: 4px"><Warning /></el-icon>
                  Overdue mitigations
                </span>
                <el-badge v-if="d.attention.overdueMitigations.length" :value="d.attention.overdueMitigations.length" type="danger" />
              </div>
            </template>
            <div v-if="d.attention.overdueMitigations.length === 0" class="panel-empty">
              No mitigations past their target date.
            </div>
            <div
              v-for="m in d.attention.overdueMitigations"
              :key="m.id"
              class="panel-row"
              @click="$router.push(`/mitigations/${m.id}`)"
            >
              <span class="mono-id">MIT-{{ String(m.displayId).padStart(4, '0') }}</span>
              <span class="panel-name">{{ m.title }}</span>
              <span v-if="m.priority" class="priority-badge" :class="`priority-badge--${m.priority}`">{{ m.priority }}</span>
            </div>
          </el-card>
        </div>
      </div>

      <!-- ── Recent activity feed ────────────────────────────────── -->
      <div class="stat-section">
        <div class="stat-section-head">
          <span class="stat-section-label">Recent activity</span>
        </div>
        <div class="feed-container">
          <div v-if="feedLoading" class="panel-empty">Loading…</div>
          <div v-else-if="feed.length === 0" class="panel-empty">
            No recent activity yet. Changes to projects, assessments, claims, evidence and mitigations will show up here.
          </div>
          <div
            v-for="item in feed"
            :key="item.id"
            class="feed-row"
            :class="{ clickable: isRoutable(item) }"
            @click="openFeedItem(item)"
          >
            <span class="action-pill" :class="`action-pill--${item.action}`">{{ actionLabel(item.action) }}</span>
            <span class="feed-text">
              <span class="feed-user">{{ item.userName ?? 'System' }}</span>
              {{ actionVerb(item.action) }} {{ entityTypeLabel(item.entityType) }}
              <span class="feed-entity">{{ item.entityName ?? shortId(item.entityId) }}</span>
            </span>
            <span class="feed-time">{{ timeAgo(item.createdAt) }}</span>
          </div>
        </div>
      </div>

      <!-- ── Registry snapshot ───────────────────────────────────── -->
      <div class="stat-section">
        <div class="stat-section-head">
          <span class="stat-section-label">Registry snapshot</span>
        </div>
        <div class="snapshot-grid">
          <div class="snapshot-card">
            <div class="snapshot-head">
              <span class="snapshot-title">Claims</span>
              <RouterLink to="/claims" class="view-all-link">View registry</RouterLink>
            </div>
            <div class="snapshot-row"><span>Total</span><span class="snapshot-val">{{ d.claims.total }}</span></div>
            <div class="snapshot-row"><span>Draft</span><span class="snapshot-val muted">{{ d.claims.byStatus.draft }}</span></div>
            <div class="snapshot-row"><span>Under review</span><span class="snapshot-val warning">{{ d.claims.byStatus.underReview }}</span></div>
            <div class="snapshot-row"><span>Accepted</span><span class="snapshot-val success">{{ d.claims.byStatus.accepted }}</span></div>
            <div class="snapshot-row"><span>Rejected</span><span class="snapshot-val danger">{{ d.claims.byStatus.rejected }}</span></div>
            <div class="snapshot-row"><span>Counter-claims</span><span class="snapshot-val danger">{{ d.claims.counterClaims }}</span></div>
          </div>

          <div class="snapshot-card">
            <div class="snapshot-head">
              <span class="snapshot-title">Mitigations</span>
              <RouterLink to="/mitigations" class="view-all-link">View registry</RouterLink>
            </div>
            <div class="snapshot-row"><span>Total</span><span class="snapshot-val">{{ d.mitigations.total }}</span></div>
            <div class="snapshot-row"><span>Proposed</span><span class="snapshot-val accent">{{ d.mitigations.byStatus.proposed }}</span></div>
            <div class="snapshot-row"><span>In progress</span><span class="snapshot-val info">{{ d.mitigations.byStatus.inProgress }}</span></div>
            <div class="snapshot-row"><span>Implemented</span><span class="snapshot-val success">{{ d.mitigations.byStatus.implemented }}</span></div>
            <div class="snapshot-row"><span>Verified</span><span class="snapshot-val success">{{ d.mitigations.byStatus.verified }}</span></div>
            <div class="snapshot-row"><span>Closed</span><span class="snapshot-val muted">{{ d.mitigations.byStatus.closed }}</span></div>
          </div>

          <div class="snapshot-card">
            <div class="snapshot-head">
              <span class="snapshot-title">Evidence</span>
              <RouterLink to="/evidence" class="view-all-link">View registry</RouterLink>
            </div>
            <div class="snapshot-row"><span>In review</span><span class="snapshot-val warning">{{ d.evidence.inReview }}</span></div>
            <div class="snapshot-row"><span>In progress</span><span class="snapshot-val info">{{ d.evidence.inProgress }}</span></div>
            <div class="snapshot-row"><span>Claimed</span><span class="snapshot-val success">{{ d.evidence.claimed }}</span></div>
            <div class="snapshot-row"><span>Expired</span><span class="snapshot-val danger">{{ d.evidence.expired }}</span></div>
          </div>

          <div class="snapshot-card">
            <div class="snapshot-head">
              <span class="snapshot-title">Requirement linkage</span>
            </div>
            <div class="snapshot-row"><span>Attestations</span><span class="snapshot-val">{{ d.requirements.attestations }}</span></div>
            <div class="snapshot-row"><span>Attested</span><span class="snapshot-val accent">{{ d.requirements.attested }}</span></div>
            <div class="snapshot-row"><span>Claimed</span><span class="snapshot-val success">{{ d.requirements.claimed }}</span></div>
            <div class="snapshot-row"><span>Mitigated</span><span class="snapshot-val info">{{ d.requirements.mitigated }}</span></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Loading, Warning, Minus } from '@element-plus/icons-vue'
import client from '@/api/client'

const router = useRouter()
const loading = ref(true)
const feedLoading = ref(true)

interface AttentionItem { id: string; displayId: number; name: string; status: string; claimType: string | null }
interface EvidenceAttentionItem { id: string; displayId: number; name: string; state: string }
interface OverdueMitigationItem { id: string; displayId: number; title: string; status: string; priority: string | null; targetDate: string | null }

interface CMData {
  claims: { total: number; counterClaims: number; byStatus: { draft: number; underReview: number; accepted: number; rejected: number } }
  mitigations: { total: number; byStatus: { proposed: number; inProgress: number; implemented: number; verified: number; closed: number } }
  evidence: { inReview: number; inProgress: number; claimed: number; expired: number }
  requirements: { attestations: number; attested: number; claimed: number; mitigated: number }
  attention: {
    claimsUnderReview: AttentionItem[]
    evidenceUnderReview: EvidenceAttentionItem[]
    counterClaims: AttentionItem[]
    overdueMitigations: OverdueMitigationItem[]
  }
}

const d = ref<CMData>({
  claims: { total: 0, counterClaims: 0, byStatus: { draft: 0, underReview: 0, accepted: 0, rejected: 0 } },
  mitigations: { total: 0, byStatus: { proposed: 0, inProgress: 0, implemented: 0, verified: 0, closed: 0 } },
  evidence: { inReview: 0, inProgress: 0, claimed: 0, expired: 0 },
  requirements: { attestations: 0, attested: 0, claimed: 0, mitigated: 0 },
  attention: { claimsUnderReview: [], evidenceUnderReview: [], counterClaims: [], overdueMitigations: [] },
})

// ── Activity feed ─────────────────────────────────────────────────
interface FeedItem {
  id: string
  entityType: string
  entityId: string
  action: string
  userName: string | null
  entityName: string | null
  createdAt: string
}
const feed = ref<FeedItem[]>([])

// Entity types that have a detail view to link to. Attestations only
// have a registry view, so feed rows for them stay non-clickable.
const DETAIL_ROUTES: Record<string, string> = {
  project: '/projects',
  assessment: '/assessments',
  claim: '/claims',
  evidence: '/evidence',
  mitigation: '/mitigations',
  standard: '/standards',
  entity: '/entities',
}

function isRoutable(item: FeedItem) {
  return item.action !== 'delete' && item.entityType in DETAIL_ROUTES
}

function openFeedItem(item: FeedItem) {
  if (!isRoutable(item)) return
  router.push(`${DETAIL_ROUTES[item.entityType]}/${item.entityId}`)
}

function actionLabel(action: string) {
  const m: Record<string, string> = {
    create: 'Created', create_for_other: 'Created', update: 'Updated', delete: 'Deleted',
    state_change: 'Status', link: 'Linked', unlink: 'Unlinked',
  }
  return m[action] || action
}

function actionVerb(action: string) {
  const m: Record<string, string> = {
    create: 'created', create_for_other: 'created', update: 'updated', delete: 'deleted',
    state_change: 'changed the status of', link: 'linked', unlink: 'unlinked',
  }
  return m[action] || action
}

function entityTypeLabel(entityType: string) {
  const m: Record<string, string> = {
    project: 'project', assessment: 'assessment', claim: 'claim', evidence: 'evidence',
    mitigation: 'mitigation', attestation: 'attestation', standard: 'standard', entity: 'entity',
  }
  return m[entityType] || entityType
}

function shortId(id: string) {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function timeAgo(iso: string) {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Lifecycle ─────────────────────────────────────────────────────
onMounted(() => {
  loadStats()
  loadFeed()
})

async function loadStats() {
  try {
    const { data } = await client.get('/dashboard/claims-mitigations')
    d.value = {
      ...data,
      attention: {
        claimsUnderReview: data.attention?.claimsUnderReview ?? [],
        evidenceUnderReview: data.attention?.evidenceUnderReview ?? [],
        counterClaims: data.attention?.counterClaims ?? [],
        overdueMitigations: data.attention?.overdueMitigations ?? [],
      },
    }
  } catch (e) {
    console.error('Failed to load activity data:', e)
  } finally {
    loading.value = false
  }
}

async function loadFeed() {
  try {
    const { data } = await client.get('/dashboard/recent-activity')
    feed.value = data.data || []
  } catch (e) {
    console.error('Failed to load recent activity:', e)
  } finally {
    feedLoading.value = false
  }
}
</script>

<style scoped lang="scss">
@use '@/assets/styles/tokens' as *;

.activity-content {
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-6);
}

.tab-intro {
  margin: 0;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-tertiary);
}

.loading-container {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--cat-spacing-3); padding: var(--cat-spacing-12);
  background: var(--cat-bg-surface); border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  .is-loading { color: var(--cat-accent-primary); animation: spin 1s linear infinite; }
  p { margin: 0; color: var(--cat-text-secondary); }
}

// ── Sections ─────────────────────────────────────────────────
.stat-section { display: flex; flex-direction: column; gap: var(--cat-spacing-3); }

.stat-section-head {
  display: flex; align-items: center; justify-content: space-between;
}

.stat-section-label {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.view-all-link {
  font-size: var(--cat-font-size-xs);
  color: var(--cat-accent-primary);
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

// ── Attention panels ─────────────────────────────────────────
.panels-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--cat-spacing-4);

  @media (max-width: 900px) { grid-template-columns: 1fr; }
}

.panel-card {
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
  display: flex;
  align-items: center;
}

.panel-empty {
  padding: var(--cat-spacing-4);
  text-align: center;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-font-size-sm);
}

.panel-row {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-2) var(--cat-spacing-4);
  border-top: 1px solid var(--cat-border-default);
  cursor: pointer;
  transition: background-color var(--cat-transition-fast);
  &:first-child { border-top: none; }
  &:hover { background: var(--cat-bg-hover); }
}

.mono-id {
  font-family: var(--cat-font-mono);
  font-size: 11px;
  color: var(--cat-text-tertiary);
  min-width: 72px;
  flex-shrink: 0;
}

.panel-name {
  flex: 1;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-meta {
  font-size: 11px;
  color: var(--cat-text-tertiary);
  min-width: 90px;
  flex-shrink: 0;
}

.priority-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: var(--cat-font-weight-semibold);
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;

  &--critical, &--high { background: rgba(248,81,73,0.15); color: #f85149; }
  &--medium             { background: rgba(210,153,34,0.15); color: #d29922; }
  &--low                { background: rgba(139,148,158,0.15); color: #8b949e; }
}

.counter-pill {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: var(--cat-font-weight-semibold);
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(248,81,73,0.12);
  color: #f85149;
}

// ── Activity feed ────────────────────────────────────────────
.feed-container {
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  overflow: hidden;
}

.feed-row {
  display: flex;
  align-items: center;
  gap: var(--cat-spacing-3);
  padding: var(--cat-spacing-2) var(--cat-spacing-4);
  border-top: 1px solid var(--cat-border-default);
  &:first-child { border-top: none; }

  &.clickable {
    cursor: pointer;
    transition: background-color var(--cat-transition-fast);
    &:hover { background: var(--cat-bg-hover); }
  }
}

.action-pill {
  flex-shrink: 0;
  min-width: 62px;
  text-align: center;
  font-size: 10px;
  font-weight: var(--cat-font-weight-semibold);
  padding: 2px 8px;
  border-radius: 4px;

  &--create, &--create_for_other { background: rgba(57,211,83,0.15); color: #39d353; }
  &--update                      { background: rgba(47,129,247,0.15); color: #2f81f7; }
  &--delete                      { background: rgba(248,81,73,0.15); color: #f85149; }
  &--state_change                { background: rgba(210,153,34,0.15); color: #d29922; }
  &--link, &--unlink             { background: rgba(139,148,158,0.15); color: #8b949e; }
}

.feed-text {
  flex: 1;
  font-size: var(--cat-font-size-sm);
  color: var(--cat-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-user {
  color: var(--cat-text-primary);
  font-weight: var(--cat-font-weight-medium);
}

.feed-entity {
  color: var(--cat-text-primary);
  font-weight: var(--cat-font-weight-medium);
}

.feed-time {
  flex-shrink: 0;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-tertiary);
  white-space: nowrap;
}

// ── Registry snapshot ────────────────────────────────────────
.snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--cat-spacing-4);
}

.snapshot-card {
  background: var(--cat-bg-surface);
  border: 1px solid var(--cat-border-default);
  border-radius: var(--cat-radius-lg);
  padding: var(--cat-spacing-3) var(--cat-spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--cat-spacing-1);
}

.snapshot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--cat-spacing-2);
  margin-bottom: var(--cat-spacing-1);
  border-bottom: 1px solid var(--cat-border-default);
}

.snapshot-title {
  font-size: var(--cat-font-size-sm);
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);
}

.snapshot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--cat-font-size-xs);
  color: var(--cat-text-secondary);
}

.snapshot-val {
  font-weight: var(--cat-font-weight-semibold);
  color: var(--cat-text-primary);

  &.muted   { color: var(--cat-text-tertiary); }
  &.warning { color: #d29922; }
  &.success { color: #39d353; }
  &.danger  { color: #f85149; }
  &.accent  { color: var(--cat-accent-primary); }
  &.info    { color: #534AB7; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
