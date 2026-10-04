import { CAPS, COLORS, SOIL, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, alongAtY, band, finish, sprite, stageOf, stem, swelling, twig } from "./common";

/** RG15, gen04_garden.py:161-180: canes of eight shoots from the base; cane c leans ±(14 + 6 · ceil(c / 2)) and rises
 * min(161.5, 18 + 15 m), later canes times 0.85; a twig of two then three small ovals per node; at most four canes (spec 5), later
 * shoots join them round-robin; token clusters of three at the newest tips; the bell is the ripening marker. */
export function blueberry(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const c = COLORS.jupsol; const n = shoots.length;
  const canesN = Math.min(4, Math.ceil(Math.max(1, n) / 8));
  const canes: ShootIn[][] = Array.from({ length: canesN }, () => []);
  shoots.forEach((s, i) => { canes[i < 32 ? Math.floor(i / 8) : (i - 32) % 4].push(s); });
  let firstTip = { x: 0, y: -(18 * k) };
  canes.forEach((cane, ci) => {
    const lean = (ci === 0 ? 0 : (ci % 2 ? 1 : -1) * (14 + 6 * Math.floor((ci + 1) / 2))) * k, m = cane.length;
    const rise = Math.min(CAPS.blueberry, 18 + 15 * m) * k * (ci === 0 ? 1 : 0.85), step = (rise - 8 * k) / Math.max(1, m);
    stem(acc, "cane", 0, 0, lean, -rise, 2.6 * k, 1.1 * k, n > 6 ? SOIL.caneWood : c.deep, lean * 0.3, 0);
    if (ci === 0) firstTip = { x: lean, y: -rise };
    cane.forEach((s, i) => {
      const ny = -8 * k - step * (i + 0.5), nx = alongAtY(0, 0, lean, -rise, lean * 0.3, ny), side = i % 2 === 0 ? -1 : 1, st = stageOf(s.ageDays), sz = band(s.band) * k;
      if (!s.opened) { sprite(acc, "bud", "bud-blueberry", nx + side * 2 * k, ny, side * 35, 0.9 * sz, 2, s.id); return; }
      acc.tips.push(twig(acc, "leaf-blueberry", nx, ny, side * (62 - 6 * (i % 3)), (8 + 3 * st) * k, sz, st >= 2 ? 3 : 2, st, k, c.deep, s.id));
    });
  });
  const tips = [...acc.tips].sort((a, b) => a.y - b.y);
  for (let q = 0; q < Math.min(o.fruit, tips.length); q++) for (const [dx, dy] of [[0, 0], [-3.4, 2.6], [3.4, 2.8]]) sprite(acc, "token", "token-jupsol", tips[q].x + dx * k, tips[q].y + 6 * k + dy * k, 0, k, 4);
  if (o.ripening > 0 && tips.length > o.fruit) sprite(acc, "bell", "bell-blueberry", tips[o.fruit].x, tips[o.fruit].y + 2 * k, 0, k * (0.6 + 0.4 * o.ripening), 4);
  swelling(acc, firstTip.x, firstTip.y + 1.2 * k, o.pending, k);
  return finish(acc, firstTip);
}
