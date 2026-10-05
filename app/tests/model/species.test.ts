import { describe, it, expect } from "vitest";
import { COLORS, CAPS, BAKED_L, BAND_SCALE, PLANT_SPECIES, SWELL_REACH, type Placed } from "@/model/species";
import { SPRITE_META } from "@/garden/sprite-meta";
import { layoutPlant } from "@/model/plant-geometry";
import { stageOf, branchFlags, twig, sprite, stem, along, swelling, pupsByCount, SWELL_LIFT, SWELL_TUCK, SWELL_SEPAL, type Acc } from "@/model/geometry/common";

describe("the species constants (spec 4 and 9)", () => {
  it("maps every plant to its species in order", () => {
    expect(Object.values(PLANT_SPECIES)).toEqual(["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"]);
  });
  it("keeps the mark's green out of the garden and gives JitoSOL its mint disc (RG21)", () => {
    for (const c of Object.values(COLORS)) for (const v of Object.values(c)) expect(v).not.toBe("#1E6B44");
    expect(COLORS.skr.deep).toBe("#236F47"); expect(COLORS.jitosol.token).toBe("#A8D8C2"); expect(COLORS.hsol.token).toBe("#C7391F");
  });
  it("carries the generators' caps", () => {
    expect(CAPS).toEqual({ mandarinTrunk: 146.52, sunflower: 222, spruce: 199.8, blueberry: 161.5, snakeBlade: 64, succulent: [78, 58, 40], stalk: 96 });
    expect(BAKED_L["leaf-blueberry"]).toEqual([10.8, 10.8, 10.8, 12.6]);   // RG29: stage 0 at 2x; RG33: stage 1 never smaller
    expect(BAND_SCALE).toEqual({ 0: 0.78, 1: 1.0, 2: 1.28 });
  });
});

describe("the grammar's helpers", () => {
  it("stages by age: under 3, 10, 30 days, then 3", () => expect([0, 2.9, 3, 9.9, 10, 29.9, 30, 400].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]));
  it("RG19: an opened shoot with three newer plantings above it branches, open or closed, the lowest node included", () => {
    const o = (opened: boolean) => ({ opened });
    expect(branchFlags([o(true), o(true), o(true), o(true), o(false)])).toEqual([true, true, false, false, false]);
    expect(branchFlags([o(false), o(true), o(true), o(true), o(true)])).toEqual([false, true, false, false, false]);
    expect(branchFlags([o(true), o(true), o(true)])).toEqual([false, false, false]);
  });
  it("a twig fans two, three or four leaves at its tip and returns the tip", () => {
    const acc: Acc = { parts: [], tips: [] };
    const tip = twig(acc, "leaf-mandarin", 0, -20, 58, 7, 1, 3, 2, 1, "#236F47", "a");
    expect(tip.x).toBeCloseTo(Math.sin((58 * Math.PI) / 180) * 7 * 2, 5); expect(tip.y).toBeCloseTo(-20 - Math.cos((58 * Math.PI) / 180) * 7 * 2, 5);   // RG29 + RG33: every twig stem doubled (SPROUT_X)
    const leaves = acc.parts.filter((p) => p.kind === "sprite");
    expect(leaves.map((l) => (l.kind === "sprite" ? l.rot : 0))).toEqual([10, 58, 106]);
    expect(leaves.map((l) => (l.kind === "sprite" ? l.scale : 0))).toEqual([0.85, 1, 0.85]);
    expect(acc.parts[0]).toMatchObject({ kind: "stem", part: "twig", w0: 1.6, w1: 0.9, shoot: "a" });
  });
  it("R358: the swelling is the species' droplet bud, sized by the old circle's range: min(4.6, 2.2 + 3.2 p) / 3.8, so p = 0.5 is the approved art", () => {
    const at = (p: number, k = 1) => { const a: Acc = { parts: [], tips: [] }; swelling(a, "spruce", 0, -40, p, k); return a.parts[0] as Extract<Placed, { kind: "sprite" }>; };
    expect(at(0.5)).toMatchObject({ kind: "sprite", part: "swelling", name: "swell-spruce", rot: 0 });
    expect(at(0.5).scale).toBeCloseTo(1, 9); expect(at(0.01).scale).toBeCloseTo((2.2 + 0.032) / 3.8, 9); expect(at(1, 0.8).scale).toBeCloseTo((4.6 / 3.8) * 0.8, 9);
    expect(at(0.75).scale).toBeCloseTo(4.6 / 3.8, 9);   // the old cap: it stops growing at three quarters, as the circle did
    const none: Acc = { parts: [], tips: [] }; swelling(none, "spruce", 0, -40, 0, 1); expect(none.parts).toHaveLength(0);
  });
  it("R358: with no stem ending at the seat (the rosette, the fan) the bud's base sits on the seat itself", () => {
    const a: Acc = { parts: [], tips: [] }; swelling(a, "succulent", 0, -3, 1, 0.8);
    expect(a.parts).toHaveLength(1); expect(a.parts[0]).toMatchObject({ x: 0, y: -3 });
  });
  it("R358: on a stem tip the bud stands SWELL_LIFT scale above it, and the stem itself grows into it (its own curve continued, one ribbon: no seam)", () => {
    const a: Acc = { parts: [], tips: [] };
    stem(a, "trunk", 0, 0, 1.5, -60, 6, 2, "#000", -2, 0);
    const before = { ...(a.parts[0] as Extract<Placed, { kind: "stem" }>) };
    swelling(a, "mandarin", 1.5, -60, 1, 1);
    const sw = a.parts.find((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite")!, t = a.parts[0] as Extract<Placed, { kind: "stem" }>;
    expect(a.parts.filter((p) => p.kind === "stem")).toHaveLength(1);   // no second stem: the leader is the trunk's own continuation
    expect(sw.y).toBeCloseTo(-60 - SWELL_LIFT * sw.scale, 9);
    expect(t.y1).toBeCloseTo(sw.y - SWELL_TUCK * sw.scale, 9);
    const T = (t.y1 - t.y0) / (before.y1 - before.y0);   // the old stem is the new one's first 1 / T: its centreline and its width below the tip unchanged
    for (const u of [0, 0.3, 0.7, 1]) {
      const o = along(before.x0, before.y0, before.x1, before.y1, before.bend, u), n = along(t.x0, t.y0, t.x1, t.y1, t.bend, u / T);
      expect(n.x).toBeCloseTo(o.x, 9); expect(n.y).toBeCloseTo(o.y, 9);
      expect(t.w0 + (t.w1 - t.w0) * (u / T)).toBeCloseTo(before.w0 + (before.w1 - before.w0) * u, 9);
    }
    expect(sw.x).toBeCloseTo(along(t.x0, t.y0, t.x1, t.y1, t.bend, (sw.y - t.y0) / (t.y1 - t.y0)).x, 9);   // the bud stands on the stem's paint
  });
  it("R358: every species' tip stem keeps its old width below the tip when it grows into the bud (no clamp fattens it)", () => {
    const sh = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ageDays: 40 - i, band: 1 as const, opened: true, branch: false }));
    const O = { fruit: 0, ripening: 0, blossom: false, pups: 0, head: false };
    for (const sp of ["mandarin", "sunflower", "blueberry", "spruce"] as const) for (const n of [1, 3, 12]) for (const k of [1, 0.8]) {
      const a = layoutPlant(sp, sh(n), { ...O, pending: 0 }, k).parts.find((p) => p.kind === "stem" && !p.shoot) as Extract<Placed, { kind: "stem" }>;
      const b = layoutPlant(sp, sh(n), { ...O, pending: 1 }, k).parts.find((p) => p.kind === "stem" && !p.shoot) as Extract<Placed, { kind: "stem" }>;
      const T = (b.y1 - b.y0) / (a.y1 - a.y0); expect(T, `${sp} ${n} ${k}`).toBeGreaterThan(1);
      expect(b.w0 + (b.w1 - b.w0) / T, `${sp} ${n} ${k}`).toBeCloseTo(a.w1, 9);
      const o = along(a.x0, a.y0, a.x1, a.y1, a.bend, 1), m = along(b.x0, b.y0, b.x1, b.y1, b.bend, 1 / T);
      expect(m.x).toBeCloseTo(o.x, 9); expect(m.y).toBeCloseTo(o.y, 9);
    }
  });
  it("a fresh bud wins the growth point (spec 5): the droplet's base rides above that bud's top, its leader grown up to it", () => {
    const a: Acc = { parts: [], tips: [] };
    stem(a, "trunk", 0, 0, 0, -60, 4, 1.2, "#000", 0, 0); sprite(a, "bud", "bud-spruce", 0, -57, 0, 0.9, 2, "e"); swelling(a, "spruce", 0, -60, 0.5, 1);
    const sw = a.parts.find((p): p is Extract<Placed, { kind: "sprite" }> => p.part === "swelling")!;
    expect(sw.y).toBeLessThanOrEqual(-57 - 9.6 * 0.9 - 1 - SWELL_SEPAL * sw.scale + 1e-9);
    expect((a.parts[0] as Extract<Placed, { kind: "stem" }>).y1).toBeCloseTo(sw.y - SWELL_TUCK * sw.scale, 9);
  });
  it("R358: SWELL_REACH is the baked droplet's reach above its anchor (bake.py swell_c, the manifest's ay)", () => {
    for (const sp of ["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"]) {
      const m = SPRITE_META[`swell-${sp}`]; expect(m, sp).toBeDefined();
      expect(SWELL_REACH).toBeGreaterThanOrEqual(Math.max(m.ay, m.ax, m.w - m.ax));
    }
  });
  it("pups by count (RG20): one per six plantings past seven, at most four", () => expect([7, 12, 13, 19, 25, 31, 40].map(pupsByCount)).toEqual([0, 0, 1, 2, 3, 4, 4]));
});
