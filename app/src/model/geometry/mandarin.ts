import { CAPS, COLORS, SOIL, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, band, finish, rad, sprite, stageOf, stem, swelling, twig } from "./common";

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
  const trunkX = (y: number) => { const t = trunkH > 0 ? Math.min(1, Math.max(0, -y / trunkH)) : 0; const mx = 0.75 * k - 2 * k; return 2 * (1 - t) * t * mx + t * t * 1.5 * k; };
  const brNodes = main.map((s, i) => (s.branch ? i : -1)).filter((i) => i >= 0).slice(0, 8);
  const on = new Map<number, ShootIn[]>(brNodes.map((i) => [i, []]));
  const overflow: ShootIn[] = [];
  extra.forEach((s, j) => { if (brNodes.length === 0) overflow.push(s); else on.get(brNodes[j % brNodes.length])!.push(s); });
  const nodeY = (i: number) => -8 * k - step * (i + 0.5);
  const branch = (bx: number, by: number, side: number, lvs: ShootIn[], L: number, ang: number, depth: number) => {
    const ex = bx + side * Math.sin(rad(ang)) * L, ey = by - Math.cos(rad(ang)) * L;
    stem(acc, "branch", bx, by, ex, ey, (depth === 0 ? 2.6 : 1.5) * k, 1.0 * k, depth === 0 ? woody : c.deep, side * 2, 1, lvs[0]?.id);
    const shown = lvs.slice(0, 5), rest = lvs.slice(5);
    shown.forEach((lf, q) => {
      const t = (q + 1) / (shown.length + 0.6), lx = bx + (ex - bx) * t, ly = by + (ey - by) * t, st = stageOf(lf.ageDays), sz = band(lf.band) * k * 0.9;
      if (!lf.opened) { sprite(acc, "bud", "bud-mandarin", lx, ly, side * 40, 0.9 * sz, 2, lf.id); return; }
      acc.tips.push(twig(acc, "leaf-mandarin", lx, ly, side * (ang + (q % 2 ? -35 : 25)), 8 * k, sz, st <= 1 ? 2 : st === 2 ? 3 : 4, st, k, c.deep, lf.id));
    });
    if (rest.length === 0) return;
    if (depth < 2) branch(bx + (ex - bx) * 0.6, by + (ey - by) * 0.6, side, rest, L * 0.7, ang - 18, depth + 1); else overflow.push(...rest);
  };
  main.forEach((s, i) => {
    const ny = nodeY(i), side = i % 2 === 0 ? -1 : 1, st = stageOf(s.ageDays), sz = band(s.band) * k, tx = trunkX(ny);
    if (!s.opened) { sprite(acc, "bud", "bud-mandarin", tx + side * 3 * k, ny, side * 35, 0.9 * sz, 2, s.id); return; }   // RG19: a branch node is opened by definition, so a bud never carries shoots
    if (on.has(i)) {
      const bi = brNodes.indexOf(i), bside = bi % 2 === 0 ? -1 : 1, lvs = on.get(i)!;
      const L = (18 + 5 * Math.min(8, lvs.length + 1)) * k * (1 + 0.05 * bi);
      branch(tx, ny, bside, [s, ...lvs], L, 64 - 7 * bi, 0);
    } else acc.tips.push(twig(acc, "leaf-mandarin", tx + side * 1.5 * k, ny, side * 58, 7 * k, sz, st <= 1 ? 2 : 3, st, k, c.deep, s.id));
  });
  overflow.forEach((s, j) => {
    const side = j % 2 === 0 ? 1 : -1, st = stageOf(s.ageDays), sz = band(s.band) * k * 0.9, ny = -trunkH + 3 * k * (1 + Math.floor(j / 2)), tx = trunkX(ny);
    if (!s.opened) sprite(acc, "bud", "bud-mandarin", tx + side * 3 * k, ny, side * 35, 0.9 * sz, 2, s.id);
    else acc.tips.push(twig(acc, "leaf-mandarin", tx + side * 1.5 * k, ny, side * 58, 7 * k, sz, st <= 1 ? 2 : 3, st, k, c.deep, s.id));
  });
  // RG16, R97: tokens on 4 px stalks at the highest twig tips (deterministic: the generator sampled them); the blossom is the next one
  const tips = [...acc.tips].sort((a, b) => a.y - b.y);
  for (let q = 0; q < Math.min(o.fruit, tips.length); q++) {
    const t = tips[q]; stem(acc, "stalk", t.x, t.y, t.x, t.y + 4 * k, 1 * k, 1 * k, c.deep, 0, 3); sprite(acc, "token", "token-skr", t.x, t.y + 7.5 * k, 0, k, 4);
  }
  if (o.ripening > 0 && tips.length > o.fruit) { const t = tips[o.fruit]; sprite(acc, "blossom", "blossom-mandarin", t.x, t.y + 3 * k, 0, k * (0.6 + 0.4 * o.ripening), 4); }
  swelling(acc, 1.5 * k, -trunkH - 1.2 * k, o.pending, k);   // G10: seated on the tip, overlapping it by a third of its radius
  return finish(acc, { x: 1.5 * k, y: -trunkH });
}
