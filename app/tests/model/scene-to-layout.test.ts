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
describe("the frame (RG30, R167): automatic framing of what is planted, 2x cap, the view as tall as the content", () => {
  const frame = (s: ReturnType<typeof buildScene>) => frameFor(s, plantLayouts(s), 320);
  const tallest = (s: ReturnType<typeof buildScene>) => Math.min(...plantLayouts(s).map((l) => FOOT_Y(l.row) - l.layout.top));   // canvas px
  it("day 1, SKR alone: zoom 2 on a 160 wide frame holding the sprout's foot and its sign; the view holds the whole ground (86) at 2x", () => {
    // SKR's foot at 0.3 of 320 = 96 (stORE's bare sign holds its slot, B7); its sign on the left at 96 - 17 = 79, 64 to 94; the
    // sprout about 35 above the front feet at 244, padded 16 to about 193; the ground's box (86, its wash painted from about 13 px
    // under its top) is taller, so the view is 86 canvas px from the bed's bottom: y 174, 172 px on screen (it was 260)
    const f = frame(buildScene({ ...base, plantings: [p("a", 1)] }));
    expect(f).toMatchObject({ zoom: 2, w: 160, h: 86, y: 174, viewH: 172 });
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(64); expect(f.x + f.w).toBeGreaterThanOrEqual(96);
  });
  it("the full year: the whole breadth at zoom 1, the view from 16 px above the tallest part down to the bed's bottom", () => {
    const s = buildScene(previewInputAt(365)), f = frame(s);
    expect(f).toMatchObject({ x: 0, w: 320, zoom: 1 });
    expect(f.y).toBeCloseTo(tallest(s) - 16, 6); expect(f.viewH).toBeCloseTo(260 - f.y, 6);
  });
  it("no plant: the whole breadth at the floor, the soil band (60) plus 40", () => expect(frame(buildScene(base))).toEqual({ x: 0, y: 160, w: 320, h: 100, zoom: 1, viewH: 100 }));
  it("six young plants, one planting each (the Saga's garden on 10-02): every plant in the breadth, no sky band: 100 px tall, not 260", () => {
    const now = new Date("2026-10-02T14:30:00-07:00"), d = (id: string, asset: GardenInput["plantings"][number]["asset"], iso: string, c: number) => ({ id, ts: new Date(iso), asset, amountOutRaw: 1n, usdcInCents: c });
    const s = buildScene({ ...base, now, wateredAt: now, pendingCents: 0, earned: {}, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65), d("o", "stORE", "2026-09-30T11:40:00-07:00", 10), d("h", "hSOL", "2026-10-01T19:00:00-07:00", 103), d("j", "JitoSOL", "2026-10-01T16:00:00-07:00", 25), d("u", "JupSOL", "2026-10-01T16:30:00-07:00", 25), d("c", "cbBTC", "2026-10-01T17:00:00-07:00", 25)] });
    const L = plantLayouts(s), f = frameFor(s, L, 320);
    expect(L).toHaveLength(6);
    for (const l of L) { expect(l.x * 320).toBeGreaterThanOrEqual(f.x); expect(l.x * 320).toBeLessThanOrEqual(f.x + f.w); }
    expect(f.viewH).toBe(100);   // the floor: the content (about 92 px with its 16 px margin) is shorter
    expect((tallest(s) - f.y) * f.zoom).toBeLessThan(24);   // measured 23.3 px of sky (183.3 before)
  });
  it("the Oct 8 garden: the empty band above the tallest part is the 16 px margin at the frame's zoom", () => {
    const s = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] }), f = frame(s);
    expect((tallest(s) - f.y) * f.zoom).toBeCloseTo(16 * f.zoom, 6); expect(f.viewH).toBeLessThan(120);   // measured 115.0 (260 before)
  });
});
