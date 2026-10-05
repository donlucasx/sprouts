import { describe, it, expect } from "vitest";
import { FOOT_Y, signLabel, boardXOf, signX, signScale, signPlacement, stakeAt, stakeScale, stakeSpots, drawnSpans, frameFor, STAKE_WALK, LEND_SIGN, LEND_STAKE_K, SIDE_GUTTER, SIGN_LABEL, SIGN_FOOT, SIGN_SOIL_MARGIN, STAKE_TRUNK } from "@/model/layout";
import { packScene } from "@/model/spread";
import { plantLayouts } from "@/model/scene-to-layout";
import type { Scene } from "@/model/garden";
import { buildScene, type GardenInput } from "@/model/garden";
import { toGardenInput } from "@/lib/garden-input";
import { widgetGardenSvg, widgetView } from "@/model/widget-svg";
import { appGround, frameGround, soilBottomAt } from "@/model/soil-clip";
import type { MeResponse } from "@/lib/api";

const LEND = { USDC_LEND: { line2: "Kamino 4.4%" }, SOL_LEND: { line2: "Jupiter 3.9%" } };
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"]) => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const lendScene = (lendSigns: GardenInput["lendSigns"]) => buildScene({ ...base, lendSigns, plantings: [p("s", 6, "SKR"), p("u", 2, "USDC_LEND"), p("l", 3, "SOL_LEND"), p("h", 4, "hSOL")] });

describe("the stake sign (R262, contracts 7.2)", () => {
  it("one line for the coins; two for lending, venue and rate under the asset", () => {
    expect(signLabel("skr", LEND)).toEqual({ line1: "SKR", line2: null });
    expect(signLabel("jitosol", LEND)).toEqual({ line1: "USDC", line2: "Kamino 4.4%" });
    expect(signLabel("jupsol", LEND)).toEqual({ line1: "SOL", line2: "Jupiter 3.9%" });
    expect(signLabel("jitosol", null)).toEqual({ line1: "USDC", line2: null });
    expect(signLabel("jupsol", { SOL_LEND: null })).toEqual({ line1: "SOL", line2: null });
    expect(SIGN_LABEL).toEqual({ skr: "SKR", ore: "stORE", hsol: "hSOL", jitosol: "USDC", jupsol: "SOL", cbbtc: "cbBTC" });
  });
  it("an API line longer than the board holds is cut to 13 characters and trimmed", () => {
    expect(signLabel("jitosol", { USDC_LEND: { line2: "Kamino 12.5% and more" } }).line2).toBe("Kamino 12.5%");
    expect(signLabel("jitosol", { USDC_LEND: { line2: "" } }).line2).toBeNull();
  });
  it("the widest line two fits the widened board and both lines sit on its face (y -12 to -1)", () => {
    const usable = 30 * LEND_SIGN.boardX - 2 * 2;
    expect(6.311 * LEND_SIGN.size2).toBeLessThanOrEqual(usable);   // "Kamino 12.5%"
    expect(6.145 * LEND_SIGN.size2).toBeLessThanOrEqual(usable);   // "Jupiter 10.4%"
    expect(2.773 * LEND_SIGN.size1).toBeLessThanOrEqual(usable);   // "USDC"
    expect(LEND_SIGN.y1 - 0.7 * LEND_SIGN.size1).toBeGreaterThanOrEqual(-12);
    expect(LEND_SIGN.y2 + 0.2 * LEND_SIGN.size2).toBeLessThanOrEqual(-1);
    expect(LEND_SIGN.y2 - 0.7 * LEND_SIGN.size2).toBeGreaterThan(LEND_SIGN.y1);
  });
  it("a wide board keeps its whole half width inside the canvas", () => {
    const s = signScale("back");
    expect(signX(0.92 * 320, 1, 320, s, LEND_SIGN.boardX)).toBeCloseTo(320 - 15 * s * 1.2 - 1, 9);
    expect(boardXOf({ line1: "USDC", line2: "Kamino 4.4%" })).toBe(1.2);
    expect(boardXOf({ line1: "SKR", line2: null })).toBe(1);
    expect(boardXOf(undefined)).toBe(1);
  });
});

describe("the lending plants (contracts 7.1)", () => {
  it("USDC lending grows the snake plant and SOL lending the blueberry; their stakes carry the venue", () => {
    const s = lendScene(LEND);
    expect(s.parts.flatMap((q) => (q.kind === "plant" ? [[q.plant, q.species]] : []))).toEqual([["skr", "mandarin"], ["hsol", "sunflower"], ["jitosol", "snake"], ["jupsol", "blueberry"]]);
    const lines = Object.fromEntries(s.parts.flatMap((q) => (q.kind === "sign" ? [[q.plant, q.lines]] : [])));
    expect(lines.jitosol).toEqual({ line1: "USDC", line2: "Kamino 4.4%" });
    expect(lines.jupsol).toEqual({ line1: "SOL", line2: "Jupiter 3.9%" });
    expect(lines.skr).toEqual({ line1: "SKR", line2: null });
  });
  it("every stake, wide ones too, stands in the soil at 320, 353 and 360 wide", () => {
    for (const width of [320, 353, 360]) for (const s0 of SCENES()) for (const scene of [s0, packScene(s0, width)]) {
      const plants = plantLayouts(scene), zoom = frameFor(scene, plants, width).zoom;
      for (const z of [1, zoom]) {
        const spots = stakeSpots(scene, plants, width, z);
        for (const q of scene.parts) if (q.kind === "sign") {
          const at = signPlacement(q, width, z, appGround(width), spots), g = appGround(width);
          expect(soilBottomAt(at.x + SIGN_FOOT.x * at.scale, g) - (at.y + SIGN_FOOT.y * at.scale)).toBeGreaterThanOrEqual(SIGN_SOIL_MARGIN - 0.06);
        }
      }
    }
  });
});

const only = (split: Partial<GardenInput["allocation"]>): GardenInput["allocation"] => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...split });
/** The gardens the stake tests hold: the Seeker's mock garden (10-04: SKR, USDC and SOL planted, hSOL and cbBTC bare), four coins
 * with cbBTC bare, all six planted young, five grown (60 days), and SKR with USDC alone. */
function SCENES(): Scene[] {
  const g = (plantings: GardenInput["plantings"], allocation = base.allocation) => buildScene({ ...base, lendSigns: LEND, allocation, plantings });
  return [
    g([p("s", 9, "SKR"), p("s2", 8, "SKR"), p("s3", 7, "SKR"), p("u", 2, "USDC_LEND"), p("l", 3, "SOL_LEND")]),
    lendScene(LEND),
    g([p("s", 6, "SKR"), p("u", 2, "USDC_LEND"), p("l", 3, "SOL_LEND"), p("h", 4, "hSOL"), p("c", 5, "cbBTC"), p("o", 5, "stORE")], { ...base.allocation, stORE: 5 }),
    g([p("s", 60, "SKR"), p("s2", 50, "SKR"), p("u", 60, "USDC_LEND"), p("l", 60, "SOL_LEND"), p("h", 60, "hSOL"), p("c", 60, "cbBTC")]),
    g([p("s", 6, "SKR"), p("u", 2, "USDC_LEND")], only({ SKR: 50, USDC_LEND: 50 })),
  ];
}
/** The garden as the app draws it at `width`: packed, framed, the stakes' spots resolved. */
function drawn(scene0: Scene, width: number) {
  const scene = packScene(scene0, width), plants = plantLayouts(scene), f = frameFor(scene, plants, width), spots = stakeSpots(scene, plants, width, f.zoom);
  const boards = scene.parts.flatMap((q) => {
    if (q.kind !== "sign") return [];
    const a = stakeAt(q, width, f.zoom, spots), h = 15 * a.scale * a.boardX;
    return [{ q, a, lo: a.x - h, hi: a.x + h, natural: signX(q.x * width, a.side, width, a.scale, a.boardX) }];
  });
  return { scene, plants, f, spots, boards };
}
const cover = (lo: number, hi: number, spans: readonly (readonly [number, number])[]) => spans.reduce((t, [l, h]) => t + Math.max(0, Math.min(hi, h) - Math.max(lo, l)), 0);

describe("the lending stake larger as a whole (R262, legible on the phone)", () => {
  it("a two-line stake is LEND_STAKE_K times its row's scale; a one-line stake is unchanged", () => {
    const two = { line1: "USDC", line2: "Kamino 4.4%" }, one = { line1: "SKR", line2: null };
    expect(LEND_STAKE_K).toBe(1.35);
    expect(stakeScale("back", two)).toBeCloseTo(signScale("back") * 1.35, 9);
    expect(stakeScale("back", one)).toBe(signScale("back"));
    expect(stakeScale("front", one)).toBe(signScale("front"));
    expect(LEND_SIGN.size2 * stakeScale("back", two)).toBeGreaterThan(7.2);   // line two, canvas px (was 5.4)
    const q = lendScene(LEND).parts.find((x) => x.kind === "sign" && x.plant === "jupsol")!;
    expect(signPlacement(q as Extract<typeof q, { kind: "sign" }>, 320, 2).scale).toBeCloseTo(stakeScale("back", two) / 2, 9);
  });
});

describe("R326: a lending stake stands where its whole board reads", () => {
  it("no back-row board overlaps another, cbBTC's included (the round 1 SOL/cbBTC collision), at 320, 353 and 360", () => {
    for (const width of [320, 353, 360]) for (const s0 of SCENES()) {
      const b = drawn(s0, width).boards.filter((x) => x.q.row === "back").sort((x, y) => x.lo - y.lo);
      for (let i = 1; i < b.length; i++) expect(b[i].lo, `${width} ${b[i - 1].q.plant}/${b[i].q.plant}`).toBeGreaterThanOrEqual(b[i - 1].hi - 1e-6);
    }
  });
  /** A two-line face's cover by front parts (over its words) and back parts (under it), canvas px, as drawn. */
  const faceCover = (d: ReturnType<typeof drawn>, x: ReturnType<typeof drawn>["boards"][number], width: number, c = x.a.x) => {
    const y = FOOT_Y(x.q.row) + 4, h = x.hi - x.a.x, band = (row: "front" | "back") => drawnSpans(d.plants.filter((l) => l.row === row), width, y - 12 * x.a.scale, y - x.a.scale);
    return { front: cover(c - h, c + h, band("front")), back: cover(c - h, c + h, band("back")) };
  };
  it("a two-line face reads clear where its reach holds a clear spot (four coins at 320 and 360, six at 360)", () => {
    for (const [s0, width] of [[SCENES()[1], 320], [SCENES()[1], 360], [SCENES()[2], 360]] as const) {
      const d = drawn(s0, width);
      for (const x of d.boards) if (x.q.lines.line2) {
        const c = faceCover(d, x, width);
        expect(c.front, `${width} ${x.q.plant}`).toBe(0); expect(c.back, `${width} ${x.q.plant}`).toBeLessThanOrEqual(0.5);
        expect(x.lo).toBeGreaterThanOrEqual(1 - 1e-6); expect(x.hi).toBeLessThanOrEqual(width - 1 + 1e-6);
      }
    }
  });
  it("its post stays its plant's: nearer its own foot than any other back-row foot", () => {
    for (const width of [320, 353, 360]) for (const s0 of SCENES()) {
      const d = drawn(s0, width), feet = d.boards.filter((x) => x.q.row === "back");
      for (const x of feet) if (x.q.lines.line2) for (const o of feet) if (o !== x)
        expect(Math.abs(x.a.x - x.q.x * width), `${width} ${x.q.plant}/${o.q.plant}`).toBeLessThan(Math.abs(x.a.x - o.q.x * width));
    }
  });
  // Was KNOWN (fix round 2): the mandarin's canopy hid part of the USDC face within R326's 48 px reach. R356 searches the whole row
  // (front parts measured still), so the face now clears.
  it("R356: the Seeker's garden at 360 no longer hides the USDC face behind the mandarin", () => {
    const d = drawn(SCENES()[0], 360), x = d.boards.find((b) => b.q.plant === "jitosol")!;
    expect(faceCover(d, x, 360).front).toBe(0);
  });
  it("one-line stakes keep R237's side at signX, unless a front plant covers a back-row one there or another board took its spot (R356)", () => {
    for (const width of [320, 360]) for (const s0 of SCENES()) {
      const d = drawn(s0, width);
      for (const x of d.boards) if (!x.q.lines.line2) {
        const home = signX(x.q.x * width, x.q.side, width, x.a.scale, x.a.boardX);
        if (Math.abs(x.a.x - home) < 1e-9) { expect(x.a.side).toBe(x.q.side); continue; }
        expect(x.q.row, `${width} ${x.q.plant}`).toBe("back");
        const y = FOOT_Y("back") + 4, h = x.hi - x.a.x, still = drawnSpans(d.plants.filter((l) => l.row === "front"), width, y - 12 * x.a.scale, y - x.a.scale, [0]);
        const crowded = d.boards.some((o) => o !== x && o.q.row === "back" && o.lo < home + h && o.hi > home - h);   // another board took its spot
        const swayed = drawnSpans(d.plants.filter((l) => l.row === "front"), width, y - 12 * x.a.scale, y - x.a.scale);   // the steady sway too
        const less = cover(x.lo, x.hi, still) < cover(home - h, home + h, still) || cover(x.lo, x.hi, swayed) < cover(home - h, home + h, swayed);
        expect(crowded || less, `${width} ${x.q.plant}`).toBe(true);
      }
    }
  });
});

describe("R327: a lending stake steps off a front trunk", () => {
  const two = (lendSigns: GardenInput["lendSigns"]) => buildScene({ ...base, lendSigns, allocation: only({ SKR: 50, USDC_LEND: 50 }), plantings: [p("s", 6, "SKR"), p("u", 2, "USDC_LEND")] });
  it("SKR in front, USDC_LEND behind at the adjacent slot: R237's side lands on the mandarin's trunk, so the stake stands on the other side", () => {
    for (const width of [320, 353]) {
      const scene = two(LEND), plants = plantLayouts(scene), skr = scene.parts.flatMap((q) => (q.kind === "plant" && q.plant === "skr" ? [q.x] : []))[0] * width;
      const q = scene.parts.find((x) => x.kind === "sign" && x.plant === "jitosol") as Extract<Scene["parts"][number], { kind: "sign" }>;
      expect(q.side).toBe(-1);   // R237: left, toward the SKR mandarin
      const a0 = stakeAt(q, width, 1), h0 = 15 * a0.scale * a0.boardX;
      expect(skr + STAKE_TRUNK > a0.x - h0 && skr - STAKE_TRUNK < a0.x + h0).toBe(true);   // would sit on the trunk
      const spots = stakeSpots(scene, plants, width, 1);
      expect(spots.get("jitosol")!.side).toBe(1);
      const at = signPlacement(q, width, 1, appGround(width), spots), h = 15 * at.scale * at.boardX;
      expect(at.x - h).toBeGreaterThanOrEqual(skr + STAKE_TRUNK);   // clear of the trunk band
      expect(at.x + h).toBeLessThanOrEqual(width - 1);
    }
  });
  it("a one-line stake never moves (the same scene without line two keeps R237's side at signX)", () => {
    const scene = two(null);
    expect(stakeSpots(scene, plantLayouts(scene), 320, 1).get("jitosol")).toEqual({ side: -1, x: null });
  });
});

describe("a bare stake the frame would cut is framed whole (round 1: the mock's cbBTC at the screen's edge)", () => {
  it("every stake is wholly inside the frame or wholly past the SIDE_GUTTER band the view draws beyond it", () => {
    for (const width of [320, 353, 360]) for (const s0 of [...SCENES(), buildScene({ ...base, plantings: [p("s", 6, "SKR")] })]) {
      const d = drawn(s0, width), g = SIDE_GUTTER / d.f.zoom;
      for (const x of d.boards) {
        const inside = x.lo >= d.f.x - 1e-6 && x.hi <= d.f.x + d.f.w + 1e-6, outside = x.hi <= d.f.x - g || x.lo >= d.f.x + d.f.w + g;
        expect(inside || outside, `${width} ${x.q.plant}`).toBe(true);
      }
    }
  });
});

describe("Home shows nothing for a leg at 0% (contracts 5.2 legsEnabled)", () => {
  const me = {
    user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: null },
    pot: { skrStakedRaw: "0", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "0", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: "2026-10-05T00:00:00.000Z" },
    holdings: [], history: { plantings: [], picks: [] }, basket: null, lastReceipt: null, wallets: [],
    nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 500, asset: "SKR" },
    manager: { managed: true, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: base.allocation, legsEnabled: ["SKR", "USDC_LEND", "hSOL", "cbBTC"] },
    rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: true, stop: "balanced", pins: {}, allocation: base.allocation },
    lendSigns: LEND,
  } as unknown as MeResponse;
  it("a leg the leash has not enabled gets 0% and no stake; the lending signs come from the read", () => {
    const g = toGardenInput(me, NOW);
    expect([g.allocation.SOL_LEND, g.allocation.USDC_LEND, g.allocation.stORE]).toEqual([0, 15, 0]);
    expect(g.lendSigns).toEqual(LEND);
    const signs = buildScene(g).parts.flatMap((q) => (q.kind === "sign" ? [q.plant] : []));
    expect(signs).toEqual(["skr", "hsol", "jitosol", "cbbtc"]);
  });
  it("not leashed (legsEnabled null or absent): the split as served", () => {
    expect(toGardenInput({ ...me, manager: { ...me.manager, legsEnabled: null } }, NOW).allocation.SOL_LEND).toBe(10);
    const noField = { ...me.manager } as Partial<MeResponse["manager"]>;
    delete noField.legsEnabled;
    expect(toGardenInput({ ...me, manager: noField as MeResponse["manager"] }, NOW).allocation.SOL_LEND).toBe(10);
  });
});

describe("the widget draws the same two-line stake", () => {
  it("both lines as text, the board widened, the API's text escaped, every foot in the soil", () => {
    const scene = lendScene({ USDC_LEND: { line2: "K<amino 4.4%" }, SOL_LEND: LEND.SOL_LEND });
    expect(widgetView(scene, 400, 170).signs).toBe(true);
    const svg = widgetGardenSvg(scene, 400, 170);
    expect(svg).toContain(">Jupiter 3.9%</text>");
    expect(svg).toContain(">SOL</text>");
    expect(svg).toContain("K&lt;amino 4.4%");
    expect(svg).not.toContain("K<amino");
    const boards = [...svg.matchAll(/<use xlink:href="#s-sign" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(0\) scale\(([\d.]+) ([\d.]+)\)/g)];
    expect(boards.filter((m) => Math.abs(Number(m[3]) / Number(m[4]) - 1.2) < 0.02)).toHaveLength(2);   // USDC and SOL
    const g = frameGround(320, widgetView(scene, 400, 170));
    for (const m of boards) {
      const sy = Number(m[4]);   // the y scale; the x scale is the widened board
      expect(soilBottomAt(Number(m[1]) + SIGN_FOOT.x * sy, g) - (Number(m[2]) + SIGN_FOOT.y * sy)).toBeGreaterThanOrEqual(SIGN_SOIL_MARGIN - 0.06);
    }
  });
});
