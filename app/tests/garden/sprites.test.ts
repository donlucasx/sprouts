import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITES_B64 } from "@/garden/sprites-b64";
import { SPRITE_META, GROUND_OUTLINE } from "@/garden/sprite-meta";
import { BAKED_L } from "@/model/species";
import meta from "../../assets/garden/sprites.json";

const EXPECTED = [
  ...["mandarin", "sunflower", "blueberry"].flatMap((s) => [0, 1, 2, 3].map((i) => `leaf-${s}-s${i}`)),
  ...[0, 1, 2, 3].map((i) => `blade-snake-s${i}`), ...[0, 1, 2, 3].map((i) => `tier-spruce-s${i}`), ...[0, 1, 2].map((i) => `blade-succulent-${i}`),
  ...["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"].map((s) => `bud-${s}`),
  ...["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"].map((p) => `token-${p}`),
  "sign", "blossom-mandarin", "bell-blueberry", "head-sunflower", "tip-spruce", "pup-succulent", "seed", "ring", "can", "can-tilt", "can-grey", "can-shadow", "ground", "grain", "bar-track", "bar-fill",
];
const APP_ONLY = ["grain", "bar-track", "bar-fill", "can-grey"];   // can-shadow rides in the widget literal unused (the bake writes every sheet part)

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
  it("carries every sprite but the grain and the bars as a PNG literal for the widget, under 220 KB in all without the ground, the ground under 100 KB", () => {
    let total = 0;
    for (const name of APP_ONLY) expect(SPRITES_B64[name], name).toBeUndefined();
    for (const name of EXPECTED.filter((n) => !APP_ONLY.includes(n))) {
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
    const { _bakedL, _strips, _groundOutline, ...rest } = meta as Record<string, unknown> & { _bakedL: Record<string, number[]>; _strips: Record<string, unknown>; _groundOutline: number[][] };
    expect(_groundOutline).toEqual(GROUND_OUTLINE);   // R176: the manifest and the module carry the one outline
    expect(Object.keys(_strips).sort()).toEqual(STRIP_NAMES);
    expect(Object.keys(SPRITE_META).sort()).toEqual(Object.keys(rest).sort());
    expect(_bakedL).toEqual(BAKED_L);
  });
});

describe("the next-planting bar (R169): two painted strokes, 300 long at 1x plus their round ends, stretched to the row", () => {
  it.each(["bar-track", "bar-fill"])("%s: 308 by about 11 at 1x, anchored at its left end's centre, painted along its length", (name) => {
    const m = (meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>)[name];
    expect(m.w).toBe(308); expect(m.h).toBeGreaterThan(8); expect(m.h).toBeLessThan(14);   // measured 11.33: the 5.5 stroke, the filter's spread, the 2 px trim
    expect(m.ax).toBe(4); expect(m.ay).toBeCloseTo(m.h / 2, 0);
    const png = PNG.sync.read(readFileSync(`assets/garden/${name}@3x.png`)), mid = Math.round(png.height / 2);
    for (const x of [0.1, 0.5, 0.9].map((t) => Math.round(t * png.width))) expect(png.data[(mid * png.width + x) * 4 + 3], `${name} alpha at x ${x}`).toBeGreaterThan(40);
  });
  it("the fill pools darker at its leading (right) end than along its body", () => {
    const png = PNG.sync.read(readFileSync("assets/garden/bar-fill@3x.png")), mid = Math.round(png.height / 2);
    const lum = (x: number) => { const i = (mid * png.width + x) * 4; return png.data[i] + png.data[i + 1] + png.data[i + 2]; };
    expect(lum(png.width - 4 * 3 - 6)).toBeLessThan(lum(Math.round(png.width / 2)));   // a few px inside the right end vs the middle
  });
});

const STRIP_NAMES = ["hsol-broad", "jitosol-blade", "jupsol-small", "ore-blade", "skr-blade"];
describe("the opening strips (RG24 part two; I4 fix round 1, ruling a): one coloured wash11 strip per species and leaf shape, 16 frames of 96 px at 3x", () => {
  const strips = (meta as unknown as { _strips: Record<string, { frames: number; w: number; h: number; ay: number; L: number }> })._strips;
  it.each(STRIP_NAMES)("%s: 16 whole frames side by side, the first empty, the last painted in colour, the base row at 0.93 and the length at 0.84 of the frame", (name) => {
    expect(strips[name]).toEqual({ frames: 16, w: 32, h: 32, ay: 29.76, L: 26.88 });   // 1x units: 96 / 3 (a whole 1x width, no seam); 0.93 and 0.84 of 32 (wash11.py:47-49)
    const png = PNG.sync.read(readFileSync(`assets/garden/strips/${name}@3x.png`));
    expect(png.width).toBe(16 * 96); expect(png.height).toBe(96);
    const sum = (frame: number, ch: number) => { let s = 0; for (let y = 0; y < 96; y++) for (let x = frame * 96; x < frame * 96 + 96; x++) s += png.data[(y * png.width + x) * 4 + ch]; return s; };
    expect(sum(0, 3)).toBe(0); expect(sum(15, 3)).toBeGreaterThan(0);
    // coloured, not a white mask: in the last frame the painted pixels are green-led (G above R and B on average, weighted by alpha)
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < 96; y++) for (let x = 15 * 96; x < 16 * 96; x++) { const i = (y * png.width + x) * 4, a = png.data[i + 3]; r += png.data[i] * a; g += png.data[i + 1] * a; b += png.data[i + 2] * a; }
    expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b);
  });
  it("the strips module names the five strips with their require()", () => {
    const src = readFileSync("src/garden/strips.ts", "utf8");
    for (const n of STRIP_NAMES) expect(src).toContain(`"${n}": { src: require("@/assets/garden/strips/${n}.png")`);
  });
});

describe("the greyed can (R175; I4 fix round 1, ruling d): baked, desaturated, about 45 percent", () => {
  it("has the rest can's box, no colour, and 45 percent of its alpha", () => {
    const m = meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>;
    expect(m["can-grey"]).toEqual(m["can"]);
    const can = PNG.sync.read(readFileSync("assets/garden/can@3x.png")), grey = PNG.sync.read(readFileSync("assets/garden/can-grey@3x.png"));
    expect([grey.width, grey.height]).toEqual([can.width, can.height]);
    let a0 = 0, a1 = 0, chroma = 0;
    for (let i = 0; i < grey.data.length; i += 4) { a0 += can.data[i + 3]; a1 += grey.data[i + 3]; chroma = Math.max(chroma, Math.abs(grey.data[i] - grey.data[i + 1]), Math.abs(grey.data[i + 1] - grey.data[i + 2])); }
    expect(chroma).toBe(0);
    expect(a1 / a0).toBeGreaterThan(0.43); expect(a1 / a0).toBeLessThan(0.47);
  });
});

describe("the water ring reads as wet soil (R182): a damp brown, no blue", () => {
  it.each(["ring@3x.png", "ring@1x.png"])("%s: its average painted pixel has blue below red", (file) => {
    const png = PNG.sync.read(readFileSync(`assets/garden/${file}`));
    let r = 0, b = 0, a = 0;
    for (let i = 0; i < png.data.length; i += 4) { const w = png.data[i + 3]; r += png.data[i] * w; b += png.data[i + 2] * w; a += w; }
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeLessThan(r / a);
  });
  it("the widget's literal is the same brown bake", () => {
    const png = PNG.sync.read(Buffer.from(SPRITES_B64["ring"], "base64"));
    let r = 0, b = 0;
    for (let i = 0; i < png.data.length; i += 4) { r += png.data[i] * png.data[i + 3]; b += png.data[i + 2] * png.data[i + 3]; }
    expect(b).toBeLessThan(r);
  });
});

describe("the can's contact shadow (R184): a soft dark-brown wash, low opacity, a little wider than the can's base", () => {
  it("is brown (blue below red), faint, and wider than the body's 27 px base at 1x", () => {
    const m = (meta as unknown as Record<string, { w: number; h: number; ax: number; ay: number }>)["can-shadow"];
    expect(m.w).toBeGreaterThan(27); expect(m.w).toBeLessThan(48); expect(m.h).toBeLessThan(m.w / 2);
    const png = PNG.sync.read(readFileSync("assets/garden/can-shadow@3x.png"));
    let r = 0, b = 0, a = 0, peak = 0;
    for (let i = 0; i < png.data.length; i += 4) { const w = png.data[i + 3]; r += png.data[i] * w; b += png.data[i + 2] * w; a += w; peak = Math.max(peak, w); }
    expect(b).toBeLessThan(r); expect(peak).toBeLessThan(255 * 0.6);   // never solid
  });
});
