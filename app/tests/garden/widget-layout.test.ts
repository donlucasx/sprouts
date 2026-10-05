import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import type { MeResponse } from "@/lib/api";

// The widget library renders on Android only; here its three tags are plain names, so the tree SproutsWidget returns can be read.
vi.mock("react-native-android-widget", () => ({ FlexWidget: "FlexWidget", TextWidget: "TextWidget", SvgWidget: "SvgWidget" }));
const { SproutsWidget } = await import("@/garden/Widget");
const { nextPlantingFor, nextPlantingText } = await import("@/lib/next-planting");
const { buildScene } = await import("@/model/garden");
const { toGardenInput } = await import("@/lib/garden-input");
const { SPRITE_META, GROUND_OUTLINE } = await import("@/garden/sprite-meta");

type El = ReactElement<{ style?: Record<string, unknown>; children?: unknown; text?: string }>;
const kids = (e: El) => ([] as unknown[]).concat(e.props.children ?? []).flat().filter(Boolean) as El[];
/** Every element under `e`, depth first, `e` included. */
const all = (e: El): El[] => [e, ...kids(e).flatMap(all)];
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
    const root = SproutsWidget({ me: m, width: 320, height: 200, wide: true, restartMarks }) as El;
    const svg = all(root).find((k) => k.type === "SvgWidget") as ReactElement<{ svg: string }> | undefined;
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
function paintedTop(svg: string): number {
  let top = Infinity;
  for (const m of svg.matchAll(/<use xlink:href="#s-([a-z0-9-]+)" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)"/g)) {
    const [, name, , ty, r, sx, sy, ax, ay] = m;
    if (name === "ground") { top = Math.min(top, Number(ty) + Number(ay) * Number(sy) + Math.min(...GROUND_OUTLINE.map((q) => q[1])) * Number(sy)); continue; }
    const box = SPRITE_META[name], a = (Number(r) * Math.PI) / 180;
    for (const [cx, cy] of [[0, 0], [box.w, 0], [0, box.h], [box.w, box.h]]) top = Math.min(top, Number(ty) + (cx + Number(ax)) * Number(sx) * Math.sin(a) + (cy + Number(ay)) * Number(sy) * Math.cos(a));
  }
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) for (const n of m[1].matchAll(/[-\d.]+ ([-\d.]+)/g)) top = Math.min(top, Number(n[1]));
  return top;
}

// R363 + R364 (10-05): the square widget: the total big and alone, "your garden" under it, the garden, ONE state line at the bottom.
const { widgetLayout, textWidth, BIG_SIZE, LABEL_SIZE, STATE_SIZE, STATE_MIN } = await import("@/garden/widget-layout");
const { widgetStateLine, BUD_LINE } = await import("@/lib/widget-state");
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
const CASES = Object.entries(R364_SIZES).flatMap(([cells, sizes]) => sizes.map(([w, h]) => [cells, w, h] as const));
const texts = (root: El) => all(root).filter((e) => e.type === "TextWidget") as ReactElement<{ text: string; maxLines?: number; style: { fontSize: number; fontWeight?: string; color: string } }>[];
const svgOfRoot = (root: El) => all(root).find((e) => e.type === "SvgWidget") as ReactElement<{ svg: string; style: { width: number; height: number } }> | undefined;
const inside = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("R364: the default widget is a 2x2 square, still resizable", async () => {
  const appJson = (await import("../../app.json")).default as { expo: { plugins: unknown[] } };
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === "react-native-android-widget") as [string, { widgets: Record<string, unknown>[] }];
  const w = plugin[1].widgets[0];
  it("targets 2 by 2 cells, its minimum a square, both directions resizable", () => {
    expect(w.targetCellWidth).toBe(2); expect(w.targetCellHeight).toBe(2);
    expect(w.minWidth).toBe(w.minHeight);
    expect(w.resizeMode).toBe("horizontal|vertical");
    expect(w.maxResizeHeight).toBeUndefined();   // a tall widget is allowed (it centres its garden)
  });
});

describe("R363 + R364: every size lays out the total, the garden and one state line, each inside the widget", () => {
  it.each(CASES)("%s at %i by %i: one line each, the garden inside its box and using it", (_cells, width, height) => {
    for (const [state, m0] of Object.entries(STATES)) for (const m of [m0, priced(m0), priced({ ...m0, history: grown.history } as MeResponse)]) {
      const root = SproutsWidget({ me: m, width, height, wide: width >= 300 }) as El;
      const [big, label, line] = texts(root);
      const L = widgetLayout(width, height, big.props.text, label.props.text, line.props.text);
      // the three boxes: inside the widget, apart
      for (const b of [L.header, L.garden, L.state]) expect(inside(b, width, height), `${state}: ${JSON.stringify(b)}`).toBe(true);
      expect(overlap(L.header, L.garden) || overlap(L.garden, L.state) || overlap(L.header, L.state)).toBe(false);
      // fonts per R363 and one line each, measured at Roboto's widths
      expect(big.props.style.fontSize).toBe(L.bigSize); expect(L.bigSize).toBeGreaterThanOrEqual(18); expect(L.bigSize).toBeLessThanOrEqual(BIG_SIZE);
      expect(label.props.style.fontSize).toBe(LABEL_SIZE); expect(line.props.style.fontSize).toBe(L.stateSize);
      expect(L.stateSize).toBeGreaterThanOrEqual(STATE_MIN); if (width >= 200) expect(L.stateSize).toBe(STATE_SIZE);
      for (const t of [big, label, line]) expect(t.props.maxLines).toBe(1);
      expect(textWidth(big.props.text, L.bigSize, true)).toBeLessThanOrEqual(L.header.w);
      expect(textWidth(label.props.text, LABEL_SIZE)).toBeLessThanOrEqual(L.header.w);
      expect(textWidth(line.props.text, L.stateSize, true), `"${line.props.text}" at ${width}`).toBeLessThanOrEqual(L.state.w);
      // the garden: inside its box, as wide as it or as tall as it (no small garden in a big box), its sky cropped
      const svg = svgOfRoot(root)!;
      const st = svg.props.style;
      expect(st.width).toBeLessThanOrEqual(L.garden.w); expect(st.height).toBeLessThanOrEqual(L.garden.h);
      expect(st.width === L.garden.w || st.height === L.garden.h).toBe(true);
      const [, y, vw, vh] = svgBox(svg.props.svg), px = Math.min(st.width / vw, st.height / vh);
      expect((paintedTop(svg.props.svg) - y) * px).toBeLessThanOrEqual(14);
    }
  });
  it("the square and the tall sizes stack (total, garden, line); 4x2 puts the total at the left of the garden", () => {
    for (const [cells, w, h] of CASES) expect(widgetLayout(w, h, "$14.99", "your garden").mode, `${cells}`).toBe(cells === "4x2" ? "wide" : "stacked");
    const sq = widgetLayout(206, 205, "$14.99", "your garden");
    expect(sq.header.y).toBeLessThan(sq.garden.y); expect(sq.garden.y + sq.garden.h).toBeLessThanOrEqual(sq.state.y);
    const wide = widgetLayout(430, 205, "$14.99", "your garden");
    expect(wide.header.x + wide.header.w).toBeLessThanOrEqual(wide.garden.x);
  });
  it("the total is big and alone: Home's number, the label under it", () => {
    const root = SproutsWidget({ me: priced(STATES.saving), width: 206, height: 205, wide: false }) as El;
    const [big, label] = texts(root);
    expect(big.props.text).toBe("$14.98"); expect(big.props.style.fontSize).toBe(BIG_SIZE); expect(big.props.style.fontWeight).toBe("700");
    expect(label.props.text).toBe("your garden");
  });
  it("a six-figure total shrinks to fit the dense 2x2, never under 18", () => {
    const L = widgetLayout(150, 150, "$123456.78", "your garden");
    expect(L.bigSize).toBeLessThan(BIG_SIZE); expect(textWidth("$123456.78", L.bigSize, true)).toBeLessThanOrEqual(L.header.w);
  });
  it("tall: the garden is centred in its box (no paper only under it)", () => {
    const root = SproutsWidget({ me: priced(STATES.saving), width: 206, height: 307, wide: false }) as El;
    const box = all(root).find((e) => kids(e).some((k) => k.type === "SvgWidget"))!;
    expect(box.props.style).toMatchObject({ justifyContent: "center", alignItems: "center" });
  });
  it("the whole widget opens the app", () => {
    for (const m of Object.values(STATES)) expect((SproutsWidget({ me: m, width: 206, height: 205, wide: false }) as El).props).toMatchObject({ clickAction: "OPEN_APP" });
  });
});

describe("R363: the state line is Home's state (watcherLine's can, nextPlantingFor's row), one rule", () => {
  const homeOf = (m: MeResponse) => {
    const scene = buildScene(toGardenInput(m, NOW_W, null));
    return { can: watcherLine({ unrevealed: scene.unrevealed, failed: false, nudged: false }).can, row: nextPlantingFor(m, scene, NOW_W) };
  };
  const lineOf = (m: MeResponse) => texts(SproutsWidget({ me: m, width: 206, height: 205, wide: false, now: NOW_W }) as El)[2];
  const NOW_W = new Date("2026-10-05T12:00:00Z");   // 5 AM in Los Angeles: the run (14:00 UTC) is "Today, 7 AM"
  it("a bud waiting (Home's can in colour): the call to water, in the accent green", () => {
    expect(homeOf(STATES.bud).can).toBe("ready");
    expect(lineOf(STATES.bud).props.text).toBe(BUD_LINE); expect(BUD_LINE).toBe("A bud is ready. Water it.");
    expect(lineOf(STATES.bud).props.style.color).toBe("#145A3C");
  });
  it("a bud wins over paused and over the run time (the can is in colour on Home whatever the row says)", () => {
    const m = { ...STATES.bud, wallets: [{ pubkey: "W", status: "paused" }] } as unknown as MeResponse;
    expect(homeOf(m).can).toBe("ready"); expect(lineOf(m).props.text).toBe(BUD_LINE);
  });
  it("saving (Home's row: $1.35 of $2.00): \"+$1.35 waiting\"", () => {
    const h = homeOf(STATES.saving); expect(h.can).toBe("grey"); expect(h.row.state).toBe("saving"); expect(h.row.value).toBe("$1.35 of $2.00");
    expect(lineOf(STATES.saving).props.text).toBe("+$1.35 waiting");
    expect(lineOf(STATES.saving).props.style.color).not.toBe("#145A3C");
  });
  it("threshold reached, waiting for the run (Home: \"Today, 7 AM\"): \"Next: 7 AM\", never \"$1.35 of $0.10\"", () => {
    const h = homeOf(STATES.reached); expect(h.row.state).toBe("reached"); expect(h.row.value).toBe("Today, 7 AM");
    expect(lineOf(STATES.reached).props.text).toBe("Next: 7 AM");
    expect(h.row.value.endsWith(lineOf(STATES.reached).props.text.replace("Next: ", ""))).toBe(true);
  });
  it("paused (Home's row: Paused): \"Paused\"", () => {
    expect(homeOf(STATES.paused).row.value).toBe("Paused");
    expect(lineOf(STATES.paused).props.text).toBe("Paused");
  });
  it("nothing saved: a quiet line, not a run time that would plant nothing", () => {
    expect(homeOf(STATES.empty).row.state).toBe("empty");
    expect(lineOf(STATES.empty).props.text).toBe("No change waiting yet");
  });
  it("widgetStateLine is the line drawn, for every state", () => {
    for (const m of Object.values(STATES)) expect(lineOf(m).props.text).toBe(widgetStateLine(m, buildScene(toGardenInput(m, NOW_W, null)), NOW_W).text);
  });
});
