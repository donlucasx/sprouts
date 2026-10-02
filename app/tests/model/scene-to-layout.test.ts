import { describe, it, expect } from "vitest";
import { plantLayouts, sceneTop } from "@/model/scene-to-layout";
import { frameFor } from "@/model/layout";
import { previewInputAt } from "@/model/fixtures/median-year";
import { buildScene, type GardenInput } from "@/model/garden";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 120, thresholdCents: 200, nextAsset: "SKR", allocation: { SKR: 50, stORE: 10, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }, earned: { SKR: { count: 1, progress: 0.5 } }, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
describe("from the scene to the layouts", () => {
  it("one layout per present plant, the back row at 0.8, the opts read off the parts", () => {
    const s = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL")] });
    const L = plantLayouts(s);
    expect(L.map((l) => [l.plant, l.row, l.k])).toEqual([["skr", "front", 1], ["ore", "front", 1], ["hsol", "back", 0.8]]);
    const skr = L.find((l) => l.plant === "skr")!;
    expect(skr.layout.parts.some((q) => q.kind === "sprite" && q.part === "swelling")).toBe(true);
    expect(skr.layout.parts.filter((q) => q.kind === "sprite" && q.name === "token-skr")).toHaveLength(1);
    expect(skr.layout.parts.filter((q) => q.kind === "stem" && q.part === "branch")).toHaveLength(2);
  });
  it("the scene's top is measured above the front row's feet, so a back plant adds its 30 px step", () => {
    const front = sceneTop(buildScene({ ...base, plantings: [p("a", 10)] })), back = sceneTop(buildScene({ ...base, plantings: [p("h", 10, "hSOL")] }));
    expect(front).toBeGreaterThan(20); expect(back).toBeGreaterThan(30);
  });
});
describe("the frame (RG30): automatic framing of what is planted, 2x cap, inside the bed", () => {
  const frame = (s: ReturnType<typeof buildScene>) => frameFor(s, plantLayouts(s), 320);
  it("day 1, SKR alone: zoom 2, a 160 by 130 frame on the bed's lower half holding the sprout's foot and its sign", () => {
    // SKR's foot at 0.3 of 320 = 96 (stORE's bare sign holds its slot, B7); its sign on the left at 96 - 17 = 79, 64 to 94; the
    // sprout about 35 above the front feet at 244; padded 16, the box is about 48 to 139 by 193 to 260, so 2x is the cap
    // (320 / 2 = 160, 260 / 2 = 130) and the frame's bottom clamps to the bed's: y = 260 - 130 = 130
    const f = frame(buildScene({ ...base, plantings: [p("a", 1)] }));
    expect(f).toMatchObject({ zoom: 2, w: 160, h: 130, y: 130 });
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(64); expect(f.x + f.w).toBeGreaterThanOrEqual(96);
  });
  it("the full year: hSOL's leaves past x 0 and cbBTC's sign at 307 plus 12 reach both edges once padded, so zoom 1, the whole bed", () => {
    expect(frame(buildScene(previewInputAt(365)))).toEqual({ x: 0, y: 0, w: 320, h: 260, zoom: 1 });
  });
  it("no plant: the whole bed", () => expect(frame(buildScene(base))).toEqual({ x: 0, y: 0, w: 320, h: 260, zoom: 1 }));
});
