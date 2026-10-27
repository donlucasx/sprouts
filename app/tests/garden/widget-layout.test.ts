import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import type { MeResponse } from "@/lib/api";

// The widget library renders on Android only; here its three tags are plain names, so the tree SproutsWidget returns can be read.
vi.mock("react-native-android-widget", () => ({ FlexWidget: "FlexWidget", OverlapWidget: "OverlapWidget", TextWidget: "TextWidget", SvgWidget: "SvgWidget" }));
const { SproutsWidget, BOTTOM_SAFE, frameInset } = await import("@/garden/Widget");
const { nextPlantingFor, nextPlantingText, nextRunWords } = await import("@/lib/next-planting");
const { buildScene } = await import("@/model/garden");
const { toGardenInput } = await import("@/lib/garden-input");
const { SPRITE_META, GROUND_OUTLINE } = await import("@/garden/sprite-meta");
const { CANVAS } = await import("@/garden2/layout");
const { frameInner, frameGap } = await import("@/model/widget2-svg");

type El = ReactElement<{ style?: Record<string, unknown>; children?: unknown; text?: string }>;
const kids = (e: El) => ([] as unknown[]).concat(e.props.children ?? []).flat().filter(Boolean) as El[];
/** Every element under `e`, depth first, `e` included. */
const all = (e: El): El[] => [e, ...kids(e).flatMap(all)];
// the garden's SVG (its images declared as w-<key>), not the bamboo frame's
const isGardenSvg = (e: El) => e.type === "SvgWidget" && String((e.props as { svg?: string }).svg).includes('id="w-');
const me = {
  user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: null },
  pot: { skrStakedRaw: "12480000", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "0", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: "2026-10-01T00:00:00.000Z" },
  holdings: [], manager: { managed: false, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
  history: { plantings: [{ id: "a", ts: "2026-10-01T12:00:00.000Z", asset: "SKR", amountOutRaw: "12480000", usdcInCents: 23 }], picks: [] },
  nextPlanting: { pendingCents: 50, thresholdCents: 200, capLeftCents: 500, asset: "SKR" },
  lastReceipt: null, basket: null, wallets: [],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
} as unknown as MeResponse;

describe("R360 in the widget: it draws only what is held now, and a restarted coin from its new planting", () => {
  const svgOf = (m: MeResponse, restartMarks = {}) => {
    const root = SproutsWidget({ me: m, width: 320, height: 200, restartMarks }) as El;
    const svg = all(root).find(isGardenSvg) as ReactElement<{ svg: string }> | undefined;
    return svg?.props.svg ?? null;
  };
  const usdc = (id: string, ts: string) => ({ id, ts, asset: "USDC_LEND", amountOutRaw: "610000", usdcInCents: 65 });
  const withUsdc = { ...me, history: { plantings: [...me.history.plantings, usdc("u1", "2026-10-02T12:00:00.000Z")], picks: [] }, positions: [], positionsRead: "ok" } as unknown as MeResponse;
  it("a lending position withdrawn in full draws as if it had never been planted", () => {
    expect(svgOf(withUsdc)).toBe(svgOf(me));
  });
  it("re-planted after the zero: the widget grows it from the new planting only", () => {
    const held = { asset: "USDC_LEND", venue: "jupiter_lend", receiptMint: "M", receiptRaw: "610000", underlyingRaw: "650000", valueUsd: 0.65, ratePct: 4, avg7Pct: 4, earnedUsd: 0, putInCents: 65, withdrawableUsd: null, poolFull: false };
    const again = { ...withUsdc, positions: [held], history: { plantings: [...withUsdc.history.plantings, usdc("u2", "2026-10-03T12:00:00.000Z")], picks: [] } } as unknown as MeResponse;
    const onlyNew = { ...again, history: { plantings: [...me.history.plantings, usdc("u2", "2026-10-03T12:00:00.000Z")], picks: [] } } as unknown as MeResponse;
    expect(svgOf(again, { USDC_LEND: "2026-10-02T12:00:00.000Z" })).toBe(svgOf(onlyNew));
    expect(svgOf(again)).not.toBe(svgOf(onlyNew));
  });
});

// His note (10-05, a 2x3 widget on the Seeker): "looks too talk and theres a big gap between "in your garden" and the garden below".
// The garden sits straight under the text, its view cropped to the plants (no sky past TIGHT_TOP), as big as the width and the room allow.
const NOW = new Date("2026-10-02T12:00:00Z");
const hold = (asset: string) => ({ asset, heldRaw: "1000000000", putInCents: 600, valueUsd: 6.2, earnedUsd: 0.2, earnedUnderlyingRaw: null });
const grown = { ...me, holdings: ["stORE", "USDC_LEND"].map(hold), history: { plantings: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, ts: new Date(NOW.getTime() - (i * 2 + 1) * 86_400_000).toISOString(), asset: (["SKR", "SKR", "stORE", "USDC_LEND"] as const)[i % 4], amountOutRaw: "12480000", usdcInCents: 200 })), picks: [] } } as unknown as MeResponse;
const svgBox = (svg: string) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.slice(1).map(Number);
/** The highest painted y in the SVG: sprite boxes through their transforms, stem paths, and the ground's painted soil (its box top plus
 * the outline's highest point, GROUND_OUTLINE, not the sprite's transparent strip). */

// R363 + R364 (10-05): the square widget: the total big and alone, "your garden" under it, the garden, ONE state line at the bottom.
const { widgetLayout, textWidth, WIDE_RATIO, isSlim, isSmallest, BIG_SIZE, BAR_H, LABEL_SIZE, STATE_SIZE, STATE_MIN, G2_BIG, G2_BIG_MIN } = await import("@/garden/widget-layout");
const { widgetStateLine, widgetHeadline, BUD_LINE, PLANTED_RECENT_MS } = await import("@/lib/widget-state");
const { watcherLine } = await import("@/model/watcher");

/** A read with no bud waiting: watered after every planting. */
const quiet = (m: MeResponse, nextPlanting: Partial<MeResponse["nextPlanting"]> = {}) =>
  ({ ...m, user: { ...m.user, wateredAt: "2026-10-04T00:00:00.000Z" }, nextPlanting: { ...m.nextPlanting, ...nextPlanting } }) as MeResponse;
const priced = (m: MeResponse) => ({ ...m, pot: { ...m.pot, skrUsd: 1.2 } }) as MeResponse;
/** The four states R363 names, plus nothing saved. */
const STATES = {
  bud: me,
  saving: quiet(me, { pendingCents: 135, thresholdCents: 200 }),
  reached: quiet(me, { pendingCents: 135, thresholdCents: 10, capLeftCents: 0 }),
  paused: { ...quiet(me), wallets: [{ pubkey: "W", status: "paused" }] } as unknown as MeResponse,
  empty: quiet(me, { pendingCents: 0 }),
} as const;
/** Launcher sizes in dp: his Seeker's cells (2x2 about 206 by 205, 4x2, 2x3, 3x2) and a denser grid's (2x2 150, 4x2, 2x3, 3x2). */
const R364_SIZES = { "2x2": [[206, 205], [150, 150]], "4x2": [[430, 205], [320, 150]], "2x3": [[206, 307], [150, 230]], "3x2": [[310, 205], [230, 150]] } as const;
const CASES = [...Object.entries({ ...R364_SIZES, min: [[110, 110], [200, 110]] })].flatMap(([cells, sizes]) => sizes.map(([w, h]) => [cells, w, h] as const));
const texts = (root: El) => all(root).filter((e) => e.type === "TextWidget") as ReactElement<{ text: string; maxLines?: number; style: { fontSize: number; fontWeight?: string; color: string } }>[];
const svgOfRoot = (root: El) => all(root).find(isGardenSvg) as ReactElement<{ svg: string; style: { width: number; height: number } }> | undefined;
const inside = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("both drawing paths (in-app refresh, the system task handler) build the same widget, zero marks included", () => {
  it("widgetFor passes R360's zero marks and the watered plants, and index.js draws through it", async () => {
    vi.resetModules();
    vi.doMock("@/lib/zero-marks", () => ({ readZeroMarks: () => ({ USDC_LEND: "2026-10-02T12:00:00.000Z" }) }));
    vi.doMock("@/lib/last-watering", () => ({ wateredPlantsFor: () => ["skr"] }));
    const { widgetFor } = await import("@/lib/widget-refresh");
    const el = widgetFor(me, { width: 206, height: 205 }) as ReactElement<{ restartMarks: unknown; wateredPlants: unknown; width: number }>;
    expect(el.props.restartMarks).toEqual({ USDC_LEND: "2026-10-02T12:00:00.000Z" }); expect(el.props.wateredPlants).toEqual(["skr"]); expect(el.props.width).toBe(206);
    const { readFileSync } = await import("node:fs");
    const entry = readFileSync(new URL("../../index.js", import.meta.url), "utf8");
    expect(entry).toMatch(/renderWidget\(widgetFor\(/); expect(entry).not.toMatch(/SproutsWidget/);
    vi.doUnmock("@/lib/zero-marks"); vi.doUnmock("@/lib/last-watering");
  });
});

// 10-26/27 (his rulings): two providers, each defaulting to 3 by 2 cells, resizable both ways down to one cell
describe("the widget providers (app.json)", async () => {
  const appJson = (await import("../../app.json")).default as { expo: { plugins: unknown[] } };
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === "react-native-android-widget") as [string, { widgets: Record<string, unknown>[] }];
  it("bamboo and ensō, 3 by 2 by default, resizable both ways; the min-resize plugin runs after the widget plugin", () => {
    expect(plugin[1].widgets.map((w) => w.name)).toEqual(["Sprouts", "SproutsEnso"]);
    for (const w of plugin[1].widgets) {
      expect([w.targetCellWidth, w.targetCellHeight]).toEqual([3, 2]);
      expect(w.resizeMode).toBe("horizontal|vertical");
    }
    // dangerous mods run in reverse: the plugin listed BEFORE the widget plugin runs after it, once its XML exists
    const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.indexOf("./plugins/widget-min-resize")).toBe(names.indexOf("react-native-android-widget") - 1);
  });
});

// 10-27 (his device rounds on the Seeker and the Saga): every size he resized to, every state, renders; the smallest and the one-row
// widgets are words and the gauge; the rest carry the garden, sized to its opening; no text is wider than the frame
const DEVICE_SIZES: [string, number, number][] = [
  ["seeker 1x1", 180, 131], ["seeker 2x1", 276, 131], ["seeker 3x1", 372, 131], ["seeker 1x2", 180, 274], ["seeker 2x2", 276, 274], ["seeker 3x2", 372, 274],
  ["seeker 1x3", 180, 417], ["seeker 2x3", 276, 417], ["seeker 3x3", 372, 417], ["seeker 1x4", 180, 560],
  ["saga 1x1", 185, 111], ["saga 2x1", 283, 111], ["saga 3x1", 382, 111], ["saga 1x2", 185, 235], ["saga 2x2", 283, 235], ["saga 3x2", 382, 235],
  ["saga 1x3", 185, 359], ["saga 2x3", 283, 359], ["saga 3x3", 382, 359], ["saga 1x4", 185, 483], ["no size", 84, 120],
];
describe("every device size, every state", () => {
  it.each(DEVICE_SIZES)("bamboo %s (%i x %i)", (_name, width, height) => {
    for (const m0 of Object.values(STATES)) for (const m of [m0, priced(m0), priced({ ...m0, history: grown.history } as MeResponse)]) {
      const root = SproutsWidget({ me: m, width, height, now: NOW }) as El;
      expect((root.props as { clickAction?: string }).clickAction).toBe("OPEN_APP");
      const g = svgOfRoot(root);
      const words = isSmallest(width, height) || isSlim(width, height) || width < 140;
      expect(!!g, `${_name}: garden ${!!g}`).toBe(!words);
      if (g) expect(String(g.props.svg)).toContain(`width="${g.props.style.width}" height="${g.props.style.height}"`);
      for (const t of texts(root)) {
        expect(t.props.maxLines ?? 1).toBeLessThanOrEqual(2);
      }
    }
  });
  it.each(DEVICE_SIZES)("ensō %s (%i x %i)", async (_name, width, height) => {
    const { EnsoWidget } = await import("@/garden/EnsoWidget");
    for (const m0 of Object.values(STATES)) for (const m of [m0, priced(m0)]) {
      const root = EnsoWidget({ me: m, width, height, now: NOW }) as El;
      const words = isSmallest(width, height) || width < 140 || isSlim(width, height);
      const art = all(root).some(isGardenSvg);
      if (isSmallest(width, height) || width < 140) expect(art, `${_name}: the mini has no art`).toBe(false);
      else if (!words) expect(art, `${_name}: a garden`).toBe(true);
      expect(texts(root).length).toBeGreaterThan(0);
    }
  });
});

describe("Garden2 (10-11, his notes \"$0.00 alone... not very inviting\", \"too big 'swap to save'... not the right kind of cta\"; Kimi's analysis): the widget reports, never asks", () => {
  const NOW_W = new Date("2026-10-05T12:00:00Z");   // 5 AM in Los Angeles: the run (14:00 UTC) is "this morning"
  const rowOf = (m: MeResponse) => nextPlantingFor(m, buildScene(toGardenInput(m, NOW_W, null)), NOW_W);
  const headOf = (m: MeResponse) => { const [big, label, line] = texts(SproutsWidget({ me: m, width: 206, height: 205, now: NOW_W }) as El); return { big, label, line }; };
  const barOf = (m: MeResponse) => all(SproutsWidget({ me: m, width: 206, height: 205, now: NOW_W }) as El).some((e) => (e.props.style as { height?: number; borderRadius?: number })?.height === BAR_H && (e.props.style as { borderRadius?: number }).borderRadius === BAR_H / 2);
  /** No planting in the last day (the fixture's plantings are days old at NOW_W, or none). */
  const old = (m: MeResponse) => ({ ...m, history: { ...m.history, plantings: m.history.plantings.map((p) => ({ ...p, ts: "2026-09-01T00:00:00.000Z" })) } }) as MeResponse;
  const ALL = { ...STATES, empty: old(STATES.empty), bud: old(STATES.bud) };
  it("never a call to swap, never \"$0.00\", in any state", () => {
    for (const m of Object.values(ALL)) for (const t of Object.values(headOf(priced(m)))) {
      expect(t.props.text).not.toMatch(/^Swap|swap to|\$0\.00/);
    }
  });
  it("saving: \"$1.35 of $2.00\", \"rounds up from every swap\", the bar", () => {
    expect(rowOf(STATES.saving).value).toBe("$1.35 of $2.00");
    const h = headOf(priced(STATES.saving)); expect(h.big.props.text).toBe("$1.35 of $2.00"); expect(h.label.props.text).toBe("rounds up from every swap");
    expect(h.label.props.style.color).not.toBe("#145A3C"); expect(barOf(priced(STATES.saving))).toBe(true);
  });
  it("threshold reached: the change saved, when it plants in Home's words, the bar full", () => {
    expect(rowOf(STATES.reached).state).toBe("reached");
    const h = headOf(priced(STATES.reached)); expect(h.big.props.text).toBe("$1.35 saved"); expect(h.label.props.text).toBe(`plants ${nextRunWords(NOW_W)}`);
  });
  it("paused: says so, and that opening Sprouts turns it on (the accent: the one state a glance should act on)", () => {
    expect(rowOf(STATES.paused).state).toBe("paused");
    const h = headOf(priced(STATES.paused)); expect(h.big.props.text).toBe("Round-ups paused"); expect(h.label.props.style.color).toBe("#145A3C");
    expect(barOf(priced(STATES.paused))).toBe(false);
  });
  // 10-27 (his note: the pill "not showing the planting bar"; R164: Home's bar is always shown): nothing pending is an EMPTY bar
  it("nothing pending, money in the garden: the garden leads, an empty bar, what plants at the bottom", () => {
    const m = priced(ALL.empty); expect(rowOf(m).state).toBe("empty");
    const h = headOf(m); expect(h.big.props.text).toMatch(/^\$[\d.,]+ in your garden$/); expect(h.label.props.text).toBe("Waiting for your next swap");
    expect(h.line.props.text).toBe("Round-ups plant at $2.00"); expect(barOf(m)).toBe(true);
  });
  it("a planting in the last day leads with what was planted (the day's plantings summed); a day later the garden leads again", () => {
    const at = (ms: number) => new Date(NOW_W.getTime() - ms).toISOString();
    const m = priced({ ...ALL.empty, history: { ...ALL.empty.history, plantings: [...ALL.empty.history.plantings, { id: "n1", ts: at(3_600_000), asset: "SKR", amountOutRaw: "1", usdcInCents: 50 }, { id: "n2", ts: at(7_200_000), asset: "stORE", amountOutRaw: "1", usdcInCents: 32 }] } } as MeResponse);
    expect(headOf(m).big.props.text).toBe("Planted $0.82"); expect(headOf(m).line.props.text).toBe("Waiting for your next swap");
    const stale = priced({ ...ALL.empty, history: { ...ALL.empty.history, plantings: [{ id: "n1", ts: at(PLANTED_RECENT_MS + 1000), asset: "SKR", amountOutRaw: "1", usdcInCents: 50 }] } } as MeResponse);
    expect(headOf(stale).big.props.text).not.toMatch(/^Planted/);
  });
  it("nothing ever: waiting for the first swap, what plants at the bottom", () => {
    const h = widgetHeadline({ nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 500, asset: "SKR" }, wallets: [], history: { plantings: [] } } as unknown as MeResponse, { parts: [] }, NOW_W, "$0.00", false);
    expect([h.big, h.label, h.line, h.fraction]).toEqual(["Your garden", "Waiting for your first swap", "Round-ups plant at $2.00", 0]);
  });
  it("a narrow widget takes each text's shorter form", () => {
    const h = widgetHeadline(priced(STATES.saving), { parts: [] }, NOW_W, "$14.98", true, { big: (t) => t.length <= 6, label: (t) => t.length <= 16, line: (t) => t.length <= 16 });
    expect([h.big, h.label, h.line]).toEqual(["$1.35", "from your swaps", "$14.98 in garden"]);   // each text's first form that fits
  });
  it("widgetHeadline is what is drawn, for every state", () => {
    for (const m0 of Object.values(ALL)) {
      const m = priced(m0), [big, label, line] = texts(SproutsWidget({ me: m, width: 206, height: 205, now: NOW_W }) as El);
      // the same room the widget measures: the frame's opening (inset, less BOTTOM_SAFE) less its gaps
      const inset = frameInset(206), room = frameInner(206 - 2 * inset, 205 - BOTTOM_SAFE - 2 * inset).w - 2 * frameGap(206);
      const fits = { big: (t: string) => textWidth(t, G2_BIG_MIN, true) <= room, label: (t: string) => textWidth(t, LABEL_SIZE, true) <= room, line: (t: string) => textWidth(t, STATE_MIN, true) <= room };
      const total = big.props.text, want = widgetHeadline(m, buildScene(toGardenInput(m, NOW_W, null)), NOW_W, line.props.text.replace(/ in your garden$/, "") || total, true, fits);
      if (rowOf(m).state !== "empty") expect([big.props.text, label.props.text, line.props.text]).toEqual([want.big, want.label, want.line]);
    }
  });
});

// 10-27 (his note: the bamboo "not when resizing into the pill shaped versions"): the Seeker's 4x1 is 372 x 131 dp
describe("isSlim: one row tall and at least twice as wide", () => {
  it("the Seeker's 4x1 and 3x1 are slim; a 2x1, the square and a 4x2 on a wide grid are not", async () => {
    const { isSlim } = await import("@/garden/widget-layout");
    expect(isSlim(372, 131)).toBe(true);
    expect(isSlim(276, 131)).toBe(true);
    expect(isSlim(184, 131)).toBe(false);
    expect(isSlim(276, 274)).toBe(false);
    expect(isSlim(430, 205)).toBe(false);
    expect(isSlim(320, 150)).toBe(false);
  });
});

// 10-27 round 5 (his notes): the 1x1s carry no art (words and the gauge); the 2x1 bamboo frames the SKR tree and drops its bottom line
describe("one column wide: no art, the gauge", () => {
  it("the bamboo 1x1 draws no garden, only words and the bar", () => {
    const els = all(SproutsWidget({ me: priced(grown), width: 84, height: 131, now: NOW }) as El);
    expect(els.some(isGardenSvg)).toBe(false);
    expect(els.filter((e) => e.type === "TextWidget").length).toBeGreaterThanOrEqual(2);
  });
  it("the ensō 1x1 draws no garden, the ring holds the total", async () => {
    const { EnsoWidget } = await import("@/garden/EnsoWidget");
    const els = all(EnsoWidget({ me: priced(grown), width: 84, height: 131, now: NOW }) as El);
    expect(els.some(isGardenSvg)).toBe(false);
    expect(els.filter((e) => e.type === "TextWidget").map((e) => e.props.text)).toContain(texts(EnsoWidget({ me: priced(grown), width: 276, height: 274, now: NOW }) as El)[0].props.text);
  });
  it("a short bamboo wider than the smallest keeps a garden and no bottom line; the Seeker's smallest (180 x 131) has no art", () => {
    const els = all(SproutsWidget({ me: priced(grown), width: 230, height: 131, now: NOW }) as El);
    expect(els.some(isGardenSvg)).toBe(true);
    expect(texts(SproutsWidget({ me: priced(grown), width: 230, height: 131, now: NOW }) as El).length).toBe(2);
    expect(all(SproutsWidget({ me: priced(grown), width: 180, height: 131, now: NOW }) as El).some(isGardenSvg)).toBe(false);
  });
});

// 10-27 (his notes: both 1x1s still showed the garden): a one-cell widget arrives with no size (0 x 0); it is drawn as one cell
describe("a widget the launcher gave no size", () => {
  it("is drawn at ONE_CELL, where both widgets are their text-and-gauge versions", async () => {
    const { sizeOrOneCell, ONE_CELL } = await import("@/garden/widget-layout");
    expect(sizeOrOneCell({ width: 0, height: 0 })).toEqual({ width: ONE_CELL.w, height: ONE_CELL.h });
    expect(sizeOrOneCell({ width: 276, height: 274 })).toEqual({ width: 276, height: 274 });
    const { EnsoWidget } = await import("@/garden/EnsoWidget");
    expect(all(SproutsWidget({ me: priced(grown), width: ONE_CELL.w, height: ONE_CELL.h, now: NOW }) as El).some(isGardenSvg)).toBe(false);
    expect(all(EnsoWidget({ me: priced(grown), width: ONE_CELL.w, height: ONE_CELL.h, now: NOW }) as El).some(isGardenSvg)).toBe(false);
  });
});
