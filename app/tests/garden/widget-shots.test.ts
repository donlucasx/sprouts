import { describe, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import type { MeResponse } from "@/lib/api";

/**
 * Not a test: with WIDGET_SHOTS=1 it writes each widget size and state as an HTML page (the widget tree mapped to flex divs, Roboto or
 * Helvetica) into build/sprouts-widget2/.shots/widget2/, for headless Chrome to screenshot. Skipped in the suite.
 */
vi.mock("react-native-android-widget", () => ({ FlexWidget: "FlexWidget", OverlapWidget: "OverlapWidget", TextWidget: "TextWidget", SvgWidget: "SvgWidget" }));
const { SproutsWidget } = await import("@/garden/Widget");

type El = ReactElement<{ style?: Record<string, unknown>; children?: unknown; text?: string; svg?: string }>;
const kids = (e: El) => ([] as unknown[]).concat(e.props.children ?? []).flat().filter(Boolean) as El[];
const dim = (v: unknown) => (v === "match_parent" ? "100%" : typeof v === "number" ? `${v}px` : "auto");
const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function html(e: El): string {
  const s = (e.props.style ?? {}) as Record<string, unknown>;
  const box = `width:${dim(s.width)};height:${dim(s.height)};box-sizing:border-box;flex:none;overflow:hidden;`;
  if (e.type === "TextWidget") {
    const weight = s.fontWeight === "normal" || s.fontWeight === undefined ? 400 : s.fontWeight === "bold" ? 700 : s.fontWeight;
    return `<div style="${box}font-family:Roboto,Helvetica,Arial,sans-serif;font-size:${s.fontSize}px;line-height:${Math.ceil(Number(s.fontSize) * 1.17)}px;color:${s.color};font-weight:${weight};white-space:${(e.props as { maxLines?: number }).maxLines === 1 ? "nowrap" : "normal"};text-overflow:ellipsis">${escHtml(e.props.text ?? "")}</div>`;
  }
  if (e.type === "SvgWidget") return `<div style="${box}">${e.props.svg}</div>`;
  if (e.type === "OverlapWidget") return `<div style="${box}position:relative">${kids(e).map((k) => `<div style="position:absolute;inset:0">${html(k)}</div>`).join("")}</div>`;
  const flex = `display:flex;flex-direction:${s.flexDirection ?? "column"};justify-content:${s.justifyContent ?? "flex-start"};align-items:${s.alignItems ?? "flex-start"};`;
  const side = (k: string, css: string) => (typeof s[k] === "number" ? `${css}:${s[k]}px;` : "");
  const deco = `${s.padding ? `padding:${s.padding}px;` : ""}${side("paddingLeft", "padding-left")}${side("paddingTop", "padding-top")}${side("paddingRight", "padding-right")}${side("paddingBottom", "padding-bottom")}${s.backgroundColor ? `background:${s.backgroundColor};` : ""}${s.borderRadius ? `border-radius:${s.borderRadius}px;` : ""}`;
  return `<div style="${box}${flex}${deco}">${kids(e).map(html).join("")}</div>`;
}

const DAY = 86_400_000, NOW = new Date("2026-10-05T12:00:00Z");
const base = {
  user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: "2026-10-05T11:00:00.000Z" },
  pot: { skrStakedRaw: "12480000", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "0", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: 1.2, storeUsd: null, asOf: "2026-10-01T00:00:00.000Z" },
  holdings: [], manager: { managed: false, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
  history: { plantings: [{ id: "a", ts: "2026-10-01T12:00:00.000Z", asset: "SKR", amountOutRaw: "12480000", usdcInCents: 23 }, { id: "b", ts: "2026-10-03T12:00:00.000Z", asset: "stORE", amountOutRaw: "1", usdcInCents: 40 }], picks: [] },
  nextPlanting: { pendingCents: 135, thresholdCents: 200, capLeftCents: 500, asset: "SKR" },
  lastReceipt: null, basket: null, wallets: [],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
} as unknown as MeResponse;
const coins = ["SKR", "SKR", "stORE", "USDC_LEND", "hSOL", "SKR", "cbBTC", "SOL_LEND"] as const;
const hold = (asset: string) => ({ asset, heldRaw: "1000000000", putInCents: 600, valueUsd: 6.2, earnedUsd: 0.2, earnedUnderlyingRaw: null });
const grown = { ...base, holdings: ["stORE", "USDC_LEND", "hSOL", "cbBTC", "SOL_LEND"].map(hold), history: { plantings: Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, ts: new Date(NOW.getTime() - (i * 1.5 + 0.5) * DAY).toISOString(), asset: coins[i % coins.length], amountOutRaw: "12480000", usdcInCents: 200 })), picks: [] }, pot: { ...base.pot, skrStakedRaw: "9480000000" } } as unknown as MeResponse;
const bud = { ...grown, user: { ...grown.user, wateredAt: new Date(NOW.getTime() - 2 * DAY).toISOString() } } as MeResponse;
const reached = { ...base, nextPlanting: { ...base.nextPlanting, thresholdCents: 10, capLeftCents: 0 } } as MeResponse;

const SIZES = { "2x2": [206, 205], "2x2-dense": [150, 150], "4x2": [430, 205], "4x2-dense": [320, 150], "2x3": [206, 307], "2x3-dense": [150, 230], "3x2": [310, 205], "3x2-dense": [230, 150], "min": [110, 110], "tall-a": [180, 230], "tall-b": [170, 260] } as const;
const empty = { ...grown, nextPlanting: { ...grown.nextPlanting, pendingCents: 0 }, history: { ...grown.history, plantings: grown.history.plantings.map((p) => ({ ...p, ts: new Date(NOW.getTime() - 3 * DAY).toISOString() })) } } as MeResponse;
const planted = { ...empty, history: { ...empty.history, plantings: [{ id: "new", ts: new Date(NOW.getTime() - 3_600_000).toISOString(), asset: "SKR", amountOutRaw: "12480000", usdcInCents: 82 }, ...empty.history.plantings] } } as unknown as MeResponse;
const first = { ...base, holdings: [], nextPlanting: { ...base.nextPlanting, pendingCents: 0 }, history: { plantings: [], picks: [] }, pot: { ...base.pot, skrStakedRaw: "0" } } as unknown as MeResponse;
const paused = { ...grown, wallets: [{ pubkey: "W", status: "paused", dailyCapCents: 500 }] } as unknown as MeResponse;
const STATES = { young: base, grown, reached, empty, planted, first, paused } as const;

describe.skipIf(!process.env.WIDGET_SHOTS)("widget shots", () => {
  it("writes the pages", () => {
    const out = path.resolve(__dirname, "../../../.shots/widget2");
    mkdirSync(out, { recursive: true });
    for (const [state, me] of Object.entries(STATES)) for (const [size, [w, h]] of Object.entries(SIZES)) {
      const root = SproutsWidget({ me, width: w, height: h, now: NOW }) as El;
      const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:linear-gradient(135deg,#1d3b45,#6a8f6b);padding:12px"><div style="width:${w}px;height:${h}px">${html(root)}</div></body>`;
      writeFileSync(path.join(out, `${state}-${size}.html`), page);
    }
  });
});
