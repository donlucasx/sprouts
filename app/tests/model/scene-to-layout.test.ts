import { describe, it, expect } from "vitest";
import { plantLayouts, sceneTop } from "@/model/scene-to-layout";
import { frameFor, FOOT_Y } from "@/model/layout";
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
describe("the frame (RG30, R167, R185: room above the tallest part max(72 dp, 60 percent of the content)): automatic framing of what is planted, 2x cap, the view as tall as the content plus room to grow", () => {
  const frame = (s: ReturnType<typeof buildScene>) => frameFor(s, plantLayouts(s), 320);
  const tallest = (s: ReturnType<typeof buildScene>) => Math.min(...plantLayouts(s).map((l) => FOOT_Y(l.row) - l.layout.top));   // canvas px
  it("day 1, SKR alone: zoom 2 on a 160 wide frame holding the sprout's foot and its sign; the view holds the whole ground (86) at 2x", () => {
    // SKR's foot at 0.3 of 320 = 96 (stORE's bare sign holds its slot, B7); its sign (1.35x, half width 20.25) on the left at
    // 96 - 18.05 = 77.95, 57.7 to 98.2; the sprout's top at 209.38, its content 50.62 canvas px (60 percent is 30.4), so the 72 px
    // floor at 2x (36 canvas px) rules: y 173.38, 86.62 canvas px from the bed's bottom (just over the ground's 86), 173.24 on screen
    const f = frame(buildScene({ ...base, plantings: [p("a", 1)] }));
    expect(f).toMatchObject({ zoom: 2, w: 160 }); expect(f.y).toBeCloseTo(173.38, 2); expect(f.h).toBeCloseTo(86.62, 2); expect(f.viewH).toBeCloseTo(173.24, 2);
    expect((209.381 - f.y) * f.zoom).toBeCloseTo(72, 2);
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(57.7); expect(f.x + f.w).toBeGreaterThanOrEqual(96);
  });
  it("the full year: the whole breadth at zoom 1; the headroom (60 percent of 237.7) reaches past the bed's top, so the view is the whole bed", () => {
    const s = buildScene(previewInputAt(365)), f = frame(s);
    expect(f).toMatchObject({ x: 0, w: 320, zoom: 1, y: 0, viewH: 260 });
    expect(tallest(s)).toBeCloseTo(22.32, 2);   // the 22 px left above the tallest part is all the bed has
  });
  it("a tall garden at zoom 1: the headroom is 60 percent of the content's height once that passes 72 px (day 120)", () => {
    const s = buildScene(previewInputAt(120)), f = frame(s), t = tallest(s);
    expect(t).toBeCloseTo(107.22, 2); expect(f.zoom).toBe(1);   // the content 152.8 canvas px; 60 percent of it is 91.7
    expect(t - f.y).toBeCloseTo(0.6 * (260 - t), 6); expect(f.viewH).toBeCloseTo(244.45, 2);
  });
  it("day 240: 60 percent of its 192.9 px reaches past the bed's top, so the view is the whole bed", () => {
    expect(frame(buildScene(previewInputAt(240)))).toMatchObject({ y: 0, zoom: 1, viewH: 260 });
  });
  it("no plant: the whole breadth at the floor, the soil band (60) plus 40", () => expect(frame(buildScene(base))).toEqual({ x: 0, y: 160, w: 320, h: 100, zoom: 1, viewH: 100 }));
  it("six young plants, one planting each (the Saga's garden on 10-02): every plant in the breadth, 72 px of room above them: 148.7 px tall, not 260", () => {
    const now = new Date("2026-10-02T14:30:00-07:00"), d = (id: string, asset: GardenInput["plantings"][number]["asset"], iso: string, c: number) => ({ id, ts: new Date(iso), asset, amountOutRaw: 1n, usdcInCents: c });
    const s = buildScene({ ...base, now, wateredAt: now, pendingCents: 0, earned: {}, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65), d("o", "stORE", "2026-09-30T11:40:00-07:00", 10), d("h", "hSOL", "2026-10-01T19:00:00-07:00", 103), d("j", "JitoSOL", "2026-10-01T16:00:00-07:00", 25), d("u", "JupSOL", "2026-10-01T16:30:00-07:00", 25), d("c", "cbBTC", "2026-10-01T17:00:00-07:00", 25)] });
    const L = plantLayouts(s), f = frameFor(s, L, 320);
    expect(L).toHaveLength(6);
    for (const l of L) { expect(l.x * 320).toBeGreaterThanOrEqual(f.x); expect(l.x * 320).toBeLessThanOrEqual(f.x + f.w); }
    expect(f.viewH).toBeCloseTo(148.71, 2);   // the content 76.4 canvas px at zoom 1.004 plus the 72 px floor of headroom (60 percent is 45.8)
    expect((tallest(s) - f.y) * f.zoom).toBeCloseTo(72, 6);   // 72 px of room to grow (40 in round 3, 23.3 in round 2, 183.3 before R167)
  });
  it("the Oct 8 garden: the band above the tallest part is the 72 px headroom floor (60 percent of its 93.8 canvas px is 56.3)", () => {
    const s = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] }), f = frame(s);
    expect((tallest(s) - f.y) * f.zoom).toBeCloseTo(72, 6); expect(f.viewH).toBeCloseTo(170.27, 2);   // 138.3 in round 3, 115.0 in round 2, 260 before R167
  });
});
