import type { MeResponse } from "./api";
import { fruitLadder, type GardenInput } from "@/model/garden";
import type { Asset } from "./coins";

/** DEMO (device check 2, throwaway branch demo/check-2, never merged): the newest planting reads as a waiting bud until the
 * first watering of this app run; a reload resets it. */
export const demo = { watered: false };
function demoWateredAt(me: MeResponse): Date | null {
  const real = me.user.wateredAt ? new Date(me.user.wateredAt) : null;
  if (demo.watered || me.history.plantings.length === 0) return real;
  const newest = Math.max(...me.history.plantings.map((p) => new Date(p.ts).getTime()));
  return real === null || real.getTime() >= newest ? new Date(newest - 1) : real;
}

/** The API's numbers (decimal strings on the wire) into the model's input; the app never computes money itself. */
export function toGardenInput(me: MeResponse, now: Date): GardenInput {
  const b = (s: string) => BigInt(s);
  // RG16: every coin's earned as token-fruit. SKR's ladder is the pot's (the API computes it); the others from their holding.
  const earned: GardenInput["earned"] = { SKR: { count: me.pot.fruit, progress: me.pot.nextFruitProgress } };
  for (const h of me.holdings) if (h.asset !== "SKR" && h.earnedUsd !== null) earned[h.asset as Asset] = fruitLadder(h.earnedUsd, h.putInCents);
  return {
    now,
    wateredAt: demoWateredAt(me),
    plantings: me.history.plantings.map((p) => ({ id: p.id, ts: new Date(p.ts), asset: p.asset, amountOutRaw: b(p.amountOutRaw), usdcInCents: p.usdcInCents })),
    picks: me.history.picks.map((p) => ({ ts: new Date(p.ts), asset: p.asset, amountRaw: b(p.amountRaw) })),
    skrPutInRaw: b(me.pot.skrPutInRaw), skrEarnedRaw: b(me.pot.skrEarnedRaw), skrPickedRaw: b(me.pot.skrPickedRaw), skrPrincipalPickedRaw: b(me.pot.skrPrincipalPickedRaw),
    pendingCents: me.nextPlanting.pendingCents, thresholdCents: me.nextPlanting.thresholdCents, nextAsset: me.nextPlanting.asset,
    allocation: me.rules.allocation,   // today's split in both modes (spec 5, 10); the manager block's stopSplit is a preview and is never read here
    earned,
    storePutInRaw: b(me.pot.storePutInRaw), joinedValueRaw: b(me.pot.joinedValueRaw),
    basket: me.basket ? { amountRaw: b(me.basket.amountRaw), readyAt: new Date(me.basket.readyAt) } : null,
  };
}
