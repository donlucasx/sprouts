import type { Repo } from "@/db/repo";
import type { PlantingRow, WalletRow } from "@/db/types";
import { rulesRowToRules } from "@/db/types";
import { pickAsset, type Asset } from "@/domain/allocation";
import { capLeftCents, plantAmountCents } from "@/domain/cap";

/** The pass-through network fee, in cents, added to every pull and shown on the receipt. */
export const NETWORK_FEE_CENTS = 3;
const USDC_PER_CENT = 10_000n;
const CONCURRENCY = 8;
const FEE_BPS = 50;
/** After this many build failures in a row the run stops: that is a Jupiter or RPC outage, not a wallet problem. */
const OUTAGE_AFTER = 3;
/** A `sent` planting younger than this may still be in flight from a concurrent run; older ones are reconciled. */
const RECONCILE_AFTER_MS = 5 * 60_000;
/** A `sent` planting the chain has not seen after this long never landed (blockhashes live about a minute). */
const GIVE_UP_AFTER_MS = 30 * 60_000;

export type DelegationState = { exists: boolean; amountPerPeriodRaw: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; periodLengthS: bigint };
export type Built = { tx: unknown; signature: string; expectedOutRaw: bigint; minOutRaw: bigint; lookupTables: unknown[]; lastValidBlockHeight: bigint };
export type Simulation = { ok: boolean; err: unknown; logs: string[]; units: number };
export type SignatureStatus = "confirmed" | "failed" | "pending";

/** Everything the run needs from the chain, injected so the run is unit-tested with fakes. */
export type Chain = {
  readDelegation(delegationPda: string): Promise<DelegationState>;
  /** 0n when the wallet has no USDC account; throws on an RPC error (which must not read as "no USDC"). */
  usdcBalanceRaw(owner: string): Promise<bigint>;
  /** Builds and signs; the signature is known before anything is sent. */
  buildPlantingTx(a: { delegator: string; user: string; asset: Asset; pullRaw: bigint; feeBps: number; delegationPda: string }): Promise<Built>;
  simulatePlanting(built: Built): Promise<Simulation>;
  /** Sends and waits for confirmation; may throw after the transaction has landed (a dropped websocket), so the caller checks. */
  sendPlanting(built: Built): Promise<void>;
  signatureStatus(signature: string): Promise<SignatureStatus>;
  /** The user's position share count, read before a send and again after confirmation: what the planting minted [A16]. */
  readShares(user: string): Promise<bigint>;
  /** StakeConfig.share_price at 1e9 scale, for a planting booked late without a before-read. */
  sharePrice(): Promise<bigint>;
};

export type Planted = { wallet: string; asset: Asset; pullCents: number; signature: string };
export type Skipped = { wallet: string; reason: string };

/**
 * One daily run. First reconcile any planting left `sent` by an earlier run (confirmed on chain: book it; never landed: release its
 * round-ups). Then, for each active wallet: sum the unplanted round-ups; plant at the threshold or when the oldest swap is past the
 * 7-day rule; bound the pull by the lowest of the user's limit, the wallet's and the on-chain period allowance (fee included);
 * pause on an empty USDC balance; pick the asset from the allocation ledger; build, simulate, record the signed transaction,
 * claim the round-ups in one conditional statement, send, confirm, bump. Two overlapping runs cannot both pull the same round-ups:
 * the second claim finds nothing to claim. One wallet's failure is recorded and the run continues; three build failures in a row
 * stop the run. Wallets run eight at a time: sequential runs take 5 to 10 s per wallet against Vercel's 300 s and Jupiter's 60
 * requests a minute, so the free stack serves the 20 to 50 wallet beta and needs paid tiers somewhere past 100 wallets.
 */
export async function runPlanting(a: { repo: Repo; now: Date; chain: Chain }): Promise<{ planted: Planted[]; skipped: Skipped[] }> {
  const planted: Planted[] = [];
  const skipped: Skipped[] = [];

  await reconcileSentPlantings(a);
  await resumePausedWallets(a);

  const wallets = await a.repo.listActiveWallets();
  let buildFailures = 0;
  let stopped = false;
  await mapWithConcurrency(wallets, CONCURRENCY, async (w) => {
    if (stopped) {
      skipped.push({ wallet: w.pubkey, reason: "run stopped" });
      return;
    }
    const outcome = await plantOne(a, w);
    if ("signature" in outcome) {
      planted.push(outcome);
      buildFailures = 0;
      return;
    }
    skipped.push(outcome);
    if (outcome.reason === "build failed" && ++buildFailures >= OUTAGE_AFTER && !stopped) {
      stopped = true;
      console.error(`planting run stopped: ${OUTAGE_AFTER} build failures in a row (Jupiter or RPC outage); the rest wait for the next run`);
      await a.repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "run_stopped", detail: { after: OUTAGE_AFTER, lastWallet: w.pubkey } });
    }
  });
  return { planted, skipped };
}

/** A planting recorded as `sent` whose send threw: the chain decides whether it landed. */
async function reconcileSentPlantings(a: { repo: Repo; now: Date; chain: Chain }) {
  for (const p of await a.repo.listSentPlantings(new Date(a.now.getTime() - RECONCILE_AFTER_MS))) {
    if (!p.signature) continue;
    const status = await a.chain.signatureStatus(p.signature);
    if (status === "confirmed") {
      await bookConfirmed(a.repo, a.chain, p);
      console.error(`planting ${p.id} for ${p.walletPubkey} reconciled: confirmed on chain (${p.signature})`);
    } else if (status === "failed" || a.now.getTime() - p.ts.getTime() >= GIVE_UP_AFTER_MS) {
      await a.repo.setPlantingStatus(p.id, "failed");
      await a.repo.releaseSwaps(p.id);
      console.error(`planting ${p.id} for ${p.walletPubkey} reconciled: ${status === "failed" ? "failed on chain" : "never landed"}; round-ups released`);
    }
  }
}

/** The one place a planting becomes confirmed: status, the ledger from the recorded legs, then the shares it minted [A16]. */
async function bookConfirmed(repo: Repo, chain: Chain, p: PlantingRow) {
  await repo.setPlantingStatus(p.id, "confirmed");
  const legs = await repo.plantingLegs(p.id);
  for (const leg of legs) await repo.bumpLedger(p.walletPubkey, leg.asset, leg.usdcInCents);
  const after = await chain.readShares(p.userPubkey);
  const minted = p.sharesBefore === null ? await estimateMinted(chain, legs) : after - p.sharesBefore;
  await repo.setPlantingShares(p.id, { before: p.sharesBefore, after, minted });
}

/** A planting booked late, with no before-read (a row from before the share columns existed): the SKR leg at today's share price. */
async function estimateMinted(chain: Chain, legs: { asset: Asset; amountOutRaw: bigint }[]): Promise<bigint> {
  const skr = legs.filter((l) => l.asset === "SKR").reduce((s, l) => s + l.amountOutRaw, 0n);
  if (skr === 0n) return 0n;
  return (skr * 1_000_000_000n) / (await chain.sharePrice());
}

async function resumePausedWallets(a: { repo: Repo; now: Date; chain: Chain }) {
  for (const w of await a.repo.listPausedWallets()) {
    const rules = rulesRowToRules(await a.repo.getRules(w.userPubkey));
    const need = BigInt(rules.plantThresholdCents + NETWORK_FEE_CENTS) * USDC_PER_CENT;
    try {
      if ((await a.chain.usdcBalanceRaw(w.pubkey)) >= need) {
        await a.repo.setWalletStatus(w.pubkey, "active");
        await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "resumed", detail: null });
      }
    } catch (e) {
      console.error(`resume check for ${w.pubkey} skipped: ${message(e)}`);
    }
  }
}

async function plantOne(a: { repo: Repo; now: Date; chain: Chain }, w: WalletRow): Promise<Planted | Skipped> {
  try {
    return await plantOneOrThrow(a, w);
  } catch (e) {
    // Review I1: a Jupiter 400 or 429, a lookup-table fetch or a blockhash error on one wallet must not abort everyone's day.
    console.error(`planting for ${w.pubkey} failed before send: ${message(e)}`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "build", err: message(e) } });
    return { wallet: w.pubkey, reason: "build failed" };
  }
}

async function plantOneOrThrow(a: { repo: Repo; now: Date; chain: Chain }, w: WalletRow): Promise<Planted | Skipped> {
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
  // The lowest of the user's own limit (rules, adjustable in the app), the wallet's recorded cap and the on-chain allowance.
  const cap = Math.min(rules.dailyCapCents, w.dailyCapCents, Number(delegation.amountPerPeriodRaw / USDC_PER_CENT));
  const left = capLeftCents(cap, pulledThisPeriod);
  const amount = plantAmountCents({ pendingCents: pending, capLeftCents: left, feeCents: NETWORK_FEE_CENTS, minCents: forced ? 0 : rules.plantThresholdCents });
  if (amount.pullCents === 0) return { wallet: w.pubkey, reason: left === 0 ? "cap reached" : "below threshold" };

  // An RPC error here throws to plantOne ("build failed"); only a successful read that comes up short pauses the wallet.
  if ((await a.chain.usdcBalanceRaw(w.pubkey)) < BigInt(amount.pullCents) * USDC_PER_CENT) {
    await a.repo.setWalletStatus(w.pubkey, "paused");
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "paused_no_usdc", detail: { needCents: amount.pullCents } });
    return { wallet: w.pubkey, reason: "no usdc" };
  }

  const asset = pickAsset({ SKR: w.ledgerSkrCents, stORE: w.ledgerStoreCents }, rules.allocation);
  const built = await a.chain.buildPlantingTx({ delegator: w.pubkey, user: w.userPubkey, asset, pullRaw: BigInt(amount.pullCents) * USDC_PER_CENT, feeBps: FEE_BPS, delegationPda: w.delegationPda });
  const sim = await a.chain.simulatePlanting(built);
  if (!sim.ok) {
    console.error(`planting for ${w.pubkey} failed simulation: ${JSON.stringify(sim.err)} ${sim.logs.slice(-2).join(" | ")}`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "simulate", err: sim.err, logs: sim.logs.slice(-5) } });
    return { wallet: w.pubkey, reason: "simulation failed" };
  }

  // Record the signed transaction before it goes anywhere, then claim the round-ups in one conditional statement (review C1).
  // The share count right before the send: after confirmation the difference is what this planting minted [A16].
  const sharesBefore = await a.chain.readShares(w.userPubkey);
  const planting = await a.repo.insertPlanting(
    { userPubkey: w.userPubkey, walletPubkey: w.pubkey, signature: built.signature, usdcPulledCents: amount.pullCents, networkFeeCents: NETWORK_FEE_CENTS, status: "sent", aiLine: null, sharesBefore, ts: a.now },
    [{ asset, usdcInCents: amount.changeCents, amountOutRaw: built.minOutRaw, staked: asset === "SKR", feeAmountRaw: (built.expectedOutRaw * BigInt(FEE_BPS)) / 10_000n }],
  );
  const claimed = await a.repo.claimSwaps(swaps.map((s) => s.signature), planting.id);
  if (claimed !== swaps.length) {
    // Another run got there first: give back whatever this one took and let that run finish.
    await a.repo.releaseSwaps(planting.id);
    await a.repo.setPlantingStatus(planting.id, "failed");
    return { wallet: w.pubkey, reason: "claimed elsewhere" };
  }

  try {
    await a.chain.sendPlanting(built);
  } catch (e) {
    // The send threw, which is not the same as the transaction failing: ask the chain.
    const status = await a.chain.signatureStatus(built.signature).catch(() => "pending" as const);
    if (status === "failed") {
      console.error(`planting for ${w.pubkey} failed on chain: ${message(e)}`);
      await a.repo.setPlantingStatus(planting.id, "failed");
      await a.repo.releaseSwaps(planting.id);
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "send", err: message(e) } });
      return { wallet: w.pubkey, reason: "send failed" };
    }
    if (status === "pending") {
      // Left as `sent` with its round-ups claimed; the next run reconciles it by signature instead of pulling again.
      console.error(`planting for ${w.pubkey} sent but unconfirmed (${built.signature}): ${message(e)}; reconciled next run`);
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "confirm", err: message(e), signature: built.signature } });
      return { wallet: w.pubkey, reason: "send unknown" };
    }
  }
  await bookConfirmed(a.repo, a.chain, planting);
  return { wallet: w.pubkey, asset, pullCents: amount.pullCents, signature: built.signature };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}
