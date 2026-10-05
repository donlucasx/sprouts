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
const me = {
  user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: null },
  pot: { skrStakedRaw: "12480000", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "0", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: "2026-10-01T00:00:00.000Z" },
  holdings: [], manager: { managed: false, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
  history: { plantings: [{ id: "a", ts: "2026-10-01T12:00:00.000Z", asset: "SKR", amountOutRaw: "12480000", usdcInCents: 23 }], picks: [] },
  nextPlanting: { pendingCents: 50, thresholdCents: 200, capLeftCents: 500, asset: "SKR" },
  lastReceipt: null, basket: null, wallets: [],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
} as unknown as MeResponse;

describe("R252: the widget's text at the top, its garden under it", () => {
  it.each([[150, 180, false], [300, 180, true]] as const)("at %i by %i (wide %s): text first, garden last", (width, height, wide) => {
    const root = SproutsWidget({ me, width, height, wide }) as El;
    expect(root.props.style).toMatchObject({ flexDirection: "column" });
    const [text, garden, ...rest] = kids(root);
    expect(rest).toHaveLength(0);
    expect(text.type).toBe("FlexWidget"); expect(garden.type).toBe("SvgWidget");
    expect(kids(text).every((t) => t.type === "TextWidget")).toBe(true);
    expect(kids(text)[0].props.text).toMatch(/^In your garden \$|SKR/);
  });
});

describe("R360 in the widget: it draws only what is held now, and a restarted coin from its new planting", () => {
  const svgOf = (m: MeResponse, restartMarks = {}) => {
    const root = SproutsWidget({ me: m, width: 320, height: 200, wide: true, restartMarks }) as El;
    const svg = kids(root).find((k) => k.type === "SvgWidget") as ReactElement<{ svg: string }> | undefined;
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
const grown = { ...me, history: { plantings: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, ts: new Date(NOW.getTime() - (i * 2 + 1) * 86_400_000).toISOString(), asset: (["SKR", "SKR", "stORE", "USDC_LEND"] as const)[i % 4], amountOutRaw: "12480000", usdcInCents: 200 })), picks: [] } } as unknown as MeResponse;
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
/** Launcher sizes: his Seeker's cells (the 10-05 screenshot's 2x3 is about 206 by 307 dp: 2x2, 4x2, 2x3), a denser grid's (2x2, 3x2,
 * 4x2, 2x3, 4x3, 2x4), and the declared minimum height (110 dp). */
const SIZES = [[206, 205], [430, 205], [206, 307], [150, 150], [230, 150], [320, 150], [150, 230], [320, 230], [320, 110], [150, 310]] as const;
const MAX_SKY_PX = 14;
describe("his note 10-05: no gap between the text and the garden, on every size", () => {
  it.each(SIZES)("at %i by %i: the garden is straight under the text, its sky at most MAX_SKY_PX, never past the widget", (width, height) => {
    for (const m of [me, grown]) {
      const root = SproutsWidget({ me: m, width, height, wide: width >= 300 }) as El;
      expect(root.props.style).toMatchObject({ justifyContent: "flex-start" });
      const [, garden] = kids(root);
      const { svg } = garden.props as unknown as { svg: string };
      const st = (garden.props.style ?? {}) as { width: number; height: number; marginTop?: number };
      expect(st.marginTop ?? 0).toBeLessThanOrEqual(8);
      const [, y, vw, vh] = svgBox(svg), px = Math.min(st.width / vw, st.height / vh);
      expect((paintedTop(svg) - y) * px).toBeLessThanOrEqual(MAX_SKY_PX);
      expect(st.width).toBeLessThanOrEqual(width - 20);
      expect(st.height).toBeLessThanOrEqual(height - 20 - 42 - 6);
      // it uses the room: as wide as the widget, or as tall as the room (never a small garden in a big box)
      expect(Math.abs(vw * px - st.width) < 1 || Math.abs(vh * px - st.height) < 1).toBe(true);
      expect(st.width === width - 20 || st.height === height - 20 - (width >= 300 && m.lastReceipt ? 58 : 42) - 6).toBe(true);
    }
  });
});

describe("the widget's Next planting line is Home's row (one rule: nextPlantingFor)", () => {
  const line = (m: MeResponse) => (kids(kids(SproutsWidget({ me: m, width: 230, height: 150, wide: false }) as El)[0])[1].props.text);
  const at = (m: MeResponse) => nextPlantingText(nextPlantingFor(m, buildScene(toGardenInput(m, new Date(), null)), new Date()));
  it("threshold reached (the daily cap hit): the run time, never \"$1.35 of $0.10\"", () => {
    const m = { ...me, nextPlanting: { ...me.nextPlanting, pendingCents: 135, thresholdCents: 10, capLeftCents: 0 } } as MeResponse;
    expect(line(m)).toMatch(/^Next: (Today|Tomorrow), \d/);
    expect(line(m)).toBe(at(m));
  });
  it("paused (every linked wallet paused): Paused", () => {
    const m = { ...me, wallets: [{ pubkey: "W", status: "paused" }] } as unknown as MeResponse;
    expect(line(m)).toBe("Next: Paused"); expect(line(m)).toBe(at(m));
  });
  it("saving: the amount of the threshold", () => {
    expect(line(me)).toBe("Next: $0.50 of $2.00"); expect(line(me)).toBe(at(me));
  });
});
