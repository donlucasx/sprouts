import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { getRepo, type Repo } from "@/db/repo";
import { errorText } from "@/lib/redact";
import { rpc } from "@/lib/rpc";
import { runPlanting } from "@/lib/plant-run";
import { cronAuthorized, realPlantingChain } from "@/lib/cron-run";
import { runWithdrawCrank } from "@/lib/withdraw-run";
import { readPosition, crankWithdraw, sharePrice } from "@/lib/staking";
import { reconcileOwnStakes } from "@/lib/reconcile";
import { signaturesFinalized } from "@/lib/finality";
import { snapshotCoins, IMPACT_LIMIT_PCT, type CoinReads } from "@/lib/coin-data";
import { snapshotVenues, scoutYields, realVenueReads } from "@/lib/venues/rates";
import { chainTxStatus, movesEnabled, proposeMoves } from "@/lib/moves";
import { decideSplits, applyToUsers } from "@/lib/split-run";
import { callConversation } from "@/lib/anthropic";
import { getQuote, pricesUsd } from "@/lib/jupiter";
import { storeRedeemRate } from "@/lib/store";
import { readLendingPositions } from "@/lib/holdings";
import { COINS, type Asset } from "@/domain/coins";
import { dayOf } from "@/domain/day";
import { isAutoVenue } from "@/domain/venues";
import { USDC_MINT } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 300;
/** The moves step reads no position past this many ms from the run's start (the planting's own cutoff is 240 s). */
const MOVES_DEADLINE_MS = 150_000;

/** The real reads behind the snapshot (spec 5.2): account bytes, the two share prices, the epoch, Jupiter's prices and a $2 quote; lending legs from today's venue rows (contracts 4). */
function realCoinReads(repo: Repo, now: Date): CoinReads {
  return {
    accountData: async (addr) => {
      const info = await rpc().getAccountInfo(address(addr), { encoding: "base64" }).send();
      return info.value ? new Uint8Array(Buffer.from(info.value.data[0], "base64")) : null;
    },
    skrSharePrice: sharePrice,
    storeRate: storeRedeemRate,
    currentEpoch: async () => (await rpc().getEpochInfo().send()).epoch,
    prices: pricesUsd,
    quoteOk: async (asset: Asset) => {
      // The planting's own size and settings; Jupiter's priceImpactPct is a percentage string.
      const q = await getQuote({ inputMint: USDC_MINT, outputMint: COINS[asset].mint, amountRaw: 2_000_000n, maxAccounts: 24, onlyDirectRoutes: asset === "SKR" });
      return Number(q.priceImpactPct) < IMPACT_LIMIT_PCT;
    },
    // snapshotVenues runs before snapshotCoins, so today's venue rows exist; a failed venues step leaves the lending legs as no data.
    lendOk: async (asset) => (await repo.listVenueDays(dayOf(now))).some((r) => r.asset === asset && isAutoVenue(r.venue) && r.ok),
  };
}

/** One of the manager's steps: its failure is logged and the day goes on (planting reads whatever the rules hold). */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error(`cron: ${name} failed: ${errorText(e)}`);
    return null;
  }
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Once a day (Vercel cron, bearer = CRON_SECRET): plant, crank withdrawals, reconcile the Seed Vaults' own stakes, clean up, keep the database awake. */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  // Review M1: the planting run starts no new wallet past 240 s from here, so the crank, the reconcile and the cleanup always run.
  const startedMs = Date.now();
  try {
    const repo = await getRepo();
    const now = new Date();
    // The Yield Manager's steps before the planting run (spec 6.1): snapshot the venues, then the coins (its lending legs read today's
    // venue rows), decide each stop's split, apply to users, propose moves. Budgets: decide 90 s (DECIDE_BUDGET_MS); the moves step
    // reads no position past 150 s from the start; planting starts no new wallet past 240 s; the whole route has 300 s.
    // realVenueReads() is built inside each step, so a missing JUPITER_API_KEY or RPC fails that step loudly in the log, not the run.
    const venues = await step("venues", () => snapshotVenues({ repo, now, reads: realVenueReads() }));
    const coins = await step("snapshot", () => snapshotCoins({ repo, now, reads: realCoinReads(repo, now) }));
    const splits = await step("decide", () => decideSplits({ repo, now, model: process.env.ANTHROPIC_API_KEY ? callConversation : null, scout: () => scoutYields(realVenueReads()) }));
    const applied = await step("apply", () => applyToUsers({ repo, now }));
    const movesDeadlineMs = startedMs + MOVES_DEADLINE_MS;
    // R337: moves are OFF unless MOVES_ENABLED is exactly "true" (unset = off); switched on after one real move works on a phone.
    const movesOn = movesEnabled();
    const moves = !movesOn ? null : await step("moves", async () => {
      // A move's cost is priced in SOL; with no SOL price today a zero would make every move look free, so the step is skipped (logged).
      const solUsd = (await repo.getCoinDay(dayOf(now), "SOL_LEND"))?.priceUsd;
      if (!solUsd || solUsd <= 0) throw new Error("no SOL price today, moves skipped");
      return proposeMoves({
        repo,
        now,
        // Past the deadline a read fails, which proposeMoves treats as "skip this user", so a slow RPC never eats the planting window.
        positions: async (u) => {
          if (Date.now() >= movesDeadlineMs) throw new Error("moves deadline passed");
          return readLendingPositions(address(u));
        },
        solUsd,
        // T21 minor: an in-flight card's chain reads stop at the same deadline (a throw leaves the card in flight for tomorrow).
        txStatus: async (sig, card) => {
          if (Date.now() >= movesDeadlineMs) throw new Error("moves deadline passed");
          return chainTxStatus(repo, card, sig, now);
        },
      });
    });
    const planting = await runPlanting({ repo, now, chain: realPlantingChain(), deadlineMs: startedMs + 240_000 });
    const withdrawals = await runWithdrawCrank({ repo, now, chain: { readPosition: (u) => readPosition(address(u)), crankWithdraw: (u) => crankWithdraw(address(u)) } });
    // R61: stakes and unstakes the Seed Vault made from its own wallet, found by comparing the chain's share count with the ledger's.
    // R499 F4: the reconcile stops starting users 25 s before the route's 300 s limit (the last one may still spend ~10 s on its
    // final status call); as a step, a throw is logged and the cleanup and the keepalive still run (round 2, R2-1).
    const reconciled = (await step("reconcile", () => reconcileOwnStakes({ repo, now: new Date(), deadlineMs: startedMs + 275_000, chain: { readPosition: (u) => readPosition(address(u), "finalized"), sharePrice, finalized: signaturesFinalized } })));
    await repo.cleanupExpired();
    // The first production run (2026-09-28) planted and then answered 500 here: reading rules for a made-up user violates the
    // rules -> users foreign key. The keepalive is now a read that needs no row.
    await repo.keepalive();
    const summary = { coins: coins ? coins.filter((c) => c.ok).length : null, splits: splits ? splits.map((s) => ({ stop: s.stop, fallback: s.fallback })) : null, applied: applied ? applied.changed.length : null, venues: venues ? venues.filter((v) => v.ok).length : null, moves: moves ? moves.proposed.length : null };
    // Review M8: expired and settled cards are logged too, so a move stuck in flight shows in the log.
    const movesLine = moves ? `${moves.proposed.length} (expired ${moves.expired.length}, settled ${moves.settled.length ? moves.settled.join(" ") : 0})` : movesOn ? "failed" : "off";
    console.log(`cron: venues ${summary.venues ?? "failed"}, coins ${summary.coins ?? "failed"}, splits ${summary.splits ? summary.splits.map((s) => `${s.stop}${s.fallback ? `(${s.fallback})` : ""}`).join(" ") : "failed"}, applied ${summary.applied ?? "failed"}, moves ${movesLine}, planted ${planting.planted.length}, skipped ${planting.skipped.length}, cranked ${withdrawals.cranked.length}, failed ${withdrawals.failed.length}, closed ${withdrawals.skipped.length}, reconciled ${reconciled ? `${reconciled.adjusted.length} (skipped ${reconciled.skipped.length}, deferred ${reconciled.deferred.length})` : "failed"}`);
    return NextResponse.json(json({ ...summary, planting, withdrawals, reconciled }));
  } catch (e) {
    const message = errorText(e);   // K-M10: never the RPC URL's key, in the log or the body
    console.error(`cron failed: ${message}`);
    return NextResponse.json({ error: `Cron failed: ${message}` }, { status: 500 });
  }
}
