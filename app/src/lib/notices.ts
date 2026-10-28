import { LOW_DAYS } from "./usdc-runway";
import { plantedWhat, formatSkr, COIN_NAME_LONG } from "./format";
import { ASSETS, isRetired, type AutoVenue, type LiveAsset, type Split } from "./coins";
import type { MeResponse } from "./api";

/** The planting push (R172, 10-02): one line, the change and what it became, with the coin's value. The "where it sits" and "a new
 * sprout is waiting" clauses are gone: they ran past one line, and he picked the plain line over "a new sprout grows". */
export function plantingNotice(
  p: { asset: LiveAsset; usdcInCents: number; amountOutRaw: string; venue?: AutoVenue | null },
  pot: { skrUsd: number | null; storeUsd: number | null },
): string {
  const usdPrice = p.asset === "SKR" ? pot.skrUsd : p.asset === "stORE" ? pot.storeUsd : null;
  return `Your change was planted: ${plantedWhat({ ...p, usdPrice })}.`;
}

/** R161: the notices, each behind its own switch in Settings > Notifications ("paused": 10-22, the run paused a wallet for want of USDC). */
export type NoticeKind = "plantings" | "withdrawals" | "manager" | "limit" | "paused";
export type Notice = { kind: NoticeKind; title: string; body: string };

/** "60% SKR, 40% stORE": the coins with a share, in the app's coin order. */
function splitLine(s: Split): string {
  return ASSETS.filter((a) => s[a] > 0).map((a) => `${s[a]}% ${COIN_NAME_LONG[a]}`).join(", ");
}

/**
 * What changed between two reads of /api/me, as notices (R161). State, not clocks: each fires on a transition,
 * so a repeat read says nothing. No notice on the first read (nothing to compare).
 */
export function noticesFor(before: MeResponse | null, me: MeResponse, on: (k: NoticeKind) => boolean): Notice[] {
  if (!before) return [];
  const out: Notice[] = [];
  const landed = me.history.plantings.filter((p) => !isRetired(p.asset) && !before.history.plantings.some((q) => q.id === p.id)) as (MeResponse["history"]["plantings"][number] & { asset: LiveAsset })[];
  for (const p of landed)
    out.push({ kind: "plantings", title: "Planted", body: plantingNotice(p, me.pot) });
  // A basket also leaves on a cancel, which drops its pick (cancelSignature set); only a basket whose pick stays was delivered.
  const b = before.basket;
  if (b && !me.basket && me.history.picks.some((p) => p.ts === b.unstakeTs))
    out.push({ kind: "withdrawals", title: "Withdrawal delivered", body: `${formatSkr(BigInt(b.amountRaw), me.pot.skrUsd)} is in your wallet.` });
  // Only the daily run sets changedDay; any save of yours clears it to null, so a new non-null day is the manager's move.
  if (me.manager.changedDay && me.manager.changedDay !== before.manager.changedDay) {
    const why = me.manager.why ? ` ${me.manager.why}` : "";
    out.push({ kind: "manager", title: "Your split moved", body: `Your yield manager moved your split to ${splitLine(me.rules.allocation)}.${why} You can undo it in Rules.` });
  }
  // Only a planting uses up the limit: one landed since the last read and what is left no longer covers a network fee. A cap you
  // lowered, or the API's fallback when the chain read fails, lands no planting, so neither can fire it (review, findings 1, 3, 7).
  const feeCents = me.lastReceipt?.networkFeeCents ?? 0;
  if (landed.length > 0 && me.rules.dailyCapCents > 0 && me.nextPlanting.capLeftCents <= feeCents)
    out.push({ kind: "limit", title: "Daily limit reached", body: "Today's limit is used up. Your change keeps adding up and plants tomorrow." });
  // 10-22: a wallet the run newly paused for want of USDC (this read says so, the last one did not), so once per pause, not every poll.
  // This phone's wallet can top up from SOL in the app; another wallet's USDC is added wherever that wallet lives.
  const noUsdc = (w: MeResponse["wallets"][number] | undefined) => w?.status === "paused" && w.pause?.reason === "no_usdc";
  for (const w of me.wallets ?? []) {
    if (!noUsdc(w) || noUsdc((before.wallets ?? []).find((b) => b.pubkey === w.pubkey))) continue;
    // 10-27 (his rulings on Home's notice: each wallet by name, this phone's the Seed Vault wallet; one "Add USDC", never "you need SOL")
    const mine = w.pubkey === me.user?.pubkey, short = `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`;
    const body = mine
      ? "Plantings are paused and your round-ups wait. Open Sprouts to add USDC."
      : `Plantings from it are paused and your round-ups wait. Add USDC to ${short} to start again.`;
    out.push({ kind: "paused", title: mine ? "Seed Vault wallet needs USDC" : `${short} needs USDC`, body });
  }
  // 10-27 (ikeonsol.skr): a wallet Sprouts newly stopped on its own (this read says so, the last did not), once; behind the same switch
  // as the no-USDC pause (plantings from a wallet stopped). A wallet the user revoked carries no `stopped`, so it never fires.
  const stopped = (w: MeResponse["wallets"][number] | undefined) => w?.status === "revoked" && !!w.stopped;
  for (const w of me.wallets ?? []) {
    if (!stopped(w) || stopped((before.wallets ?? []).find((b) => b.pubkey === w.pubkey))) continue;
    const mine = w.pubkey === me.user?.pubkey, short = `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`;
    out.push({ kind: "paused", title: `Sprouts stopped planting from ${mine ? "your Seed Vault wallet" : short}`, body: "Open Sprouts to link it again." });
  }
  return out.filter((n) => on(n.kind));
}

/**
 * 10-27 (the notification his review list named for the release): this phone's wallet running low on USDC, once per low spell. `usdcCents`
 * its USDC now, `avg` its round-ups a day (Home saves its last reading, usdc-runway), `wasLow` whether the last check already said so.
 * Low = under LOW_DAYS of round-ups; a wallet the run already paused is the paused notice's, not this one's. Behind the "paused" switch
 * (Settings: "Tell me when a wallet runs out of USDC").
 */
export function lowUsdcNotice(usdcCents: number | null, avg: number | null, wasLow: boolean, paused: boolean): { notice: Notice | null; low: boolean } {
  if (usdcCents === null) return { notice: null, low: wasLow };
  const low = usdcCents <= 0 || (avg !== null && avg > 0 && usdcCents < avg * LOW_DAYS);
  if (!low || wasLow || paused) return { notice: null, low };
  const notice: Notice = usdcCents <= 0
    ? { kind: "paused", title: "Seed Vault wallet has no USDC", body: "Your round-ups wait until it has some. Open Sprouts to add USDC." }
    : { kind: "paused", title: "Seed Vault wallet is low on USDC", body: `$${(usdcCents / 100).toFixed(2)} left. Open Sprouts to add more before plantings pause.` };
  return { notice, low };
}
