import { BAKED_L, BAND_SCALE, SWELL_REACH, type PlantLayout, type Placed, type Species, type Stage } from "../species";

/** RG3: maturity by age (gen01_garden.py:103). */
export const stageOf = (ageDays: number): Stage => (ageDays < 3 ? 0 : ageDays < 10 ? 1 : ageDays < 30 ? 2 : 3);
/** RG19 as gen01_garden.py:105-107: an opened shoot with three newer plantings above it, open or closed, any age, the lowest node
 * included. `shoots` is the plant's full planting history in order (pruned plantings included; Task C2 passes it so). */
export const branchFlags = (shoots: { opened: boolean }[]): boolean[] => shoots.map((s, i) => s.opened && shoots.length - 1 - i >= 3);
export const rad = (deg: number) => (deg * Math.PI) / 180;
export type Acc = { parts: Placed[]; tips: { x: number; y: number }[] };
type StemPart = Extract<Placed, { kind: "stem" }>["part"];
type SpritePart = Extract<Placed, { kind: "sprite" }>["part"];
export function stem(acc: Acc, part: StemPart, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, color: string, bend = 0, z = 0, shoot?: string) {
  acc.parts.push({ kind: "stem", part, x0, y0, x1, y1, w0, w1, bend, color, z, shoot });
}
export function sprite(acc: Acc, part: SpritePart, name: string, x: number, y: number, rot: number, scale: number, z: number, shoot?: string, xScale?: number) {
  acc.parts.push(xScale === undefined ? { kind: "sprite", part, name, x, y, rot, scale, z, shoot } : { kind: "sprite", part, name, x, y, rot, scale, xScale, z, shoot });
}
/** R290 (10-04): a point on a stem's painted centreline at parameter t (0 base, 1 tip): gen01's quadratic, its control point the
 * middle plus `bend` in x (paint.ts ribbon), so y is linear in t. Every branch, twig and node leaves its parent from here, never from
 * the straight chord (a bent stem's chord misses its paint by up to half the bend). */
export const along = (x0: number, y0: number, x1: number, y1: number, bend: number, t: number) => {
  const mx = (x0 + x1) / 2 + bend;
  return { x: (1 - t) ** 2 * x0 + 2 * t * (1 - t) * mx + t * t * x1, y: y0 + (y1 - y0) * t };
};
/** The centreline's x at height y on a stem from (x0, y0) to (x1, y1), y clamped to the stem. */
export const alongAtY = (x0: number, y0: number, x1: number, y1: number, bend: number, y: number) =>
  along(x0, y0, x1, y1, bend, y1 === y0 ? 0 : Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))).x;
/** gen06_garden.py:18: a succulent blade's width for its length, so a long blade stays slender; the sprite is baked at L = 40. */
export const bladeWidth = (L: number) => Math.max(4, Math.min(0.42 * L, 6.5 + 0.12 * L));
export const bladeXScale = (scale: number) => bladeWidth(scale * 40) / bladeWidth(40);
/** RG20: pups widen the rosette by COUNT, one per six plantings past seven, at most four. */
export const pupsByCount = (n: number) => Math.min(4, Math.floor(Math.max(0, n - 7) / 6));
/** gen03_garden.py:76-83 `twig()`: a short painted stem of length `L` at `ang` with 2, 3 or 4 leaves fanned at its tip; a leaf's
 * length is the baked length times `sz`, times 0.85 off the centre, so its sprite scale is `sz` or `0.85 sz`. Returns the tip.
 * RG29 (gen12_ground.py:19-23): at stage 0 the stem is SPROUT_X times as long and the leaves SPROUT_X times the size; the leaves'
 * doubling is baked in (BAKED_L's stage-0 entries), so only the stem's length is multiplied here. RG33 (never shrink) carries the
 * doubled stem to every stage. */
export const SPROUT_X = 2;
export function twig(acc: Acc, leafName: string, x: number, y: number, ang: number, L: number, sz: number, blades: 2 | 3 | 4, stage: Stage, k: number, color: string, shoot?: string) {
  const len = L * SPROUT_X;   // RG29 + RG33: the stage-0 stem is doubled and no later stage may be shorter, so every twig stem is doubled
  const ex = x + Math.sin(rad(ang)) * len, ey = y - Math.cos(rad(ang)) * len;
  stem(acc, "twig", x, y, ex, ey, 1.6 * k, 0.9 * k, color, 0, 1, shoot);
  const fan = blades === 2 ? [-38, 38] : blades === 3 ? [-48, 0, 48] : [-55, -18, 18, 55];
  for (const a of fan) sprite(acc, "leaf", `${leafName}-s${stage}`, ex, ey, ang + a, sz * (a === 0 ? 1 : 0.85), 2, shoot);
  return { x: ex, y: ey };
}
/** The layout's reach above the foot: every stem end and every sprite's reach (a leaf or blade its baked length times scale, a safe
 * bound whatever its rotation; the head 17.6 scale; a tier reaches sideways, 4 px up; a swelling its droplet's SWELL_REACH scale, a dot its radius; the rest 8 scale). */
export function topOf(parts: Placed[]): number {
  let top = 0;
  for (const p of parts) {
    if (p.kind === "stem") { top = Math.max(top, -p.y0, -p.y1); continue; }
    const base = BAKED_L[p.name.replace(/-s\d$/, "").replace(/-\d$/, "")];
    const reach = p.part === "tier" ? 4 * p.scale : base ? base[Number(p.name.match(/-s(\d)$/)?.[1] ?? 0)] * p.scale : p.part === "head" ? 17.6 * p.scale : p.part === "swelling" ? SWELL_REACH * p.scale : p.part === "dot" ? p.scale : 8 * p.scale;
    top = Math.max(top, -p.y + reach);
  }
  return top;
}
export const finish = (acc: Acc, growthPoint: { x: number; y: number }): PlantLayout => ({ parts: acc.parts, tips: acc.tips, growthPoint, top: topOf(acc.parts) });
/** R358 (10-05, "C droplet bud + sepals"): the swelling is a pale water-drop bud cupped by two sepals, one baked sprite per species
 * (bake.py swell_c, gen14_swell.py option C at grow 1.1 = the art at p 0.5), anchored at the bud's base. Its scale keeps the old circle's
 * range: min(4.6, 2.2 + 3.2 p) / 3.8, so 0.58 to 1.21 times the art. On a stem tip the base stands SWELL_LIFT scale above the tip (gen14:
 * 1.7 s) and the stem ending there is grown on along its own curve into the bud (SWELL_TUCK past the base, under the sepals): the leader is
 * the plant's own stem, one ribbon, so no seam where a second stem would meet it. SWELL_SEPAL: the sepals' reach below the base. */
export const SWELL_LIFT = 1.87, SWELL_TUCK = 0.5, SWELL_SEPAL = 0.8;
export const swellScale = (pending: number, k: number) => (Math.min(4.6, 2.2 + 3.2 * pending) / 3.8) * k;
/** The stem `s` continued along its own quadratic to height `y` (y is linear in t, so t = T past 1): the first 1 / T of the new stem is
 * the old one exactly, its centreline and its width (gen01's taper is linear in t) (`minW` only a guard far under any
 * real taper: a floor that fires would fatten the old stem). */
function grow(s: Extract<Placed, { kind: "stem" }>, y: number, minW: number) {
  const T = (y - s.y0) / (s.y1 - s.y0); if (!(T > 1)) return;
  const end = along(s.x0, s.y0, s.x1, s.y1, s.bend, T), cx = (1 - T) * s.x0 + T * ((s.x0 + s.x1) / 2 + s.bend);
  s.bend = cx - (s.x0 + end.x) / 2; s.x1 = end.x; s.y1 = end.y; s.w1 = Math.max(minW, s.w0 + (s.w1 - s.w0) * T);
}
/** The swelling at a plant's seat (x, y): a stem tip (the trunk, the sunflower's stem, the first cane, the spruce's leader) or, with no
 * stem ending there, the bud's base itself (the rosette, the fan). Spec 5: a fresh closed bud within 7 px of the seat wins the growth
 * point and the droplet rides above it; R351: so it does above the mandarin's highest sprout (its node within 14 px), clear of its
 * furled pair. `clear`: the base at least this far above the seat (the sunflower's head). Call it AFTER the species has placed its buds. */
export function swelling(acc: Acc, species: Species, x: number, y: number, pending: number, k: number, clear = 0) {
  if (pending <= 0) return;
  const s = swellScale(pending, k);
  const tip = acc.parts.find((p): p is Extract<Placed, { kind: "stem" }> => p.kind === "stem" && !p.shoot && Math.hypot(p.x1 - x, p.y1 - y) < 1e-6);
  let base = Math.min(tip ? y - SWELL_LIFT * s : y, y - clear);
  const bud = acc.parts.find((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite" && p.part === "bud" && Math.hypot(p.x - x, p.y - y) <= 7 * k);
  if (bud) base = Math.min(base, bud.y - 9.6 * bud.scale - 1 * k - SWELL_SEPAL * s);
  const nub = bud ? undefined : acc.parts.filter((p): p is Extract<Placed, { kind: "stem" }> => p.kind === "stem" && p.part === "nub" && Math.hypot(p.x0 - x, p.y0 - y) <= 14 * k).sort((a, b) => a.y0 - b.y0)[0];
  const furled = nub ? acc.parts.filter((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite" && p.part === "furl" && p.shoot === nub.shoot) : [];
  if (furled.length) base = Math.min(base, Math.min(...furled.map((p) => p.y - Math.cos(rad(p.rot)) * (BAKED_L[p.name.replace(/-s\d$/, "")]?.[Number(p.name.slice(-1))] ?? 12) * p.scale)) - 1 * k - SWELL_SEPAL * s);
  let bx = x;
  if (tip) { grow(tip, base - SWELL_TUCK * s, 0.4 * k); bx = alongAtY(tip.x0, tip.y0, tip.x1, tip.y1, tip.bend, base); }
  sprite(acc, "swelling", `swell-${species}`, bx, base, 0, s, 4);
}
export const band = (b: 0 | 1 | 2) => BAND_SCALE[b];
