import { describe, it, expect } from "vitest";
import { buildScene, type GardenInput } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { packScene } from "@/model/spread";
import { BASKET, basketAt, bedSpan, drawnSpans, frameFor, FRAME, SIGN_SOIL_MARGIN, signPlacement, stakeSpots } from "@/model/layout";
import { frameGround, soilBottomAt } from "@/model/soil-clip";

// The owner's garden on the Seeker (10-05): SKR planted Oct 5 for $4.32, stORE $1.00 today, a USDC lending planting withdrawn to zero,
// change waiting for stORE, and SKR in the basket (an unstake on its way): the basket drew over the young stORE blade's base.
const NOW = new Date("2026-10-05T20:00:00-07:00"), DAY = 86_400_000;
const owner: GardenInput = {
  now: NOW, wateredAt: NOW, plantings: [
    { id: "s", ts: new Date(NOW.getTime() - 0.5 * DAY), asset: "SKR", amountOutRaw: 4n, usdcInCents: 432 },
    { id: "o", ts: new Date(NOW.getTime() - 0.1 * DAY), asset: "stORE", amountOutRaw: 1n, usdcInCents: 100 },
    { id: "u", ts: new Date(NOW.getTime() - 3 * DAY), asset: "USDC_LEND", amountOutRaw: 2n, usdcInCents: 200 },
  ],
  picks: [{ ts: new Date(NOW.getTime() - 1 * DAY), asset: "USDC_LEND", amountRaw: 2n }],
  skrPutInRaw: 4n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 79, thresholdCents: 100, nextAsset: "stORE",
  allocation: { SKR: 60, stORE: 20, hSOL: 0, USDC_LEND: 20, SOL_LEND: 0, cbBTC: 0 }, earned: {}, storePutInRaw: 1n, joinedValueRaw: 0n,
  basket: { amountRaw: 1n, readyAt: new Date(NOW.getTime() + DAY) },
};
const boxOf = (x: number): [number, number] => [x, x + BASKET.w];
const hits = (lo: number, hi: number, spans: [number, number][]) => spans.filter(([l, h]) => Math.min(hi, h) - Math.max(lo, l) > 0);

describe("the basket stands where nothing of the garden covers it (the brown box under the stORE blade, 10-05)", () => {
  for (const w of [300, 320, 360, 392]) it(`the owner's garden at ${w} wide`, () => {
    const scene = packScene(buildScene(owner)), plants = plantLayouts(scene), frame = frameFor(scene, plants, w), spots = stakeSpots(scene, plants, w, frame.zoom, bedSpan(w));
    const ground = frameGround(w, frame);
    const plantSpans = drawnSpans(plants, w, BASKET.top, BASKET.bottom, [0]);   // the plants standing still
    const stakes = scene.parts.flatMap((q) => (q.kind === "sign" ? [q] : [])).map((s) => signPlacement(s, w, frame.zoom, ground, spots));
    const boards = stakes.filter((a) => a.y - 12 * a.scale < BASKET.bottom && a.y + 9.4 * a.scale > BASKET.top).map((a) => { const h = 15 * a.scale * a.boardX; return [a.x - h, a.x + h] as [number, number]; });
    expect(boards.length, "the front stakes reach its band").toBe(2);
    const old = frame.x + frame.w * (1 - FRAME.footInset) - 26;   // the spot it had (Garden.tsx): on the outermost plant's foot
    expect(hits(...boxOf(old), plantSpans).length + hits(...boxOf(old), boards).length, "the old spot collides").toBeGreaterThan(0);
    const x = basketAt(scene, plants, w, frame, spots, ground);
    expect(hits(...boxOf(x), plantSpans)).toEqual([]);
    expect(hits(...boxOf(x), boards)).toEqual([]);
    expect(x).toBeGreaterThanOrEqual(frame.x); expect(x + BASKET.w).toBeLessThanOrEqual(frame.x + frame.w);   // inside the view (R242)
    for (const e of [x, x + BASKET.w]) expect(soilBottomAt(e, ground), "on the full mound (R242)").toBeGreaterThanOrEqual(BASKET.bottom + SIGN_SOIL_MARGIN);
  });
});
