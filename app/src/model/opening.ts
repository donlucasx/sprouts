// What moves when the scene changes, and when (spec 6; Task I4): the plan the garden plays from a scene diff. Pure, so its order and
// timings are tested; Plant and Garden only draw it. Dependency-free (the Diff is a type).
import type { Diff } from "@/lib/scene-diff";
import { PLANT_ORDER, type PlantId, type Scene } from "./garden";
import type { PlantLayout } from "./species";

export const LEAF_MS = 3000;            // gen11_motion.py:32 LEAF_S = 3.0: a 0.3 s stroke, a 1.5 s decelerating bloom, the settle with the rim darkening last
export const PART_GAP_MS = 800;         // gen11_motion.py:33 GAP = 0.8: every opening part starts this long after the previous one
export const STEM_MS = 600;             // gen11_motion.py:173: a twig's or branch's stem is a 0.6 s stroke reveal, then its leaf
export const BUD_FADE_MS = 1400;        // gen11_motion.py:156 budout 1.4 s ease-in ...
export const BUD_FADE_AFTER_MS = 250;   // ... from 0.25 s after its first leaf's stroke begins (:193)
export const BUD_ARRIVE_MS = 1050;      // gen11_motion.py:154, :157: a new bud comes in over 1.05 s
export const TOKEN_ARRIVE_MS = 1500;    // gen11_motion.py:178: an earned token over 1.5 s, after the openings
export const SEED_MS = 900;             // gen11_motion.py:152-153: a seed over 0.9 s ...
export const SEED_GAP_MS = 120;         // ... 120 ms after the one before
export const REDUCED_MS = 300;          // constraints, Animation: reduced motion is every part at its end under a 300 ms fade

/** Which strip a leaf-like sprite opens with (gen03's shapes: twig blade, plant_hsol3 broad, gen04 jup small, jito blade; the succulent's
 * teardrop is nearest the blade). Tiers, pups, heads and the rest fade in. */
const STRIP_SHAPE: Record<string, "blade" | "heart" | "broad" | "small"> = { "leaf-mandarin": "blade", "leaf-sunflower": "broad", "leaf-blueberry": "small", "blade-snake": "blade", "blade-succulent": "blade" };
export const stripShapeOf = (name: string) => STRIP_SHAPE[name.replace(/-s\d$/, "").replace(/-\d$/, "")];

/** `part` is the index in the plant's layout.parts (for `bud`, in the layout BEFORE the change); every time is ms from the change. */
export type OpeningItem =
  | { kind: "stem"; plant: PlantId; shoot: string; part: number; delay: number; ms: number }
  | { kind: "strip"; plant: PlantId; shoot: string; part: number; leaf: number; shape: "blade" | "heart" | "broad" | "small"; delay: number; ms: number }
  | { kind: "fade"; plant: PlantId; shoot: string | null; part: number; delay: number; ms: number }
  | { kind: "bud"; plant: PlantId; shoot: string; part: number; delay: number; ms: number }
  | { kind: "seed"; id: string; delay: number; ms: number };
type Laid = { plant: PlantId; layout: PlantLayout };

/**
 * The opening order (gen11_motion.py:35; RG25): the plant the can was dropped on first (`first`; a tap passes null), then the others in
 * garden order; in each plant its opened shoots in slot order, then the nodes that just became branches. One shoot: its stems' stroke
 * reveal, then its leaves one strip each, 0.8 s apart (the next shoot starts 0.8 s after its last leaf starts); its other parts fade in
 * with the first leaf; its old bud fades from 0.25 s after that leaf. New buds arrive at once, seeds 120 ms apart, earned tokens after
 * the last opening ends. `tempo` scales every time (the preview runs at 8); reduced motion is one 300 ms fade for all, no order.
 */
export function openingPlan(o: { scene: Scene; plants: Laid[]; before: Laid[] | null; diff: Diff; first: PlantId | null; reduced: boolean; tempo: number }): { items: OpeningItem[]; endMs: number } {
  const { scene, plants, diff } = o;
  const items: OpeningItem[] = [];
  const order = [...(o.first ? [o.first] : []), ...PLANT_ORDER.filter((p) => p !== o.first)];
  const slotOf = new Map(scene.parts.flatMap((p) => (p.kind === "sprout" ? [[p.id, p.slot] as const] : [])));
  const opened = new Set(diff.opened), branched = new Set(diff.branches);
  let t = 0, end = 0;
  const push = (it: OpeningItem) => { items.push(it); end = Math.max(end, it.delay + it.ms); };
  for (const plant of order) {
    const pl = plants.find((p) => p.plant === plant); if (!pl) continue;
    const parts = pl.layout.parts;
    const shootsHere = [...new Set(parts.flatMap((q) => (q.shoot ? [q.shoot] : [])))].sort((a, b) => (slotOf.get(a) ?? 0) - (slotOf.get(b) ?? 0));
    const run = [...shootsHere.filter((s) => opened.has(s)), ...shootsHere.filter((s) => !opened.has(s) && branched.has(s))];
    for (const shoot of run) {
      const mine = parts.flatMap((q, i) => (q.shoot === shoot ? [{ q, i }] : []));
      const stems = mine.filter(({ q }) => q.kind === "stem");
      for (const { i } of stems) push({ kind: "stem", plant, shoot, part: i, delay: t, ms: STEM_MS });
      const leafAt = t + (stems.length ? STEM_MS : 0);
      let leaf = 0;
      for (const { q, i } of mine) {
        if (q.kind !== "sprite") continue;
        const shape = stripShapeOf(q.name);
        if (shape) { push({ kind: "strip", plant, shoot, part: i, leaf, shape, delay: leafAt + PART_GAP_MS * leaf, ms: LEAF_MS }); leaf++; }
        else push({ kind: "fade", plant, shoot, part: i, delay: leafAt, ms: BUD_ARRIVE_MS });
      }
      if (opened.has(shoot)) {
        const old = o.before?.find((p) => p.plant === plant)?.layout.parts ?? [];
        old.forEach((q, i) => { if (q.shoot === shoot && q.kind === "sprite" && q.part === "bud") push({ kind: "bud", plant, shoot, part: i, delay: leafAt + BUD_FADE_AFTER_MS, ms: BUD_FADE_MS }); });
      }
      t = leafAt + PART_GAP_MS * Math.max(1, leaf);
    }
  }
  // arrivals: new closed buds swell in at once; earned tokens after the openings (the k-th token sprite of a plant is its k-th fruit)
  for (const pl of plants) pl.layout.parts.forEach((q, i) => { if (q.kind === "sprite" && q.part === "bud" && q.shoot && diff.buds.includes(q.shoot)) push({ kind: "fade", plant: pl.plant, shoot: q.shoot, part: i, delay: 0, ms: BUD_ARRIVE_MS }); });
  const opensEnd = end;
  for (const pl of plants) {
    const tokens = pl.layout.parts.flatMap((q, i) => (q.kind === "sprite" && q.part === "token" ? [i] : []));
    for (const tk of diff.tokens) if (tk.plant === pl.plant && tokens[tk.index] !== undefined) push({ kind: "fade", plant: pl.plant, shoot: null, part: tokens[tk.index], delay: opensEnd, ms: TOKEN_ARRIVE_MS });
  }
  diff.seeds.forEach((id, k) => push({ kind: "seed", id, delay: SEED_GAP_MS * k, ms: SEED_MS }));
  if (o.reduced) return { items: items.map((it) => ({ ...it, delay: 0, ms: REDUCED_MS })), endMs: items.length ? REDUCED_MS : 0 };
  return { items: items.map((it) => ({ ...it, delay: it.delay * o.tempo, ms: it.ms * o.tempo })), endMs: end * o.tempo };
}
