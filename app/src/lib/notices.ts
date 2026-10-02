import { formatUsd, formatAmount, formatSkr, COIN_NAME } from "./format";
import { ASSETS, type Asset, type Split } from "./coins";
import type { MeResponse } from "./api";

/** The planting push: what landed, where it sits, and that a sprout waits to be opened (audits/watering-ux, finding 9). */
export function plantingNotice(
  p: { asset: Asset; usdcInCents: number; amountOutRaw: string },
  pot: { skrUsd: number | null; storeUsd: number | null },
): string {
  const amount = formatAmount(p.asset, BigInt(p.amountOutRaw), p.asset === "SKR" ? pot.skrUsd : p.asset === "stORE" ? pot.storeUsd : null);
  const where = p.asset === "SKR" ? "locked to your Seeker" : "in your Seeker wallet";
  return `${formatUsd(p.usdcInCents)} of change became ${amount}, ${where}. A new sprout is waiting in your garden.`;
}

/** R161: the four notices, each behind its own switch in Settings > Notifications. */
export type NoticeKind = "plantings" | "withdrawals" | "manager" | "limit";
export type Notice = { kind: NoticeKind; title: string; body: string };

/** "60% SKR, 40% stORE": the coins with a share, in the app's coin order. */
function splitLine(s: Split): string {
  return ASSETS.filter((a) => s[a] > 0).map((a) => `${s[a]}% ${COIN_NAME[a]}`).join(", ");
}

/**
 * What changed between two reads of /api/me, as notices (R161). State, not clocks: each fires on a transition,
 * so a repeat read says nothing. No notice on the first read (nothing to compare).
 */
export function noticesFor(before: MeResponse | null, me: MeResponse, on: (k: NoticeKind) => boolean): Notice[] {
  if (!before) return [];
  const out: Notice[] = [];
  for (const p of me.history.plantings.filter((p) => !before.history.plantings.some((q) => q.id === p.id)))
    out.push({ kind: "plantings", title: "Planting landed", body: plantingNotice(p, me.pot) });
  if (before.basket && !me.basket)
    out.push({ kind: "withdrawals", title: "Withdrawal delivered", body: `${formatSkr(BigInt(before.basket.amountRaw), me.pot.skrUsd)} is in your Seeker's wallet.` });
  // Only the daily run sets changedDay; any save of yours clears it to null, so a new non-null day is the manager's move.
  if (me.manager.changedDay && me.manager.changedDay !== before.manager.changedDay) {
    const why = me.manager.why ? ` ${me.manager.why}` : "";
    out.push({ kind: "manager", title: "Your split moved", body: `Your yield manager moved your split to ${splitLine(me.rules.allocation)}.${why} You can undo it in Rules.` });
  }
  if (me.rules.dailyCapCents > 0 && me.nextPlanting.capLeftCents === 0 && before.nextPlanting.capLeftCents > 0)
    out.push({ kind: "limit", title: "Daily limit reached", body: `Today's ${formatUsd(me.rules.dailyCapCents)} is used up. Your change keeps adding up and plants tomorrow.` });
  return out.filter((n) => on(n.kind));
}
