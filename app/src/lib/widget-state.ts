import { formatUsd } from "./format";
import { t, type Vars } from "@/i18n";
import type { Key } from "@/i18n/en";
import { nextPlantingFor, nextRunClock, nextRunWords } from "./next-planting";
import { watcherLine } from "@/model/watcher";
import type { MeResponse } from "./api";
import type { Scene } from "@/model/garden";

/** The widget's one state line (R363), and whether it is the call to act (drawn in the accent green). */
export type WidgetState = { text: string; action: boolean };

/** The bud's call in English (tests); the widget draws t("widget.state.bud") (0.1.13). */
export const BUD_LINE = "A bud is ready. Water it.";

/** 0.1.13: a widget text's forms, longest first, in the current language at draw time ('|' separates them in en.ts / es.ts). */
export const formsOf = (key: Key, vars?: Vars): string[] => t(key, vars).split("|");
/** The texts the Garden2 headline picks a form of by width (tests: every Spanish text has a form as narrow as English's narrowest). */
export const WIDGET_FORM_KEYS = [
  "widget.inGarden", "widget.plantsAt", "widget.noUsdc.big", "widget.noUsdc.label", "widget.paused.big", "widget.paused.label",
  "widget.reached.big", "widget.reached.label", "widget.saving.big", "widget.saving.label", "widget.planted.big", "widget.waitingNext",
  "widget.garden.big", "widget.waitingFirst", "widget.walletAsk",
] as const satisfies readonly Key[];
/** The first form of a text that fits, else its last (the narrowest). */
const pickForm = (f: Fit | undefined, texts: string[]) => texts.find((x) => (f ?? (() => true))(x)) ?? texts[texts.length - 1];

/**
 * R363 (10-05, "Value + the one thing to do"): ONE line that invites a tap, decided from Home's own state so the two never disagree:
 * a bud waiting (Home's can in colour, watcherLine) -> "A bud is ready. Water it."; else Home's Next planting row (nextPlantingFor):
 * paused -> "Paused"; change saved below the threshold -> "+$1.35 waiting"; the threshold reached, waiting for the run -> its clock,
 * "Next: 7 AM" (Home: "Tomorrow, 7 AM"). Nothing saved yet -> "Waiting for a swap" (his 10-26 note: "waiting on your next swap", in the least text).
 */
export function widgetStateLine(me: Pick<MeResponse, "nextPlanting" | "wallets">, scene: Pick<Scene, "parts" | "unrevealed">, now: Date): WidgetState {
  if (watcherLine({ unrevealed: scene.unrevealed, failed: false, nudged: false }).can === "ready") return { text: t("widget.state.bud"), action: true };
  const row = nextPlantingFor(me, scene, now);
  switch (row.state) {
    case "paused": return { text: me.wallets.some((w) => w.status === "paused" && w.pause?.reason === "no_usdc") ? t("widget.state.walletNeedsUsdc") : t("next.paused"), action: false };
    case "saving": return { text: t("widget.state.waiting", { amount: formatUsd(me.nextPlanting.pendingCents) }), action: false };
    case "reached": return { text: t("next.short.next", { value: nextRunClock(now) }), action: false };
    case "empty": return { text: t("widget.state.empty"), action: false };
  }
}

/** A planting this recent leads the widget ("Planted $0.82"): the widget keeps no memory of what it drew, so a clock decides. */
export const PLANTED_RECENT_MS = 24 * 60 * 60 * 1000;
/** Garden2's three lines (10-11, after Kimi's analysis): the headline (one small bold line), the line under it and its accent, the bottom
 *  line, and the bar's fill (null: no bar). */
export type WidgetHeadline = { big: string; label: string; line: string; fraction: number | null; action: boolean; walletAsk?: boolean };
type Fit = (text: string) => boolean;

/**
 * Garden2 (his notes 10-11: "seeing $0.00 alone up there is not very inviting"; "too big 'swap to save', plus not the right kind of cta";
 * Kimi's widget analysis, ~/Documents/kimi/sprouts-widget-2026-10-11/WIDGET-ANALYSIS.md): the widget reports, it never asks for a swap (it
 * cannot do one, and neither can Sprouts). One small headline about the user's money, never "$0.00"; the bottom line is the fact the
 * headline leaves out. From Home's Next planting row (nextPlantingFor), so the two never disagree:
 * paused -> "Round-ups paused" / open to turn on (accent) / the total; reached -> "$2.15 saved" / when it plants / the total, bar full;
 * saving -> "$1.35 of $2.00" / "rounds up from every swap" / the total, bar; nothing pending after a planting in the last day ->
 * "Planted $0.82" / the total / "Waiting for your next swap"; nothing pending, money in the garden -> the total / "Waiting for your next
 * swap" / what plants; nothing yet -> "Your garden" / "Waiting for your first swap" / what plants.
 * Each text lists its forms longest first; a narrow widget takes the first that fits, else the last.
 */
export function widgetHeadline(
  me: Pick<MeResponse, "nextPlanting" | "wallets"> & { history?: Pick<MeResponse["history"], "plantings"> },
  scene: Pick<Scene, "parts">, now: Date, total: string, hasMoney: boolean,
  fits: { big?: Fit; label?: Fit; line?: Fit } = {},
): WidgetHeadline {
  const head = gardenHeadline(me, scene, now, total, hasMoney, fits);
  // 10-26 (his ruling: "the widget should flag this issue"): one wallet out of USDC while another still plants. The garden is not paused,
  // so the money and the bar stay; the line under the headline turns into the ask, in the accent green, and a tap opens Home's top-up.
  if (head.action || !me.wallets.some((w) => w.status === "paused" && w.pause?.reason === "no_usdc")) return head;
  return { ...head, label: pickForm(fits.label, formsOf("widget.walletAsk")), action: true, walletAsk: true };
}

function gardenHeadline(
  me: Pick<MeResponse, "nextPlanting" | "wallets"> & { history?: Pick<MeResponse["history"], "plantings"> },
  scene: Pick<Scene, "parts">, now: Date, total: string, hasMoney: boolean,
  fits: { big?: Fit; label?: Fit; line?: Fit } = {},
): WidgetHeadline {
  const row = nextPlantingFor(me, scene, now), pending = Math.max(0, me.nextPlanting.pendingCents);
  const goal = formatUsd(me.nextPlanting.thresholdCents);
  // 0.1.13: each text is one key whose forms the language gives ('|'), read at draw time
  const big = (k: Key, v?: Vars) => pickForm(fits.big, formsOf(k, v)), label = (k: Key, v?: Vars) => pickForm(fits.label, formsOf(k, v)), line = (k: Key, v?: Vars) => pickForm(fits.line, formsOf(k, v));
  const inGarden = line("widget.inGarden", { total });
  const plantsAt = line("widget.plantsAt", { goal });
  switch (row.state) {
    case "paused":
      // 10-26 copy review row 7: a pause for want of USDC asks for USDC in the wallet; the user's own pause keeps its words
      if (me.wallets.some((w) => w.status === "paused" && w.pause?.reason === "no_usdc"))
        return { big: big("widget.noUsdc.big"), label: label("widget.noUsdc.label"), line: inGarden, fraction: null, action: true };
      return { big: big("widget.paused.big"), label: label("widget.paused.label"), line: inGarden, fraction: null, action: true };
    case "reached": return { big: big("widget.reached.big", { amount: formatUsd(pending) }), label: label("widget.reached.label", { when: nextRunWords(now), clock: nextRunClock(now) }), line: inGarden, fraction: 1, action: false };
    case "saving": return { big: big("widget.saving.big", { amount: formatUsd(pending), goal }), label: label("widget.saving.label"), line: inGarden, fraction: row.fraction, action: false };
    case "empty": {
      const recent = (me.history?.plantings ?? []).filter((p) => { const t = Date.parse(p.ts); return t <= now.getTime() && now.getTime() - t < PLANTED_RECENT_MS; });
      const planted = recent.reduce((c, p) => c + p.usdcInCents, 0);
      // 10-27 (his note: the pill "not showing the planting bar"): nothing waiting is an empty bar (fraction 0), not no bar
      if (planted > 0) return { big: big("widget.planted.big", { amount: formatUsd(planted) }), label: label("widget.inGarden", { total }), line: line("widget.waitingNext"), fraction: 0, action: false };
      if (hasMoney) return { big: big("widget.garden.big", { total }), label: label("widget.waitingNext"), line: plantsAt, fraction: 0, action: false };
      return { big: t("widget.yourGarden"), label: label("widget.waitingFirst"), line: plantsAt, fraction: 0, action: false };
    }
  }
}
