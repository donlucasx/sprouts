import type { Repo } from "@/db/repo";
import type { WalletRow } from "@/db/types";
import { rulesRowToRules } from "@/db/types";
import { pickAsset, type Asset } from "@/domain/allocation";
import { capLeftCents, plantAmountCents } from "@/domain/cap";

/** The pass-through network fee, in cents, added to every pull and shown on the receipt. */
export const NETWORK_FEE_CENTS = 3;
const USDC_PER_CENT = 10_000n;
const CONCURRENCY = 8;
const FEE_BPS = 50;

export type DelegationState = { exists: boolean; amountPerPeriodRaw: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; periodLengthS: bigint };
export type Built = { tx: unknown; expectedOutRaw: bigint; minOutRaw: bigint; lookupTables: unknown[]; lastValidBlockHeight: bigint };
export type Simulation = { ok: boolean; err: unknown; logs: string[]; units: number };

/** Everything the run needs from the chain, injected so the run is unit-tested with fakes. */
export type Chain = {
  readDelegation(delegationPda: string): Promise<DelegationState>;
  usdcBalanceRaw(owner: string): Promise<bigint>;
  buildPlantingTx(a: { delegator: string; user: string; asset: Asset; pullRaw: bigint; feeBps: number; delegationPda: string }): Promise<Built>;
  simulatePlanting(built: Built): Promise<Simulation>;
  sendPlanting(built: Built): Promise<string>;
};

export type Planted = { wallet: string; asset: Asset; pullCents: number; signature: string };
export type Skipped = { wallet: string; reason: string };

/**
 * One daily run. For each active wallet: sum the unplanted round-ups; plant at the threshold or when the oldest swap is past the
 * 7-day rule; bound the pull by the on-chain limit left this period (fee included); pause on an empty USDC balance; pick the
 * asset from the allocation ledger; build, simulate, record, send, confirm, mark, bump. Wallets run eight at a time: sequential
 * runs take 5 to 10 s per wallet against Vercel's 300 s and Jupiter's 60 requests a minute, so the free stack serves the
 * 20 to 50 wallet beta and needs paid tiers somewhere past 100 wallets.
 */
export async function runPlanting(a: { repo: Repo; now: Date; chain: Chain }): Promise<{ planted: Planted[]; skipped: Skipped[] }> {
  const planted: Planted[] = [];
  const skipped: Skipped[] = [];

  await resumePausedWallets(a);

  const wallets = await a.repo.listActiveWallets();
  await mapWithConcurrency(wallets, CONCURRENCY, async (w) => {
    const outcome = await plantOne(a, w);
    if ("signature" in outcome) planted.push(outcome);
    else skipped.push(outcome);
  });
  return { planted, skipped };
}

async function resumePausedWallets(a: { repo: Repo; now: Date; chain: Chain }) {
  for (const w of await a.repo.listPausedWallets()) {
    const rules = rulesRowToRules(await a.repo.getRules(w.userPubkey));
    const need = BigInt(rules.plantThresholdCents + NETWORK_FEE_CENTS) * USDC_PER_CENT;
    if ((await a.chain.usdcBalanceRaw(w.pubkey)) >= need) {
      await a.repo.setWalletStatus(w.pubkey, "active");
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "resumed", detail: null });
    }
  }
}

async function plantOne(a: { repo: Repo; now: Date; chain: Chain }, w: WalletRow): Promise<Planted | Skipped> {
  const swaps = await a.repo.unplantedSwaps(w.pubkey);
  const pending = swaps.reduce((sum, s) => sum + s.roundupCents, 0);
  const rules = rulesRowToRules(await a.repo.getRules(w.userPubkey));
  const oldestMs = swaps.length ? Math.min(...swaps.map((s) => s.ts.getTime())) : a.now.getTime();
  const forced = a.now.getTime() - oldestMs >= rules.plantMaxDays * 86_400_000;
  if (pending <= 0 || (!forced && pending < rules.plantThresholdCents)) return { wallet: w.pubkey, reason: "below threshold" };

  const delegation = await a.chain.readDelegation(w.delegationPda);
  if (!delegation.exists) {
    await a.repo.setWalletStatus(w.pubkey, "revoked");
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "revoke_seen", detail: null });
    return { wallet: w.pubkey, reason: "revoked" };
  }

  const periodEndMs = Number(delegation.periodStartTs + delegation.periodLengthS) * 1000;
  const pulledThisPeriod = a.now.getTime() < periodEndMs ? Number(delegation.pulledInPeriodRaw / USDC_PER_CENT) : 0;
  const cap = Math.min(w.dailyCapCents, Number(delegation.amountPerPeriodRaw / USDC_PER_CENT));
  const left = capLeftCents(cap, pulledThisPeriod);
  const amount = plantAmountCents({ pendingCents: pending, capLeftCents: left, feeCents: NETWORK_FEE_CENTS, minCents: forced ? 0 : rules.plantThresholdCents });
  if (amount.pullCents === 0) return { wallet: w.pubkey, reason: left === 0 ? "cap reached" : "below threshold" };

  if ((await a.chain.usdcBalanceRaw(w.pubkey)) < BigInt(amount.pullCents) * USDC_PER_CENT) {
    await a.repo.setWalletStatus(w.pubkey, "paused");
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "paused_no_usdc", detail: { needCents: amount.pullCents } });
    return { wallet: w.pubkey, reason: "no usdc" };
  }

  const asset = pickAsset({ SKR: w.ledgerSkrCents, stORE: w.ledgerStoreCents }, rules.allocation);
  const built = await a.chain.buildPlantingTx({ delegator: w.pubkey, user: w.userPubkey, asset, pullRaw: BigInt(amount.pullCents) * USDC_PER_CENT, feeBps: FEE_BPS, delegationPda: w.delegationPda });
  const sim = await a.chain.simulatePlanting(built);
  if (!sim.ok) {
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { err: sim.err, logs: sim.logs.slice(-5) } });
    return { wallet: w.pubkey, reason: "simulation failed" };
  }

  const planting = await a.repo.insertPlanting(
    { userPubkey: w.userPubkey, walletPubkey: w.pubkey, signature: null, usdcPulledCents: amount.pullCents, networkFeeCents: NETWORK_FEE_CENTS, status: "sent", aiLine: null },
    [{ asset, usdcInCents: amount.changeCents, amountOutRaw: built.minOutRaw, staked: asset === "SKR", feeAmountRaw: (built.expectedOutRaw * BigInt(FEE_BPS)) / 10_000n }],
  );
  try {
    const signature = await a.chain.sendPlanting(built);
    await a.repo.setPlantingStatus(planting.id, "confirmed", signature);
    await a.repo.markPlanted(swaps.map((s) => s.signature), planting.id);
    await a.repo.bumpLedger(w.pubkey, asset, amount.changeCents);
    return { wallet: w.pubkey, asset, pullCents: amount.pullCents, signature };
  } catch (e) {
    await a.repo.setPlantingStatus(planting.id, "failed");
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { err: e instanceof Error ? e.message : String(e) } });
    return { wallet: w.pubkey, reason: "send failed" };
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}
