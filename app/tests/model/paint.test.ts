import { describe, it, expect } from "vitest";
import { stemPaths, leafPath, spriteTransform, soilPaths } from "@/model/paint";
describe("the painted stem (gen01 stem, gen03 stem3)", () => {
  it("is three outlines: the core at .72, a white streak at .22, a dark edge at .18, each a closed quadratic ribbon", () => {
    const p = stemPaths(0, 0, 1.5, -66, 3.8, 2, -2, "#236F47");
    expect(p.map((q) => [q.fill, q.opacity])).toEqual([["#236F47", 0.72], ["#FFFFFF", 0.22], ["#1E3A2A", 0.18]]);
    expect(p[0].d).toMatch(/^M[-\d.]+ [-\d.]+ Q .* z$/);
  });
  it("the leaf outline runs from the base to minus L and back along the midrib gap", () => {
    expect(leafPath(14, 5, 1)).toMatch(/^M0\.\d+ 0 L.*-14(\.0)? .* z$/);
  });
  it("places a sprite by its anchor, x scaled apart when asked", () => {
    expect(spriteTransform({ w: 24, h: 40, ax: 12, ay: 40 }, 100, 90, -30, 1.5)).toBe("translate(100 90) rotate(-30) scale(1.5 1.5) translate(-12 -40)");
    expect(spriteTransform({ w: 24, h: 40, ax: 12, ay: 40 }, 0, 0, 0, 1, 2)).toBe("translate(0 0) rotate(0) scale(2 1) translate(-12 -40)");
  });
  it("the soil is gen01's three ridges scaled to the band", () => {
    const p = soilPaths(320, 200, 60);
    expect(p.map((q) => q.fill)).toEqual(["#C9A77E", "#A9825C", "none", "#6B5340"]);
    expect(p[0].d).toContain("Q 160 190");   // the back ridge's crown 10 above the soil line
  });
});
