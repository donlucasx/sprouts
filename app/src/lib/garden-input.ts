import type { MeResponse } from "./api";
import { fruitLadder, type GardenInput, type PlantId } from "@/model/garden";
import { ASSETS, isRetired, type LiveAsset } from "./coins";

/** The API's numbers (decimal strings on the wire) into the model's input; the app never computes money itself. Retired coins' plantings
 * and picks are dropped (contracts 7.3, R281): their past sprouts leave the garden. */
export function toGardenInput(me: MeResponse, now: Date, wateredPlants: PlantId[] | null = null): GardenInput {
  const b = (s: string) => BigInt(s);
  // RG16: every coin's earned as token-fruit. SKR's ladder is the pot's (the API computes it); the others from their holding.
  const earned: GardenInput["earned"] = { SKR: { count: me.pot.fruit, progress: me.pot.nextFruitProgress } };
  for (const h of me.holdings) if (h.asset !== "SKR" && h.earnedUsd !== null) earned[h.asset] = fruitLadder(h.earnedUsd, h.putInCents);
  const plantings: GardenInput["plantings"] = [];
  for (const p of me.history.plantings) if (!isRetired(p.asset)) plantings.push({ id: p.id, ts: new Date(p.ts), asset: p.asset as LiveAsset, amountOutRaw: b(p.amountOutRaw), usdcInCents: p.usdcInCents });
  const picks: GardenInput["picks"] = [];
  for (const p of me.history.picks) if (!isRetired(p.asset)) picks.push({ ts: new Date(p.ts), asset: p.asset as LiveAsset, amountRaw: b(p.amountRaw) });
  // Contracts 5.2: a leashed user's legs not enabled today plant nothing; with legsEnabled null or absent, the split as served
  const enabled = me.manager.legsEnabled ?? null;
  const allocation = { ...me.rules.allocation };
  if (enabled) for (const a of ASSETS) if (!enabled.includes(a)) allocation[a] = 0;
  return {
    now,
    wateredAt: me.user.wateredAt ? new Date(me.user.wateredAt) : null, wateredPlants,
    plantings,
    picks,
    skrPutInRaw: b(me.pot.skrPutInRaw), skrEarnedRaw: b(me.pot.skrEarnedRaw), skrPickedRaw: b(me.pot.skrPickedRaw), skrPrincipalPickedRaw: b(me.pot.skrPrincipalPickedRaw),
    pendingCents: me.nextPlanting.pendingCents, thresholdCents: me.nextPlanting.thresholdCents, nextAsset: me.nextPlanting.asset,
    allocation,   // today's split in both modes (spec 5, 10), a leg the leash has not enabled at 0 (spec 6.5): Home shows nothing for it
    lendSigns: me.lendSigns ?? null,
    earned,
    storePutInRaw: b(me.pot.storePutInRaw), joinedValueRaw: b(me.pot.joinedValueRaw),
    basket: me.basket ? { amountRaw: b(me.basket.amountRaw), readyAt: new Date(me.basket.readyAt) } : null,
  };
}
