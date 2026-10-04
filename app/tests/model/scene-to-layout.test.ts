import { describe, it, expect } from "vitest";
import { plantLayouts, sceneTop } from "@/model/scene-to-layout";
import { frameFor, FOOT_Y, MAX_VIEW_H, PLANT_SCALE } from "@/model/layout";
import { previewInputAt } from "@/model/fixtures/median-year";
import { buildScene, type GardenInput } from "@/model/garden";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 120, thresholdCents: 200, nextAsset: "SKR", allocation: { SKR: 50, stORE: 10, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }, earned: { SKR: { count: 1, progress: 0.5 } }, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
describe("from the scene to the layouts", () => {
  it("one layout per present plant, the back row at 0.8 and the front at 1.3 (R231), the opts read off the parts", () => {
    const s = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL")] });
    const L = plantLayouts(s);
    expect(L.map((l) => [l.plant, l.row, l.k])).toEqual([["skr", "front", 1.3], ["ore", "front", 1.3], ["hsol", "back", 0.8]]);
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
    // R231: the front row's feet at 266 and its sprout 1.3x: the top at 221.0, the content 69.0 canvas px, so 60 percent (41.4, 82.8 on
    // screen at 2x) passes the 72 px floor; the sign 1.62x (half width 24.3) at 77.14
    // R231 fix: the view holds the whole ground, now 129 deep (86 times 1.5), which rules over the headroom here
    expect(f).toMatchObject({ zoom: 2, w: 160 }); expect(f.y).toBeCloseTo(161, 2); expect(f.h).toBeCloseTo(129, 2); expect(f.viewH).toBeCloseTo(258, 2);
    expect((220.995 - f.y) * f.zoom).toBeGreaterThanOrEqual(0.6 * (290 - 220.995) * 2);
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(77.14 - 24.3); expect(f.x + f.w).toBeGreaterThanOrEqual(96);
  });
  it("the full year: the whole breadth, zoomed out to 0.945 so its 1.25x plants hold the side gutters in a gust (R187 fix round 1; zoom 1 before); the view at its 380 cap (R231; 320 before)", () => {
    const s = buildScene(previewInputAt(365)), f = frame(s);
    expect(f.zoom).toBeCloseTo(0.94464, 4); expect(f.viewH).toBe(380); expect(f.x).toBeCloseTo(-6.45, 2); expect(f.y).toBeCloseTo(-112.27, 1);   // R290: -6.48, -112.31 before the twigs left the canes' paint   // before: x 0, zoom 1, y -60
    expect(tallest(s)).toBeCloseTo(22.32, 2);   // the 22 px left above the tallest part is all the bed has
  });
  it("a tall garden at zoom 1: the headroom is 60 percent of the content's height once that passes 72 px (day 120)", () => {
    const s = buildScene(previewInputAt(120)), f = frame(s), t = tallest(s);
    expect(t).toBeCloseTo(88.19, 2); expect(f.zoom).toBe(1);   // R231: the content 201.8 canvas px; 60 percent of it is 121.1
    expect(t - f.y).toBeCloseTo(0.6 * (290 - t), 6); expect(f.viewH).toBeCloseTo(322.90, 2);
  });
  it("day 240: the view grows by 60 percent of its 192.9 px content (115.7) above the canvas's top; zoomed out to 0.957 for the gutters (R187 fix round 1)", () => {
    const f = frame(buildScene(previewInputAt(240)));
    expect(f.zoom).toBeCloseTo(0.95826, 4); expect(f.viewH).toBeCloseTo(341.72, 2); expect(f.y).toBeCloseTo(-66.61, 1);   // R290: 341.45 before   // R231: 295.49 and -48.61 before   // before: zoom 1, viewH 308.61
  });
  it("R185's headroom never shrinks the plants (I4 fix round 5): the zoom with it equals the zoom without it", () => {
    const tall = buildScene({ ...base, pendingCents: 0, earned: {}, plantings: Array.from({ length: 40 }, (_, i) => p(`h${i}`, 300 - i * 7, "hSOL")) });   // a lone sunflower: narrow and tall, so the height binds
    for (const s of [buildScene(previewInputAt(120)), buildScene(previewInputAt(240)), buildScene(previewInputAt(365)), tall]) {
      const L = plantLayouts(s);
      expect(frameFor(s, L, 320).zoom).toBe(frameFor(s, L, 320, { share: 0, minPx: 0 }).zoom);
    }
    const L = plantLayouts(tall), f = frameFor(tall, L, 320);
    expect(f.zoom).toBeGreaterThan(1); expect(f.zoom).toBeLessThan(2);   // the height binds: the case the old rule shrank
    expect(f.viewH).toBeLessThanOrEqual(MAX_VIEW_H);
  });
  it("no plant: the whole breadth at the floor, the soil band (90 since R231) plus 40", () => expect(frame(buildScene(base))).toEqual({ x: 0, y: 160, w: 320, h: 130, zoom: 1, viewH: 130 }));
  it("six young plants, one planting each (the Saga's garden on 10-02): every plant in the breadth, 72 px of room above them: 148.7 px tall, not 260", () => {
    const now = new Date("2026-10-02T14:30:00-07:00"), d = (id: string, asset: GardenInput["plantings"][number]["asset"], iso: string, c: number) => ({ id, ts: new Date(iso), asset, amountOutRaw: 1n, usdcInCents: c });
    const s = buildScene({ ...base, now, wateredAt: now, pendingCents: 0, earned: {}, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65), d("o", "stORE", "2026-09-30T11:40:00-07:00", 10), d("h", "hSOL", "2026-10-01T19:00:00-07:00", 103), d("j", "JitoSOL", "2026-10-01T16:00:00-07:00", 25), d("u", "JupSOL", "2026-10-01T16:30:00-07:00", 25), d("c", "cbBTC", "2026-10-01T17:00:00-07:00", 25)] });
    const L = plantLayouts(s), f = frameFor(s, L, 320);
    expect(L).toHaveLength(6);
    for (const l of L) { expect(l.x * 320).toBeGreaterThanOrEqual(f.x); expect(l.x * 320).toBeLessThanOrEqual(f.x + f.w); }
    expect(f.viewH).toBeCloseTo(178.4, 2);   // R231: the content 106.4 canvas px at zoom 1 plus the 72 px floor of headroom (148.71 before)
    expect((tallest(s) - f.y) * f.zoom).toBeCloseTo(72, 6);   // 72 px of room to grow (40 in round 3, 23.3 in round 2, 183.3 before R167)
  });
  it("R187 fix round 1: the Saga's young garden (six plants, one planting each) fits the gutters at the gust's peak and keeps its zoom", () => {
    const now = new Date("2026-10-02T14:30:00-07:00"), d = (id: string, asset: GardenInput["plantings"][number]["asset"], iso: string, c: number) => ({ id, ts: new Date(iso), asset, amountOutRaw: 1n, usdcInCents: c });
    const s = buildScene({ ...base, now, wateredAt: now, pendingCents: 0, earned: {}, plantings: [d("s", "SKR", "2026-09-29T14:00:00-07:00", 65), d("o", "stORE", "2026-09-30T11:40:00-07:00", 10), d("h", "hSOL", "2026-10-01T19:00:00-07:00", 103), d("j", "JitoSOL", "2026-10-01T16:00:00-07:00", 25), d("u", "JupSOL", "2026-10-01T16:30:00-07:00", 25), d("c", "cbBTC", "2026-10-01T17:00:00-07:00", 25)] });
    // recorded from frameFor before the gutter-fit term (main f10d166 + R187, 10-02): 320 wide 1.004016064257028, 353 wide 1.0121863799283155
    // R231: re-recorded with the 1.3x front row and its 1.62x signs (the content a little wider): 1 and 1.0064
    expect(frameFor(s, plantLayouts(s), 320).zoom).toBeCloseTo(1, 12);
    expect(frameFor(s, plantLayouts(s), 353).zoom).toBeCloseTo(1, 12);   // R242: the feet inset holds it at 1 (1.006 with SKR at .34)
  });
  it("R291 (10-04, a lone SKR: \"plus a bit too much negative space above it\"): zoomed in, the room above the plants is what a zoom-1 garden shows, not that times the zoom", () => {
    const lone = (n: number) => buildScene({ ...base, pendingCents: 0, earned: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 }, plantings: Array.from({ length: n }, (_, i) => p(`a${i}`, 6 + (n - i) * 4)) });
    const s = lone(5), f = frameFor(s, plantLayouts(s), 360), t = tallest(s);
    expect(f.zoom).toBe(2);
    expect((t - f.y) * f.zoom).toBeCloseTo(Math.max(72, 0.6 * (290 - t)), 6);   // 76.5 on screen; 125 before (60 percent of the content times the zoom, held by the 380 cap)
  });
  it("R291: no lone plant of any coin, any size, is cut at the top: its 1.25x drawing (R187) clears the view's top by 8 dp", () => {
    for (const asset of ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const) for (const n of [1, 2, 3, 5, 8, 12, 20, 40]) {
      const s = buildScene({ ...base, pendingCents: 120, plantings: Array.from({ length: n }, (_, i) => p(`a${i}`, 3 + (n - i) * 5, asset)) });
      for (const w of [320, 360]) {
        const L = plantLayouts(s), f = frameFor(s, L, w);
        for (const l of L) expect((FOOT_Y(l.row) - l.layout.top * PLANT_SCALE - f.y) * f.zoom, `${asset} n${n} w${w}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
  it("the Oct 8 garden: the band above the tallest part is 60 percent of its 125.2 canvas px content (75.7 on screen), past the 72 px floor since R231", () => {
    const s = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] }), f = frame(s);
    expect((tallest(s) - f.y) * f.zoom).toBeCloseTo(75.10, 2);   // R291: zoom 1.0014, so 75.20 / 1.0014; R237: 75.68 with SKR at .30 expect(f.viewH).toBeCloseTo(201.81, 2);   // 170.27 before R231, 138.3 in round 3
  });
});
