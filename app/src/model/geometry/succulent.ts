import { CAPS, COLORS, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, band, bladeXScale, finish, sprite, stageOf, stem, swelling } from "./common";

/** RG13, G6, gen06_garden.py:26-50: seven blades shown, the oldest in the centre upright, newer pairs one ring out at 24, 40, 56
 * degrees; past seven every planting lengthens the blades toward their caps (78 / 58 / 40), never a ring; the gold stalk at four
 * plantings and a 30-day shoot carries the earned tokens (RG20), three gold dots until the first. */
export function succulent(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const c = COLORS.ore; const n = shoots.length;
  const shown = shoots.slice(0, 7), extra = Math.max(0, n - 7);
  for (let i = shown.length - 1; i >= 0; i--) {
    const s = shown[i], st = stageOf(s.ageDays), sz = band(s.band) * k, ring = Math.floor((i + 1) / 2), side = i % 2 === 1 ? -1 : 1, ang = i > 0 ? side * (8 + 16 * ring) : 0;
    const base = [12, 20, 30, 40][st];
    let L = (base * (1 - 0.2 * ring) + 4 * Math.max(0, 3 - ring) + (ring === 0 ? 6 : ring === 1 ? 3 : 1.5) * extra) * sz;
    L = Math.min(L, CAPS.succulent[Math.min(ring, 2)] * k);
    if (!s.opened) { sprite(acc, "bud", "bud-succulent", side * (2 + 3 * ring) * k, -2 * k, ang, 0.9 * sz, 2, s.id); continue; }
    sprite(acc, "blade", `blade-succulent-${(ring + (side < 0 ? 0 : 1)) % 3}`, side * (1.5 + 3.2 * ring) * k, 0, ang, L / 40, 2 - ring * 0.1, s.id, bladeXScale(L / 40));   // slender: x follows gen06:18's width
  }
  if (n >= 4 && Math.max(...shoots.map((s) => s.ageDays)) >= 30) {
    const top = Math.max(-(62 + 5 * extra) * k, -CAPS.stalk * k);
    stem(acc, "stalk", 1 * k, -14 * k, 4 * k, top, 1.8 * k, 1.0 * k, c.deep, 0, 1);
    const tokens = Math.min(o.fruit, 4);
    for (let q = 0; q < tokens; q++) sprite(acc, "token", "token-ore", 4 * k - q * 1.2 * k, top + 4 * k + q * 8 * k, 0, (3.2 / 3.6) * k, 3);
    if (tokens === 0) for (let q = 0; q < 3; q++) sprite(acc, "dot", "dot", 4 * k - q * 2.5 * k, top + q * 5 * k, 0, 2.2 * k, 3);
    if (o.ripening > 0 && tokens < 4) sprite(acc, "token", "token-ore", 4 * k - tokens * 1.2 * k, top + 4 * k + tokens * 8 * k, 0, (3.2 / 3.6) * k * (0.5 + 0.5 * o.ripening), 3);
  }
  for (let p = 0; p < o.pups; p++) sprite(acc, "pup", "pup-succulent", (p % 2 === 0 ? -1 : 1) * (20 + 6 * Math.floor(p / 2)) * k, 0, 0, k, 1);
  swelling(acc, "succulent", 0, -5 * k, o.pending, k);   // R358: the droplet's base in the rosette's heart
  return finish(acc, { x: 0, y: -6 * k });
}
