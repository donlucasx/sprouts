import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { rpc } from "@/lib/rpc";
import { runPlanting, type Chain } from "@/lib/plant-run";
import { runWithdrawCrank } from "@/lib/withdraw-run";
import { readDelegation, usdcAta } from "@/lib/subscriptions";
import { buildPlantingTx, simulatePlanting, sendPlanting, signatureStatus, pullerSkrChangeRaw, pullerTokenChangeRaw, cleanupPlanting, type BuiltPlanting } from "@/lib/planting";
import { readLeashConfig, priceSourceFor, type LeashLegByte } from "@/lib/leash";
import { readPosition, crankWithdraw, sharePrice } from "@/lib/staking";
import { reconcileOwnStakes } from "@/lib/reconcile";
import { snapshotCoins, IMPACT_LIMIT_PCT, type CoinReads } from "@/lib/coin-data";
import { decideSplits, applyToUsers } from "@/lib/split-run";
import { callTool } from "@/lib/anthropic";
import { getQuote, pricesUsd } from "@/lib/jupiter";
import { storeRedeemRate } from "@/lib/store";
import { assetBalanceRaw, receiptBalanceRaw, readLendingPositions } from "@/lib/holdings";
import { COINS, type Asset, type LendAsset } from "@/domain/coins";
import { USDC_MINT, WSOL_MINT } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${config().cronSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The real chain behind the run: delegation reads, balances, and the planting builder from the libraries. */
function realChain(): Chain {
  return {
    readDelegation: (pda) => readDelegation(address(pda)),
    usdcBalanceRaw: async (owner) => {
      // A missing token account is "no USDC"; anything else (an RPC outage) throws, so the wallet is skipped, not paused (review I8).
      const ata = await usdcAta(address(owner));
      const info = await rpc().getAccountInfo(ata, { encoding: "base64" }).send();
      if (!info.value) return 0n;
      const { value } = await rpc().getTokenAccountBalance(ata).send();
      return BigInt(value.amount);
    },
    buildPlantingTx: (a) => buildPlantingTx({ ...a, delegator: address(a.delegator), user: address(a.user), delegationPda: address(a.delegationPda) }),
    simulatePlanting: (b) => simulatePlanting(b as BuiltPlanting),
    sendPlanting: (b) => sendPlanting(b as BuiltPlanting),
    signatureStatus,
    readShares: async (u) => (await readPosition(address(u))).shares,
    sharePrice,
    assetBalanceRaw: (owner, asset, venue) => (venue ? receiptBalanceRaw(address(owner), asset as LendAsset, venue) : assetBalanceRaw(address(owner), asset)),
    pullerSkrChangeRaw: (sig) => pullerSkrChangeRaw(sig),
    readLeashConfig: () => readLeashConfig().catch(() => null),
    lendingPositions: (u) => readLendingPositions(address(u)),
    pullerCarryChangeRaw: (sig, kind) => pullerTokenChangeRaw(sig, kind === "WSOL" ? WSOL_MINT : USDC_MINT),
    cleanup: (b) => cleanupPlanting(b as BuiltPlanting),
    // T8 carry: the run's one wait per feed (waitS 60) and the checks with no wait (before a build, before a send); leg 0 throws (R324).
    priceFresh: async (leg, cfg, waitS) => { await priceSourceFor(leg as LeashLegByte, undefined, waitS, cfg); },
  };
}

/** The real reads behind the snapshot (spec 5.2): account bytes, the two share prices, the epoch, Jupiter's prices and a $2 quote. */
function realCoinReads(): CoinReads {
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
  };
}

/** One of the manager's steps: its failure is logged and the day goes on (planting reads whatever the rules hold). */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error(`cron: ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Once a day (Vercel cron, bearer = CRON_SECRET): plant, crank withdrawals, reconcile the Seed Vaults' own stakes, clean up, keep the database awake. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  // Review M1: the planting run starts no new wallet past 240 s from here, so the crank, the reconcile and the cleanup always run.
  const startedMs = Date.now();
  try {
    const repo = await getRepo();
    const now = new Date();
    // The Yield Manager's three steps before the planting run (spec 6.1): snapshot the coins, decide each stop's split, apply to users.
    const coins = await step("snapshot", () => snapshotCoins({ repo, now, reads: realCoinReads() }));
    const splits = await step("decide", () => decideSplits({ repo, now, model: process.env.ANTHROPIC_API_KEY ? callTool : null }));
    const applied = await step("apply", () => applyToUsers({ repo, now }));
    const planting = await runPlanting({ repo, now, chain: realChain(), deadlineMs: startedMs + 240_000 });
    const withdrawals = await runWithdrawCrank({ repo, now, chain: { readPosition: (u) => readPosition(address(u)), crankWithdraw: (u) => crankWithdraw(address(u)) } });
    // R61: stakes and unstakes the Seed Vault made from its own wallet, found by comparing the chain's share count with the ledger's.
    const reconciled = await reconcileOwnStakes({ repo, chain: { readPosition: (u) => readPosition(address(u), "finalized"), sharePrice } });
    await repo.cleanupExpired();
    // The first production run (2026-09-28) planted and then answered 500 here: reading rules for a made-up user violates the
    // rules -> users foreign key. The keepalive is now a read that needs no row.
    await repo.keepalive();
    const summary = { coins: coins ? coins.filter((c) => c.ok).length : null, splits: splits ? splits.map((s) => ({ stop: s.stop, fallback: s.fallback })) : null, applied: applied ? applied.changed.length : null };
    console.log(`cron: coins ${summary.coins ?? "failed"}, splits ${summary.splits ? summary.splits.map((s) => `${s.stop}${s.fallback ? `(${s.fallback})` : ""}`).join(" ") : "failed"}, applied ${summary.applied ?? "failed"}, planted ${planting.planted.length}, skipped ${planting.skipped.length}, cranked ${withdrawals.cranked.length}, failed ${withdrawals.failed.length}, closed ${withdrawals.skipped.length}, reconciled ${reconciled.adjusted.length} (skipped ${reconciled.skipped.length}, deferred ${reconciled.deferred.length})`);
    return NextResponse.json(json({ ...summary, planting, withdrawals, reconciled }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`cron failed: ${message}`);
    return NextResponse.json({ error: `Cron failed: ${message}` }, { status: 500 });
  }
}
