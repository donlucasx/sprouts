import { BAKED_L, BAND_SCALE, type PlantLayout, type Placed, type Stage } from "../species";

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
 * bound whatever its rotation; the head 17.6 scale; a tier reaches sideways, 4 px up; a swelling or dot its radius; the rest 8 scale). */
export function topOf(parts: Placed[]): number {
  let top = 0;
  for (const p of parts) {
    if (p.kind === "stem") { top = Math.max(top, -p.y0, -p.y1); continue; }
    const base = BAKED_L[p.name.replace(/-s\d$/, "").replace(/-\d$/, "")];
    const reach = p.part === "tier" ? 4 * p.scale : base ? base[Number(p.name.match(/-s(\d)$/)?.[1] ?? 0)] * p.scale : p.part === "head" ? 17.6 * p.scale : p.part === "swelling" || p.part === "dot" ? p.scale : 8 * p.scale;
    top = Math.max(top, -p.y + reach);
  }
  return top;
}
export const finish = (acc: Acc, growthPoint: { x: number; y: number }): PlantLayout => ({ parts: acc.parts, tips: acc.tips, growthPoint, top: topOf(acc.parts) });
/** The swelling (RG9, G9): a pale translucent circle at the growth point, radius min(4.6, 2.2 + 3.2 progress), no ring. Spec 5: a
 * fresh closed bud wins the growth point; when a bud sprite sits within 7 px of the anchor the swelling rides 2 px above that bud's
 * top (the bud sprite is 9.6 px tall at scale 1, anchored at its base). Call it AFTER the species has placed its buds. */
export function swelling(acc: Acc, x: number, y: number, pending: number, k: number) {
  if (pending <= 0) return;
  const r = Math.min(4.6, 2.2 + 3.2 * pending) * k;
  const bud = acc.parts.find((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite" && p.part === "bud" && Math.hypot(p.x - x, p.y - y) <= 7 * k);
  // R351: the mandarin's highest sprout, its node within 14 px (its furled pair reaches up past the node): ride 2 px above its leaves'
  // highest tip when they reach the swelling, so the circle never sits on the sprout
  const nub = bud ? undefined : acc.parts.filter((p): p is Extract<Placed, { kind: "stem" }> => p.kind === "stem" && p.part === "nub" && Math.hypot(p.x0 - x, p.y0 - y) <= 14 * k).sort((a, b) => a.y0 - b.y0)[0];
  const furled = nub ? acc.parts.filter((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite" && p.part === "furl" && p.shoot === nub.shoot) : [];
  const sproutTop = furled.length ? Math.min(...furled.map((p) => p.y - Math.cos(rad(p.rot)) * (BAKED_L[p.name.replace(/-s\d$/, "")]?.[Number(p.name.slice(-1))] ?? 12) * p.scale)) : null;
  sprite(acc, "swelling", "swelling", x, bud ? bud.y - 9.6 * bud.scale - 2 * k - r : sproutTop !== null ? Math.min(y, sproutTop - 2 * k - r) : y, 0, r, 4);
}
export const band = (b: 0 | 1 | 2) => BAND_SCALE[b];
