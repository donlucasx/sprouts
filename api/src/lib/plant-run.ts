import type { Repo } from "@/db/repo";
import type { PlantingLegRow, PlantingRow, WalletRow } from "@/db/types";
import { rulesRowToRules } from "@/db/types";
import { pickAsset, type Asset } from "@/domain/allocation";
import { dayOf } from "@/domain/day";
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
  buildPlantingTx(a: { delegator: string; user: string; asset: Asset; pullRaw: bigint; feeBps: number; delegationPda: string; skrCarryRaw?: bigint }): Promise<Built>;
  simulatePlanting(built: Built): Promise<Simulation>;
  /** Sends and waits for confirmation; may throw after the transaction has landed (a dropped websocket), so the caller checks. */
  sendPlanting(built: Built): Promise<void>;
  signatureStatus(signature: string): Promise<SignatureStatus>;
  /** The user's position share count, read before a send and again after confirmation: what the planting minted [A16]. */
  readShares(user: string): Promise<bigint>;
  /** StakeConfig.share_price at 1e9 scale, for a planting booked late without a before-read, and for what an SKR leg landed [R141]. */
  sharePrice(): Promise<bigint>;
  /** The Seed Vault wallet's balance of a wallet coin (every coin but SKR), 0n with no account; throws on an RPC error. Read before a send and after confirmation: what the planting delivered [R141]. */
  assetBalanceRaw(owner: string, asset: Asset): Promise<bigint>;
  /** The puller's SKR change inside one confirmed transaction (swap in, stake out), from that transaction's own balances [R207 #2]. */
  pullerSkrChangeRaw(signature: string): Promise<bigint>;
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
 * stop the run. Users run eight at a time, each user's wallets in series (the balance and share reads around a send are per Seed
 * Vault [A16, R141]): sequential runs take 5 to 10 s per wallet against Vercel's 300 s and Jupiter's 60 requests a minute, so the
 * free stack serves the 20 to 50 wallet beta and needs paid tiers somewhere past 100 wallets.
 */
export async function runPlanting(a: { repo: Repo; now: Date; chain: Chain }): Promise<{ planted: Planted[]; skipped: Skipped[] }> {
  const planted: Planted[] = [];
  const skipped: Skipped[] = [];

  await reconcileSentPlantings(a);
  await resumePausedWallets(a);

  const wallets = await a.repo.listActiveWallets();
  let buildFailures = 0;
  let stopped = false;
  const plantWallet = async (w: WalletRow) => {
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
  };
  // One Seed Vault's wallets run in series: the share count and the coin balance are read per user before a send and after
  // confirmation, so two wallets of one user planting the same coin at once would each count the other's delivery (review I1).
  const byUser = new Map<string, WalletRow[]>();
  for (const w of wallets) byUser.set(w.userPubkey, [...(byUser.get(w.userPubkey) ?? []), w]);
  await mapWithConcurrency([...byUser.values()], CONCURRENCY, async (group) => {
    for (const w of group) await plantWallet(w);
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

/** The one place a planting becomes confirmed: status, the ledger from the recorded legs, the shares it minted [A16], then what each leg landed [R141]. */
async function bookConfirmed(repo: Repo, chain: Chain, p: PlantingRow, outBefore: bigint | null = null) {
  await repo.setPlantingStatus(p.id, "confirmed");
  const legs = await repo.plantingLegs(p.id);
  for (const leg of legs) await repo.bumpLedger(p.walletPubkey, leg.asset, leg.usdcInCents);
  const after = await chain.readShares(p.userPubkey);
  const minted = p.sharesBefore === null ? await estimateMinted(chain, legs) : after - p.sharesBefore;
  await repo.setPlantingShares(p.id, { before: p.sharesBefore, after, minted });
  await recordLanded(repo, chain, p, legs, minted, outBefore);
  await recordSkrSurplus(repo, chain, p, legs);
}

/**
 * Security audit R207 #2, spec 3.2 step 4: the stake takes the quote's minimum (plus the user's carried remainder), so what the swap
 * delivered above the minimum stays in the puller's account. It is recorded against THIS planting, hence this user, as
 * surplus = the puller's SKR change in this transaction + the carry its stake drew, and the user's next SKR stake adds it. Read from
 * the transaction by signature, so concurrent plantings of other users in the same account do not mix in; written once (a second
 * booking cannot add it twice). A failed read leaves it unrecorded and says so: the remainder then stays with the puller, never
 * with another user.
 */
async function recordSkrSurplus(repo: Repo, chain: Chain, p: PlantingRow, legs: PlantingLegRow[]) {
  if (!p.signature || !legs.some((l) => l.asset === "SKR")) return;
  try {
    const surplus = (await chain.pullerSkrChangeRaw(p.signature)) + p.skrCarryInRaw;
    if (surplus < 0n) {
      console.error(`planting ${p.id}: SKR surplus ${surplus} is below zero (the swap delivered under the minimum?); nothing carried`);
      return;
    }
    await repo.setPlantingSkrSurplus(p.id, surplus);
  } catch (e) {
    console.error(`planting ${p.id}: the SKR remainder could not be read (${message(e)}); it is not carried`);
  }
}

/**
 * R141: each leg's amount becomes what landed, not the quote's minimum. The SKR leg from its minted shares at the share price (the
 * stake is its destination); a wallet coin from its balance read before the send and again now. A missing or failed read, or a
 * change that is not above zero, leaves the quote and says so in the log; nothing here can interrupt the booking.
 */
async function recordLanded(repo: Repo, chain: Chain, p: PlantingRow, legs: PlantingLegRow[], minted: bigint, outBefore: bigint | null) {
  for (const leg of legs) {
    try {
      let landed: bigint;
      if (leg.asset === "SKR") {
        if (p.sharesBefore === null) continue; // minted was itself estimated from the quote (a row from before the share columns)
        landed = (minted * (await chain.sharePrice())) / 1_000_000_000n;
      } else if (outBefore === null) {
        console.error(`planting ${p.id}: no ${leg.asset} balance from before the send; the quote stands`);
        continue;
      } else {
        landed = (await chain.assetBalanceRaw(p.userPubkey, leg.asset)) - outBefore;
      }
      if (landed <= 0n) {
        console.error(`planting ${p.id}: ${leg.asset} landed ${landed}, not above zero; the quote stands`);
        continue;
      }
      await repo.setLegAmountOut(p.id, leg.asset, landed);
    } catch (e) {
      console.error(`planting ${p.id}: what ${leg.asset} landed could not be read (${message(e)}); the quote stands`);
    }
  }
}

/** A planting booked late, with no before-read (a row from before the share columns existed): the SKR leg at today's share price. */
async function estimateMinted(chain: Chain, legs: { asset: Asset; amountOutRaw: bigint }[]): Promise<bigint> {
  const skr = legs.filter((l) => l.asset === "SKR").reduce((s, l) => s + l.amountOutRaw, 0n);
  if (skr === 0n) return 0n;
  return (skr * 1_000_000_000n) / (await chain.sharePrice());
}

/**
 * A wallet the RUN paused for want of USDC comes back once the USDC is there. A wallet the USER paused never does: only their own
 * signed resume ends it (R84). One status serves both, so the cause is read from the wallet's newest pause or resume event: only
 * `paused_no_usdc` resumes; a user pause, or a pause with no event (one made before user pauses were recorded, after a resume),
 * stays paused, failing closed (security audit R207, HIGH).
 */
async function pausedForNoUsdc(repo: Repo, w: WalletRow): Promise<boolean> {
  const events = await repo.listEvents(w.userPubkey, ["paused_no_usdc", "paused_by_user", "resumed"], 200);
  return events.find((e) => e.walletPubkey === w.pubkey)?.kind === "paused_no_usdc";
}

/** R207: the user's own newest word on a wallet is a pause (a run's resume, detail null, does not count against it). */
async function userPauseStands(repo: Repo, w: WalletRow): Promise<boolean> {
  const events = await repo.listEvents(w.userPubkey, ["paused_by_user", "resumed"], 200);
  const mine = events.find((e) => e.walletPubkey === w.pubkey && (e.kind === "paused_by_user" || (e.detail as { by?: string } | null)?.by === "user"));
  return mine?.kind === "paused_by_user";
}

async function resumePausedWallets(a: { repo: Repo; now: Date; chain: Chain }) {
  for (const w of await a.repo.listPausedWallets()) {
    if (!(await pausedForNoUsdc(a.repo, w))) continue;
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

  // R207: the run listed this wallet as active at its start; a pause made since, or a run resume racing a user pause, must not pull.
  // Read again just before the pull: still active, and the user's newest word on it is not a pause.
  const now = await a.repo.getWallet(w.pubkey);
  if (now?.status !== "active" || (await userPauseStands(a.repo, w))) {
    if (now?.status === "active") await a.repo.setWalletStatus(w.pubkey, "paused");
    return { wallet: w.pubkey, reason: "paused" };
  }

  // An RPC error here throws to plantOne ("build failed"); only a successful read that comes up short pauses the wallet.
  if ((await a.chain.usdcBalanceRaw(w.pubkey)) < BigInt(amount.pullCents) * USDC_PER_CENT) {
    await a.repo.setWalletStatus(w.pubkey, "paused");
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "paused_no_usdc", detail: { needCents: amount.pullCents } });
    return { wallet: w.pubkey, reason: "no usdc" };
  }

  // R207 #2: this user's SKR remainder from earlier plantings rides on an SKR stake. A failed read carries nothing (fail closed).
  let credit = 0n;
  try {
    credit = await a.repo.skrCreditRaw(w.userPubkey);
  } catch (e) {
    console.error(`planting for ${w.pubkey}: the SKR remainder could not be read (${message(e)}); nothing carried today`);
  }
  const carryFor = (asset: Asset) => (asset === "SKR" && credit > 0n ? credit : 0n);

  let asset = pickAsset(w.ledgerCents, rules.allocation);
  const attempt = async (asset: Asset) => {
    const carry = carryFor(asset);
    const built = await a.chain.buildPlantingTx({ delegator: w.pubkey, user: w.userPubkey, asset, pullRaw: BigInt(amount.pullCents) * USDC_PER_CENT, feeBps: FEE_BPS, delegationPda: w.delegationPda, ...(carry > 0n ? { skrCarryRaw: carry } : {}) });
    return { built, sim: await a.chain.simulatePlanting(built) };
  };
  let { built, sim } = await attempt(asset).then((r) => {
    if (asset !== "SKR" && !r.sim.ok) throw new Error(`simulation: ${JSON.stringify(r.sim.err)} ${r.sim.logs.slice(-2).join(" | ")}`);
    return r;
  }).catch(async (e: unknown) => {
    // A non-SKR leg that will not build or simulate must not freeze the wallet (the picker would choose it again tomorrow) nor
    // count toward the outage stop: plant SKR today and say which coin fell back (spec 7.3; the ORE plan's finding 4, generalised).
    if (asset === "SKR") throw e;
    console.error(`${asset} leg for ${w.pubkey} failed (${message(e)}); planting SKR instead`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "leg_fallback", detail: { asset, err: message(e) } });
    asset = "SKR";
    return attempt(asset);
  });
  if (!sim.ok) {
    console.error(`planting for ${w.pubkey} failed simulation: ${JSON.stringify(sim.err)} ${sim.logs.slice(-2).join(" | ")}`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "simulate", err: sim.err, logs: sim.logs.slice(-5) } });
    return { wallet: w.pubkey, reason: "simulation failed" };
  }

  // Record the signed transaction before it goes anywhere, then claim the round-ups in one conditional statement (review C1).
  // The share count right before the send: after confirmation the difference is what this planting minted [A16].
  const sharesBefore = await a.chain.readShares(w.userPubkey);
  // R141: a wallet coin's destination balance right before the send; after confirmation the difference is what landed.
  let outBefore: bigint | null = null;
  if (asset !== "SKR") {
    try {
      outBefore = await a.chain.assetBalanceRaw(w.userPubkey, asset);
    } catch (e) {
      console.error(`planting for ${w.pubkey}: the ${asset} balance before the send could not be read (${message(e)}); the quote stands`);
    }
  }
  // The coin's rate on the day it was planted, for "earned" per coin (spec 7.6); null before the first snapshot.
  const rateAtPlanting = (await a.repo.getCoinDay(dayOf(a.now), asset))?.rate ?? null;
  const planting = await a.repo.insertPlanting(
    { userPubkey: w.userPubkey, walletPubkey: w.pubkey, signature: built.signature, usdcPulledCents: amount.pullCents, networkFeeCents: NETWORK_FEE_CENTS, status: "sent", aiLine: null, sharesBefore, ts: a.now, ...(carryFor(asset) > 0n ? { skrCarryInRaw: carryFor(asset) } : {}) },
    [{ asset, usdcInCents: amount.changeCents, amountOutRaw: built.minOutRaw, staked: asset === "SKR", feeAmountRaw: 0n, feeCents: Math.round((amount.pullCents * FEE_BPS) / 10_000), rateAtPlanting }],
  );
  // R207 #2: the carry is reserved by the row just written; if another run spent the same remainder meanwhile, the user's credit is
  // now below zero and this planting stands down before claiming or sending (a failed read stands down too).
  if (planting.skrCarryInRaw > 0n && (await a.repo.skrCreditRaw(w.userPubkey).catch(() => -1n)) < 0n) {
    await a.repo.setPlantingStatus(planting.id, "failed");
    return { wallet: w.pubkey, reason: "claimed elsewhere" };
  }
  const claimed = await a.repo.claimSwaps(swaps.map((s) => s.signature), planting.id);
  if (claimed !== swaps.length) {
    // Another run got there first: give back whatever this one took and let that run finish.
    await a.repo.releaseSwaps(planting.id);
    await a.repo.setPlantingStatus(planting.id, "failed");
    return { wallet: w.pubkey, reason: "claimed elsewhere" };
  }

  // From here the transaction may be on chain: an error (a database write, the confirm, the share read) is "send unknown",
  // never "build failed" (09-29), so it does not count toward the outage stop; the row stays `sent` for the next run to reconcile.
  try {
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
    await bookConfirmed(a.repo, a.chain, planting, outBefore);
    return { wallet: w.pubkey, asset, pullCents: amount.pullCents, signature: built.signature };
  } catch (e) {
    console.error(`planting for ${w.pubkey} sent (${built.signature}), booking interrupted: ${message(e)}; reconciled next run`);
    return { wallet: w.pubkey, reason: "send unknown" };
  }
}

/** The error's message, plus its cause when it has one: Node's "fetch failed" keeps the host and the reason only in the cause. */
function message(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause instanceof Error ? e.cause.message : e.cause !== undefined ? String(e.cause) : "";
  return cause ? `${e.message} (${cause})` : e.message;
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}
