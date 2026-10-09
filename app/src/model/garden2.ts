import type { LiveAsset } from '../lib/coins'
import { CANVAS, DRAW_ORDER, HIT, HIT_CELL, OVERLAYS, PLANTS, type Plant2 } from '../garden2/layout'
export type { Plant2 } from '../garden2/layout'

/**
 * Garden2, the painted garden (R508G: composed in the app from the approved mockup v8, R498G). Pure math only: the stage each coin's
 * plant shows and the layers that draw it, in canvas px (1328 x 896, layout.ts). Garden2.tsx scales the plan; scripts/garden2/
 * preview.ts composites the same plan offline. No React, no requires, so vitest and Node read it as is.
 */

/** Each live coin's plant (layout.json's coins: SKR mandarin, stORE store, hSOL pothos, USDC lending azalea, SOL lending maple, cbBTC orchid). */
export const PLANT_OF_ASSET: Record<LiveAsset, Plant2> = {
  SKR: 'mandarin',
  stORE: 'store',
  hSOL: 'pothos',
  USDC_LEND: 'azalea',
  SOL_LEND: 'maple',
  cbBTC: 'orchid',
}
export const ASSET_OF_PLANT: Record<Plant2, LiveAsset> = {
  mandarin: 'SKR',
  store: 'stORE',
  pothos: 'hSOL',
  azalea: 'USDC_LEND',
  maple: 'SOL_LEND',
  orchid: 'cbBTC',
}

/** The two trees start at stage 1 (R486G: no seed stage); before a coin's first planting a tree shows nothing. */
export const isTree = (p: Plant2): boolean => PLANTS[p].first > 0

/** R484G/R485G, approved: the stage ladder in dollars ($0.01 .. $5 over stages 1-7, $5 .. $30 over 8-14). */
export const LADDER = [0.01, 0.5, 1, 1.75, 2.5, 3.5, 5, 6.45, 8.3, 10.7, 13.8, 17.8, 23, 30] as const
export const MAX_STAGE = LADDER.length

/** The number of ladder steps `dollars` reaches (0 below the first). */
export function stageForDollars(dollars: number, ladder: readonly number[] = LADDER): number {
  let n = 0
  for (const t of ladder) if (dollars >= t) n++
  return n
}

export type Stages = Record<Plant2, number>
export const allStages = (s: number): Stages => Object.fromEntries(DRAW_ORDER.map((p) => [p, s])) as Stages

/**
 * OPEN (the founder's, unruled; R492G ruled one clock for the TIMELAPSE only): how each coin's plant is paced. One ladder per plant
 * (below) is the mockup's rule and the placeholder; the other two options asked were "ladder follows each user's split" and "keep it:
 * SKR leads". Swap this one function when he rules.
 */
export type Pacing = (plant: Plant2, dollars: number, all: Readonly<Record<Plant2, number>>) => number
export const onePerPlant: Pacing = (_plant, dollars) => stageForDollars(dollars)

/** What the stage reads from a planting (GardenInput's plantings: retired coins, coins not held and a withdrawal to zero already gone). */
export type Planting2 = { ts: Date; asset: LiveAsset; usdcInCents: number }

/**
 * R458 (his rule: a plant ready to grow may wait for the user all day, then grows by itself at the end of the day; no action is ever
 * required). Claude's reading, until the tap-to-grow moment exists: a planting counts from the end of its local day, or earlier once a
 * watering after it opened it (the old garden's reveal, `wateredAt`).
 */
export function grown(p: Planting2, now: Date, wateredAt: Date | null): boolean {
  const endOfDay = new Date(p.ts.getFullYear(), p.ts.getMonth(), p.ts.getDate() + 1)
  return now.getTime() >= endOfDay.getTime() || (wateredAt !== null && p.ts.getTime() <= wateredAt.getTime())
}

/** Planted dollars per plant (the dollars put in, never the price: a price drop never shrinks a plant) and whether it has any planting. */
export function plantedDollars(plantings: readonly Planting2[], now: Date, wateredAt: Date | null) {
  const dollars = allStages(0) as Record<Plant2, number>
  const planted = new Set<Plant2>()
  for (const p of plantings) {
    if (!grown(p, now, wateredAt)) continue
    const plant = PLANT_OF_ASSET[p.asset]
    planted.add(plant)
    dollars[plant] += Math.max(0, p.usdcInCents) / 100
  }
  return { dollars, planted }
}

/** Each plant's stage: the pacing on its dollars, at least 1 once planted (a legacy row with no dollar leg still sprouts), capped at 14. */
export function stagesFor(
  g: { plantings: readonly Planting2[]; now: Date; wateredAt: Date | null },
  pacing: Pacing = onePerPlant,
): Stages {
  const { dollars, planted } = plantedDollars(g.plantings, g.now, g.wateredAt)
  const out = allStages(0)
  for (const p of DRAW_ORDER) out[p] = planted.has(p) ? clampStage(p, Math.max(1, pacing(p, dollars[p], dollars))) : 0
  return out
}

/** A stage inside the plant's range; for a tree 0 stays 0 (nothing drawn). */
export function clampStage(p: Plant2, s: number): number {
  const n = Math.round(Number.isFinite(s) ? s : 0)
  if (isTree(p) && n <= 0) return 0
  return Math.min(PLANTS[p].last, Math.max(PLANTS[p].first, n))
}

export type Layer =
  | { kind: 'plate'; key: 'plate'; x: number; y: number; w: number; h: number }
  | { kind: 'overlay'; key: 'stand' | 'cords'; x: number; y: number; w: number; h: number }
  | { kind: 'plant'; key: Plant2; stage: number; x: number; y: number; w: number; h: number }

/**
 * The draw list, back to front, in canvas px: the plate, then each plant in DRAW_ORDER at its box (a tree at stage 0 is skipped; a
 * companion at 0 draws its bare ground), the stand right after `store`, the cords right before `pothos`. Overlays always draw (before a
 * first hSOL planting the pothos hangs its bare pot, stage 0).
 */
export function composeLayers(stages: Partial<Stages>): Layer[] {
  const out: Layer[] = [{ kind: 'plate', key: 'plate', x: 0, y: 0, w: CANVAS.w, h: CANVAS.h }]
  const overlay = (key: 'stand' | 'cords'): Layer => {
    const o = OVERLAYS[key]
    return { kind: 'overlay', key, x: o.x, y: o.y, w: o.w, h: o.h }
  }
  for (const p of DRAW_ORDER) {
    if (OVERLAYS.cords.before === p) out.push(overlay('cords'))
    const s = clampStage(p, stages[p] ?? 0)
    if (!(isTree(p) && s === 0)) out.push({ kind: 'plant', key: p, stage: s, ...box(p) })
    if (OVERLAYS.stand.after === p) out.push(overlay('stand'))
  }
  return out
}
const box = (p: Plant2) => ({ x: PLANTS[p].x, y: PLANTS[p].y, w: PLANTS[p].w, h: PLANTS[p].h })

/** A canvas rect at view width `viewW` (the view keeps the canvas aspect, so one factor serves both axes). */
export function scaleRect<T extends { x: number; y: number; w: number; h: number }>(r: T, viewW: number): T {
  const k = viewW / CANVAS.w
  return { ...r, x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }
}
export const viewHeight = (viewW: number): number => (viewW * CANVAS.h) / CANVAS.w

const decoded = new Map<string, Uint8Array>()
function bitsOf(b64: string): Uint8Array {
  let v = decoded.get(b64)
  if (!v) {
    const bin = globalThis.atob(b64)
    v = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i)
    decoded.set(b64, v)
  }
  return v
}
/** True where plant `p` at stage `s` paints the canvas point (cx, cy) (its hit grid, HIT_CELL px cells). */
export function paintsAt(p: Plant2, s: number, cx: number, cy: number): boolean {
  const m = HIT[p][s],
    b = PLANTS[p]
  if (!m) return false
  const col = Math.floor((cx - b.x) / HIT_CELL),
    row = Math.floor((cy - b.y) / HIT_CELL)
  if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return false
  const i = row * m.cols + col
  return ((bitsOf(m.bits)[i >> 3]! >> (7 - (i & 7))) & 1) === 1
}
/** The plant a tap at canvas point (cx, cy) lands on: the front-most drawn plant whose paint covers it, else null. */
export function plantAt(stages: Partial<Stages>, cx: number, cy: number): Plant2 | null {
  const layers = composeLayers(stages)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!
    if (l.kind === 'plant' && paintsAt(l.key, l.stage, cx, cy)) return l.key
  }
  return null
}

/** R487G: pinch zoom capped at about 1.5x (where the 624 px MJ art still holds), never below the fitted view. */
export const MAX_ZOOM2 = 1.5
export function clampZoom2(s: number): number {
  'worklet'
  return Math.min(MAX_ZOOM2, Math.max(1, s))
}
