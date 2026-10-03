import { describe, it, expect } from "vitest";
import { WIND, WIND_IDLE, WIND_SPRITE_COUNT, rand, curlCount, curlPlan, curlAt, isGustStart, GUST_ROLL_MS, GUST_PEAK_MS } from "@/model/wind";
import { GUST, GUST_IDLE, gustSpanMs } from "@/model/motion";
import { readFileSync } from "node:fs";
import path from "node:path";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const plan = (seed: number) => [0, 1, 2].map((i) => curlPlan(seed, i));
const on = (seed: number) => plan(seed).filter((c) => c.on);

describe("R200: the wind curls ride the gust clock", () => {
  it("the gust the curls ride is R189's: 2.1 s across six plants, each peaking 750 ms into its own gust", () => {
    expect(GUST_ROLL_MS).toBe(2100);
    expect(GUST_PEAK_MS).toBe(750);
    expect(GUST_ROLL_MS).toBe(gustSpanMs(6));
  });
  it("a new gust is detected only when the gust clock falls (idle or held, then reset to 0)", () => {
    expect(isGustStart(0, GUST_IDLE)).toBe(true);           // the first gust after mount
    expect(isGustStart(0, gustSpanMs(6))).toBe(true);       // every later gust: the clock held at the last gust's end, reset to 0
    expect(isGustStart(800, 400)).toBe(false);               // mid-gust, the clock climbs
    expect(isGustStart(GUST_IDLE, 1200)).toBe(false);        // reduced motion switched on mid-gust: the clock parks at idle (a rise)
    expect(isGustStart(0, null)).toBe(false);                // the reaction's first run has no previous value
  });
  it("each gust brings 2 or 3 curls, and both counts happen", () => {
    const counts = SEEDS.map(curlCount);
    for (const n of counts) expect([2, 3]).toContain(n);
    expect(counts.filter((n) => n === 2).length).toBeGreaterThan(40);
    expect(counts.filter((n) => n === 3).length).toBeGreaterThan(40);
    for (const s of SEEDS) expect(on(s).length).toBe(curlCount(s));
  });
  it("in step with the gust: the first curl lands within 250 ms of the gust's start, the last fades after the last plant settles, all gone by the wind's span", () => {
    for (const s of SEEDS) {
      const cs = on(s);
      expect(Math.min(...cs.map((c) => c.delay))).toBeLessThanOrEqual(250);
      const end = Math.max(...cs.map((c) => c.delay + c.life));
      expect(end).toBeGreaterThanOrEqual(GUST_ROLL_MS);
      expect(end).toBeLessThanOrEqual(WIND.spanMs);
      for (const c of cs) { expect(c.delay).toBeGreaterThanOrEqual(0); expect(c.life).toBeGreaterThan(1500); }
    }
  });
  it("visible during the gust, at most WIND.maxOpacity, and nothing between gusts (the wind clock idle)", () => {
    for (const s of SEEDS.slice(0, 40)) {
      const cs = on(s);
      // half-way through the gust's roll at least one curl shows, none above the cap
      const mid = cs.map((c) => curlAt(c, GUST_ROLL_MS / 2, false).opacity);
      expect(Math.max(...mid)).toBeGreaterThan(0.3);
      for (let ms = 0; ms <= WIND.spanMs; ms += 50) for (const c of cs) expect(curlAt(c, ms, false).opacity).toBeLessThanOrEqual(WIND.maxOpacity + 1e-9);
      for (const c of plan(s)) {
        expect(curlAt(c, WIND_IDLE, false).opacity).toBe(0);
        expect(curlAt(c, WIND.spanMs, false).opacity).toBe(0);
        expect(curlAt(c, -1, false).opacity).toBe(0);
      }
    }
  });
  it("a slot a two-curl gust leaves out never shows", () => {
    const s = SEEDS.find((x) => curlCount(x) === 2) as number;
    const off = curlPlan(s, 2);
    expect(off.on).toBe(false);
    for (let ms = 0; ms <= WIND.spanMs; ms += 50) expect(curlAt(off, ms, false).opacity).toBe(0);
  });
  it("reduced motion: no curl at any moment", () => {
    for (const s of SEEDS.slice(0, 20)) for (const c of plan(s)) for (let ms = 0; ms <= WIND.spanMs; ms += 25) expect(curlAt(c, ms, true).opacity).toBe(0);
  });
  it("drifts left to right, quickest as it lands (an ease-out), lands softly and fades without a pop", () => {
    for (const s of SEEDS.slice(0, 40)) for (const c of on(s)) {
      let lastX = -Infinity, lastStep = Infinity;
      for (let k = 1; k < 40; k++) {
        const f = curlAt(c, c.delay + (c.life * k) / 40, false);
        expect(f.x).toBeGreaterThan(lastX);
        if (lastX !== -Infinity) { const step = f.x - lastX; expect(step).toBeLessThanOrEqual(lastStep + 1e-12); lastStep = step; }
        lastX = f.x;
      }
      const at = (u: number) => curlAt(c, c.delay + c.life * u, false);
      expect(at(0.01).opacity).toBeLessThan(0.02);         // fades in
      expect(at(0.99).opacity).toBeLessThan(0.01);         // fades out
      expect(at(0.5).opacity).toBeCloseTo(c.peak, 9);       // full strength through the middle
      expect(at(0.99).x).toBeCloseTo(c.x0 + c.travel, 1);   // it covered its travel
    }
  });
  it("starts at the garden's left and crosses most of it, in the sky (never low over the soil)", () => {
    for (const s of SEEDS) for (const c of on(s)) {
      expect(c.x0).toBeGreaterThanOrEqual(WIND.startX[0]); expect(c.x0).toBeLessThanOrEqual(WIND.startX[1]);
      expect(c.travel).toBeGreaterThanOrEqual(WIND.travel[0]); expect(c.travel).toBeLessThanOrEqual(WIND.travel[1]);
      expect(c.top).toBeGreaterThanOrEqual(WIND.top[0]); expect(c.top).toBeLessThanOrEqual(WIND.top[1]);
    }
  });
  it("per-curl variation: within a gust the curls take different bands of the sky and different paintings; across gusts sizes and speeds vary", () => {
    for (const s of SEEDS) {
      const cs = plan(s);
      const band = (t: number) => Math.floor(((t - WIND.top[0]) / (WIND.top[1] - WIND.top[0])) * 3);
      expect(new Set(cs.map((c) => band(c.top))).size).toBe(3);
      expect(new Set(cs.map((c) => c.sprite)).size).toBe(3);
      for (const c of cs) { expect(c.sprite).toBeGreaterThanOrEqual(0); expect(c.sprite).toBeLessThan(WIND_SPRITE_COUNT); }
    }
    const first = SEEDS.map((s) => curlPlan(s, 0));
    expect(new Set(first.map((c) => c.scale.toPrecision(6))).size).toBeGreaterThan(150);
    expect(new Set(first.map((c) => (c.travel / c.life).toPrecision(6))).size).toBeGreaterThan(150);
    expect(new Set(first.map((c) => c.top.toPrecision(6))).size).toBeGreaterThan(150);
  });
  it("the plan is a pure function of the gust's seed (the UI thread and these tests agree)", () => {
    expect(curlPlan(7, 1)).toEqual(curlPlan(7, 1));
    expect(curlPlan(7, 1)).not.toEqual(curlPlan(8, 1));
    for (let k = 0; k < 500; k++) { const v = rand(k, k % 7); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it("one painted curl per sprite index (wind12.py baked three)", () => {
    // wind-sprites.ts holds require() calls node cannot load: count its entries from the source instead
    const src = readFileSync(path.resolve(__dirname, "../../src/garden/wind-sprites.ts"), "utf8");
    expect(src.match(/require\("@\/assets\/garden\/wind-[a-z]\.png"\)/g)?.length).toBe(WIND_SPRITE_COUNT);
  });
  it("the wind never outlasts the gap to the next gust", () => {
    expect(WIND.spanMs).toBeLessThan(GUST.minGapMs);
  });
});
