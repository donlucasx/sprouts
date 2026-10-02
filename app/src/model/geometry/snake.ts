import { COLORS, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, band, finish, sprite, stageOf, swelling } from "./common";

/** gen04_garden.py:143-159: upright banded blades from the soil in fans of five; fan f stands at ±(12 + 7 · ceil(f / 2)); blade j
 * in a fan sits side · (2.4 + 1.8 · floor(j / 2)) out at side · (5 + 5 · floor(j / 2)) degrees. At most four fans (spec 5); the
 * twenty-first and later shoots join the fans round-robin. The four mint bands are baked into the blade sprite. */
export function snake(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const n = shoots.length;
  const fansN = Math.min(4, Math.ceil(Math.max(1, n) / 5));
  const fans: ShootIn[][] = Array.from({ length: fansN }, () => []);
  shoots.forEach((s, i) => { fans[i < 20 ? Math.floor(i / 5) : (i - 20) % 4].push(s); });
  fans.forEach((fan, fi) => {
    const fx = fi === 0 ? 0 : (fi % 2 ? 1 : -1) * (12 + 7 * Math.floor((fi + 1) / 2)) * k;
    fan.forEach((s, j) => {
      const st = stageOf(s.ageDays), sz = band(s.band) * k, side = j % 2 === 0 ? -1 : 1, off = side * (2.4 + 1.8 * Math.floor(j / 2)) * k;
      if (!s.opened) { sprite(acc, "bud", "bud-snake", fx + off, -1 * k, side * 12, 0.9 * sz, 2, s.id); return; }
      sprite(acc, "blade", `blade-snake-s${st}`, fx + off, 0, side * (5 + 5 * Math.floor(j / 2)), sz, 2 + j * 0.01, s.id);
    });
  });
  for (let q = 0; q < o.fruit; q++) sprite(acc, "token", "token-jitosol", (q - (o.fruit - 1) / 2) * 8 * k, -4 * k, 0, k, 4);
  if (o.ripening > 0) sprite(acc, "token", "token-jitosol", (o.fruit - (o.fruit - 1) / 2) * 8 * k, -4 * k, 0, k * (0.5 + 0.5 * o.ripening), 4);
  swelling(acc, 4 * k, -4 * k, o.pending, k);
  void COLORS;
  return finish(acc, { x: 4 * k, y: -4 * k });
}
