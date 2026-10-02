import { BAKED_L, CAPS, COLORS, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, band, finish, sprite, stageOf, stem, swelling } from "./common";

/** gen03_garden.py plant_hsol3 with gen04's cap: a thick stem, broad pointed-heart leaves on short petioles alternating from the
 * right, a side stem with its own leaf at a branch node, the head once four leaves are open, tokens along the stem. */
export function sunflower(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const c = COLORS.hsol; const n = shoots.length;
  const rise = Math.min(CAPS.sunflower, 22 + 16 * n) * k, step = (rise - 14 * k) / Math.max(1, n);
  stem(acc, "trunk", 0, 0, -1 * k, -rise, 4 * k + 0.2 * n * k, 2.2 * k, c.green, 2 * k, 0);
  shoots.forEach((s, i) => {
    const ny = -12 * k - step * (i + 0.5), side = i % 2 === 0 ? 1 : -1, st = stageOf(s.ageDays), sz = band(s.band) * k;
    if (!s.opened) { sprite(acc, "bud", "bud-sunflower", side * 3 * k, ny, side * 30, sz, 2, s.id); return; }
    const pl = (6 + 2 * st) * k, px = side * pl * 0.9, py = ny - pl * 0.3;
    stem(acc, "petiole", 0, ny, px, py, 1.4 * k, 0.9 * k, c.deep, 0, 1, s.id);
    sprite(acc, "leaf", `leaf-sunflower-s${st}`, px, py, side * (68 - 10 * st), sz, 2, s.id);
    if (s.branch) {
      const ex = side * 22 * k, ey = ny - 14 * k;
      stem(acc, "branch", 0, ny, ex, ey, 2 * k, 1 * k, c.green, 0, 1, s.id);
      sprite(acc, "leaf", "leaf-sunflower-s3", ex, ey, side * 25, (14 * sz) / BAKED_L["leaf-sunflower"][3], 2, s.id);
    }
  });
  const top = -rise, opened = shoots.filter((s) => s.opened).length;
  if (o.head || opened >= 4) sprite(acc, "head", "head-sunflower", -1 * k, top, 0, k, 3);
  for (let q = 0; q < o.fruit; q++) sprite(acc, "token", "token-hsol", -1 * k + (q - (o.fruit - 1) / 2) * 9 * k, -rise * 0.55 + (q % 2) * 6 * k, 0, k, 4);
  if (o.ripening > 0) sprite(acc, "token", "token-hsol", -1 * k + (o.fruit - (o.fruit - 1) / 2) * 9 * k, -rise * 0.55 + (o.fruit % 2) * 6 * k, 0, k * (0.5 + 0.5 * o.ripening), 4);
  swelling(acc, -1 * k, top + 1.2 * k, o.pending, k);
  return finish(acc, { x: -1 * k, y: top });
}
