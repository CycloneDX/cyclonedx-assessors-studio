<template>
  <div class="world-map-wrap">
    <div v-if="hasGeoData" class="world-map-container">
      <svg class="world-map-svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet">
        <defs>
          <!-- Glow filter for country borders -->
          <filter id="wm-border-glow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
          </filter>
          <!-- Stronger glow for active-country borders -->
          <filter id="wm-border-glow-active" x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
          </filter>
          <!-- Marker glow -->
          <filter id="wm-marker-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          </filter>
          <!-- Radial gradient for sphere -->
          <radialGradient id="wm-sphere-grad" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#0f1932" />
            <stop offset="100%" stop-color="#040810" />
          </radialGradient>
        </defs>

        <!-- Sphere background -->
        <path :d="spherePath" fill="url(#wm-sphere-grad)" />

        <!-- Graticule (very subtle) -->
        <path :d="graticulePath" class="wm-graticule" />

        <!-- === Glow layer (blurred thick borders rendered under fill layer) === -->
        <g filter="url(#wm-border-glow)">
          <path
            v-for="(c, i) in countryData"
            :key="`g-${i}`"
            :d="c.d"
            :class="c.active ? 'wm-country-glow--active' : 'wm-country-glow'"
          />
        </g>

        <!-- === Fill + crisp border layer === -->
        <path
          v-for="(c, i) in countryData"
          :key="`f-${i}`"
          :d="c.d"
          :class="c.active ? 'wm-country--active' : 'wm-country'"
        />

        <!-- Relationship lines -->
        <line
          v-for="(line, i) in relLines"
          :key="`line-${i}`"
          :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2"
          class="wm-rel-line"
        />

        <!-- Marker glow halo (blurred, under the crisp marker) -->
        <g filter="url(#wm-marker-glow)">
          <circle
            v-for="(m, i) in markers.filter(m => !m.dim)"
            :key="`mg-${i}`"
            :cx="m.x" :cy="m.y" :r="m.active ? 6 : 4"
            :style="{ fill: TYPE_COLORS[m.type] }"
            class="wm-marker-halo"
          />
        </g>

        <!-- Entity markers (crisp top layer) -->
        <g v-for="(m, i) in markers" :key="`m-${i}`">
          <circle
            :cx="m.x" :cy="m.y" :r="m.active ? 5 : 3.5"
            class="wm-marker"
            :class="[`wm-marker--${m.type}`, { 'wm-marker--dim': m.dim }]"
          />
          <title>{{ m.label }}</title>
        </g>
      </svg>

      <!-- Legend -->
      <div class="wm-legend">
        <span v-for="item in activeLegend" :key="item.type" class="wm-legend-item">
          <span class="wm-legend-dot" :style="{ background: TYPE_COLORS[item.type] }" />
          {{ item.label }}
        </span>
      </div>
    </div>
    <div v-else class="world-map-empty">
      <el-icon :size="28"><Location /></el-icon>
      <span>No geo data yet — edit entities to add country or city locations</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'
import * as topojson from 'topojson-client'
import { Location } from '@element-plus/icons-vue'
import type { Topology, GeometryCollection } from 'topojson-specification'
import worldData from '@/assets/world-110m.json'
import type { Entity } from '@/types'

interface GraphEdge {
  sourceEntityId: string
  targetEntityId: string
  relationshipType: string
}

const props = defineProps<{
  entities: Entity[]
  graphEdges: GraphEdge[]
  activeType: string
}>()

const W = 960
const H = 500

const TYPE_COLORS: Record<string, string> = {
  organization:    '#6366f1',
  business_unit:   '#0ea5e9',
  team:            '#10b981',
  product:         '#f59e0b',
  product_version: '#f97316',
  component:       '#8b5cf6',
  service:         '#ec4899',
  project:         '#64748b',
}

const TYPE_LABELS: Record<string, string> = {
  organization: 'Organization', business_unit: 'Business Unit', team: 'Team',
  product: 'Product', product_version: 'Version', component: 'Component',
  service: 'Service', project: 'Project',
}

// ── Coordinate lookup ─────────────────────────────────────────────────────────
const CITY_COORDS: Record<string, [number, number]> = {
  'san francisco': [37.77, -122.41], 'los angeles': [34.05, -118.24],
  'new york': [40.71, -74.00], 'chicago': [41.87, -87.62],
  'seattle': [47.60, -122.33], 'boston': [42.36, -71.05],
  'austin': [30.26, -97.74], 'denver': [39.73, -104.98],
  'miami': [25.77, -80.19], 'washington': [38.89, -77.03],
  'london': [51.50, -0.12], 'paris': [48.85, 2.35],
  'berlin': [52.52, 13.40], 'amsterdam': [52.37, 4.89],
  'madrid': [40.41, -3.70], 'rome': [41.89, 12.48],
  'zurich': [47.37, 8.54], 'stockholm': [59.33, 18.06],
  'oslo': [59.91, 10.75], 'copenhagen': [55.67, 12.56],
  'frankfurt': [50.11, 8.68], 'munich': [48.13, 11.58],
  'tokyo': [35.68, 139.69], 'osaka': [34.69, 135.50],
  'beijing': [39.90, 116.40], 'shanghai': [31.22, 121.47],
  'singapore': [1.35, 103.82], 'hong kong': [22.31, 114.16],
  'sydney': [-33.86, 151.20], 'melbourne': [-37.81, 144.96],
  'toronto': [43.65, -79.38], 'vancouver': [49.28, -123.12],
  'montreal': [45.50, -73.56], 'sao paulo': [-23.54, -46.63],
  'buenos aires': [-34.60, -58.38], 'mexico city': [19.42, -99.13],
  'dubai': [25.20, 55.27], 'mumbai': [19.07, 72.87],
  'bangalore': [12.97, 77.59], 'delhi': [28.61, 77.20],
  'cairo': [30.04, 31.23], 'nairobi': [-1.28, 36.81],
  'johannesburg': [-26.20, 28.04], 'istanbul': [41.01, 28.94],
  'seoul': [37.56, 126.97], 'taipei': [25.04, 121.56],
  'kuala lumpur': [3.14, 101.68], 'jakarta': [-6.20, 106.81],
  'bangkok': [13.75, 100.52],
}

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'united states': [37.09, -95.71], 'usa': [37.09, -95.71], 'us': [37.09, -95.71],
  'united kingdom': [55.37, -3.43], 'uk': [55.37, -3.43], 'great britain': [55.37, -3.43],
  'germany': [51.16, 10.45], 'france': [46.22, 2.21], 'italy': [41.87, 12.56],
  'spain': [40.46, -3.74], 'netherlands': [52.13, 5.29], 'belgium': [50.50, 4.46],
  'switzerland': [46.81, 8.22], 'austria': [47.51, 14.55], 'sweden': [60.12, 18.64],
  'norway': [60.47, 8.46], 'denmark': [56.26, 9.50], 'finland': [61.92, 25.74],
  'poland': [51.91, 19.14], 'czechia': [49.81, 15.47], 'hungary': [47.16, 19.50],
  'portugal': [39.39, -8.22], 'greece': [39.07, 21.82], 'ireland': [53.41, -8.24],
  'russia': [61.52, 105.31], 'ukraine': [48.37, 31.16], 'turkey': [38.96, 35.24],
  'china': [35.86, 104.19], 'japan': [36.20, 138.25], 'south korea': [35.90, 127.76],
  'india': [20.59, 78.96], 'australia': [-25.27, 133.77], 'new zealand': [-40.90, 174.88],
  'canada': [56.13, -106.34], 'mexico': [23.63, -102.55], 'brazil': [-14.23, -51.92],
  'argentina': [-38.41, -63.61], 'chile': [-35.67, -71.54], 'colombia': [4.57, -74.29],
  'peru': [-9.18, -75.01], 'south africa': [-28.47, 24.67], 'nigeria': [9.08, 8.67],
  'kenya': [-0.02, 37.90], 'egypt': [26.82, 30.80], 'singapore': [1.35, 103.82],
  'malaysia': [4.21, 101.97], 'indonesia': [-0.78, 113.92], 'thailand': [15.87, 100.99],
  'pakistan': [30.37, 69.34], 'israel': [31.04, 34.85], 'saudi arabia': [23.88, 45.07],
  'uae': [23.42, 53.84], 'united arab emirates': [23.42, 53.84],
}

function getCoords(entity: Entity): [number, number] | null {
  const loc = (entity.locality || '').toLowerCase().trim()
  const country = (entity.country || '').toLowerCase().trim()
  if (loc && CITY_COORDS[loc]) return CITY_COORDS[loc]
  if (country && COUNTRY_COORDS[country]) return COUNTRY_COORDS[country]
  return null
}

// ── D3 projection ─────────────────────────────────────────────────────────────
const projection = d3.geoNaturalEarth1()
  .scale(153)
  .translate([W / 2, H / 2])

const pathGen = d3.geoPath(projection)

const spherePath = computed(() => pathGen({ type: 'Sphere' }) || '')
const graticulePath = computed(() => pathGen(d3.geoGraticule10()) || '')

// ── Entity coordinate map ─────────────────────────────────────────────────────
const markerMap = computed<Map<string, { x: number; y: number; type: string; label: string; dim: boolean; active: boolean }>>(() => {
  const m = new Map()
  for (const e of props.entities) {
    const coords = getCoords(e)
    if (!coords) continue
    const proj = projection([coords[1], coords[0]])
    if (!proj) continue
    m.set(e.id, {
      x: proj[0], y: proj[1],
      type: e.entityType,
      label: `${e.name}${e.locality ? ` · ${e.locality}` : ''}${e.country ? `, ${e.country}` : ''}`,
      dim: !!props.activeType && e.entityType !== props.activeType,
      active: !props.activeType || e.entityType === props.activeType,
    })
  }
  return m
})

const markers = computed(() => Array.from(markerMap.value.values()))

// ── Active country detection ──────────────────────────────────────────────────
// Build a Set of projected pixel positions for entities that have markers,
// then use a rough bounding-box check to tag countries as "active".
// We do a point-in-path check via the path generator's measure.
const activeProjectedPoints = computed(() =>
  Array.from(markerMap.value.values())
    .filter(m => !m.dim)
    .map(m => [m.x, m.y] as [number, number])
)

// ── Country paths with active flag ───────────────────────────────────────────
const countryData = computed(() => {
  const topo = worldData as unknown as Topology
  const land = topojson.feature(topo, topo.objects.countries as GeometryCollection)
  const features = (land as GeoJSON.FeatureCollection).features

  return features.map(f => {
    const d = pathGen(f) || ''
    // Check if any active entity marker falls within this country's path bounds
    const bounds = pathGen.bounds(f)
    const active = activeProjectedPoints.value.some(([px, py]) =>
      px >= bounds[0][0] - 4 && px <= bounds[1][0] + 4 &&
      py >= bounds[0][1] - 4 && py <= bounds[1][1] + 4
    )
    return { d, active }
  })
})

// ── Relationship lines ────────────────────────────────────────────────────────
const relLines = computed(() => {
  if (!props.activeType) return []
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (const edge of props.graphEdges) {
    const src = markerMap.value.get(edge.sourceEntityId)
    const tgt = markerMap.value.get(edge.targetEntityId)
    if (!src || !tgt) continue
    if (src.type !== props.activeType && tgt.type !== props.activeType) continue
    lines.push({ x1: src.x, y1: src.y, x2: tgt.x, y2: tgt.y })
  }
  return lines
})

// ── Legend ────────────────────────────────────────────────────────────────────
const hasGeoData = computed(() => markers.value.length > 0)

const activeLegend = computed(() => {
  const types = new Set(markers.value.filter(m => !m.dim).map(m => m.type))
  return Array.from(types).map(t => ({ type: t, label: TYPE_LABELS[t] || t }))
})

</script>

<style scoped lang="scss">
.world-map-wrap {
  margin-bottom: var(--cat-spacing-4);
}

.world-map-container {
  background: #040810;
  border: 1px solid #1a2540;
  border-radius: var(--cat-radius-md);
  overflow: hidden;
  position: relative;
}

.world-map-svg {
  width: 100%;
  height: 240px;
  display: block;
}

// ── Graticule ─────────────────────────────────────────────────────────────────
.wm-graticule {
  fill: none;
  stroke: #0d1628;
  stroke-width: 0.3;
}

// ── Country glow layer (rendered under fills, blurred via parent filter) ───────
.wm-country-glow {
  fill: none;
  stroke: #92400e;   // amber-800 — dim glow for inactive countries
  stroke-width: 2.5;
  stroke-linejoin: round;
}

.wm-country-glow--active {
  fill: none;
  stroke: #f59e0b;   // amber-400 — bright glow for countries with entities
  stroke-width: 3.5;
  stroke-linejoin: round;
}

// ── Country fill + crisp border layer ────────────────────────────────────────
.wm-country {
  fill: #0d1627;
  stroke: #7c2d12;   // dim amber-900 border
  stroke-width: 0.6;
  stroke-linejoin: round;
}

.wm-country--active {
  fill: #162036;     // slightly brighter fill for countries with entities
  stroke: #d97706;   // amber-600 crisp border
  stroke-width: 0.8;
  stroke-linejoin: round;
}

// ── Relationship lines ────────────────────────────────────────────────────────
.wm-rel-line {
  stroke: rgba(251, 191, 36, 0.5);
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
  animation: dash-flow 1.2s linear infinite;
}

@keyframes dash-flow {
  to { stroke-dashoffset: -7; }
}

// ── Marker halo (glow under the dot) ─────────────────────────────────────────
.wm-marker-halo {
  opacity: 0.55;
}

// ── Marker dots ───────────────────────────────────────────────────────────────
.wm-marker {
  stroke: #040810;
  stroke-width: 1;
  opacity: 1;
  transition: r 0.2s, opacity 0.2s;

  &--dim {
    opacity: 0.15;
  }

  &--organization    { fill: #6366f1; }
  &--business_unit   { fill: #0ea5e9; }
  &--team            { fill: #10b981; }
  &--product         { fill: #f59e0b; }
  &--product_version { fill: #f97316; }
  &--component       { fill: #8b5cf6; }
  &--service         { fill: #ec4899; }
  &--project         { fill: #64748b; }
}

// ── Legend ────────────────────────────────────────────────────────────────────
.wm-legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  padding: 6px 14px 8px;
  border-top: 1px solid #1a2540;
  background: #06090f;
}

.wm-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  color: #94a3b8;
}

.wm-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

// ── Empty state ───────────────────────────────────────────────────────────────
.world-map-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px;
  background: #040810;
  border: 1px solid #1a2540;
  border-radius: var(--cat-radius-md);
  color: #64748b;
  font-size: 0.85rem;
  margin-bottom: var(--cat-spacing-4);

  .el-icon { opacity: 0.4; flex-shrink: 0; }
}
</style>
