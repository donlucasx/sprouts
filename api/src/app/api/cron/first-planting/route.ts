import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { errorText } from "@/lib/redact";
import { runPlanting } from "@/lib/plant-run";
import { cronAuthorized, realPlantingChain } from "@/lib/cron-run";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const { planted, skipped } = await runPlanting({ repo, now: new Date(), chain: realPlantingChain(), deadlineMs: startedMs + 240_000, only: "first" });
    for (const p of planted) console.log(`first planting: ${p.wallet} ${p.asset} ${p.pullCents}c ${p.signature}`);
    for (const s of skipped) console.log(`first planting skipped: ${s.wallet} ${s.reason}`);
    const reasons: Record<string, number> = {};
    for (const s of skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    console.log(`cron (first plantings): planted ${planted.length}, skipped ${skipped.length}`);
    return NextResponse.json({ planted: planted.length, skipped: skipped.length, reasons });
  } catch (e) {
    const message = errorText(e);   // K-M10: never the RPC URL's key
    console.error(`cron (first plantings) failed: ${message}`);
    return NextResponse.json({ error: "Cron failed." }, { status: 500 });
  }
}
