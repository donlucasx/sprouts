import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { errorText } from "@/lib/redact";
import { rescueCandidates, runPlanting } from "@/lib/plant-run";
import { dayOf } from "@/domain/day";
import { cronAuthorized, realPlantingChain } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 800; // 11-25 (Pro): 300 s killed the run under Helius 429 slowdowns (19 of ~45 planted); internal deadlines unchanged

/**
 * First planting (owner 10-22, "first planting right away"): the hourly run, called by GitHub Actions
 * (.github/workflows/first-planting.yml) because Vercel Hobby crons run once a day. Same bearer as the daily cron (CRON_SECRET).
 * It plants first plantings only (runPlanting's first-only mode: users with no sent or confirmed planting and round-ups waiting)
 * and runs none of the daily steps: no snapshot, decision, moves, withdraw crank, stake reconcile, sent-planting reconcile or
 * cleanup. A route of its own, not a query on /api/cron/plant: a deploy without this file answers 404 here, where the old daily
 * route would have ignored a query and run the whole day's work every hour.
 * The answer carries counts and reasons only (the caller's log is public on GitHub): never a wallet or a signature.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const startedMs = Date.now();
  try {
    const repo = await getRepo();
    const now = new Date();
    // 11-24 (Kimi audit finding 4): first plantings get the first 140 s, so the rescue below always has time left.
    const first = await runPlanting({ repo, now, chain: realPlantingChain(), deadlineMs: startedMs + 140_000, only: "first" });
    // 11-24 (the daily run stopped on Helius 429s, 56 wallets waited a day): then, in the same budget, the wallets today's finished
    // daily run could not reach (stopped, deadline, rate-limited), minus users who planted since it started. What does not fit waits
    // for the next hour, until the next daily run.
    const run = await repo.getCronRun(dayOf(now)).catch((e) => { console.error(`cron (first plantings): today's run unreadable, no rescue: ${errorText(e)}`); return null; });
    const candidates = rescueCandidates(run);
    const rescue = candidates.length && run && Date.now() < startedMs + 230_000
      ? await runPlanting({ repo, now, chain: realPlantingChain(), deadlineMs: startedMs + 240_000, only: "rescue", rescue: { wallets: candidates, since: run.startedAt } })
      : { planted: [], skipped: [] };
    const planted = [...first.planted, ...rescue.planted];
    const skipped = [...first.skipped, ...rescue.skipped];
    const nCandidates = candidates === "all" ? "all" : candidates.length;
    if (candidates.length) console.log(`cron (rescue): ${nCandidates} wallet(s) the daily run missed; planted ${rescue.planted.length}, skipped ${rescue.skipped.length}`);
    for (const p of planted) console.log(`first planting: ${p.wallet} ${p.asset} ${p.pullCents}c ${p.signature}`);
    for (const s of skipped) console.log(`first planting skipped: ${s.wallet} ${s.reason}`);
    const reasons: Record<string, number> = {};
    for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    console.log(`cron (first plantings): planted ${planted.length}, skipped ${skipped.length}`);
    // Heartbeat for the ops dashboard's "First planting" light: one event per completed run, even with 0 planted. Counts and the fixed reason strings only (public log
    // rule). A run that threw writes none (the light going stale is the signal). A failed write is logged and never changes the answer.
    try {
      await repo.addEvent({ kind: "first_planting_run", userPubkey: null, walletPubkey: null, detail: { planted: planted.length, skipped: skipped.length, reasons, rescue: { candidates: nCandidates, planted: rescue.planted.length } } });
    } catch (e) {
      console.error(`cron (first plantings) heartbeat not written: ${errorText(e)}`);
    }
    return NextResponse.json({ planted: planted.length, skipped: skipped.length, reasons, rescued: rescue.planted.length });
  } catch (e) {
    const message = errorText(e);   // K-M10: never the RPC URL's key
    console.error(`cron (first plantings) failed: ${message}`);
    return NextResponse.json({ error: "Cron failed." }, { status: 500 });
  }
}
