import { describe, it, expect } from "vitest";
import { sunflower } from "@/model/geometry/sunflower";
import { spruce } from "@/model/geometry/spruce";
import { branchFlags } from "@/model/geometry/common";
import type { ShootIn, LayoutOpts } from "@/model/species";
import { snake } from "@/model/geometry/snake";
import { blueberry } from "@/model/geometry/blueberry";

const O: LayoutOpts = { pending: 0, fruit: 0, ripening: 0, blossom: false, pups: 0, head: false };
const sh = (ages: number[], buds = 0): ShootIn[] => { const raw = ages.map((age, i) => ({ id: `h${i}`, ageDays: age, band: 1 as const, opened: i < ages.length - buds })); const br = branchFlags(raw); return raw.map((s, i) => ({ ...s, branch: br[i] })); };
type L = ReturnType<typeof sunflower>; const sprites = (l: L) => l.parts.filter((p) => p.kind === "sprite") as Extract<L["parts"][number], { kind: "sprite" }>[]; const stems = (l: L) => l.parts.filter((p) => p.kind === "stem") as Extract<L["parts"][number], { kind: "stem" }>[];

describe("the sunflower (gen03 plant_hsol3, cap 222)", () => {
  it("rises 22 + 16 per shoot to 222, leaves alternate from the right on petioles, a branch node adds a side stem with a leaf", () => {
    const l = sunflower(sh([40, 30, 20, 12, 5]), O, 1);
    expect(stems(l).find((s) => s.part === "trunk")).toMatchObject({ x1: -1, y1: -(22 + 16 * 5), bend: 2, color: "#6E9B2E" });
    const leaves = sprites(l).filter((s) => s.part === "leaf");
    expect(leaves[0]).toMatchObject({ name: "leaf-sunflower-s3", rot: 68 - 30, x: (6 + 2 * 3) * 0.9 });
    expect(stems(l).filter((s) => s.part === "branch")).toHaveLength(2);   // nodes 0 and 1 have three newer above
    expect(sunflower(sh(Array.from({ length: 20 }, (_, i) => 200 - i * 9)), O, 1).top).toBeLessThanOrEqual(222 + 30);
  });
  it("the head stands once four leaves are open; tokens sit along the stem at 0.55 of the rise", () => {
    expect(sprites(sunflower(sh([20, 15, 10, 5], 1), O, 1)).some((s) => s.part === "head")).toBe(false);
    const l = sunflower(sh([20, 15, 10, 5]), { ...O, fruit: 2 }, 1);
    expect(sprites(l).find((s) => s.part === "head")).toMatchObject({ x: -1, y: -(22 + 16 * 4) });
    expect(sprites(l).filter((s) => s.name === "token-hsol").map((t) => t.y)).toEqual([-(22 + 64) * 0.55, -(22 + 64) * 0.55 + 6]);
  });
});

describe("the spruce (gen03 plant_cbbtc3, cap 200)", () => {
  it("rises 16 + 13 per shoot to 199.8; a tier's reach grows with the tiers above it, to six", () => {
    const l = spruce(sh([80, 60, 40, 20, 5]), O, 1);
    expect(stems(l).find((s) => s.part === "trunk")).toMatchObject({ y1: -(16 + 13 * 5), color: "#8C6A45" });
    const tiers = sprites(l).filter((s) => s.part === "tier");
    expect(tiers[0]).toMatchObject({ name: "tier-spruce-s3", scale: 1, xScale: ((17 + 2.5 * 4) * 1) / 17 });   // the arms lengthen with the tiers above; the needles keep their size (gen03:270-275)
    expect(tiers[4]).toMatchObject({ name: "tier-spruce-s1", scale: 1, xScale: 1 });
    expect(sprites(l).find((s) => s.part === "tip")).toMatchObject({ x: 0, y: -(16 + 65) });
    expect(spruce(sh(Array.from({ length: 30 }, (_, i) => 300 - i * 9)), O, 1).parts.find((p) => p.kind === "stem")).toMatchObject({ y1: -199.8 });
  });

  it("pins every tier: count, stage name, height up the leader, arm ratio, all on the axis", () => {
    const l = spruce(sh([80, 60, 40, 20, 5]), O, 1);
    const tiers = sprites(l).filter((s) => s.part === "tier");
    expect(tiers).toHaveLength(5);
    const step = (81 - 8) / 5;
    const baked = { 3: 17, 2: 14, 1: 10 } as const;
    const stage = [3, 3, 3, 2, 1] as const;
    tiers.forEach((t, i) => {
      expect(t.name).toBe(`tier-spruce-s${stage[i]}`);
      expect(t.x).toBe(0); expect(t.rot).toBe(0); expect(t.z).toBe(2); expect(t.shoot).toBe(`h${i}`);
      expect(t.y).toBeCloseTo(-8 - step * (i + 0.5), 10);
      expect(t.scale).toBe(1);
      expect(t.xScale).toBeCloseTo((baked[stage[i]] + 2.5 * (4 - i)) / baked[stage[i]], 10);
    });
    // the leader is the one stem, trunk width 3 + 0.2n tapering to 1.2
    expect(stems(l)).toHaveLength(1);
    expect(stems(l)[0]).toMatchObject({ part: "trunk", x0: 0, y0: 0, x1: 0, w0: 3 + 0.2 * 5, w1: 1.2 });
  });

  it("the arm reach stops growing at six tiers above; the band and k scale both axes through scale, not xScale", () => {
    const l = spruce(sh(Array.from({ length: 9 }, () => 50)), O, 1);
    const tiers = sprites(l).filter((s) => s.part === "tier");
    const older = (i: number) => Math.min(8 - i, 6);
    tiers.forEach((t, i) => expect(t.xScale).toBeCloseTo((17 + 2.5 * older(i)) / 17, 10));
    expect(tiers[0].xScale).toBe(tiers[1].xScale);   // 8 and 7 tiers above both clamp to six
    const big = { ...sh([50, 50, 50])[0], band: 2 as const };
    const l2 = spruce([big, ...sh([50, 50, 50]).slice(1)], O, 0.8);
    const t0 = sprites(l2).find((s) => s.part === "tier")!;
    expect(t0.scale).toBeCloseTo(1.28 * 0.8, 10);
    expect(t0.xScale).toBeCloseTo((17 + 2.5 * 2) / 17, 10);
  });

  it("a bud is a small bud sprite, not a tier; the tip always stands; tokens sit at tier ends", () => {
    const l = spruce(sh([30, 20, 10, 2], 1), { ...O, fruit: 2 }, 1);
    expect(sprites(l).filter((s) => s.part === "tier")).toHaveLength(3);
    expect(sprites(l).find((s) => s.part === "bud")).toMatchObject({ name: "bud-spruce", scale: 0.9 });
    expect(sprites(l).filter((s) => s.part === "tip")).toHaveLength(1);
    const rise = 16 + 13 * 4;
    const toks = sprites(l).filter((s) => s.name === "token-cbbtc");
    expect(toks.map((t) => t.x)).toEqual([-5, 5]);
    expect(toks[0].y).toBeCloseTo(-rise * 0.35, 10); expect(toks[1].y).toBeCloseTo(-rise * 0.45, 10);
    expect(sprites(spruce(sh([30]), O, 1)).some((s) => s.part === "tip")).toBe(true);
  });
});

describe("the snake plant (gen04:143-159)", () => {
  it("fans of five from the centre out, blades 14 / 30 / 48 / 64 by stage times band, angles 5 + 5 per pair; at most four fans, later shoots join them", () => {
    const l = snake(sh(Array.from({ length: 7 }, (_, i) => 40 - i * 5)), O, 1);
    const blades = sprites(l).filter((s) => s.part === "blade");
    expect(blades[0]).toMatchObject({ name: "blade-snake-s3", x: -2.4, rot: -5, scale: 1 });
    expect(blades[2]).toMatchObject({ x: -(2.4 + 1.8), rot: -10 });
    expect(blades[5]).toMatchObject({ x: 19 - 2.4 });   // the second fan at +(12 + 7)
    const many = snake(sh(Array.from({ length: 30 }, (_, i) => 300 - i * 9)), O, 1);
    const xs = sprites(many).filter((s) => s.part === "blade").map((b) => Math.round(b.x));
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(26 + 6);
    expect(sprites(many).filter((s) => s.part === "blade")).toHaveLength(30);
  });
  it("tokens at the foot, the swelling 4 px up and right", () => {
    const l = snake(sh([20]), { ...O, fruit: 2, pending: 0.25 }, 1);
    expect(sprites(l).filter((s) => s.name === "token-jitosol").map((t) => [t.x, t.y])).toEqual([[-4, -4], [4, -4]]);
    expect(sprites(l).find((s) => s.part === "swelling")).toMatchObject({ x: 4, y: -4, scale: 3 });
  });
  it("band 2 at k 0.8: the blade's scale is band times k and carries no xScale, so the drawn length is 1.28 · 0.8 · 64", () => {
    const l = snake([{ id: "a", ageDays: 40, band: 2, opened: true, branch: false }], O, 0.8);
    const b = sprites(l).find((s) => s.part === "blade")!;
    expect(b.scale).toBeCloseTo(1.28 * 0.8, 10); expect(b.xScale).toBeUndefined();
    expect(b.scale * 64).toBeCloseTo(65.536, 10);
  });
});

describe("the blueberry bush (gen04:161-180)", () => {
  it("canes of eight: the first upright to min(161.5, 18 + 15 m), later canes lean 14 + 6 per pair and rise 0.85; at most four canes", () => {
    const l = blueberry(sh(Array.from({ length: 10 }, (_, i) => 100 - i * 9)), O, 1);
    const canes = stems(l).filter((s) => s.part === "cane");
    expect(canes[0]).toMatchObject({ x1: 0, y1: -(18 + 15 * 8) });
    expect(canes[1]).toMatchObject({ x1: 20, y1: -((18 + 15 * 2) * 0.85), bend: 6 });
    expect(stems(blueberry(sh(Array.from({ length: 40 }, (_, i) => 400 - i * 9)), O, 1)).filter((s) => s.part === "cane")).toHaveLength(4);
  });
  it("twigs of two then three small ovals at 62 minus 6 per node mod 3; token clusters of three at the newest tips; the bell last", () => {
    const l = blueberry(sh([40, 30, 5]), { ...O, fruit: 1, ripening: 0.5 }, 1);
    const leaves = sprites(l).filter((s) => s.part === "leaf");
    expect(leaves.filter((f) => f.shoot === "h0")).toHaveLength(3); expect(leaves.filter((f) => f.shoot === "h2")).toHaveLength(2);
    expect(sprites(l).filter((s) => s.name === "token-jupsol")).toHaveLength(3);
    expect(sprites(l).find((s) => s.name === "bell-blueberry")?.scale).toBeCloseTo(0.8, 5);
  });
  it("band 2 at k 0.8: a leaf's scale is band times k (0.85 off the centre) and carries no xScale", () => {
    const l = blueberry([{ id: "a", ageDays: 40, band: 2, opened: true, branch: false }], O, 0.8);
    const leaves = sprites(l).filter((s) => s.part === "leaf");
    expect(leaves.map((s) => s.scale).sort()).toEqual([1.28 * 0.8 * 0.85, 1.28 * 0.8 * 0.85, 1.28 * 0.8].sort());
    expect(leaves.every((s) => s.xScale === undefined)).toBe(true);
  });
});
