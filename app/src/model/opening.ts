// What moves when the scene changes, and when (spec 6; Task I4): the plan the garden plays from a scene diff. Pure, so its order and
// timings are tested; Plant and Garden only draw it. Dependency-free (the Diff is a type).
import type { Diff } from "@/lib/scene-diff";
import { PLANT_ORDER, type PlantId, type Scene } from "./garden";
import type { PlantLayout } from "./species";
import { isClosedPart, pairOf, UNFURL_STEM } from "./sprout";

/** R202 (device check 2, "it all happens kinda fast"; his pick "About 2x slower", each leaf over ~5 s): the watering's opening runs at
 * G11's timings times PACE, order and gaps kept in proportion (the can's own sequence doubles, CAN_MS). New buds and seeds keep G11's. */
export const PACE = 5 / 3;
const paced = (ms: number) => Math.round(ms * PACE);
export const LEAF_MS = paced(3000);     // 5 s; gen11_motion.py:32 LEAF_S = 3.0: a 0.3 s stroke, a 1.5 s decelerating bloom, the settle with the rim darkening last
export const PART_GAP_MS = paced(800);  // gen11_motion.py:33 GAP = 0.8: every opening part starts this long after the previous one
export const STEM_MS = paced(600);      // gen11_motion.py:173: a twig's or branch's stem is a 0.6 s stroke reveal, then its leaf
export const BUD_FADE_MS = paced(1400); // gen11_motion.py:156 budout 1.4 s ease-in ...
export const BUD_FADE_AFTER_MS = paced(250);   // ... from 0.25 s after its first leaf's stroke begins (:193)
export const PART_FADE_MS = paced(1050);       // an opening shoot's other parts (tiers, pups, heads) fade in with its first leaf
/** R351 (10-05, his #4 on the sprout draft: "should be slow enough so the user can appreciate it"; the length is Claude's call): a
 * mandarin sprout unfolds into its leaf pair over 4.5 s, after the beat (model/sprout.ts: the stem over the first 40%, the pair after). */
export const UNFURL_MS = paced(2700);
export const OPEN_BEAT_MS = 800;        // R202: the beat between the water reaching a plant and its bud starting to open
export const BUD_ARRIVE_MS = 1050;      // gen11_motion.py:154, :157: a new bud comes in over 1.05 s
export const TOKEN_ARRIVE_MS = paced(1500);   // gen11_motion.py:178: an earned token over 1.5 s, after the openings
export const SEED_MS = 900;             // gen11_motion.py:152-153: a seed over 0.9 s ...
export const SEED_GAP_MS = 120;         // ... 120 ms after the one before
export const REDUCED_MS = 300;          // constraints, Animation: reduced motion is every part at its end under a 300 ms fade

/** Which baked strip a leaf-like sprite opens with (I4 fix round 1, ruling a: coloured per species and shape, bake.py STRIP_SPECIES;
 * gen03's shapes: twig blade, plant_hsol3 broad, gen04 jup small, jito blade; the succulent's teardrop is nearest the blade). Tiers,
 * pups, heads and the rest fade in. Every value is a key of the generated `STRIPS` (a test holds strips.ts to it). */
export const STRIP_FOR: Record<string, string> = { "leaf-mandarin": "skr-blade", "blade-succulent": "ore-blade", "leaf-sunflower": "hsol-broad", "blade-snake": "jitosol-blade", "leaf-blueberry": "jupsol-small" };
export const stripOf = (name: string): string | undefined => STRIP_FOR[name.replace(/-s\d$/, "").replace(/-\d$/, "")];

/** `part` is the index in the plant's layout.parts (for `bud`, in the layout BEFORE the change); every time is ms from the change. */
export type OpeningItem =
  | { kind: "stem"; plant: PlantId; shoot: string; part: number; delay: number; ms: number }
  | { kind: "strip"; plant: PlantId; shoot: string; part: number; leaf: number; strip: string; delay: number; ms: number }
  | { kind: "fade"; plant: PlantId; shoot: string | null; part: number; delay: number; ms: number }
  | { kind: "bud"; plant: PlantId; shoot: string; part: number; delay: number; ms: number }
  | { kind: "unfurl"; plant: PlantId; shoot: string; part: number; leaves: [number, number]; delay: number; ms: number }
  | { kind: "seed"; id: string; delay: number; ms: number };
type Laid = { plant: PlantId; layout: PlantLayout };

/**
 * The opening order (gen11_motion.py:35; RG25): the plant the can was dropped on first (`first`; a tap passes null), then the others in
 * garden order; in each plant its opened shoots in slot order, then the nodes that just became branches. The first opening starts
 * OPEN_BEAT_MS in (R202). One shoot: its stems' stroke reveal, then its leaves one strip each, PART_GAP_MS apart (the next shoot
 * starts PART_GAP_MS after its last leaf starts); its other parts fade in with the first leaf; its old bud fades from
 * BUD_FADE_AFTER_MS after that leaf. New buds arrive at once, seeds 120 ms apart, earned tokens after the last opening ends.
 * R201, a release group: with `order`, only those plants open, in that order, each one's tokens after the group's openings, and no
 * arrivals or seeds (the garden plays those at the change, arrivalsOf); times are then from the group's release. `tempo` scales every
 * time (a slowed preview runs at 8); reduced motion is one 300 ms fade for all, no order.
 */
export function openingPlan(o: { scene: Scene; plants: Laid[]; before: Laid[] | null; diff: Diff; first: PlantId | null; reduced: boolean; tempo: number; order?: PlantId[] }): { items: OpeningItem[]; endMs: number } {
  const { scene, plants, diff } = o;
  const items: OpeningItem[] = [];
  const order = o.order ?? [...(o.first ? [o.first] : []), ...PLANT_ORDER.filter((p) => p !== o.first)];
  const group = o.order !== undefined;
  const slotOf = new Map(scene.parts.flatMap((p) => (p.kind === "sprout" ? [[p.id, p.slot] as const] : [])));
  const opened = new Set(diff.opened), branched = new Set(diff.branches);
  let t = OPEN_BEAT_MS, end = 0;
  const push = (it: OpeningItem) => { items.push(it); end = Math.max(end, it.delay + it.ms); };
  for (const plant of order) {
    const pl = plants.find((p) => p.plant === plant); if (!pl) continue;
    const parts = pl.layout.parts;
    const shootsHere = [...new Set(parts.flatMap((q) => (q.shoot ? [q.shoot] : [])))].sort((a, b) => (slotOf.get(a) ?? 0) - (slotOf.get(b) ?? 0));
    const run = [...shootsHere.filter((s) => opened.has(s)), ...shootsHere.filter((s) => !opened.has(s) && branched.has(s))];
    for (const shoot of run) {
      const mine = parts.flatMap((q, i) => (q.shoot === shoot ? [{ q, i }] : []));
      const old = opened.has(shoot) ? (o.before?.find((p) => p.plant === plant)?.layout.parts ?? []) : [];
      // R351: a mandarin sprout (a nub before) that opens into its pair unfolds in place: one item moves its stem and both leaves
      const pair = old.some((q) => q.shoot === shoot && q.part === "nub") ? pairOf(mine.map(({ q }) => q)) : null;
      if (pair) {
        const at = (q: (typeof parts)[number]) => mine.find((m) => m.q === q)!.i;
        push({ kind: "unfurl", plant, shoot, part: at(pair.stem), leaves: [at(pair.leaves[0]), at(pair.leaves[1])], delay: t, ms: UNFURL_MS });
        t += Math.round(UNFURL_MS * UNFURL_STEM[1]) + PART_GAP_MS;   // the next shoot once this one's stem has grown, a gap later
        continue;
      }
      const stems = mine.filter(({ q }) => q.kind === "stem");
      for (const { i } of stems) push({ kind: "stem", plant, shoot, part: i, delay: t, ms: STEM_MS });
      const leafAt = t + (stems.length ? STEM_MS : 0);
      let leaf = 0;
      for (const { q, i } of mine) {
        if (q.kind !== "sprite") continue;
        const strip = stripOf(q.name);
        if (strip) { push({ kind: "strip", plant, shoot, part: i, leaf, strip, delay: leafAt + PART_GAP_MS * leaf, ms: LEAF_MS }); leaf++; }
        else push({ kind: "fade", plant, shoot, part: i, delay: leafAt, ms: PART_FADE_MS });
      }
      if (opened.has(shoot)) {
        old.forEach((q, i) => { if (q.shoot === shoot && isClosedPart(q)) push({ kind: "bud", plant, shoot, part: i, delay: leafAt + BUD_FADE_AFTER_MS, ms: BUD_FADE_MS }); });
      }
      t = leafAt + PART_GAP_MS * Math.max(1, leaf);
    }
  }
  // arrivals: new closed buds swell in at once; earned tokens after the openings (the k-th token sprite of a plant is its k-th fruit)
  if (!group) for (const pl of plants) pl.layout.parts.forEach((q, i) => { if (isClosedPart(q) && q.shoot && diff.buds.includes(q.shoot)) push({ kind: "fade", plant: pl.plant, shoot: q.shoot, part: i, delay: 0, ms: BUD_ARRIVE_MS }); });
  const opensEnd = end;
  for (const pl of plants) {
    if (group && !order.includes(pl.plant)) continue;
    const tokens = pl.layout.parts.flatMap((q, i) => (q.kind === "sprite" && q.part === "token" ? [i] : []));
    for (const tk of diff.tokens) if (tk.plant === pl.plant && tokens[tk.index] !== undefined) push({ kind: "fade", plant: pl.plant, shoot: null, part: tokens[tk.index], delay: opensEnd, ms: TOKEN_ARRIVE_MS });
  }
  if (!group) diff.seeds.forEach((id, k) => push({ kind: "seed", id, delay: SEED_GAP_MS * k, ms: SEED_MS }));
  if (o.reduced) return { items: items.map((it) => ({ ...it, delay: 0, ms: REDUCED_MS })), endMs: items.length ? REDUCED_MS : 0 };
  return { items: items.map((it) => ({ ...it, delay: it.delay * o.tempo, ms: it.ms * o.tempo })), endMs: end * o.tempo };
}

/** R201: the plants a watering's change opens (an opened or branched shoot, or an earned token), in garden order: the plants a drag may
 * hold closed until the can reaches them. */
export function openingPlants(scene: Scene, diff: Diff): PlantId[] {
  const moved = new Set([...diff.opened, ...diff.branches]);
  const of = new Set([...scene.parts.flatMap((p) => (p.kind === "sprout" && moved.has(p.id) ? [p.plant] : [])), ...diff.tokens.map((t) => t.plant)]);
  return PLANT_ORDER.filter((p) => of.has(p));
}
/** R201: a held change's arrivals only (new buds, seeds); its openings and tokens play per release group. */
export const arrivalsOf = (d: Diff): Diff => ({ ...d, opened: [], branches: [], tokens: [] });
/** R201, the drag's releases: each time the can reaches a plant, or the drag ends (`dropped`, every plant still held opens), the
 * plants newly released form the next group, the visited in visit order then the rest in garden order. Returns `groups` itself when
 * nothing new is released, so a render can compare by reference. */
export function releaseGroups(groups: PlantId[][], visited: PlantId[], dropped: boolean, openers: PlantId[]): PlantId[][] {
  const done = new Set(groups.flat());
  const fresh = [...visited.filter((p) => openers.includes(p)), ...(dropped ? openers : [])].filter((p, i, a) => !done.has(p) && a.indexOf(p) === i);
  return fresh.length ? [...groups, fresh] : groups;
}

export type PlantItem = Exclude<OpeningItem, { kind: "seed" }>;
/** I4 fix round 1, ruling c: the picture each item leaves its part in when it ends: every part present in the scene ends fully shown
 * (a strip on its last frame, which the dry sprite then replaces); only the old closed bud (a part of the layout BEFORE the change, no
 * longer in the scene) ends gone. */
export const endOf = (it: OpeningItem): { opacity: 0 | 1; frame: "last" | null } => (it.kind === "bud" ? { opacity: 0, frame: null } : { opacity: 1, frame: it.kind === "strip" ? "last" : null });
/** Who draws each part of a plant's layout: the static drawing, or the item playing it. Once the garden settles (the plan's end, or a
 * newer change cutting it short) every part is static, which is each item's end picture: nothing can stay hidden. */
export function drawnBy(partCount: number, items: PlantItem[], settled: boolean): (PlantItem | "static")[] {
  const by = new Map<number, PlantItem>(settled ? [] : items.flatMap((it): [number, PlantItem][] => (it.kind === "bud" ? [] : it.kind === "unfurl" ? [it.part, ...it.leaves].map((i): [number, PlantItem] => [i, it]) : [[it.part, it]])));
  return Array.from({ length: partCount }, (_, i) => by.get(i) ?? "static");
}
