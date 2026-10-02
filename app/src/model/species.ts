// The six species on one grammar (spec 4): the shared types the geometry, the model and both renderers agree on, the constants
// ported from the review generators (brand/garden/gen01 to gen06, gen09) and the colour table (spec 9, RG21). Dependency-free.
export type Species = "mandarin" | "succulent" | "sunflower" | "snake" | "blueberry" | "spruce";
export type PlantId = "skr" | "ore" | "hsol" | "jitosol" | "jupsol" | "cbbtc";
export const PLANT_SPECIES: Record<PlantId, Species> = { skr: "mandarin", ore: "succulent", hsol: "sunflower", jitosol: "snake", jupsol: "blueberry", cbbtc: "spruce" };
export type Band = 0 | 1 | 2;
export type Stage = 0 | 1 | 2 | 3;
/** One planting as the geometry sees it: age in days, the amount band, opened or a bud, and whether it is a branch node (RG19). */
export type ShootIn = { id: string; ageDays: number; band: Band; opened: boolean; branch: boolean };
/** One placed thing: a sprite by name, or a vector stem by its two ends. x and y are px from the plant's foot (0, 0), y negative
 * upward, already multiplied by k; rot in degrees, SVG sense; scale multiplies the sprite's baked size (for `swelling` and `dot`
 * it is the circle's radius in px). */
export type Placed =
  | { kind: "sprite"; name: string; x: number; y: number; rot: number; scale: number; xScale?: number; z: number; shoot?: string; part: "leaf" | "bud" | "blade" | "tier" | "token" | "blossom" | "head" | "bell" | "pup" | "swelling" | "tip" | "dot" }
  | { kind: "stem"; x0: number; y0: number; x1: number; y1: number; w0: number; w1: number; bend: number; color: string; z: number; shoot?: string; part: "trunk" | "twig" | "branch" | "cane" | "stalk" | "petiole" | "fan" };
export type PlantLayout = { parts: Placed[]; top: number; growthPoint: { x: number; y: number }; tips: { x: number; y: number }[] };
export type LayoutOpts = { pending: number; fruit: number; ripening: number; blossom: boolean; pups: number; head: boolean };

/** RG4: the bud's and the shoot's size by amount band (gen01_garden.py:23). */
export const BAND_SCALE: Record<Band, number> = { 0: 0.78, 1: 1.0, 2: 1.28 };
/** The generators' rise caps (gen04_garden.py:13, :74, :167, :184, :190, :152; gen06_garden.py:36, :40). */
export const CAPS = { mandarinTrunk: 222 * 0.66, sunflower: 222, spruce: 222 * 0.9, blueberry: 190 * 0.85, snakeBlade: 64, succulent: [78, 58, 40] as const, stalk: 96 } as const;
/** The length each leaf-like sprite was baked at, per stage (bake.py LEAF_L and TIER_L): a placed scale times this is the part's length.
 * RG29 (gen12_ground.py:19-23): the twig species' stage 0 at twice gen01's size, 12 for the mandarin and 10.8 for the blueberry.
 * RG33 (10-02, "Never shrink"): no stage is smaller than the one before, so stage 1 rises to the sprout's length. */
export const BAKED_L: Record<string, number[]> = {
  "leaf-mandarin": [12, 12, 12, 14], "leaf-sunflower": [9, 14, 19, 24], "leaf-blueberry": [10.8, 10.8, 10.8, 12.6],
  "blade-snake": [14, 30, 48, 64], "tier-spruce": [6, 10, 14, 17], "blade-succulent": [40, 40, 40, 40],
};
/** Spec 9 (RG12, RG21): light, green, deep per plant; the token disc and its glyph. The mark's #1E6B44 appears nowhere here. */
export const COLORS: Record<PlantId, { light: string; green: string; deep: string; token: string; glyph: string }> = {
  skr: { light: "#6FBF7A", green: "#2E8B57", deep: "#236F47", token: "#F08A2E", glyph: "#FFF6EC" },
  ore: { light: "#7FB3A3", green: "#5E9C8C", deep: "#4A8577", token: "#E8C46A", glyph: "#4A3A14" },
  hsol: { light: "#9BC24A", green: "#6E9B2E", deep: "#4A7020", token: "#C7391F", glyph: "#FFF1E8" },
  jitosol: { light: "#A8D8C2", green: "#3F8F7A", deep: "#22594B", token: "#A8D8C2", glyph: "#22594B" },
  jupsol: { light: "#D2EC9A", green: "#A6D65A", deep: "#6FA33A", token: "#2C9FD6", glyph: "#E9F7FF" },
  cbbtc: { light: "#A9C7C0", green: "#6E9C93", deep: "#3F6B66", token: "#2F6BDF", glyph: "#FFFFFF" },
};
export const SOIL = { back: "#C9A77E", front: "#A9825C", edge: "#6B5340", line: "#7A6248", post: "#8C6A45", wood: "#C9A77E", board: "#F1E6CC", ink: "#2B2622", paper: "#FFFCF6", water: "#5C8BB3", woody: "#6E5A3C", caneWood: "#7A6248" } as const;
