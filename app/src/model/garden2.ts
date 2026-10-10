import type { LiveAsset } from '../lib/coins'
import { CANVAS, COIN_PLANTS, DECOR, DRAW_ORDER, HIT, HIT_CELL, OVERLAYS, PLANTS, SPOTS, type Plant2 } from '../garden2/layout'
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
 * R515/R518: each plant grows by its own coin's dollars put in, on the one ladder (the one-clock timelapse, R492G, was promo only).
 * Kept as a swappable function for other pacings later.
 */
export type Pacing = (plant: Plant2, dollars: number, all: Readonly<Record<Plant2, number>>) => number
export const onePerPlant: Pacing = (_plant, dollars) => stageForDollars(dollars)

/** What the stage reads from a planting (GardenInput's plantings: retired coins, coins not held and a withdrawal to zero already gone). */
export type Planting2 = { ts: Date; asset: LiveAsset; usdcInCents: number; amountOutRaw: bigint }
/** A withdrawal of a coin, in that coin's raw units (GardenInput's picks). */
export type Pick2 = { asset: LiveAsset; amountRaw: bigint }
export type GardenInput2 = { plantings: readonly Planting2[]; picks: readonly Pick2[]; skrPrincipalPickedRaw: bigint }

/**
 * Dollars per plant that still count: the dollars put in (never the price, R518), times the share of the planted tokens still held
 * (R519: a withdrawal shrinks the plant). SKR counts only principal withdrawn (the API's skrPrincipalPickedRaw): picking the earned
 * fruit never shrinks the tree [A13]. A planting counts as soon as it is confirmed (R521; the reveal is the view's).
 */
export function plantedDollars(g: GardenInput2) {
  const dollars = allStages(0) as Record<Plant2, number>
  const plantedRaw = new Map<LiveAsset, bigint>()
  const planted = new Set<Plant2>()
  for (const p of g.plantings) {
    const plant = PLANT_OF_ASSET[p.asset]
    planted.add(plant)
    dollars[plant] += Math.max(0, p.usdcInCents) / 100
    plantedRaw.set(p.asset, (plantedRaw.get(p.asset) ?? 0n) + (p.amountOutRaw > 0n ? p.amountOutRaw : 0n))
  }
  const pickedRaw = new Map<LiveAsset, bigint>()
  for (const k of g.picks) if (k.asset !== 'SKR') pickedRaw.set(k.asset, (pickedRaw.get(k.asset) ?? 0n) + (k.amountRaw > 0n ? k.amountRaw : 0n))
  if (g.skrPrincipalPickedRaw > 0n) pickedRaw.set('SKR', g.skrPrincipalPickedRaw)
  for (const [asset, out] of pickedRaw) {
    const put = plantedRaw.get(asset) ?? 0n
    if (put <= 0n) continue
    const keptPpm = out >= put ? 0n : ((put - out) * 1_000_000n) / put
    dollars[PLANT_OF_ASSET[asset]] *= Number(keptPpm) / 1_000_000
  }
  return { dollars, planted }
}

/** Each plant's stage: the pacing on its dollars, at least 1 while planted and held (a legacy row with no dollar leg still sprouts), capped at 14. */
export function stagesFor(g: GardenInput2, pacing: Pacing = onePerPlant): Stages {
  const { dollars, planted } = plantedDollars(g)
  const out = allStages(0)
  for (const p of DRAW_ORDER) out[p] = planted.has(p) ? clampStage(p, Math.max(1, pacing(p, dollars[p], dollars))) : 0
  return out
}

/** A stage inside the plant's range (every plant now has a stage 0: the trees' bare soil mound, R517). */
export function clampStage(p: Plant2, s: number): number {
  const n = Math.round(Number.isFinite(s) ? s : 0)
  return Math.min(PLANTS[p].last, Math.max(PLANTS[p].first, n))
}

/**
 * R521: the plants that stepped UP since this phone last showed the garden, each with the stage it showed then (a shrink after a
 * withdrawal, R519, shows as is; no record yet = nothing to reveal). Garden2 fades the new painting in over that one.
 */
export function revealFrom(seen: Partial<Stages> | null, now: Stages): Partial<Stages> {
  const out: Partial<Stages> = {}
  if (!seen) return out
  for (const p of DRAW_ORDER) {
    const was = seen[p]
    if (typeof was === 'number' && Number.isFinite(was) && was < now[p]) out[p] = clampStage(p, was)
  }
  return out
}

export type Layer =
  | { kind: 'plate'; key: 'plate'; x: number; y: number; w: number; h: number }
  | { kind: 'overlay'; key: 'stand' | 'cords'; x: number; y: number; w: number; h: number }
  | { kind: 'plant'; key: Plant2; stage: number; x: number; y: number; w: number; h: number }
  | { kind: 'fruit'; key: Tree; index: number; x: number; y: number; w: number; h: number }
  | { kind: 'decor'; key: keyof typeof DECOR; x: number; y: number; w: number; h: number }
  | { kind: 'stake'; key: Plant2; label: string; x: number; y: number; w: number; h: number }

/** What the garden shows besides the plants: the trees' fruit (R533) and the basket while SKR waits out its unstake (R535). */
export type Extras = { fruit?: Fruit; basket?: boolean; stakes?: boolean }

/**
 * R534/R555-R557: the stake sign (MJ f83a979e #2, decor/sprites/stake.png): its foot (the post's base) and its plank, in sprite px;
 * the app writes the coin name on the plank in Outfit 700 at `font` canvas px (the plank's height caps it: every name fits the width),
 * one line, a tad below the plank's middle.
 */
export const STAKE = { foot: [71, 80], board: { x: 2, y: 1, w: 136, h: 34 }, font: 27, drop: 0.05 } as const
/** R557 (his placement on decor-stake-context-v2): each plant's stake foot in canvas px; stORE's stands behind the orchid (drawn before it). */
export const STAKE_AT: Record<Plant2, { x: number; y: number; before?: Plant2 }> = {
  mandarin: { x: 560, y: 740 },
  store: { x: 885, y: 690, before: 'orchid' },
  maple: { x: 735, y: 640 },
  azalea: { x: 215, y: 852 },
  orchid: { x: 1110, y: 800 },
  pothos: { x: 1345, y: 712 },
}
/** The name on each plant's stake: its coin as layout.json names it (USDC and SOL = the lending plants). */
export const STAKE_LABEL = Object.fromEntries(Object.entries(COIN_PLANTS).map(([coin, plant]) => [plant, coin])) as Record<Plant2, string>
const stakeOf = (p: Plant2): Extract<Layer, { kind: 'stake' }> => ({
  kind: 'stake',
  key: p,
  label: STAKE_LABEL[p],
  x: STAKE_AT[p].x - STAKE.foot[0],
  y: STAKE_AT[p].y - STAKE.foot[1],
  w: DECOR.stake.w,
  h: DECOR.stake.h,
})

/** The two trees that show earnings in the garden (R533): SKR's mandarins and stORE's ORE-gold flowers; the companions show none. */
export type Tree = 'mandarin' | 'store'
/** How many earned fruit (mandarin) or flowers (store) each tree has: the shared ladder's count (garden-input.ts earned). */
export type Fruit = Partial<Record<Tree, number>>
/** R548: the mandarin bears fruit from stage 8 (its crown has leaves); stages 3-7 are bare branches. stORE flowers wherever it has spots. */
export const FRUIT_FROM: Record<Tree, number> = { mandarin: 8, store: 0 }

/**
 * The fruit drawn on a tree at a stage, in canvas px: the first `count` of that stage's measured spots (R416: each stage has its own
 * spots, fruit never slides), each sprite 2r square centred on its spot (R547/R549: the board's size). Earned beyond the stage's spots
 * is not drawn (Claude's build rule; R412's clusters of 2-3 not built).
 */
export function fruitOn(tree: Tree, stage: number, count: number): Extract<Layer, { kind: 'fruit' }>[] {
  if (stage < FRUIT_FROM[tree] || !(count > 0)) return []
  const at = SPOTS[tree][stage]
  if (!at || at.r <= 0) return []
  const b = PLANTS[tree],
    d = at.r * 2
  return at.at
    .slice(0, Math.floor(count))
    .map(([x, y], index) => ({ kind: 'fruit', key: tree, index, x: b.x + x - d / 2, y: b.y + y - d / 2, w: d, h: d }))
}

/**
 * The draw list, back to front, in canvas px: the plate, then each plant in DRAW_ORDER at its box (a tree's fruit right after it; the basket last, R535) (at stage 0 every plant draws its
 * bare ground: the trees' soil mound since R517), the stand right after `store`, the cords right before `pothos`. Overlays always draw (before a
 * first hSOL planting the pothos hangs its bare pot, stage 0).
 */
export function composeLayers(stages: Partial<Stages>, { fruit = {}, basket = false, stakes = false }: Extras = {}): Layer[] {
  const out: Layer[] = [{ kind: 'plate', key: 'plate', x: 0, y: 0, w: CANVAS.w, h: CANVAS.h }]
  const overlay = (key: 'stand' | 'cords'): Layer => {
    const o = OVERLAYS[key]
    return { kind: 'overlay', key, x: o.x, y: o.y, w: o.w, h: o.h }
  }
  for (const p of DRAW_ORDER) {
    if (OVERLAYS.cords.before === p) out.push(overlay('cords'))
    // R534: a stake per planted plant (stage 1 up); one marked `before` this plant stands behind it (R557: stORE's behind the orchid)
    if (stakes) for (const q of DRAW_ORDER) if (STAKE_AT[q].before === p && (stages[q] ?? 0) >= 1) out.push(stakeOf(q))
    const s = clampStage(p, stages[p] ?? 0)
    out.push({ kind: 'plant', key: p, stage: s, ...box(p) })
    if (p === 'mandarin' || p === 'store') out.push(...fruitOn(p, s, fruit[p] ?? 0))
    if (OVERLAYS.stand.after === p) out.push(overlay('stand'))
  }
  if (stakes) for (const q of DRAW_ORDER) if (!STAKE_AT[q].before && (stages[q] ?? 0) >= 1) out.push(stakeOf(q))
  if (basket) out.push({ kind: 'decor', key: 'basket', ...DECOR.basket }) // R535: front-most, at the mandarin's foot
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
/** The canvas y of the first painted row of plant `p` at stage `s` (its hit grid), or Infinity when the layer paints nothing. */
export function paintedTop(p: Plant2, s: number): number {
  const m = HIT[p][s]
  if (!m) return Number.POSITIVE_INFINITY
  const bits = bitsOf(m.bits)
  for (let row = 0; row < m.rows; row++)
    for (let col = 0; col < m.cols; col++) {
      const i = row * m.cols + col
      if (((bits[i >> 3]! >> (7 - (i & 7))) & 1) === 1) return PLANTS[p].y + row * HIT_CELL
    }
  return Number.POSITIVE_INFINITY
}

/** The canvas box plant `p` paints at stage `s` (its hit grid), or null when the layer paints nothing. */
export function paintedBox(p: Plant2, s: number): { x0: number; x1: number; y0: number; y1: number } | null {
  const m = HIT[p][s]
  if (!m) return null
  const bits = bitsOf(m.bits)
  let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1
  for (let row = 0; row < m.rows; row++)
    for (let col = 0; col < m.cols; col++) {
      const i = row * m.cols + col
      if (((bits[i >> 3]! >> (7 - (i & 7))) & 1) === 1) (c0 = Math.min(c0, col), c1 = Math.max(c1, col), r0 = Math.min(r0, row), r1 = Math.max(r1, row))
    }
  if (c1 < 0) return null
  const b = PLANTS[p]
  return { x0: b.x + c0 * HIT_CELL, x1: b.x + (c1 + 1) * HIT_CELL, y0: b.y + r0 * HIT_CELL, y1: b.y + (r1 + 1) * HIT_CELL }
}

/** The plant card's pointer, view px; the card keeps this far from the view's edges. */
export const CARD_CARET = 8,
  CARD_EDGE = 8
/**
 * R587 (his note: "cards should be better centered in relation to the plants"): where a tapped plant's card sits, all in view px.
 * Centred over the plant's paint (held inside the view), the pointer on the plant's middle. Above the plant when it fits, pointing
 * down at it; else under the plant's stake, pointing up at it (it may hang `below` px past the view's bottom, over what follows the
 * garden: on the device a tall tree left no room above, and the card at the top hid its crown); else at the top, over the crown.
 */
export function placeCard(o: { plant: { x0: number; x1: number; y0: number }; stakeBottom: number; viewW: number; viewH: number; cardW: number; cardH: number; below?: number }): {
  left: number
  top: number
  caretX: number
  caret: 'down' | 'up'
} {
  const cx = (o.plant.x0 + o.plant.x1) / 2
  const left = Math.min(Math.max(cx - o.cardW / 2, CARD_EDGE), Math.max(CARD_EDGE, o.viewW - o.cardW - CARD_EDGE))
  const caretX = Math.min(Math.max(cx - left, 2 * CARD_CARET), o.cardW - 2 * CARD_CARET)
  const above = o.plant.y0 - CARD_CARET - o.cardH
  if (above >= CARD_EDGE / 2) return { left, top: above, caretX, caret: 'down' }
  const below = o.stakeBottom + CARD_CARET
  if (below + o.cardH <= o.viewH + (o.below ?? 0) - CARD_EDGE / 2) return { left, top: below, caretX, caret: 'up' }
  return { left, top: CARD_EDGE / 2, caretX, caret: 'down' }
}

/** Breathing room above the tallest painted thing, canvas px (R525). */
export const FRAME_PAD = 48
/**
 * R525 (his ruling: the frame grows with the garden): the canvas row the view starts at, just above the tallest thing drawn now (each
 * plant at its stage, and the bamboo stand, which always draws), less FRAME_PAD; 0 once a tree reaches the top. A young garden sits
 * tight under its stand; the frame opens as the trees grow.
 */
export function frameTop(stages: Partial<Stages>): number {
  let top: number = OVERLAYS.stand.y
  for (const l of composeLayers(stages)) if (l.kind === 'plant') top = Math.min(top, paintedTop(l.key, l.stage))
  return Math.max(0, Math.floor(top - FRAME_PAD))
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
