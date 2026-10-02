// R89: one plant per coin, its plantings stacked up one stem. Pixels above the soil's surface at the plant's foot, for the app's
// garden; the widget scales them. Shared so the app and the widget draw the same plant.

/** How much room the tallest plant may take above the soil. */
export const MAX_RISE = 150;
/** A transplanted position (R61) is the SKR plant's grown base; its own plantings start above it. */
export const TRANSPLANT_BASE = 56;
const FIRST = 16;
const STEP = 16;

/** The gap between shoots: 16 px, closing up so a long history still fits under MAX_RISE. */
function step(shoots: number, base: number): number {
  return shoots <= 1 ? STEP : Math.min(STEP, (MAX_RISE - base - FIRST - 12) / (shoots - 1));
}

/** How high up the stem shoot `slot` sits (0 is the oldest, lowest). */
export function nodeRise(slot: number, shoots: number, base = 0): number {
  return base + FIRST + slot * step(shoots, base);
}

/** The stem's height: a little past the newest shoot, where the next one forms. */
export function stemRise(shoots: number, base = 0): number {
  return shoots === 0 ? base : nodeRise(shoots - 1, shoots, base) + 12;
}

/** Shoots alternate sides up the stem. */
export const side = (slot: number) => (slot % 2 === 0 ? -1 : 1);

/** A shoot's leaf grows with its age stage (0 to 3). */
export const leafSize = (stage: 0 | 1 | 2 | 3) => [5, 7, 9, 11][stage];

/** The ORE stem is drawn 4.5 wide (parts.tsx); a pup is a circle of radius 4. */
export const ORE_STEM_HALF = 2.25;
export const PUP_R = 4;

/**
 * Where pup `index` sits at the succulent's foot, in pixels from the stem's centre: touching the stem, then touching the pup
 * before it on that side, alternating sides. A forming pup of radius `r` takes the next slot the same way (09-30, the Saga: 17 px
 * out on its own, it read as a seed).
 */
export function pupOffset(index: number, r = PUP_R): number {
  const edge = ORE_STEM_HALF + 2 * PUP_R * Math.floor(index / 2);   // how far out that side already reaches
  return (index % 2 === 0 ? -1 : 1) * (edge + r);
}

// Task 0.5 (garden build): the new helpers beside today's names; Track B rewrites this file in B6.
export { branchFlags, stageOf, pupsByCount } from "./geometry/common";
