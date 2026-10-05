import type { MeResponse } from "./api";
import { fruitLadder, type GardenInput, type PlantId } from "@/model/garden";
import { ASSETS, isLend, isRetired, type LiveAsset } from "./coins";

/** R360: under one cent of value is zero (dust). */
export const DUST_USD = 0.01;
/** R360: per coin, the newest planting (ISO time) seen while the coin was at zero; plantings at or before it never draw again. */
export type ZeroMarks = Partial<Record<LiveAsset, string>>;

/**
 * R360: what the user holds NOW, per live coin: true held, false at zero (under DUST_USD, or nothing), null unknown (the lending read
 * failed, so nothing may leave on it). SKR in the basket is still held (on its way, not yet withdrawn). Without a price the raw amount
 * decides. Lending reads `positions` (receipts from chain) when the API serves them, else the holding.
 */
export function heldNow(me: MeResponse): Record<LiveAsset, boolean | null> {
  const out = {} as Record<LiveAsset, boolean | null>;
  const worth = (raw: bigint, usd: number | null) => raw > 0n && (usd === null || usd >= DUST_USD);
  for (const a of ASSETS) {
    if (a === "SKR") {
      const staked = BigInt(me.pot.skrStakedRaw);
      out.SKR = me.basket !== null || worth(staked, me.pot.skrUsd === null ? null : (Number(staked) / 1e6) * me.pot.skrUsd);
    } else if (isLend(a) && me.positions !== undefined) {
      out[a] = me.positionsRead === "failed" ? null : me.positions.some((p) => p.asset === a && worth(BigInt(p.receiptRaw), p.valueUsd));
    } else {
      const h = me.holdings.find((x) => x.asset === a);
      out[a] = h !== undefined && worth(BigInt(h.heldRaw), h.valueUsd);
    }
  }
  return out;
}

/**
 * R360: the marks after this read. A coin seen at zero is marked at its newest planting (so a later planting starts it from a seedling);
 * a held or unknown coin keeps its mark as it is; marks only move forward. A lending zero is marked only on an API that says its read
 * succeeded (`positionsRead: "ok"`): an older API serves an empty list on a failed read, which must never erase history for good.
 */
export function nextZeroMarks(me: MeResponse, prev: ZeroMarks): ZeroMarks {
  const held = heldNow(me);
  const out: ZeroMarks = { ...prev };
  for (const a of ASSETS) {
    if (held[a] !== false) continue;
    if (isLend(a) && me.positions !== undefined && me.positionsRead !== "ok") continue;
    const newest = me.history.plantings.filter((p) => p.asset === a).map((p) => p.ts).sort((x, y) => new Date(x).getTime() - new Date(y).getTime()).at(-1);
    // Review: a planting booked within 10 minutes of this read may not be in the balance yet; marking on it would hide it for good.
    if (newest && new Date(me.pot.asOf).getTime() - new Date(newest).getTime() < 10 * 60_000) continue;
    if (newest && (!out[a] || new Date(newest).getTime() > new Date(out[a]!).getTime())) out[a] = newest;
  }
  return out;
}

/** The API's numbers (decimal strings on the wire) into the model's input; the app never computes money itself. Retired coins' plantings
 * and picks are dropped (contracts 7.3, R281): their past sprouts leave the garden. */
/** R360: only what is held now draws (a coin at zero leaves with its stake), and a coin's plantings at or before its zero mark never draw. */
export function toGardenInput(me: MeResponse, now: Date, wateredPlants: PlantId[] | null = null, zeroMarks: ZeroMarks = {}): GardenInput {
  const held = heldNow(me);
  const draws = (asset: LiveAsset, ts: string) => held[asset] !== false && !(zeroMarks[asset] && new Date(ts).getTime() <= new Date(zeroMarks[asset]!).getTime());
  const b = (s: string) => BigInt(s);
  // RG16: every coin's earned as token-fruit. SKR's ladder is the pot's (the API computes it); the others from their holding.
  const earned: GardenInput["earned"] = { SKR: { count: me.pot.fruit, progress: me.pot.nextFruitProgress } };
  for (const h of me.holdings) if (h.asset !== "SKR" && h.earnedUsd !== null) earned[h.asset] = fruitLadder(h.earnedUsd, h.putInCents);
  const plantings: GardenInput["plantings"] = [];
  for (const p of me.history.plantings) if (!isRetired(p.asset) && draws(p.asset as LiveAsset, p.ts)) plantings.push({ id: p.id, ts: new Date(p.ts), asset: p.asset as LiveAsset, amountOutRaw: b(p.amountOutRaw), usdcInCents: p.usdcInCents });
  const picks: GardenInput["picks"] = [];
  for (const p of me.history.picks) if (!isRetired(p.asset) && draws(p.asset as LiveAsset, p.ts)) picks.push({ ts: new Date(p.ts), asset: p.asset as LiveAsset, amountRaw: b(p.amountRaw) });
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
    storePutInRaw: b(me.pot.storePutInRaw), joinedValueRaw: held.SKR === false ? 0n : b(me.pot.joinedValueRaw),
    everPlanted: me.history.plantings.some((p) => !isRetired(p.asset)),
    basket: me.basket ? { amountRaw: b(me.basket.amountRaw), readyAt: new Date(me.basket.readyAt) } : null,
  };
}
