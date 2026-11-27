import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { getRepo, type Repo } from "@/db/repo";
import { errorText } from "@/lib/redact";
import { cronAuthorized } from "@/lib/cron-run";
import { dayOf } from "@/domain/day";
import { alertFounder } from "@/lib/founder-alert";
import { flushHeliusCredits } from "@/lib/helius-credits";
import { config } from "@/lib/config";
import { annotateMissReasons, checkedThrough, checkMissedSwaps, MAX_LOOKBACK_S, realSwapCheckReads, repeatMisses, type SwapCheckRecord } from "@/lib/swap-check";
import { excludedWallets } from "@/lib/ops/sources";

export const runtime = "nodejs";
/**
 * 11-27 (Kimi swap-check scope item 1, his ruling "check EVERY wallet daily"): the missed-swap check on its own daily route, 13:00 UTC
 * (vercel.json), an hour before the plant run. In the plant run it had ~30 s after the reconcile and deferred ~70-104 of ~140 wallets
 * a day. DETECTION ONLY, as before: nothing is booked; a miss is credited by hand (spikes/credit-missed-swaps.ts).
 */
export const maxDuration = 800;
/** No wallet is started past this many ms from the route's start; a wallet still being read at the hard stop is deferred, never concluded. */
const SWAPCHECK_DEADLINE_MS = 730_000;
const SWAPCHECK_HARD_STOP_MS = 755_000;
/** M1: the step returns by this whatever read is still in flight (the rest of its wallets deferred), so the record is written. */
const SWAPCHECK_BOUND_MS = 760_000;
/** The lock: a claimed run not finished after this long died (limit 800 s), so its day can be claimed again. */
const RUN_STALE_MS = 15 * 60_000;

/** The record is best effort: failing to write it never fails the run. */
async function finishRun(repo: Repo, day: string, startedAt: Date, ok: boolean, record: unknown) {
  try {
    await repo.finishSwapCheckRun(day, ok, json(record), new Date(), startedAt);
  } catch (e) {
    console.error(`swap check: run record failed: ${errorText(e)}`);
  }
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const summaryCheck = (s: unknown): unknown => (s !== null && typeof s === "object" ? (s as { swapCheck?: unknown }).swapCheck ?? null : null);

/** Once a day (Vercel cron, bearer = CRON_SECRET): every active linked wallet's swaps since its last check, against swaps. */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return apiError("unauthorized", { error: "Unauthorized." }, { status: 401 });
  const startedMs = Date.now();
  let run: { repo: Repo; day: string; startedAt: Date } | null = null;
  try {
    const repo = await getRepo();
    const now = new Date();
    const day = dayOf(now);
    // Its own lock (0014), so it can never collide with the plant run's.
    if (!(await repo.claimSwapCheckRun(day, now, new Date(now.getTime() - RUN_STALE_MS)))) {
      console.log(`swap check: ${day} is already running, this trigger stopped`);
      return apiError("busy", { error: "Another run is going." }, { status: 409 });
    }
    run = { repo, day, startedAt: now };
    // The last week's records: each wallet's last check (its lookback) and the previous run's misses (repeats). Unreadable: no history,
    // so every wallet gets the plain 48 h and no repeat is called (never a narrower window).
    const since = new Date(now.getTime() - MAX_LOOKBACK_S * 1000);
    const earlier = (await repo.listSwapCheckRuns(since, 14).catch((e) => { console.error(`swap check: history unreadable: ${errorText(e)}`); return []; }))
      .filter((r) => r.day !== day);
    const records = earlier.map((r) => summaryCheck(r.summary));
    const history = checkedThrough(records);

    let swapCheck: SwapCheckRecord | null = null;
    try {
      const out = await checkMissedSwaps({
        repo, now, reads: await realSwapCheckReads(), exclude: excludedWallets(config().opsExcludeWallets), history,
        deadlineMs: startedMs + SWAPCHECK_DEADLINE_MS, hardStopMs: startedMs + SWAPCHECK_HARD_STOP_MS, boundAt: startedMs + SWAPCHECK_BOUND_MS,
      });
      swapCheck = { ...out, missed: await annotateMissReasons(repo, out.missed, since) };
    } catch (e) {
      // A failed check is null in the record ("Every swap counted" goes grey), never a run that claims nothing was missed.
      console.error(`swap check failed: ${errorText(e)}`);
    }

    if (swapCheck) {
      for (const m of swapCheck.missed) console.log(`swap check: missed ${m.sig} on ${m.wallet} at ${m.ts}, ${m.roundupCents}c, webhook: ${m.reason ?? "?"}`);
      const repeats = repeatMisses(swapCheck.missed, records[0] ?? null);
      if (repeats.length) {
        const lines = repeats.map((w) => `${w}: ${swapCheck!.missed.filter((m) => m.wallet === w).map((m) => `${m.sig} (${m.reason ?? "?"})`).join(", ")}`);
        await alertFounder({
          channel: "ops",
          title: repeats.length === 1 ? "Same wallet missed swaps two runs in a row" : `${repeats.length} wallets missed swaps two runs in a row`,
          text: `The daily swap check found new swaps not counted for ${repeats.length === 1 ? "a wallet" : "wallets"} that also had one missed yesterday. ${lines.join("; ")}`.slice(0, 900),
          todo: "Credit them by hand. no_trace = the webhook never sent it; refused or unpriced = it came and was turned away",
        }).catch(() => {});
      }
    }
    // This route's own Helius calls join the cycle's count (the plant run checks the total an hour later).
    await flushHeliusCredits(repo, now).catch((e) => { console.error(`swap check: helius credits not flushed: ${errorText(e)}`); });
    console.log(`swap check: ${swapCheck ? `missed ${swapCheck.missed.length} (checked ${swapCheck.checked}, unchecked ${swapCheck.unchecked.length}, deferred ${swapCheck.deferred}; skipped ${JSON.stringify(swapCheck.skipped ?? {})})` : "failed"}`);
    // The same record shape the plant run wrote (summary.swapCheck), so the ops light reads it unchanged.
    const record = { swapCheck, seconds: Math.round((Date.now() - startedMs) / 1000) };
    await finishRun(repo, day, now, swapCheck !== null, record);
    return NextResponse.json(json(record));
  } catch (e) {
    const message = errorText(e);
    console.error(`swap check route failed: ${message}`);
    if (run) await finishRun(run.repo, run.day, run.startedAt, false, { swapCheck: null, error: message.slice(0, 500), seconds: Math.round((Date.now() - startedMs) / 1000) });
    await alertFounder({ channel: "ops", title: "Daily swap check failed", text: message.slice(0, 300), todo: "Check the Vercel logs for /api/cron/swap-check; it runs again tomorrow" }).catch(() => {});
    return apiError("internal", { error: `Swap check failed: ${message}` }, { status: 500 });
  }
}
