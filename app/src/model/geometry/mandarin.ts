import { CAPS, COLORS, SOIL, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, along, alongAtY, band, finish, rad, stageOf, stem, sprite, swelling, twig } from "./common";
import { unfurlParts } from "../sprout";

/** RG14, gen04_garden.py:70-110 with RG19's trigger (gen09) and G10's seating. The trunk shows 12 nodes; shoots 13 and later go
 * round-robin to at most 8 branch nodes; a branch shows 5 twigs then two sub-branches; past that, and with no branch node, shoots
 * return to the trunk's top as twigs: nothing is dropped. Twigs leave the bowed trunk's actual centreline at their node. */
export function mandarin(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const c = COLORS.skr; const n = shoots.length;
  const main = shoots.slice(0, 12), extra = shoots.slice(12), m = main.length;
  const trunkH = Math.min(CAPS.mandarinTrunk, 16 + 10 * m) * k, step = (trunkH - 8 * k) / Math.max(1, m);
  const woody = n > 8 ? SOIL.woody : c.deep;
  stem(acc, "trunk", 0, 0, 1.5 * k, -trunkH, Math.min(10, 3 + 0.16 * n) * k, 2 * k, woody, -2 * k, 0);
  // gen01's stem is a quadratic with its control point at the middle plus the bend; y is linear in t, so x at a height is exact
  const trunkX = (y: number) => alongAtY(0, 0, 1.5 * k, -trunkH, -2 * k, y);
  const brNodes = main.map((s, i) => (s.branch ? i : -1)).filter((i) => i >= 0).slice(0, 8);
  const on = new Map<number, ShootIn[]>(brNodes.map((i) => [i, []]));
  const overflow: ShootIn[] = [];
  extra.forEach((s, j) => { if (brNodes.length === 0) overflow.push(s); else on.get(brNodes[j % brNodes.length])!.push(s); });
  /** R351: a closed shoot is the twig it will become (a pair, at its stage), folded: the nub and the furled pair at the twig's node,
   * so the sprout sits on the trunk or branch and opens in place (model/sprout.ts). No tip: tokens hang on open twigs only. */
  const sprout = (x: number, y: number, ang: number, L: number, sz: number, st: ReturnType<typeof stageOf>, id: string) => {
    const tmp: Acc = { parts: [], tips: [] };
    twig(tmp, "leaf-mandarin", x, y, ang, L, sz, 2, st, k, c.deep, id);
    acc.parts.push(...unfurlParts(tmp.parts, 0));
  };
  const nodeY = (i: number) => -8 * k - step * (i + 0.5);
  const branch = (bx: number, by: number, side: number, lvs: ShootIn[], L: number, ang: number, depth: number) => {
    const ex = bx + side * Math.sin(rad(ang)) * L, ey = by - Math.cos(rad(ang)) * L, bend = side * 2;
    const on = (t: number) => along(bx, by, ex, ey, bend, t);   // R290: twigs and the sub-branch leave the BENT branch's paint, not its chord
    stem(acc, "branch", bx, by, ex, ey, (depth === 0 ? 2.6 : 1.5) * k, 1.0 * k, depth === 0 ? woody : c.deep, bend, 1, lvs[0]?.id);
    const shown = lvs.slice(0, 5), rest = lvs.slice(5);
    shown.forEach((lf, q) => {
      const { x: lx, y: ly } = on((q + 1) / (shown.length + 0.6)), st = stageOf(lf.ageDays), sz = band(lf.band) * k * 0.9;
      const tang = side * (ang + (q % 2 ? -35 : 25));
      if (!lf.opened) { sprout(lx, ly, tang, 8 * k, sz, st, lf.id); return; }
      acc.tips.push(twig(acc, "leaf-mandarin", lx, ly, tang, 8 * k, sz, st <= 1 ? 2 : st === 2 ? 3 : 4, st, k, c.deep, lf.id));
    });
    if (rest.length === 0) return;
    if (depth < 2) branch(on(0.6).x, on(0.6).y, side, rest, L * 0.7, ang - 18, depth + 1); else overflow.push(...rest);
  };
  main.forEach((s, i) => {
    const ny = nodeY(i), side = i % 2 === 0 ? -1 : 1, st = stageOf(s.ageDays), sz = band(s.band) * k, tx = trunkX(ny);
    if (!s.opened) { sprout(tx, ny, side * 58, 7 * k, sz, st, s.id); return; }   // RG19: a branch node is opened by definition, so a bud never carries shoots
    if (on.has(i)) {
      const bi = brNodes.indexOf(i), bside = bi % 2 === 0 ? -1 : 1, lvs = on.get(i)!;
      const L = (18 + 5 * Math.min(8, lvs.length + 1)) * k * (1 + 0.05 * bi);
      branch(tx, ny, bside, [s, ...lvs], L, 64 - 7 * bi, 0);
    } else acc.tips.push(twig(acc, "leaf-mandarin", tx, ny, side * 58, 7 * k, sz, st <= 1 ? 2 : 3, st, k, c.deep, s.id));
  });
  overflow.forEach((s, j) => {
    const side = j % 2 === 0 ? 1 : -1, st = stageOf(s.ageDays), sz = band(s.band) * k * 0.9, ny = -trunkH + 3 * k * (1 + Math.floor(j / 2)), tx = trunkX(ny);
    if (!s.opened) sprout(tx, ny, side * 58, 7 * k, sz, st, s.id);
    else acc.tips.push(twig(acc, "leaf-mandarin", tx, ny, side * 58, 7 * k, sz, st <= 1 ? 2 : 3, st, k, c.deep, s.id));
  });
  // RG16, R97: tokens on 4 px stalks at the highest twig tips (deterministic: the generator sampled them); the blossom is the next one
  const tips = [...acc.tips].sort((a, b) => a.y - b.y);
  for (let q = 0; q < Math.min(o.fruit, tips.length); q++) {
    const t = tips[q]; stem(acc, "stalk", t.x, t.y, t.x, t.y + 4 * k, 1 * k, 1 * k, c.deep, 0, 3); sprite(acc, "token", "token-skr", t.x, t.y + 7.5 * k, 0, k, 4);
  }
  if (o.ripening > 0 && tips.length > o.fruit) { const t = tips[o.fruit]; sprite(acc, "blossom", "blossom-mandarin", t.x, t.y + 3 * k, 0, k * (0.6 + 0.4 * o.ripening), 4); }
  swelling(acc, "mandarin", 1.5 * k, -trunkH, o.pending, k);   // R358: the droplet bud on the trunk's tip, the trunk grown on into it
  return finish(acc, { x: 1.5 * k, y: -trunkH });
}
