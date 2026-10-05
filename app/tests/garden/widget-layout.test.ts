import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import type { MeResponse } from "@/lib/api";

// The widget library renders on Android only; here its three tags are plain names, so the tree SproutsWidget returns can be read.
vi.mock("react-native-android-widget", () => ({ FlexWidget: "FlexWidget", TextWidget: "TextWidget", SvgWidget: "SvgWidget" }));
const { SproutsWidget } = await import("@/garden/Widget");

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

describe("R252: the widget's text at the top, its garden at the bottom", () => {
  it.each([[150, 180, false], [300, 180, true]] as const)("at %i by %i (wide %s): text first, garden last, spread apart", (width, height, wide) => {
    const root = SproutsWidget({ me, width, height, wide }) as El;
    expect(root.props.style).toMatchObject({ flexDirection: "column", justifyContent: "space-between" });
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
