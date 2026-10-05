import { describe, it, expect } from "vitest";
import { signLabel, boardXOf, signX, signScale, signPlacement, LEND_SIGN, SIGN_LABEL, SIGN_FOOT, SIGN_SOIL_MARGIN } from "@/model/layout";
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
  it("every stake, wide ones too, stands in the soil at 320 and 353 wide", () => {
    for (const width of [320, 353]) for (const q of lendScene(LEND).parts) if (q.kind === "sign") {
      const at = signPlacement(q, width), g = appGround(width);
      expect(soilBottomAt(at.x + SIGN_FOOT.x * at.scale, g) - (at.y + SIGN_FOOT.y * at.scale)).toBeGreaterThanOrEqual(SIGN_SOIL_MARGIN - 0.06);
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
