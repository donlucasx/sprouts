import type { Repo } from "@/db/repo";
import type { EventRow } from "@/db/types";
import { signatureStatuses } from "./planting";

/**
 * The top-up's record (10-27, his rulings: "should a top up be considered a swap?" -> no; top-ups show in Activity, this release).
 * Two events per top-up, both keyed by its signature and written at most once each (Kimi F2: a second confirm of the same
 * transaction answers 200 again and must not add a second row):
 * - `topup_sent`, BEFORE the API sends it: the Helius webhook books any two-legged transaction of a linked wallet, so a top-up would
 *   read as a SOL->USDC swap; bookSwap skips a marked signature, and the mark exists before the chain can see the transaction.
 * - `topped_up`, once it landed: Activity's row. `sentAt` is the mark's time, so a top-up settled later still sorts where it happened.
 */
type Mark = { user: string; signature: string; usdcRaw: string };

/** Throws when the mark could not be written: the caller must not send (an unmarked top-up would be booked as a swap). */
export async function markTopUpSent(repo: Repo, m: Mark): Promise<void> {
  if ((await repo.topUpKinds(m.signature, m.user)).includes("topup_sent")) return;
  await repo.addEvent({ userPubkey: m.user, walletPubkey: m.user, kind: "topup_sent", detail: { signature: m.signature, usdcRaw: m.usdcRaw } });
}

/** The money already moved, so a failed write is logged, never thrown into the user's answer. */
export async function recordTopUpLanded(repo: Repo, m: Mark & { sentAt: Date }): Promise<void> {
  try {
    if ((await repo.topUpKinds(m.signature, m.user)).includes("topped_up")) return;
    await repo.addEvent({ userPubkey: m.user, walletPubkey: m.user, kind: "topped_up", detail: { signature: m.signature, usdcRaw: m.usdcRaw, sentAt: m.sentAt.toISOString() } });
  } catch (e) {
    console.error(`top-up ${m.signature}: landed, but its Activity row was not written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * How far back, and how many, a settle looks. A top-up's blockhash lives about 90 s, so a mark that has not landed by then never
 * will; the week only covers a user who opens Activity days later. Every open mark is asked in ONE RPC call per load (review 10-27:
 * dead marks were one call each, every load, for a week).
 */
export const SETTLE_DAYS = 7;
export const SETTLE_MAX = 20;

/**
 * Kimi F4 (his "address this fix asap"): a top-up whose confirm poll ended 202 "pending" and landed later has a mark and no row.
 * Activity calls this first: the user's recent marks without a `topped_up` are asked on chain together (searching history), and the
 * landed ones get their row. A failed chain read leaves the marks for the next load. Answers the user's top-ups, one per signature
 * (two racing writers can both insert: the confirm's poll and a settle, or two loads), newest first by `sentAt`, the settled ones
 * included, so Activity reads the events once (the 10-08 read-count budget).
 */
export async function settleTopUps(repo: Repo, user: string, now = new Date()): Promise<EventRow[]> {
  const events = await repo.listEvents(user, ["topup_sent", "topped_up"], 100);
  const sig = (d: unknown) => (d as { signature?: unknown } | null)?.signature;
  const landed = new Set(events.filter((e) => e.kind === "topped_up").map((e) => sig(e.detail)));
  const since = now.getTime() - SETTLE_DAYS * 86_400_000;
  const open = events.filter((e) => e.kind === "topup_sent" && e.ts.getTime() >= since && !landed.has(sig(e.detail))).slice(0, SETTLE_MAX);
  const marks = open.flatMap((e) => {
    const d = e.detail as { signature?: unknown; usdcRaw?: unknown } | null;
    return typeof d?.signature === "string" && typeof d.usdcRaw === "string" && /^\d+$/.test(d.usdcRaw) ? [{ signature: d.signature, usdcRaw: d.usdcRaw, sentAt: e.ts }] : [];
  });
  const settled: EventRow[] = [];
  try {
    const statuses = await signatureStatuses(marks.map((m) => m.signature));
    for (const [i, m] of marks.entries()) {
      if (statuses[i] !== "confirmed") continue;
      await recordTopUpLanded(repo, { user, ...m });
      settled.push({ id: 0, userPubkey: user, walletPubkey: user, ts: now, kind: "topped_up", detail: { ...m, sentAt: m.sentAt.toISOString() } });
    }
  } catch (err) {
    console.error(`top-up settle for ${user}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const at = (e: EventRow) => { const s = (e.detail as { sentAt?: unknown } | null)?.sentAt; return typeof s === "string" && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : e.ts.getTime(); };
  const seen = new Set<unknown>();
  return [...settled, ...events.filter((e) => e.kind === "topped_up")]
    .filter((e) => { const s = sig(e.detail); if (seen.has(s)) return false; seen.add(s); return true; })
    .sort((x, y) => at(y) - at(x));
}
