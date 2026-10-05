import { BAKED_L, CAPS, SOIL, type LayoutOpts, type PlantLayout, type ShootIn } from "../species";
import { type Acc, band, finish, sprite, stageOf, stem, swelling } from "./common";

/** gen03_garden.py:266-271 plant_cbbtc3 with gen04's cap: a leader in post brown, a needled tier per shoot whose arms lengthen with
 * the tiers above it (2.5 px each, to six) while the needles keep their size, the silver tip always, tokens at tier ends. The tier
 * sprite is baked at older = 0 and stretched in x alone by the arm ratio (xScale); its y scale is the band. */
export function spruce(shoots: ShootIn[], o: LayoutOpts, k: number): PlantLayout {
  const acc: Acc = { parts: [], tips: [] }; const n = shoots.length;
  const rise = Math.min(CAPS.spruce, 16 + 13 * n) * k, step = (rise - 8 * k) / Math.max(1, n);
  stem(acc, "trunk", 0, 0, 0, -rise, 3 * k + 0.2 * n * k, 1.2 * k, SOIL.post, 0, 0);
  shoots.forEach((s, i) => {
    const ny = -8 * k - step * (i + 0.5), st = stageOf(s.ageDays), sz = band(s.band) * k, older = n - 1 - i;
    if (!s.opened) { sprite(acc, "bud", "bud-spruce", 0, ny, 0, 0.9 * sz, 2, s.id); return; }
    const baked = BAKED_L["tier-spruce"][st], arm = baked + 2.5 * Math.min(older, 6);
    sprite(acc, "tier", `tier-spruce-s${st}`, 0, ny, 0, sz, 2, s.id, arm / baked);   // scale = band * k on both axes; xScale = the arm ratio alone (it multiplies scale, so sz must not be in it), so the needles stay 2.2 by 4.5 as gen03 draws them
  });
  sprite(acc, "tip", "tip-spruce", 0, -rise, 0, k, 3);
  for (let q = 0; q < o.fruit; q++) sprite(acc, "token", "token-cbbtc", (q - (o.fruit - 1) / 2) * 10 * k, -rise * (0.35 + 0.1 * (q % 3)), 0, k, 4);
  if (o.ripening > 0) sprite(acc, "token", "token-cbbtc", (o.fruit - (o.fruit - 1) / 2) * 10 * k, -rise * (0.35 + 0.1 * (o.fruit % 3)), 0, k * (0.5 + 0.5 * o.ripening), 4);
  swelling(acc, "spruce", 0, -rise, o.pending, k);
  return finish(acc, { x: 0, y: -rise });
}
