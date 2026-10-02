import { describe, it, expect } from "vitest";
import { medianYear, previewInputAt, PREVIEW_LABEL } from "@/model/fixtures/median-year";
import { buildScene } from "@/model/garden";
describe("the preview's made-up year (RG8, spec 7)", () => {
  it("is seeded and deterministic: about 102 plantings at the gen01 split, a watering every seven days", () => {
    const a = medianYear(), b = medianYear();
    expect(a.plantings.map((p) => p.id)).toEqual(b.plantings.map((p) => p.id));
    expect(a.plantings.length).toBeGreaterThanOrEqual(99); expect(a.plantings.length).toBeLessThanOrEqual(105);
    const skr = a.plantings.filter((p) => p.asset === "SKR").length / a.plantings.length; expect(skr).toBeGreaterThan(0.42); expect(skr).toBeLessThan(0.58);
    expect(a.waterings).toHaveLength(52); expect(a.waterings[1].getTime() - a.waterings[0].getTime()).toBe(7 * 86_400_000);
    const bands = a.plantings.map((p) => p.usdcInCents); expect(bands.filter((c) => c < 100).length / bands.length).toBeGreaterThan(0.45);
  });
  it("day 365 is a full garden: six plants, SKR branched, every coin earning but cbBTC, at most 6 tokens a plant; the next coin holds still between plantings", () => {
    const s = buildScene(previewInputAt(365));
    expect(s.parts.filter((p) => p.kind === "plant")).toHaveLength(6);
    expect(s.parts.some((p) => p.kind === "sprout" && p.plant === "skr" && p.branch)).toBe(true);
    expect(s.parts.filter((p) => p.kind === "fruit" && p.plant === "skr").length).toBeLessThanOrEqual(6);
    expect(s.parts.some((p) => p.kind === "fruit" && p.plant === "cbbtc")).toBe(false);
    expect(previewInputAt(10).nextAsset).toBe(previewInputAt(10.5).nextAsset);
  });
  it("the label is the spec's", () => {
    expect(PREVIEW_LABEL).toBe("Preview: a made-up year for a typical saver. Your garden is on Home.");
  });
});
