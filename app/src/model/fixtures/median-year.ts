// A made-up history for the preview, never written anywhere (nothing here reaches the API or the database).
// Research 14 supports the $17 a month figure; the $2 threshold, the 8.5 plantings a month and the 55 / 35 / 10 bands
// are gen01's working numbers for the review screens (gen01_garden.py:314).
import type { Asset } from "@/lib/coins";
import { fruitLadder, type GardenInput } from "@/model/garden";
export const PREVIEW_LABEL = "Preview: a made-up year for a typical saver. Your garden is on Home.";
const SPLIT: [Asset, number][] = [["SKR", 0.5], ["stORE", 0.12], ["hSOL", 0.1], ["JitoSOL", 0.1], ["JupSOL", 0.1], ["cbBTC", 0.08]];
const START = new Date("2026-10-08T12:00:00-07:00").getTime();
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Research 14: about $17 a month at a $2 threshold is about 8.5 plantings a month: 102 a year, 3.6 days apart with a little jitter;
 * bands 55 / 35 / 10 percent; the coin by the split's cumulative share; a watering every seven days. */
export function medianYear(seed = 7) {
  const rnd = mulberry32(seed); const plantings: GardenInput["plantings"] = []; const putInCents: Record<Asset, number> = { SKR: 0, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 };
  for (let i = 0; i < 102; i++) {
    const day = (i + 0.5) * (365 / 102) + (rnd() - 0.5) * 1.6; const r = rnd(); let acc = 0; let asset: Asset = "SKR";
    for (const [a, share] of SPLIT) { acc += share; if (r < acc) { asset = a; break; } }
    const b = rnd(); const cents = b < 0.55 ? 40 + Math.floor(rnd() * 59) : b < 0.9 ? 100 + Math.floor(rnd() * 400) : 501 + Math.floor(rnd() * 600);
    putInCents[asset] += cents;
    plantings.push({ id: `pv${i}`, ts: new Date(START + day * 86_400_000), asset, amountOutRaw: BigInt(cents) * 1000n, usdcInCents: cents });
  }
  const waterings = Array.from({ length: 52 }, (_, w) => new Date(START + (w * 7 + 3) * 86_400_000));
  return { plantings, waterings, putInCents };
}
/** The next coin as the API picks it (allocation.ts pickAsset): the largest shortfall against the split, SKR on ties; so seeds and the swelling stay put until a planting lands. */
function nextBy(plantings: GardenInput["plantings"]): Asset {
  const total = plantings.length || 1; let best: Asset = "SKR", gap = -Infinity;
  for (const [a, share] of SPLIT) { const g = share - plantings.filter((p) => p.asset === a).length / total; if (g > gap) { gap = g; best = a; } }
  return best;
}
/** The garden's input on day `day` of the made-up year: what has landed, the last watering, the change waiting, earned at 16.4 percent a year (the reconciled rule) for every coin but cbBTC, capped at 6 tokens a plant. */
export function previewInputAt(day: number, fx = medianYear()): GardenInput {
  const now = new Date(START + day * 86_400_000);
  const plantings = fx.plantings.filter((p) => p.ts.getTime() <= now.getTime());
  const watered = fx.waterings.filter((w) => w.getTime() <= now.getTime()); const wateredAt = watered[watered.length - 1] ?? null;
  const put = (a: Asset) => plantings.filter((p) => p.asset === a).reduce((s, p) => s + p.usdcInCents, 0);
  const earned: GardenInput["earned"] = {};
  for (const [a] of SPLIT) { const cents = put(a); if (cents > 0 && a !== "cbBTC") { const e = fruitLadder((cents / 100) * 0.164 * (day / 365), cents); earned[a] = { count: Math.min(6, e.count), progress: e.count >= 6 ? 0 : e.progress }; } }   // capped at 6 a plant: the review screens showed 2 to 8, and 12 on a back-row stem would read as a necklace
  const pending = Math.round(((day * 17) / 30) * 100) % 200;
  return {
    now, wateredAt, plantings, picks: [], skrPutInRaw: BigInt(put("SKR")) * 1000n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n,
    pendingCents: pending, thresholdCents: 200, nextAsset: nextBy(plantings), allocation: { SKR: 50, stORE: 12, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 8 },
    earned, storePutInRaw: BigInt(put("stORE")) * 1000n, joinedValueRaw: 0n, basket: null,
  };
}
