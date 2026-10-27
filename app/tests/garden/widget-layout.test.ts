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
const { widgetLayout, textWidth, BIG_SIZE, BAR_H, LABEL_SIZE, STATE_SIZE, STATE_MIN, G2_BIG, G2_BIG_MIN } = await import("@/garden/widget-layout");
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

describe("R364: the default widget is a 2x2 square, still resizable", async () => {
  const appJson = (await import("../../app.json")).default as { expo: { plugins: unknown[] } };
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === "react-native-android-widget") as [string, { widgets: Record<string, unknown>[] }];
  const w = plugin[1].widgets[0];
  it("targets 2 by 2 cells, its minimum a square, both directions resizable", () => {
    expect(w.targetCellWidth).toBe(2); expect(w.targetCellHeight).toBe(2);
    expect(w.minWidth).toBe("110dp"); expect(w.minHeight).toBe("110dp");
    expect(w.resizeMode).toBe("horizontal|vertical");
    expect(w.maxResizeHeight).toBeUndefined();   // a tall widget is allowed (it centres its garden)
  });
});

describe("R363 + R364: every size lays out the total, the garden and one state line, each inside the widget", () => {
  it.each(CASES)("%s at %i by %i: one line each, the garden inside its box and using it", (_cells, width, height) => {
    for (const [state, m0] of Object.entries(STATES)) for (const m of [m0, priced(m0), priced({ ...m0, history: grown.history } as MeResponse)]) {
      const root = SproutsWidget({ me: m, width, height}) as El;
      const [big, label, line] = texts(root);
      // Garden2: the card (and so the layout) stops BOTTOM_SAFE short of the reported height, which can exceed the cell
      const H = height - BOTTOM_SAFE, inset = frameInset(width), FW = width - 2 * inset, FH = H - 2 * inset, inner = frameInner(FW, FH);
      const barred = widgetLayout(inner.w, inner.h, big.props.text, label.props.text, line.props.text, frameGap(width), true, G2_BIG, G2_BIG_MIN);
      // the bar drops out where it would leave the garden under 16 dp (a 110 dp tall widget)
      const hasBar = all(root).some((e) => (e.props.style as { height?: number })?.height === BAR_H && kids(e).length >= 0 && (e.props.style as { borderRadius?: number })?.borderRadius === BAR_H / 2);
      const L = hasBar ? barred : widgetLayout(inner.w, inner.h, big.props.text, label.props.text, line.props.text, frameGap(width), false, G2_BIG, G2_BIG_MIN);
      // the three boxes: inside the widget, apart
      for (const b of [L.header, L.garden, L.state]) expect(inside(b, inner.w, inner.h), `${state}: ${JSON.stringify(b)}`).toBe(true);
      expect(overlap(L.header, L.garden) || overlap(L.garden, L.state) || overlap(L.header, L.state)).toBe(false);
      // fonts per R363 and one line each, measured at Roboto's widths
      expect(big.props.style.fontSize).toBe(L.bigSize); expect(L.bigSize).toBeGreaterThanOrEqual(G2_BIG_MIN); expect(L.bigSize).toBeLessThanOrEqual(G2_BIG);   // 10-11 his "too big": the garden is the hero   // an amount never under 18; the empty call ("Swap to save") down to BIG_MIN expect(L.bigSize).toBeLessThanOrEqual(BIG_SIZE);
      expect(label.props.style.fontSize).toBe(LABEL_SIZE); expect(line.props.style.fontSize).toBe(L.stateSize);
      expect(L.stateSize).toBeGreaterThanOrEqual(STATE_MIN); if (width >= 200) expect(L.stateSize).toBe(STATE_SIZE);
      for (const t of [big, label]) expect(t.props.maxLines).toBe(1);
      // the state line is one line on every launcher size; only under 140 dp may the bud's call wrap to two (never cut)
      expect(line.props.maxLines).toBe(L.stateLines); if (width >= 140) expect(L.stateLines).toBe(1);
      expect(textWidth(big.props.text, L.bigSize, true)).toBeLessThanOrEqual(L.header.w);
      expect(textWidth(label.props.text, LABEL_SIZE)).toBeLessThanOrEqual(L.header.w);
      expect(textWidth(line.props.text, L.stateSize, true), `"${line.props.text}" at ${width}`).toBeLessThanOrEqual(L.state.w * L.stateLines);
      // the rendered tree adds up: the root's padding is the layout's, the top block's children fill its box, the top block and the
      // line fit the inner height, and in the wide row the header, the spacer and the garden fill the inner width
      // 10-10 Garden2: the bamboo frame (the whole widget less BOTTOM_SAFE) under the content, laid out in the frame's opening
      // 10-11 (his note "a tad slimmer within it so theres more transparency around"): the frame FRAME_INSET in from every edge
      expect(root.type).toBe("FlexWidget"); expect(root.props.style).toMatchObject({ padding: inset }); expect(inset).toBeGreaterThan(0);
      const framed = kids(root)[0]; expect(framed.type).toBe("OverlapWidget"); expect(framed.props.style).toEqual({ width: FW, height: FH });
      const [frameEl, wrap] = kids(framed);
      expect(frameEl.type).toBe("SvgWidget"); expect(frameEl.props.style).toEqual({ width: FW, height: FH });
      expect(String((frameEl.props as { svg: string }).svg).match(/<image x=/g)).toHaveLength(8);   // the nine-slice less its empty centre (the sand tile is declared once, by id)
      expect(wrap.props.style).toMatchObject({ width: FW, height: FH, paddingLeft: inner.l, paddingTop: inner.t, paddingRight: inner.r, paddingBottom: inner.b });
      // 10-11: the opening stacks the painting (widgetGarden2, the whole opening) under the text
      const opening = kids(wrap)[0];
      expect(opening.type).toBe("OverlapWidget"); expect(opening.props.style).toEqual({ width: inner.w, height: inner.h });
      const content = kids(opening).find((k) => k.type === "FlexWidget")!;
      expect(content.props.style).toMatchObject({ width: inner.w, height: inner.h, padding: L.pad });
      const [topBlock, lineEl] = kids(content);
      const ts = topBlock.props.style as { height: number; flexDirection: string };
      const sizes = kids(topBlock).map((k) => k.props.style as { width: number | string; height: number });
      expect(ts.height + (lineEl.props.style as { height: number }).height).toBeLessThanOrEqual(inner.h - 2 * L.pad);
      expect((lineEl.props.style as { height: number }).height).toBe(L.state.h);
      if (ts.flexDirection === "column") {
        expect(sizes.reduce((t, z) => t + z.height, 0)).toBe(ts.height);
        expect(L.garden.y + L.garden.h).toBeLessThanOrEqual(L.state.y);
      } else {
        expect(sizes.reduce((t, z) => t + (z.width as number), 0)).toBe(inner.w - 2 * L.pad);
        expect(sizes.every((z) => z.height <= ts.height)).toBe(true);
      }
      // the painting: the whole opening, behind the text, its view inside the plate across and at the opening's own aspect
      const svg = svgOfRoot(root)!;
      expect(kids(opening)[0]).toBe(svg); expect(svg.props.style).toEqual({ width: inner.w, height: inner.h });
      const [x, , vw, vh] = svgBox(svg.props.svg);
      // inside the plate, or, where the opening is wider than the plate at the fitted scale, around it (paper beside it)
      if (vw <= CANVAS.w + 0.01) { expect(x).toBeGreaterThanOrEqual(0); expect(x + vw).toBeLessThanOrEqual(CANVAS.w + 0.01); }
      else { expect(x).toBeLessThanOrEqual(0.01); expect(x + vw).toBeGreaterThanOrEqual(CANVAS.w - 0.01); }
      expect(vw / vh).toBeCloseTo(inner.w / inner.h, 1);
      const declared = new Set([...svg.props.svg.matchAll(/<image id="([^"]+)"/g)].map((q) => q[1]));
      for (const u of svg.props.svg.matchAll(/<use xlink:href="#([^"]+)"/g)) expect(declared.has(u[1]), u[1]).toBe(true);
    }
  });
  it("the square and the tall sizes stack (total, garden, line); 4x2 puts the total at the left of the garden", () => {
    for (const [cells, w, h] of CASES) expect(widgetLayout(w, h, "$14.99", "your garden").mode, `${cells} ${w}`).toBe(cells === "4x2" ? "wide" : w / h >= 1.8 ? "wide" : "stacked");
    // a total too long for a wide widget's column stacks instead of being cut
    expect(widgetLayout(200, 110, "$123456.78", "your garden").mode).toBe("stacked");
    const sq = widgetLayout(206, 205, "$14.99", "your garden");
    expect(sq.header.y).toBeLessThan(sq.garden.y); expect(sq.garden.y + sq.garden.h).toBeLessThanOrEqual(sq.state.y);
    const wide = widgetLayout(430, 205, "$14.99", "your garden");
    expect(wide.header.x + wide.header.w).toBeLessThanOrEqual(wide.garden.x);
  });
  it("Garden2 (his note 10-11: \"showing 'next swap' data is more relevant than the total\"): the next planting leads, small; the total is the bottom line", () => {
    const root = SproutsWidget({ me: priced(STATES.saving), width: 206, height: 205}) as El;
    const [big, label, line] = texts(root);
    expect(big.props.text).toBe("$1.35 of $2.00"); expect(big.props.style.fontSize).toBe(G2_BIG); expect(big.props.style.fontWeight).toBe("700");
    expect(label.props.text).toBe("rounds up from every swap");
    expect(line.props.text).toBe("$14.98 in your garden");
  });
  it("a six-figure total shrinks to fit the dense 2x2, never under 18", () => {
    const L = widgetLayout(150, 150, "$123456.78", "your garden");
    expect(L.bigSize).toBeLessThan(BIG_SIZE); expect(textWidth("$123456.78", L.bigSize, true)).toBeLessThanOrEqual(L.header.w);
    const M = widgetLayout(110, 110, "$12345.67", "your garden");
    expect(textWidth("$12345.67", M.bigSize, true)).toBeLessThanOrEqual(M.header.w);
  });
  it("the bar under the headline is Home's fraction toward the next planting", () => {
    const root = SproutsWidget({ me: priced(STATES.saving), width: 206, height: 205}) as El;
    const track = all(root).find((e) => e.type === "FlexWidget" && (e.props.style as { height?: number })?.height === BAR_H && kids(e).length === 1)!;
    const fill = kids(track)[0].props.style as { width: number }, w = (track.props.style as { width: number }).width;
    expect(fill.width).toBe(Math.round(w * (135 / 200)));
    const none = SproutsWidget({ me: priced(STATES.empty), width: 206, height: 205}) as El;
    expect(all(none).some((e) => (e.props.style as { height?: number })?.height === BAR_H && kids(e).length === 1)).toBe(false);
  });
  it("the whole widget opens the app", () => {
    for (const m of Object.values(STATES)) expect((SproutsWidget({ me: m, width: 206, height: 205}) as El).props).toMatchObject({ clickAction: "OPEN_APP" });
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
