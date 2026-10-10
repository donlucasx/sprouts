import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CANVAS, DECOR, DRAW_ORDER, OVERLAYS, PLANTS, SPOTS } from "@/garden2/layout";
import { FRAME_PAD, frameTop, paintedTop, LADDER, allStages, clampStage, composeLayers, onePerPlant, paintsAt, plantAt, plantedDollars, scaleRect, stageForDollars, stagesFor, viewHeight, clampZoom2, fruitOn, FRUIT_FROM, revealFrom, STAKE, STAKE_AT, STAKE_LABEL, type Pick2, type Planting2, type Stages } from "@/model/garden2";

const ASSETS = path.resolve(__dirname, "../../assets/garden2");
const day = (d: number, h = 12) => new Date(2026, 9, d, h);   // local time (vitest pins TZ to Los Angeles)
/** A planting of `cents` that bought `raw` of the coin (raw defaults to 1,000 per cent, so tests read in round numbers). */
const at = (d: number, asset: Planting2["asset"], cents: number, h = 12, raw = BigInt(Math.max(0, cents)) * 1000n): Planting2 => ({ ts: day(d, h), asset, usdcInCents: cents, amountOutRaw: raw });
const g = (plantings: Planting2[], picks: Pick2[] = [], skrPrincipalPickedRaw = 0n) => ({ plantings, picks, skrPrincipalPickedRaw });

describe("the stage ladder (R484G, approved R485G)", () => {
  it("is the approved 14 steps: $0.01 to $5 over stages 1-7, $5 to $30 over 8-14", () => {
    expect([...LADDER]).toEqual([0.01, 0.5, 1, 1.75, 2.5, 3.5, 5, 6.45, 8.3, 10.7, 13.8, 17.8, 23, 30]);
    expect(stageForDollars(5)).toBe(7);
  });
  it("counts the thresholds a coin's dollars reach, each one exactly at its threshold", () => {
    expect(stageForDollars(0)).toBe(0);
    expect(stageForDollars(0.009)).toBe(0);
    LADDER.forEach((t, i) => {
      expect(stageForDollars(t)).toBe(i + 1);
      expect(stageForDollars(t - 0.001)).toBe(i);
    });
    expect(stageForDollars(30)).toBe(14);
    expect(stageForDollars(10_000)).toBe(14);
  });
  it("takes another ladder (the pacing decision is open: one swappable function)", () => {
    expect(stageForDollars(3, [1, 2, 4])).toBe(2);
    expect(onePerPlant("mandarin", 1, allStages(0))).toBe(3);
  });
});

describe("stages from plantings (dollars put in, R518; right away, R521; withdrawals shrink, R519)", () => {
  it("is 0 everywhere before any planting", () => {
    expect(stagesFor(g([]))).toEqual(allStages(0));
  });
  it("maps each coin to its plant (layout.json's coins) and sums its dollars", () => {
    const plantings = [at(5, "SKR", 30), at(6, "SKR", 30), at(5, "stORE", 100), at(5, "hSOL", 175), at(5, "USDC_LEND", 250), at(5, "SOL_LEND", 500), at(5, "cbBTC", 3000)];
    expect(stagesFor(g(plantings))).toEqual({ mandarin: 2, store: 3, pothos: 4, azalea: 5, maple: 7, orchid: 14 });
  });
  it("a planting grows the plant as soon as it is confirmed, with no end-of-day wait (R521)", () => {
    expect(stagesFor(g([at(10, "SKR", 100, 8)])).mandarin).toBe(3);
  });
  it("a planted coin shows at least stage 1 (a legacy row with no dollar leg), never above 14", () => {
    expect(stagesFor(g([at(5, "stORE", 0)])).store).toBe(1);
    expect(stagesFor(g([at(5, "cbBTC", 99_999)])).orchid).toBe(14);
  });
  it("counts dollars put in only (no price input exists), never a negative leg", () => {
    const { dollars, planted } = plantedDollars(g([at(5, "hSOL", 120), at(6, "hSOL", -50)]));
    expect(dollars.pothos).toBeCloseTo(1.2, 9);
    expect([...planted]).toEqual(["pothos"]);
  });
  it("uses the pacing it is given", () => {
    const skrLeads = (p: string, d: number) => (p === "mandarin" ? 14 : stageForDollars(d));
    expect(stagesFor(g([at(5, "SKR", 1), at(5, "SOL_LEND", 1)]), skrLeads)).toMatchObject({ mandarin: 14, maple: 1 });
  });
  it("a withdrawal shrinks the plant by the share of its planted tokens taken out (R519)", () => {
    // $10 of hSOL (10,000,000 raw) is stage 9 ($10.70 is the 10th step); half withdrawn leaves $5, stage 7; all of it leaves the minimum 1 while planted.
    const p = [at(5, "hSOL", 1000)];
    expect(stagesFor(g(p)).pothos).toBe(9);
    expect(stagesFor(g(p, [{ asset: "hSOL", amountRaw: 500_000n }])).pothos).toBe(7);
    expect(plantedDollars(g(p, [{ asset: "hSOL", amountRaw: 500_000n }])).dollars.pothos).toBeCloseTo(5, 9);
    expect(plantedDollars(g(p, [{ asset: "hSOL", amountRaw: 2_000_000n }])).dollars.pothos).toBe(0);
    // a withdrawal of another coin leaves this one alone
    expect(stagesFor(g(p, [{ asset: "cbBTC", amountRaw: 500_000n }])).pothos).toBe(9);
  });
  it("SKR shrinks by principal withdrawn only: picking the fruit never prunes [A13]", () => {
    const p = [at(5, "SKR", 1000)];
    expect(stagesFor(g(p, [{ asset: "SKR", amountRaw: 900_000n }], 0n)).mandarin).toBe(9);
    expect(stagesFor(g(p, [{ asset: "SKR", amountRaw: 900_000n }], 500_000n)).mandarin).toBe(7);
  });
});

describe("clampStage", () => {
  it("keeps every stage inside the plant's range; every plant has a stage 0 (the trees' soil mound, R517)", () => {
    expect(clampStage("mandarin", 0)).toBe(0);
    expect(clampStage("store", -3)).toBe(0);
    expect(clampStage("maple", -3)).toBe(0);
    expect(clampStage("orchid", 22)).toBe(14);
    expect(clampStage("azalea", 6.6)).toBe(7);
    expect(clampStage("pothos", Number.NaN)).toBe(0);
    for (const p of DRAW_ORDER) expect(PLANTS[p].first, p).toBe(0);
  });
});

describe("the layer plan (draw order and positions from the approved export)", () => {
  const keys = (s: Partial<Stages>) => composeLayers(s).map((l) => (l.kind === "plant" ? `${l.key}${l.stage}` : l.key));
  it("draws plate, then the plants back to front, the stand right after stORE and the cords right before the pothos", () => {
    expect(DRAW_ORDER).toEqual(["maple", "store", "mandarin", "pothos", "orchid", "azalea"]);
    expect(keys(allStages(14))).toEqual(["plate", "maple14", "store14", "stand", "mandarin14", "cords", "pothos14", "orchid14", "azalea14"]);
  });
  it("before any planting: every plant's bare ground (the trees' soil mound, R517), the stand and cords still drawn", () => {
    expect(keys(allStages(0))).toEqual(["plate", "maple0", "store0", "stand", "mandarin0", "cords", "pothos0", "orchid0", "azalea0"]);
    expect(keys({})).toEqual(keys(allStages(0)));
  });
  it("places every plant at its export box, the plate over the whole 1518 x 896 canvas (190 px of sand right of the original pole, R522b/R545)", () => {
    expect(CANVAS).toEqual({ w: 1518, h: 896 });
    const L = composeLayers(allStages(14));
    expect(L[0]).toMatchObject({ kind: "plate", x: 0, y: 0, w: 1518, h: 896 });
    expect(L.find((l) => l.key === "maple")).toMatchObject({ x: 597, y: 446, w: 276, h: 263 });
    expect(L.find((l) => l.key === "store")).toMatchObject({ x: 618, y: 5, w: 639, h: 708 });
    expect(L.find((l) => l.key === "mandarin")).toMatchObject({ x: 143, y: 35, w: 637, h: 705 });
    expect(L.find((l) => l.key === "pothos")).toMatchObject({ x: 1251, y: 381, w: 204, h: 260 });   // R545: moved 125 px right with the pole
    expect(L.find((l) => l.key === "orchid")).toMatchObject({ x: 928, y: 478, w: 265, h: 384 });
    expect(L.find((l) => l.key === "azalea")).toMatchObject({ x: 71, y: 532, w: 319, h: 287 });
    expect(L.find((l) => l.key === "stand")).toMatchObject({ x: OVERLAYS.stand.x, y: OVERLAYS.stand.y });
  });
  it("scales every rect by one factor, the view keeping the canvas aspect", () => {
    expect(viewHeight(1518)).toBe(896);
    expect(viewHeight(412)).toBeCloseTo(243.183, 3);
    expect(scaleRect({ x: 597, y: 446, w: 276, h: 263 }, 759)).toEqual({ x: 298.5, y: 223, w: 138, h: 131.5 });
  });
});

/** A WebP file's pixel size from its header (VP8 lossy, VP8L lossless, VP8X extended). */
function webpSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}
const pngSize = (file: string) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

describe("the bundled layers", () => {
  it("has one layer per stage in each plant's range, cut to its box", () => {
    let n = 0;
    for (const p of DRAW_ORDER) for (let s = PLANTS[p].first; s <= PLANTS[p].last; s++, n++) {
      expect(webpSize(path.join(ASSETS, p, `stage${String(s).padStart(2, "0")}.webp`))).toEqual({ w: PLANTS[p].w, h: PLANTS[p].h });
    }
    expect(n).toBe(90);
  });
  it("has the plate at canvas size and each overlay at its box", () => {
    expect(pngSize(path.join(ASSETS, "plate.png"))).toEqual({ w: 1518, h: 896 });
    for (const k of ["stand", "cords"] as const) expect(pngSize(path.join(ASSETS, OVERLAYS[k].file))).toEqual({ w: OVERLAYS[k].w, h: OVERLAYS[k].h });
  });
  it("requires every layer in sources.ts", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/garden2/sources.ts"), "utf8");
    for (const p of DRAW_ORDER) for (let s = PLANTS[p].first; s <= PLANTS[p].last; s++) expect(src).toContain(`assets/garden2/${p}/stage${String(s).padStart(2, "0")}.webp`);
  });
});

describe("tap a plant (R483G): the front-most painted plant", () => {
  const full = allStages(14);
  it("finds nothing in the empty sky or on the bare sand", () => {
    expect(plantAt(full, 5, 5)).toBeNull();
    expect(plantAt(full, 1300, 880)).toBeNull();
    expect(plantAt(full, 657, 760)).toBeNull();   // the raked sand below the maple
  });
  it("where two plants overlap, the one drawn later wins", () => {
    let both: [number, number] | null = null;
    for (let x = 618; x < 780 && !both; x += 8) for (let y = 40; y < 700 && !both; y += 8) if (paintsAt("store", 14, x, y) && paintsAt("mandarin", 14, x, y)) both = [x, y];
    expect(both).not.toBeNull();
    expect(plantAt(full, both![0], both![1])).toBe("mandarin");
    expect(plantAt({ ...full, mandarin: 0 }, both![0], both![1])).toBe("store");
  });
  it("hits each plant at the centre of its painted area, and a tree's bare mound at stage 0 (R517)", () => {
    for (const p of DRAW_ORDER) {
      const b = PLANTS[p];
      let hit = 0;
      for (let x = b.x; x < b.x + b.w; x += 8) for (let y = b.y; y < b.y + b.h; y += 8) if (plantAt(full, x, y) === p) hit++;
      expect(hit, p).toBeGreaterThan(20);
    }
    const none = allStages(0);
    const seen = new Set<string>();
    for (let x = 0; x < CANVAS.w; x += 16) for (let y = 0; y < CANVAS.h; y += 16) { const h = plantAt(none, x, y); if (h) seen.add(h); }
    expect(seen.has("mandarin") && seen.has("store")).toBe(true);
  });
});

describe("the hit grid follows the layer's own paint", () => {
  // opaque (alpha >= 128) bounding boxes measured on the export's webps, canvas px (brand/garden2/app-export, 10-09)
  const painted: [Parameters<typeof paintsAt>[0], number, [number, number, number, number]][] = [
    ["mandarin", 1, [262, 555, 692, 709]], ["store", 1, [830, 540, 1096, 661]], ["maple", 1, [634, 538, 833, 632]],
    ["orchid", 0, [944, 685, 1176, 845]], ["pothos", 14, [1267, 405, 1421, 624]],
  ];
  it.each(painted)("%s stage %i hits only inside its painted bounds (one cell of slack) and fills them", (p, s, [x0, y0, x1, y1]) => {
    const b = PLANTS[p];
    let inside = 0;
    for (let x = b.x; x < b.x + b.w; x += 4) for (let y = b.y; y < b.y + b.h; y += 4) {
      if (!paintsAt(p, s, x, y)) continue;
      expect(x >= x0 - 16 && x <= x1 + 16 && y >= y0 - 16 && y <= y1 + 16, `${p}${s} at ${x},${y}`).toBe(true);
      inside++;
    }
    expect(inside).toBeGreaterThan(((x1 - x0) * (y1 - y0)) / 16 / 8);
    expect(paintsAt(p, s, b.x - 1, b.y + 10)).toBe(false);
  });
});

describe("pinch zoom (R487G)", () => {
  it("is capped at 1.5x and never below the fitted view", () => {
    expect(clampZoom2(3)).toBe(1.5);
    expect(clampZoom2(1.2)).toBe(1.2);
    expect(clampZoom2(0.5)).toBe(1);
  });
});

describe("the frame grows with the garden (R525)", () => {
  it("an empty garden starts just above the bamboo stand, the tallest thing drawn", () => {
    expect(frameTop(allStages(0))).toBe(OVERLAYS.stand.y - FRAME_PAD);
    expect(frameTop({})).toBe(OVERLAYS.stand.y - FRAME_PAD);
  });
  it("a mature garden opens the frame to just above the tallest crown (stORE's)", () => {
    expect(frameTop(allStages(14))).toBe(Math.floor(paintedTop("store", 14) - FRAME_PAD));
    expect(frameTop(allStages(14))).toBeLessThan(FRAME_PAD);
  });
  it("only rises: a taller stage never starts the frame lower", () => {
    for (const p of DRAW_ORDER) {
      let prev = Number.POSITIVE_INFINITY;
      for (let st = 0; st <= 14; st++) {
        const t = frameTop({ ...allStages(0), [p]: st });
        expect(t, `${p} ${st}`).toBeLessThanOrEqual(prev);
        prev = t;
      }
    }
  });
  it("follows the painted top of a plant that grows above the stand", () => {
    const tall = DRAW_ORDER.flatMap((p) => Array.from({ length: 15 }, (_, st) => [p, st] as const)).find(([p, st]) => paintedTop(p, st) < OVERLAYS.stand.y);
    expect(tall).toBeDefined();
    const [p, st] = tall!;
    expect(frameTop({ ...allStages(0), [p]: st })).toBe(Math.max(0, Math.floor(paintedTop(p, st) - FRAME_PAD)));
  });
});


describe("the trees' fruit and flowers (R533, R547-R549)", () => {
  it("R548: no mandarin fruit before stage 8, whatever was earned", () => {
    expect(FRUIT_FROM.mandarin).toBe(8);
    for (let s = 0; s < 8; s++) expect(fruitOn("mandarin", s, 12)).toEqual([]);
    expect(fruitOn("mandarin", 8, 12).length).toBe(SPOTS.mandarin[8]!.at.length);
  });
  it("draws min(count, the stage's spots), none at 0 earned, and stORE only where its stage has spots", () => {
    expect(fruitOn("mandarin", 14, 0)).toEqual([]);
    expect(fruitOn("mandarin", 14, 3).length).toBe(3);
    expect(fruitOn("mandarin", 14, 40).length).toBe(SPOTS.mandarin[14]!.at.length);
    expect(fruitOn("store", 5, 12)).toEqual([]);
    expect(fruitOn("store", 6, 12).length).toBe(SPOTS.store[6]!.at.length);
  });
  it("each sprite is 2r square, centred on its spot in the tree's box (the board's size)", () => {
    const [f] = fruitOn("store", 14, 1), sp = SPOTS.store[14]!;
    expect(f!.w).toBe(sp.r * 2);
    expect(f!.x + f!.w / 2).toBeCloseTo(PLANTS.store.x + sp.at[0]![0]);
    expect(f!.y + f!.h / 2).toBeCloseTo(PLANTS.store.y + sp.at[0]![1]);
  });
  it("the fruit draws right after its tree: flowers before the stand (pole in front), mandarins before the pothos", () => {
    const keys = composeLayers(allStages(14), { fruit: { mandarin: 2, store: 2 } }).map((l) => (l.kind === "fruit" ? `f-${l.key}` : l.key));
    expect(keys.indexOf("f-store")).toBe(keys.indexOf("store") + 1);
    expect(keys.indexOf("f-store")).toBeLessThan(keys.indexOf("stand"));
    expect(keys.indexOf("f-mandarin")).toBe(keys.indexOf("mandarin") + 1);
    expect(composeLayers(allStages(14)).some((l) => l.kind === "fruit")).toBe(false);
  });
  it("bundles one sprite per tree", () => {
    for (const t of ["mandarin", "store"]) expect(fs.existsSync(path.join(ASSETS, `${t}-fruit.png`))).toBe(true);
  });
});

describe("the basket (R535)", () => {
  it("draws only when asked, last (in front of everything), at its exported box", () => {
    expect(composeLayers(allStages(14)).some((l) => l.kind === "decor")).toBe(false);
    const ls = composeLayers(allStages(14), { basket: true }), last = ls[ls.length - 1]!;
    expect(last).toEqual({ kind: "decor", key: "basket", ...DECOR.basket });
    expect(fs.existsSync(path.join(ASSETS, "decor-basket.png"))).toBe(true);
  });
});

describe("the stakes (R534, R556, R557)", () => {
  const stakesOf = (st: Stages) => composeLayers(st, { stakes: true }).filter((l) => l.kind === "stake");
  it("one per planted plant (stage 1 up), none when off or unplanted", () => {
    expect(composeLayers(allStages(14)).some((l) => l.kind === "stake")).toBe(false);
    expect(stakesOf(allStages(0))).toEqual([]);
    expect(stakesOf({ ...allStages(0), azalea: 1 }).map((l) => l.key)).toEqual(["azalea"]);
    expect(stakesOf(allStages(14)).length).toBe(6);
  });
  it("labels each with its coin, one line", () => {
    expect(STAKE_LABEL).toEqual({ mandarin: "SKR", store: "stORE", pothos: "hSOL", azalea: "USDC", maple: "SOL", orchid: "cbBTC" });
  });
  it("stands its foot on the ruled spot", () => {
    for (const l of stakesOf(allStages(14))) {
      expect(l.x + STAKE.foot[0]).toBe(STAKE_AT[l.key].x);
      expect(l.y + STAKE.foot[1]).toBe(STAKE_AT[l.key].y);
    }
  });
  it("stORE's stands behind the orchid; the rest in front of every plant", () => {
    const ls = composeLayers(allStages(14), { stakes: true }), at = (k: string) => ls.findIndex((l) => (l.kind === "stake" ? `s-${l.key}` : l.key) === k);
    expect(at("s-store")).toBe(at("orchid") - 1);
    for (const p of ["mandarin", "maple", "azalea", "orchid", "pothos"]) expect(at(`s-${p}`)).toBeGreaterThan(at("azalea"));
  });
});

describe("the reveal (R521)", () => {
  const now = { ...allStages(5), mandarin: 8, store: 0 } as Stages;
  it("nothing on the first open (no record)", () => expect(revealFrom(null, now)).toEqual({}));
  it("only plants that stepped UP, from the stage last shown", () => {
    expect(revealFrom({ ...allStages(5), mandarin: 6 }, now)).toEqual({ mandarin: 6 });
  });
  it("a shrink (R519) or an unchanged plant reveals nothing; junk in the record is ignored", () => {
    expect(revealFrom({ ...allStages(5), mandarin: 9, store: 3 }, now)).toEqual({});
    expect(revealFrom({ mandarin: Number.NaN, maple: "x" as unknown as number }, now)).toEqual({});
  });
  it("a plant missing from the record (a coin new to the app) reveals nothing", () => {
    expect(revealFrom({ maple: 5 }, now)).toEqual({});
  });
});
