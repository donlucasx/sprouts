import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITES_B64 } from "@/garden/sprites-b64";
import { SPRITE_META } from "@/garden/sprite-meta";
import { BAKED_L } from "@/model/species";
import meta from "../../assets/garden/sprites.json";

const EXPECTED = [
  ...["mandarin", "sunflower", "blueberry"].flatMap((s) => [0, 1, 2, 3].map((i) => `leaf-${s}-s${i}`)),
  ...[0, 1, 2, 3].map((i) => `blade-snake-s${i}`), ...[0, 1, 2, 3].map((i) => `tier-spruce-s${i}`), ...[0, 1, 2].map((i) => `blade-succulent-${i}`),
  ...["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"].map((s) => `bud-${s}`),
  ...["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"].map((p) => `token-${p}`),
  "sign", "blossom-mandarin", "bell-blueberry", "head-sunflower", "tip-spruce", "pup-succulent", "seed", "ring", "can", "can-tilt", "ground", "grain",
];

describe("the baked sprite set", () => {
  it("has every part the geometry places, with a box and an anchor inside it", () => {
    for (const name of EXPECTED) {
      const m = (meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>)[name];
      expect(m, name).toBeDefined();
      expect(m.w).toBeGreaterThan(0); expect(m.h).toBeGreaterThan(0);
      expect(m.ax).toBeGreaterThanOrEqual(0); expect(m.ax).toBeLessThanOrEqual(m.w);
      expect(m.ay).toBeGreaterThanOrEqual(0); expect(m.ay).toBeLessThanOrEqual(m.h);
      expect(existsSync(`assets/garden/${name}@3x.png`), `${name}@3x.png`).toBe(true);
    }
  });
  it("bakes each part at its drawn size (each box is the drawn part plus the trim's 2 px pad a side and the paint filter): a bud, a sign with its post, a token, a succulent blade", () => {
    const m = meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>;   // sprites.json also carries _strips and _bakedL
    expect(m["bud-mandarin"].h).toBeGreaterThan(12); expect(m["bud-mandarin"].h).toBeLessThan(16);   // measured 14.33 (10-02 pre-flight bake)
    expect(m["sign"].h).toBeGreaterThan(24); expect(m["sign"].ay).toBeGreaterThan(m["sign"].h / 2);   // measured h 25.67, ay 14 (10-02, the blank board of R168): the board sits 12 to 13.5 px above the origin, the post and its mark about 9.5 below
    for (const p of ["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]) expect(m[`sign-${p}`], `sign-${p}`).toBeUndefined();   // R168: one blank board, the word is type
    expect(m["token-skr"].w).toBeGreaterThan(10); expect(m["token-skr"].w).toBeLessThan(16);   // measured 14.33
    expect(m["blade-succulent-0"].h).toBeGreaterThan(40); expect(m["blade-succulent-0"].h).toBeLessThan(50);   // measured 47.33
    expect(m["grain"].w).toBe(320);
  });
  it("the ground is one baked wash, 320 wide at 1x, anchored top-left, the paper showing at its top-left corner (RG28)", () => {
    const m = (meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>)["ground"];
    expect(m.w).toBe(320); expect(m.ax).toBe(0); expect(m.ay).toBe(0);
    const png = PNG.sync.read(readFileSync("assets/garden/ground@3x.png"));
    expect(png.width).toBe(960); expect(png.height).toBe(Math.round(m.h * 3));
    expect(png.data[3]).toBe(0);   // RGBA: the first pixel's alpha; the vignette does not fill the canvas
  });
  it("carries every sprite but the grain as a PNG literal for the widget, under 220 KB in all without the ground, the ground under 100 KB", () => {
    let total = 0;
    for (const name of EXPECTED.filter((n) => n !== "grain")) {
      const b = Buffer.from(SPRITES_B64[name], "base64");
      expect(b.subarray(1, 4).toString("ascii"), name).toBe("PNG");
      if (name !== "ground") total += SPRITES_B64[name].length;
    }
    expect(SPRITES_B64["grain"]).toBeUndefined();
    expect(total).toBeLessThan(220_000);
    expect(SPRITES_B64["ground"].length).toBeLessThan(100_000);   // measured 10-02 on the current ground12.py: the 1x literal is 60,104 chars (the 3x bake downsampled keeps its grain)
  });
  it("the three generated modules agree on the names, and the bake's length tables are species.ts's BAKED_L", () => {
    expect(readFileSync("src/garden/sprites.ts", "utf8")).toContain('"sign": { src: require("@/assets/garden/sign.png")');   // no @3x in a require: Metro cannot resolve an explicit scale (the spike, 10-02); it picks sign@3x.png itself
    const { _bakedL, _strips, ...rest } = meta as Record<string, unknown> & { _bakedL: Record<string, number[]>; _strips: Record<string, unknown> };
    expect(Object.keys(_strips).sort()).toEqual(["blade", "broad", "heart", "small"]);
    expect(Object.keys(SPRITE_META).sort()).toEqual(Object.keys(rest).sort());
    expect(_bakedL).toEqual(BAKED_L);
  });
});

describe("the opening strips (RG24 part two): one wash11 strip per leaf shape, 16 frames of 96 px at 3x", () => {
  const strips = (meta as unknown as { _strips: Record<string, { frames: number; w: number; h: number; ay: number; L: number }> })._strips;
  it.each(["blade", "heart", "broad", "small"])("%s: 16 frames side by side, the first empty, the last painted, the base row at 0.93 and the length at 0.84 of the frame", (shape) => {
    expect(strips[shape]).toEqual({ frames: 16, w: 32, h: 32, ay: 29.76, L: 26.88 });   // 1x units: 96 / 3; 0.93 and 0.84 of 32 (wash11.py:47-49)
    const png = PNG.sync.read(readFileSync(`assets/garden/strips/${shape}@3x.png`));
    expect(png.width).toBe(16 * 96); expect(png.height).toBe(96);
    const alphaSum = (frame: number) => { let s = 0; for (let y = 0; y < 96; y++) for (let x = frame * 96; x < frame * 96 + 96; x++) s += png.data[(y * png.width + x) * 4 + 3]; return s; };
    expect(alphaSum(0)).toBe(0); expect(alphaSum(15)).toBeGreaterThan(0);
  });
  it("the strips module names the four shapes with their require()", () => {
    expect(readFileSync("src/garden/strips.ts", "utf8")).toContain('blade: { src: require("@/assets/garden/strips/blade.png")');
  });
});
