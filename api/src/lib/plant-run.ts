import type { Address } from "@solana/kit";
import type { Repo } from "@/db/repo";
import type { CarryKind, PlantingLegRow, PlantingRow, VenueDayRow, WalletRow } from "@/db/types";
import { rulesRowToRules } from "@/db/types";
import { pickAsset, type Asset } from "@/domain/allocation";
import { ASSETS, COINS, LEND_ASSETS, isLendAsset, type LendAsset, type LiveAsset } from "@/domain/coins";
import { addDays, dayOf } from "@/domain/day";
import { capLeftCents, plantAmountCents } from "@/domain/cap";
import { redistributeDisabled } from "@/domain/split";
import { lendingUsdByProtocol } from "./user-routing";
import { errorText } from "./redact";
export { lendingUsdByProtocol } from "./user-routing";
import { AUTO_VENUES, VENUE_PROTOCOL, pickVenue, venueCandidates, type AutoVenue, type Protocol } from "@/domain/venues";
import { LEASH_PROGRAM } from "./constants";
import { enabledLegs, leashAllowedVenues, leashLegOf, leashLive, LEASH_ERRORS, LEG_SPEC, postedPriceRefusal, skrPriceSource, type LeashConfig, type LeashLegByte } from "./leash";
import type { ParsedPrice } from "./pyth";
import { klendDeliveryShortfall } from "./venues/klend";
import { jlendDeliveryShortfall } from "./venues/jlend";

/**
 * Cents added to a pull on top of the change: 0. Sprouts pays the network fee (Terms 2026-10-07). Until 10-06 this was 3 and the
 * receipt called it a "network fee", but the whole pull was planted (planting.ts: "not withheld"), so it was never a fee
 * (audits/fee-model). The leash floor would refuse a withheld flat fee at small pulls anyway; Sprouts' only fee is the 0.5%.
 */
export const NETWORK_FEE_CENTS = 0;
const USDC_PER_CENT = 10_000n;
const CONCURRENCY = 8;
/** After this many build failures in a row the run stops: that is a Jupiter or RPC outage, not a wallet problem. */
const OUTAGE_AFTER = 3;
/** A `sent` planting younger than this may still be in flight from a concurrent run; older ones are reconciled. */
const RECONCILE_AFTER_MS = 5 * 60_000;
/** A `sent` planting the chain has not seen after this long never landed (blockhashes live about a minute). */
const GIVE_UP_AFTER_MS = 30 * 60_000;
/**
 * T8/T9 carry (Task 11): the run waits for each price FEED at most once, all feeds at the same time, for at most this long; builds
 * then pass waitS 0 and the price is checked again right before each send. 60 s against the cron's maxDuration of 300 s (the
 * snapshot, the decision and the planting itself need the rest); measured 10-04, SOL/ORE update every 50-55 s.
 */
export const PRICE_WAIT_S = 60;
/**
 * Task 11 review I2 (fix round 1): with a 40 s usable window (max age 60 - 20 margin) and SOL/ORE updates every 50-55 s, a no-wait
 * check lands in the stale tail about a quarter of the time. So, unless the feed's run-level wait failed (a dead feed fails fast):
 * before the build the leg waits up to PRE_BUILD_WAIT_S for a price with BUILD_HEADROOM_S of freshness to spare (the builder's own
 * no-wait read comes a moment later), and right before the send up to PRE_SEND_WAIT_S (the planting is claimed, nothing is sent
 * yet). Both are cut to what is left of the run deadline. 20 s and 15 s cover one update gap from the stale points they start at.
 */
export const PRE_BUILD_WAIT_S = 20;
export const PRE_SEND_WAIT_S = 15;
export const BUILD_HEADROOM_S = 5;
/**
 * Review M1: the planting run starts no new wallet after this point, so the withdraw crank, the stake reconcile, the cleanup and the
 * keepalive always run inside the cron's 300 s. The route passes its own start + 240 s; alone, the run allows itself 200 s.
 */
export const RUN_BUDGET_MS = 200_000;
/** The leash's SettleMismatch (contracts 2.5): the receipt changed between the build's read of `pre` and the pull. */
const SETTLE_MISMATCH = 6007;

export type DelegationState = { exists: boolean; amountPerPeriodRaw: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; periodLengthS: bigint };
/**
 * `usdcFloat`, `wsolFloat` and `skrFloat` name the puller's pooled accounts the guards bound, all in `watched`, on every leg (T9 review
 * I2, Task 11 review I1): each may fall by at most this leg's own carry of that kind. `skrFloat` is null on an SKR leg (it is the
 * delivery account there).
 */
export type Built = { tx: unknown; signature: string; expectedOutRaw: bigint; minOutRaw: bigint; lookupTables: unknown[]; lastValidBlockHeight: bigint;
  asset?: LiveAsset; venue?: AutoVenue | null; leg?: number | null; watched?: string[]; usdcFloat?: string; wsolFloat?: string | null; skrFloat?: string | null; pullerJl?: string | null; jlLeftover?: bigint | null; cleanup?: unknown[];
  /** A posted price as re-read after its pre-txs landed (SKR, contracts 10 item 15): judged again right before the send. */
  postedPrice?: ParsedPrice | null };
export type LendPosition = { asset: LendAsset; venue: AutoVenue; receiptRaw: bigint };
export type PriceCfg = { confCapBps: number; maxAgeS: number };
/** `delivery`: the balance of the account the planting delivers to (SKR: the puller's own SKR account; a wallet coin: the user's) right before the simulation and after it [R207 review]. */
export type Simulation = { ok: boolean; err: unknown; logs: string[]; units: number; delivery?: { pre: bigint; post: bigint }; watched?: Record<string, { pre: bigint | null; post: bigint | null }> };
export type SignatureStatus = "confirmed" | "failed" | "pending";

/** Everything the run needs from the chain, injected so the run is unit-tested with fakes. */
export type Chain = {
  readDelegation(delegationPda: string): Promise<DelegationState>;
  /** 0n when the wallet has no USDC account; throws on an RPC error (which must not read as "no USDC"). */
  usdcBalanceRaw(owner: string): Promise<bigint>;
  /** Builds and signs; the signature is known before anything is sent. `priceOpts`: a leashed priced leg's on-chain conf cap and max age, waitS 0. */
  buildPlantingTx(a: { delegator: string; user: string; asset: LiveAsset; venue: AutoVenue | null; pullRaw: bigint; delegationPda: string; leashed: boolean;
    carryIn: Partial<Record<CarryKind, bigint>>; jlLeftover?: 0n | 1n; priceOpts?: PriceCfg & { waitS: number } }): Promise<Built>;
  simulatePlanting(built: Built): Promise<Simulation>;
  /** Sends and waits for confirmation; may throw after the transaction has landed (a dropped websocket), so the caller checks. */
  sendPlanting(built: Built): Promise<void>;
  signatureStatus(signature: string): Promise<SignatureStatus>;
  /** The user's position share count, read before a send and again after confirmation: what the planting minted [A16]. */
  readShares(user: string): Promise<bigint>;
  /** StakeConfig.share_price at 1e9 scale, for a planting booked late without a before-read, and for what an SKR leg landed [R141]. */
  sharePrice(): Promise<bigint>;
  /** The Seed Vault wallet's balance of a wallet coin, or of a lending leg's receipt at its venue, 0n with no account; throws on an RPC error. Read before a send and after confirmation: what the planting delivered [R141]. */
  assetBalanceRaw(owner: string, asset: LiveAsset, venue: AutoVenue | null): Promise<bigint>;
  /** The puller's SKR change inside one confirmed transaction (swap in, stake out), from that transaction's own balances [R207 #2]. */
  pullerSkrChangeRaw(signature: string): Promise<bigint>;
  /** The leash Config account (contracts 3.1: the enabled flags and each leg's conf cap and max age come from chain); null when unreadable. */
  readLeashConfig(): Promise<LeashConfig | null>;
  /** The user's lending receipts (both assets, both venues), only those above zero. */
  lendingPositions(user: string): Promise<LendPosition[]>;
  /** The puller's WSOL or USDC change inside one confirmed transaction (R295 carry). */
  pullerCarryChangeRaw(signature: string, kind: "WSOL" | "USDC"): Promise<bigint>;
  /** After the planting, or for any build that is not sent: reclaim a posted price's rent (best effort; a no-op without one). */
  cleanup(built: Built): Promise<void>;
  /** Resolves when the leg's price is usable under `cfg` (polling up to `waitS`); throws otherwise. Leg 0 (SKR): resolves at once when
   *  PYTH_API_KEY is set (its price is posted in the build), else throws (no source, R324). */
  priceFresh(leg: number, cfg: PriceCfg, waitS: number): Promise<void>;
};

export type Planted = { wallet: string; asset: LiveAsset; pullCents: number; signature: string };
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
export async function runPlanting(a: { repo: Repo; now: Date; chain: Chain; deadlineMs?: number }): Promise<{ planted: Planted[]; skipped: Skipped[] }> {
  const planted: Planted[] = [];
  const skipped: Skipped[] = [];
  const deadline = a.deadlineMs ?? Date.now() + RUN_BUDGET_MS;

  await reconcileSentPlantings(a);
  await resumePausedWallets(a);

  // Read once per run (T8 carry): the leash config, today's and yesterday's venue rows, the lending prices.
  const day = dayOf(a.now);
  const leash = await a.chain.readLeashConfig().catch((e) => { console.error(`leash config unreadable: ${message(e)}`); return null; });
  const wallets = await a.repo.listActiveWallets();
  const ctx: RunCtx = {
    leash,
    venueDays: await a.repo.listVenueDays(day),
    yesterday: await a.repo.listVenueDays(addDays(day, -1)),
    prices: { USDC_LEND: (await a.repo.getCoinDay(day, "USDC_LEND"))?.priceUsd ?? null, SOL_LEND: (await a.repo.getCoinDay(day, "SOL_LEND"))?.priceUsd ?? null },
    gate: startPriceWaits(a.chain, leash, wallets.some((w) => w.linkModel === "leash"), deadline),
    deadline,
  };
  let pastDeadline = 0;
  let buildFailures = 0;
  let stopped = false;
  const plantWallet = async (w: WalletRow) => {
    if (stopped) {
      skipped.push({ wallet: w.pubkey, reason: "run stopped" });
      return;
    }
    if (Date.now() >= deadline) {
      pastDeadline++;
      skipped.push({ wallet: w.pubkey, reason: "run deadline" });
      return;
    }
    const outcome = await plantOne(a, w, ctx);
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
  if (pastDeadline) console.error(`planting run deadline reached: ${pastDeadline} wallet(s) not started (${skipped.filter((x) => x.reason === "run deadline").map((x) => x.wallet).join(", ")}); they wait for the next run`);
  return { planted, skipped };
}

type RunCtx = { leash: LeashConfig | null; venueDays: VenueDayRow[]; yesterday: VenueDayRow[]; prices: Partial<Record<LendAsset, number | null>>; gate: (leg: LeashLegByte) => Promise<boolean>; deadline: number };

/** Seconds left of `want`, cut to the run deadline. */
const waitWithin = (want: number, deadline: number) => Math.max(0, Math.min(want, Math.floor((deadline - Date.now()) / 1000)));

/**
 * T8/T9 carry: one wait per price FEED per run, every feed at once, started before the first wallet (only when a leashed wallet is
 * active). A feed's wait uses the strictest conf cap and max age among its enabled legs, so a price fresh for it is fresh for all.
 * A wait that runs out is logged, not thrown, and marks the feed dead for the run (false): its legs then check without waiting
 * (fail fast). A live feed's legs get the bounded waits (review I2).
 */
function startPriceWaits(chain: Chain, leash: LeashConfig | null, anyLeashed: boolean, deadline: number): (leg: LeashLegByte) => Promise<boolean> {
  const waits = new Map<string, Promise<boolean>>();
  if (leash && anyLeashed) {
    const byFeed = new Map<string, { leg: LeashLegByte; cfg: PriceCfg }>();
    for (const leg of enabledLegs(leash)) {
      const feed = LEG_SPEC[leg].feed;
      if (!feed || feed === "SKR") continue;   // SKR is posted per planting (or has no source without a key): no account to wait for
      const l = leash.legs[leg];
      const cur = byFeed.get(feed);
      byFeed.set(feed, cur ? { leg: cur.leg, cfg: { confCapBps: Math.min(cur.cfg.confCapBps, l.confCapBps), maxAgeS: Math.min(cur.cfg.maxAgeS, l.maxAgeS) } } : { leg, cfg: { confCapBps: l.confCapBps, maxAgeS: l.maxAgeS } });
    }
    for (const [feed, { leg, cfg }] of byFeed) {
      waits.set(feed, chain.priceFresh(leg, cfg, waitWithin(PRICE_WAIT_S, deadline)).then(() => true, (e) => {
        console.error(`price wait for the ${feed} feed ended unusable (${message(e)}); its legs check without waiting this run`);
        return false;
      }));
    }
  }
  return (leg) => waits.get(LEG_SPEC[leg].feed ?? "") ?? Promise.resolve(true);
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
  let legs: PlantingLegRow[] | null = null;
  try {
    legs = await repo.plantingLegs(p.id);
    for (const leg of legs) await repo.bumpLedger(p.walletPubkey, leg.asset as LiveAsset, leg.usdcInCents);
    const after = await chain.readShares(p.userPubkey);
    const minted = p.sharesBefore === null ? await estimateMinted(chain, legs) : after - p.sharesBefore;
    await repo.setPlantingShares(p.id, { before: p.sharesBefore, after, minted });
    await recordLanded(repo, chain, p, legs, minted, outBefore);
  } finally {
    // Review M9: the row is `confirmed` now, so the reconciler never books it again: the carry it drew stays debited, and its
    // surplus must be credited even when a step above threw (each recorder catches its own errors).
    const l = legs ?? (await repo.plantingLegs(p.id).catch(() => [] as PlantingLegRow[]));
    await recordSkrSurplus(repo, chain, p, l);
    await recordCarrySurplus(repo, chain, p, l);
  }
}

/**
 * R295: the WSOL or USDC a lending planting left with the puller (swap slippage, Jupiter Lend's max_assets slack), credited once to
 * this user: surplus = the puller's change of that kind in this transaction + the carry this planting drew. Written after
 * confirmation only, once (a second booking cannot add it twice); the carry drawn is the planting's own row, so a rebuild before
 * the send never counts twice.
 */
async function recordCarrySurplus(repo: Repo, chain: Chain, p: PlantingRow, legs: PlantingLegRow[]) {
  const asset = legs[0]?.asset;
  const kind = asset === "SOL_LEND" ? "WSOL" : asset === "USDC_LEND" ? "USDC" : null;
  if (!p.signature || !kind) return;
  try {
    const surplus = (await chain.pullerCarryChangeRaw(p.signature, kind)) + ((await repo.plantingCarry(p.id))[kind] ?? 0n);
    if (surplus < 0n) {
      console.error(`planting ${p.id}: ${kind} surplus ${surplus} is below zero; nothing carried`);
      return;
    }
    await repo.setPlantingSurplus(p.id, kind, surplus);
  } catch (e) {
    console.error(`planting ${p.id}: the ${kind} remainder could not be read (${message(e)}); it is not carried`);
  }
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
        landed = (await chain.assetBalanceRaw(p.userPubkey, leg.asset as LiveAsset, leg.venue)) - outBefore;
      }
      if (landed <= 0n) {
        console.error(`planting ${p.id}: ${leg.asset} landed ${landed}, not above zero; the quote stands`);
        continue;
      }
      await repo.setLegAmountOut(p.id, leg.asset as LiveAsset, landed);
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

/**
 * R207 review: the stake draws minimum + carry from the puller's pooled SKR account, which also holds other users' remainders, so
 * a swap that delivered short (or elsewhere) would be covered from their money and still simulate fine. The simulation's own
 * balances bind it: for SKR the puller's account may fall by at most this user's carry (the swap delivered at least the minimum
 * the stake takes); for a wallet coin the user's account must gain at least the minimum. A simulation without the balances fails
 * closed. Returns why the planting is refused, or null.
 */
export function deliveryShortfall(sim: Simulation, built: Built, asset: Asset, carryRaw: bigint): string | null {
  if (!sim.delivery) return "the simulation returned no delivery balance";
  const change = sim.delivery.post - sim.delivery.pre;
  if (asset === "SKR") return change >= -carryRaw ? null : `the puller's SKR fell by ${-change}, more than this user's carry of ${carryRaw}`;
  return change >= built.minOutRaw ? null : `the destination gained ${change}, under the minimum ${built.minOutRaw}`;
}

/** Contracts 3.3: a pooled puller float (USDC pull receiver, WSOL swap output) may fall by at most this user's carry; no balance fails closed. */
export function floatShortfall(sim: Simulation, account: string | undefined | null, carryRaw: bigint, label: string): string | null {
  if (!account || !sim.watched || !(account in sim.watched)) return `the simulation returned no ${label} balance`;
  const w = sim.watched[account];
  const change = (w.post ?? 0n) - (w.pre ?? 0n);
  return change >= -carryRaw ? null : `the puller's ${label} fell by ${-change}, more than this user's carry of ${carryRaw}`;
}
export const wsolCarryShortfall = (sim: Simulation, built: Built, carryRaw: bigint) => floatShortfall(sim, built.wsolFloat, carryRaw, "WSOL");
/** USDC lending draws the user's USDC carry from the pooled pull receiver; every swap leg passes 0: the swap may spend only the pull (T9 review I2). */
export const usdcCarryShortfall = (sim: Simulation, built: Built, carryRaw: bigint) => floatShortfall(sim, built.usdcFloat, carryRaw, "USDC");
export const skrCarryShortfall = (sim: Simulation, built: Built, carryRaw: bigint) => floatShortfall(sim, built.skrFloat, carryRaw, "SKR");

/**
 * Task 11 review I1: all three pooled floats on every leg. Each may fall by at most this leg's own carry of that kind (USDC lending:
 * its USDC carry; SOL lending: its WSOL carry), 0 otherwise, so a route cannot spend another user's SKR or WSOL remainder as its
 * input, nor close the wSOL. On an SKR leg the SKR float is the delivery account, bounded by deliveryShortfall.
 */
export function floatsShortfall(sim: Simulation, built: Built, asset: LiveAsset, carry: Partial<Record<CarryKind, bigint>>): string | null {
  return usdcCarryShortfall(sim, built, asset === "USDC_LEND" ? (carry.USDC ?? 0n) : 0n)
    ?? wsolCarryShortfall(sim, built, asset === "SOL_LEND" ? (carry.WSOL ?? 0n) : 0n)
    ?? (asset === "SKR" ? null : skrCarryShortfall(sim, built, 0n));
}

/** Every leg's guard (contracts 3.3): the venue's delivery guard (or the coin / SKR one), then the floats its deposit or swap draws on. */
export function legShortfall(sim: Simulation, built: Built, asset: LiveAsset, venue: AutoVenue | null, carry: Partial<Record<CarryKind, bigint>>): string | null {
  if (venue) {
    const d = venue === "kamino_klend" ? klendDeliveryShortfall(sim, built) : jlendDeliveryShortfall(sim, { minOutRaw: built.minOutRaw, pullerJl: (built.pullerJl ?? null) as Address | null });
    if (d) return d;
    return floatsShortfall(sim, built, asset, carry);
  }
  return deliveryShortfall(sim, built, asset, carry.SKR ?? 0n) ?? floatsShortfall(sim, built, asset, carry);
}

/** The leash program's own custom error in a failed simulation, read from its "Program <leash> failed" log line (other programs' 6000-range codes do not count). */
export function leashErrorOf(sim: { logs: string[] }): number | null {
  const re = new RegExp(`Program ${LEASH_PROGRAM} failed: custom program error: 0x([0-9a-f]+)`, "i");
  for (const l of sim.logs) {
    const m = re.exec(l);
    if (m) return parseInt(m[1], 16);
  }
  return null;
}

/** A refusal by one of the money guards or checkers (a possible attack, or a builder bug), not weather: it gets an ALERT line (review M2). */
const GUARD_REFUSAL = /fell by|under the minimum|still holds|(Planting|Jupiter response|Jupiter Lend|K-Lend|Leash) refused/;
function alertIfGuard(w: WalletRow, asset: LiveAsset, err: string) {
  if (GUARD_REFUSAL.test(err)) console.error(`ALERT: guard refusal on ${asset} for ${w.pubkey}: ${err}`);
}

/**
 * Spec 2 / Task 2 note: a skipped leg is logged every run but recorded at most once per wallet per day for the same reason (the
 * reason with its decimal numbers masked, so a price that is 61 s and then 63 s old is one reason; hex program error codes such as
 * 0x1777 / 0x1778 stay distinct, review M2). A failed read records it anyway.
 */
async function legSkipped(a: { repo: Repo; now: Date }, w: WalletRow, asset: LiveAsset, err: string, extra: Record<string, unknown> = {}) {
  console.error(`${asset} leg for ${w.pubkey} failed (${err}); skipped today`);
  alertIfGuard(w, asset, err);
  const day = dayOf(a.now);
  const key = `${w.pubkey}:${asset}:${err.replace(/0x[0-9a-f]+|\d+/gi, (m) => (/^0x/i.test(m) ? m : "#")).slice(0, 160)}`;
  try {
    const seen = await a.repo.listEvents(w.userPubkey, ["leg_skipped"], 50);
    if (seen.some((e) => { const d = e.detail as { day?: string; key?: string } | null; return d?.day === day && d?.key === key; })) return;
  } catch (e) {
    console.error(`leg_skipped history of ${w.userPubkey} unreadable (${message(e)}); recording anyway`);
  }
  await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "leg_skipped", detail: { asset, err, day, key, ...extra } });
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

async function plantOne(a: { repo: Repo; now: Date; chain: Chain }, w: WalletRow, ctx: RunCtx): Promise<Planted | Skipped> {
  try {
    return await plantOneOrThrow(a, w, ctx);
  } catch (e) {
    // Review I1: a Jupiter 400 or 429, a lookup-table fetch or a blockhash error on one wallet must not abort everyone's day.
    console.error(`planting for ${w.pubkey} failed before send: ${message(e)}`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "build", err: message(e) } });
    return { wallet: w.pubkey, reason: "build failed" };
  }
}

async function plantOneOrThrow(a: { repo: Repo; now: Date; chain: Chain }, w: WalletRow, ctx: RunCtx): Promise<Planted | Skipped> {
  const swaps = await a.repo.unplantedSwaps(w.pubkey);
  const pending = swaps.reduce((sum, s) => sum + s.roundupCents, 0);
  const rules = rulesRowToRules(await a.repo.getRules(w.userPubkey));
  const oldestMs = swaps.length ? Math.min(...swaps.map((s) => s.ts.getTime())) : a.now.getTime();
  let forced = a.now.getTime() - oldestMs >= rules.plantMaxDays * 86_400_000;
  if (pending <= 0 || (!forced && pending < rules.plantThresholdCents)) {
    // 10-07: a revoke made outside the app is seen on a wallet with nothing due too (else it stays active and the app keeps asking
    // for a re-link). A failed read changes nothing: it is no outage and records no event; the next run reads it again.
    const gone = await a.chain.readDelegation(w.delegationPda).then((d) => !d.exists, () => false);
    if (gone) {
      await a.repo.setWalletStatus(w.pubkey, "revoked");
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "revoke_seen", detail: null });
      return { wallet: w.pubkey, reason: "revoked" };
    }
    return { wallet: w.pubkey, reason: "below threshold" };
  }
  const leashed = w.linkModel === "leash";
  // R297: from go-live the API refuses to plant on old puller-key links (the app shows "Re-link to keep planting"); nothing is read or pulled.
  if (!leashed && leashLive()) return { wallet: w.pubkey, reason: "relink needed" };

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
  let left = capLeftCents(cap, pulledThisPeriod);
  let amount = plantAmountCents({ pendingCents: pending, capLeftCents: left, feeCents: NETWORK_FEE_CENTS, minCents: forced ? 0 : rules.plantThresholdCents });
  if (amount.pullCents === 0) return { wallet: w.pubkey, reason: left === 0 ? "cap reached" : "below threshold" };

  // R207: the run listed this wallet as active at its start; a pause made since, or a run resume racing a user pause, must not pull.
  // Read again just before the pull: still active, and the user's newest word on it is not a pause.
  const now = await a.repo.getWallet(w.pubkey);
  if (now?.status !== "active" || (await userPauseStands(a.repo, w))) {
    if (now?.status === "active") await a.repo.setWalletStatus(w.pubkey, "paused");
    return { wallet: w.pubkey, reason: "paused" };
  }

  // An RPC error here throws to plantOne ("build failed"); only a successful read that comes up short changes the planting.
  // R361 (owner 10-05, "Carry the rest to a later planting"): when the wallet's USDC (whole cents, rounded down) cannot cover the
  // pull the cap allows, the planting takes the round-ups it covers, whole, oldest first (one that does not fit is skipped), and
  // claims only those. The 7-day minimum of zero holds only when a round-up past plantMaxDays is among them, so an old round-up
  // bigger than the balance does not let new cents drip in under the threshold, a fee each day. The rest stay
  // unplanted and plant on a later run, after a top-up. The pull (their sum + the fee) never exceeds the balance. With nothing that
  // reaches the minimum covered: a balance under threshold + fee pauses (the resume ends it at threshold + fee, so the two
  // converge); a balance at or above it (one round-up bigger than the balance) waits active, since the resume would undo a pause.
  // A cap-bounded planting keeps its own rule: it claims every pending round-up (the cap is the user's own daily limit).
  let claim = swaps;
  let covered = pending;
  const balanceCents = Number((await a.chain.usdcBalanceRaw(w.pubkey)) / USDC_PER_CENT);
  if (balanceCents < amount.pullCents) {
    const wanted = amount.pullCents;
    left = Math.min(left, balanceCents);
    const room = left - NETWORK_FEE_CENTS;
    claim = [];
    covered = 0;
    for (const s of swaps) if (covered + s.roundupCents <= room) { claim.push(s); covered += s.roundupCents; }
    forced = claim.some((s) => a.now.getTime() - s.ts.getTime() >= rules.plantMaxDays * 86_400_000);
    amount = plantAmountCents({ pendingCents: covered, capLeftCents: left, feeCents: NETWORK_FEE_CENTS, minCents: forced ? 0 : rules.plantThresholdCents });
    if (amount.pullCents === 0) {
      if (balanceCents >= rules.plantThresholdCents + NETWORK_FEE_CENTS) return { wallet: w.pubkey, reason: "no usdc" };
      await a.repo.setWalletStatus(w.pubkey, "paused");
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "paused_no_usdc", detail: { needCents: wanted } });
      return { wallet: w.pubkey, reason: "no usdc" };
    }
  }

  // R207 #2 generalised (R295): each kind's remainder rides on the next planting of the same kind. T9 carry: the carry is exactly
  // this user's own credit, never more; a credit at or below zero carries nothing; a failed read carries nothing (fail closed).
  // Nothing is debited here: the planting row written below reserves it (released when the planting fails), and the surplus is
  // credited only after confirmation (recordCarrySurplus). A rebuild (the Jupiter Lend leftover, a SettleMismatch) reuses this carry.
  const credit = async (k: CarryKind): Promise<bigint> => {
    try {
      const c = await a.repo.carryCreditRaw(w.userPubkey, k);
      return c > 0n ? c : 0n;
    } catch (e) {
      console.error(`planting for ${w.pubkey}: the ${k} remainder could not be read (${message(e)}); nothing carried today`);
      return 0n;
    }
  };
  const carryFor = async (asset: LiveAsset): Promise<Partial<Record<CarryKind, bigint>>> => {
    const kind: CarryKind | null = asset === "SKR" ? "SKR" : asset === "SOL_LEND" ? "WSOL" : asset === "USDC_LEND" ? "USDC" : null;
    if (!kind) return {};
    const c = await credit(kind);
    return c > 0n ? { [kind]: c } : {};
  };

  // Which legs can take money today: the leash flags (leashed users), an eligible venue under the 60% cap (lending).
  const enabled = leashed ? (ctx.leash ? new Set<number>(enabledLegs(ctx.leash)) : null) : undefined;
  if (enabled === null) return { wallet: w.pubkey, reason: "leash unavailable" };
  let pullRaw = BigInt(amount.pullCents) * USDC_PER_CENT;
  let positionsUsd: Partial<Record<Protocol, number>> | null | undefined;
  const venues: Partial<Record<LendAsset, AutoVenue | null>> = {};
  const disabled: LiveAsset[] = [];
  const checkLend = async (leg: LendAsset) => {
    if (positionsUsd === undefined) positionsUsd = await a.chain.lendingPositions(w.userPubkey).then((p) => lendingUsdByProtocol(p, ctx.venueDays, ctx.prices)).catch((e) => { console.error(`lending positions of ${w.userPubkey} unreadable (${message(e)}); no lending today`); return null; });
    const allowed = enabled ? leashAllowedVenues(enabled, leg) : undefined;
    venues[leg] = positionsUsd === null ? null : pickVenue({ candidates: venueCandidates(leg, ctx.venueDays, ctx.yesterday), lendingUsdByProtocol: positionsUsd, addUsd: amount.pullCents / 100, ...(allowed ? { allowed } : {}) });
    if (!venues[leg]) disabled.push(leg);
  };
  for (const leg of ASSETS) {
    // PREFLIGHT 10-04 s20 (Kimi F5): a leashed user's 0% legs are checked too. When every leg with a share is disabled,
    // redistributeDisabled hands the money to a 0% leg; unchecked, that leg could be leash-disabled (LegDisabled 6015) and the
    // "no leg enabled" test planted stORE. Unleashed users skip their 0% legs here, so the lending-positions read stays off the
    // SKR-only path; the pass below checks them once any leg is disabled.
    if (rules.allocation[leg] <= 0 && !enabled) continue;
    if (isLendAsset(leg)) await checkLend(leg);
    else if (enabled && !enabled.has(leashLegOf(leg, null))) disabled.push(leg);
  }
  // Residual N1 (10-05): the water-fill gives points to the leg with the most headroom, and a 0% lending leg has full headroom, so
  // once any leg is disabled every lending leg needs its venue. A lending leg with no venue is itself disabled and gets no points.
  if (disabled.length > 0) for (const leg of LEND_ASSETS) if (!(leg in venues)) await checkLend(leg);
  const target = redistributeDisabled(rules.allocation, disabled, rules.stop);
  if (!target) return { wallet: w.pubkey, reason: "no leg enabled" };
  // R336 follow-up: with USDC lending disabled and every enabled leg at its stop max, the rest of the split is left unpulled. One leg
  // takes each planting, so "unpulled" is the pull itself: only the target's share of the change is pulled (the USDC stays in the
  // wallet; the round-ups are all claimed by this planting). The venue check above used the larger amount (the stricter 60% test); both are already bounded by the cap and the USDC balance.
  const share = ASSETS.reduce((sum, leg) => sum + target[leg], 0);
  if (share < 100 - 1e-9) {
    amount = plantAmountCents({ pendingCents: Math.floor((covered * share) / 100), capLeftCents: left, feeCents: NETWORK_FEE_CENTS, minCents: forced ? 0 : rules.plantThresholdCents });
    if (amount.pullCents === 0) return { wallet: w.pubkey, reason: "below threshold" };
    pullRaw = BigInt(amount.pullCents) * USDC_PER_CENT;
  }

  type Attempt = { built: Built; sim: Simulation; carry: Partial<Record<CarryKind, bigint>>; venue: AutoVenue | null; leg: LeashLegByte | null; cfg: PriceCfg | null; feedAlive: boolean; settleMismatch: boolean };
  let asset: LiveAsset = pickAsset(w.ledgerCents, target);
  // A build that is not sent reclaims its posted price at once (SKR, contracts 10 item 15; a no-op for every other build).
  const discard = (b: Built) => a.chain.cleanup(b).catch((e) => console.error(`price cleanup for ${b.signature} failed: ${message(e)}`));
  const attempt = async (asset: LiveAsset): Promise<Attempt> => {
    const venue = isLendAsset(asset) ? (venues[asset] ?? null) : null;
    const leg = leashed ? leashLegOf(asset, venue) : null;
    const lc = leg !== null && ctx.leash ? ctx.leash.legs[leg] : null;
    const cfg: PriceCfg | null = leg !== null && lc && LEG_SPEC[leg].feed !== null ? { confCapBps: lc.confCapBps, maxAgeS: lc.maxAgeS } : null;
    let feedAlive = true;
    if (leg !== null && cfg) {
      // T8 carry: the run's one wait for this leg's feed (all feeds started together). Review I2: then a bounded wait for a price
      // with BUILD_HEADROOM_S to spare under the leg's own on-chain cap and age (none when the feed's run wait failed: fail fast).
      // Carry-in 9: without PYTH_API_KEY SKR (leg 0) has no price source (R324), so this throws and a leashed SKR leg is skipped;
      // with it this answers at once ("post") and the build posts and judges the price (contracts 10 item 15).
      feedAlive = await ctx.gate(leg);
      await a.chain.priceFresh(leg, { ...cfg, maxAgeS: cfg.maxAgeS - BUILD_HEADROOM_S }, feedAlive ? waitWithin(PRE_BUILD_WAIT_S, ctx.deadline) : 0);
    }
    const carry = await carryFor(asset);
    const input = { delegator: w.pubkey, user: w.userPubkey, asset, venue, pullRaw, delegationPda: w.delegationPda, leashed, carryIn: carry, ...(cfg ? { priceOpts: { waitS: 0, ...cfg } } : {}) };
    const once = async (inp: typeof input & { jlLeftover?: 0n | 1n }) => {
      const b = await a.chain.buildPlantingTx(inp);
      try {
        return { b, s: await a.chain.simulatePlanting(b) };
      } catch (e) {
        await discard(b);
        throw e;
      }
    };
    let { b: built, s: sim } = await once(input);
    let settleMismatch = false;
    // T9 review M4: SettleMismatch (6007) means the receipt moved between the build's read of `pre` and the pull; one rebuild re-reads it.
    if (!sim.ok && leashErrorOf(sim) === SETTLE_MISMATCH) {
      await discard(built);   // a rebuild posts its own price (SKR): this one's account is reclaimed now
      ({ b: built, s: sim } = await once(input));
      settleMismatch = !sim.ok && leashErrorOf(sim) === SETTLE_MISMATCH;
    }
    // Task 7: Jupiter Lend mints N or N - 1 shares; one rebuild with the other leftover decides which (the close fails on the wrong one).
    if (venue === "jupiter_lend" && !sim.ok && !settleMismatch) {
      const other: 0n | 1n = built.jlLeftover === 1n ? 0n : 1n;
      const r2 = await once({ ...input, jlLeftover: other });
      if (r2.s.ok) { await discard(built); built = r2.b; sim = r2.s; } else await discard(r2.b);
    }
    const short = sim.ok ? legShortfall(sim, built, asset, venue, carry) : null;
    return { built, carry, venue, leg, cfg, feedAlive, settleMismatch, sim: short ? { ...sim, ok: false, err: { delivery: short } } : sim };
  };
  const simError = (r: Attempt) => `simulation: ${json(r.sim.err)} ${r.sim.logs.slice(-2).join(" | ")}`;
  // A leg that cannot be planted today: a lending leg, a coin leg whose SKR fallback is off for this leashed user, and (carry-in 9)
  // a leashed SKR leg are skipped; an unleashed coin leg falls back to SKR (spec 7.3); an unleashed SKR build error is "build failed".
  // R439 (10-07): a lending leg that fails for weather (not a guard refusal) tries the same asset once on the other venue, if that
  // venue is eligible, under its 60% cap and (leashed) its leash leg is on; never another asset (spec: a lending leg waits).
  const retriedVenue = new Set<LendAsset>();
  const otherVenue = (leg: LendAsset, not: AutoVenue): AutoVenue | null => {
    if (!positionsUsd) return null;
    const allowed = (enabled ? leashAllowedVenues(enabled, leg) : AUTO_VENUES).filter((v) => v !== not);
    return pickVenue({ candidates: venueCandidates(leg, ctx.venueDays, ctx.yesterday), lendingUsdByProtocol: positionsUsd, addUsd: amount.pullCents / 100, allowed });
  };
  const fallbackOrSkip = async (failed: LiveAsset, err: string): Promise<Attempt | null> => {
    if (isLendAsset(failed) && !retriedVenue.has(failed) && !GUARD_REFUSAL.test(err)) {
      const from = venues[failed] ?? null;
      const to = from ? otherVenue(failed, from) : null;
      if (from && to) {
        retriedVenue.add(failed);
        console.error(`${failed} on ${from} for ${w.pubkey} failed (${err}); trying ${to}`);
        await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "venue_fallback", detail: { asset: failed, from, to, err } });
        venues[failed] = to;
        return tryLeg(failed);
      }
    }
    if (isLendAsset(failed)) console.error(`ALERT: lending leg ${failed} skipped for ${w.pubkey}${retriedVenue.has(failed) ? " on both venues" : ""}; the planting waits for the next run: ${err}`);
    // Review M4: a leashed user never falls back to SKR while leg 0 has no price source (no PYTH_API_KEY, R324): it would be skipped there anyway.
    if (isLendAsset(failed) || disabled.includes("SKR") || (leashed && !skrPriceSource())) {
      await legSkipped(a, w, failed, err);
      return null;
    }
    alertIfGuard(w, failed, err);
    console.error(`${failed} leg for ${w.pubkey} failed (${err}); planting SKR instead`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "leg_fallback", detail: { asset: failed, err } });
    asset = "SKR";
    return tryLeg("SKR");
  };
  const tryLeg = async (leg: LiveAsset): Promise<Attempt | null> => {
    let r: Attempt;
    try {
      r = await attempt(leg);
    } catch (e) {
      if (leg !== "SKR") return fallbackOrSkip(leg, message(e));
      if (!leashed) throw e;
      await legSkipped(a, w, leg, message(e));
      return null;
    }
    if (r.settleMismatch) {
      // M4: a second SettleMismatch right after a rebuild skips the leg (no fallback); the same wallet's repeat across runs alerts.
      const before = await a.repo.listEvents(w.userPubkey, ["leg_skipped"], 50).catch(() => []);
      // Review M3: a repeat is a SettleMismatch skip of this wallet within the last 7 days (by the run's own day).
      const since = addDays(dayOf(a.now), -7);
      const repeat = before.some((e) => { const d = e.detail as { leashError?: string; day?: string } | null; return e.walletPubkey === w.pubkey && d?.leashError === "SettleMismatch" && !!d.day && d.day >= since && d.day <= dayOf(a.now); });
      if (repeat) console.error(`ALERT: leash SettleMismatch (6007) again for ${w.pubkey} on ${leg}: the receipt keeps moving between build and pull`);
      await discard(r.built);
      await legSkipped(a, w, leg, "leash SettleMismatch (6007) after one rebuild", { leashError: "SettleMismatch", alert: repeat });
      return null;
    }
    if (leg === "SKR" || r.sim.ok) return r;
    await discard(r.built);
    return fallbackOrSkip(leg, simError(r));
  };
  const outcome = await tryLeg(asset);
  if (!outcome) return { wallet: w.pubkey, reason: "leg failed" };
  const { built, sim, carry, venue, leg, cfg, feedAlive } = outcome;
  if (!sim.ok) {
    alertIfGuard(w, asset, json(sim.err));
    const code = leashErrorOf(sim);
    const leashError = code !== null ? (LEASH_ERRORS[code] ?? null) : null;
    console.error(`planting for ${w.pubkey} failed simulation: ${json(sim.err)} ${sim.logs.slice(-2).join(" | ")}`);
    await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "simulate", err: sim.err, logs: sim.logs.slice(-5), leashError } });
    await discard(built);
    return { wallet: w.pubkey, reason: "simulation failed" };
  }

  // Review (feat/skr-post) I2: until the send starts, a throw here (a share read, a database write) must not strand a posted price:
  // the price account is reclaimed, then the error goes on as before. From the send on, the planting may be in flight: no reclaim.
  let sendStarted = false;
  try {
  return await (async () => {
  // Record the signed transaction before it goes anywhere, then claim the round-ups in one conditional statement (review C1).
  // The share count right before the send: after confirmation the difference is what this planting minted [A16].
  const sharesBefore = await a.chain.readShares(w.userPubkey);
  // R141: a wallet coin's (or a lending receipt's) balance right before the send; after confirmation the difference is what landed.
  let outBefore: bigint | null = null;
  if (asset !== "SKR") {
    try {
      outBefore = await a.chain.assetBalanceRaw(w.userPubkey, asset, venue);
    } catch (e) {
      console.error(`planting for ${w.pubkey}: the ${asset} balance before the send could not be read (${message(e)}); the quote stands`);
    }
  }
  // Earned (spec 8): a lending leg's rate is its venue's exchange rate today; a coin leg's its coin_days rate; null before the first snapshot.
  const rateAtPlanting = venue
    ? (ctx.venueDays.find((r) => r.venue === venue && r.asset === asset)?.exchangeRate ?? null)
    : ((await a.repo.getCoinDay(dayOf(a.now), asset))?.rate ?? null);
  const carryIn = { ...(carry.WSOL ? { WSOL: carry.WSOL } : {}), ...(carry.USDC ? { USDC: carry.USDC } : {}) };
  const planting = await a.repo.insertPlanting(
    { userPubkey: w.userPubkey, walletPubkey: w.pubkey, signature: built.signature, usdcPulledCents: amount.pullCents, networkFeeCents: NETWORK_FEE_CENTS, status: "sent", aiLine: null, sharesBefore, ts: a.now,
      ...(carry.SKR ? { skrCarryInRaw: carry.SKR } : {}), ...(Object.keys(carryIn).length ? { carryIn } : {}) },
    [{ asset, venue, usdcInCents: amount.changeCents, amountOutRaw: built.minOutRaw, staked: asset === "SKR", feeAmountRaw: 0n, feeCents: Math.round((amount.pullCents * COINS[asset].feeBps) / 10_000), rateAtPlanting }],
  );
  // R207 #2: the carry is reserved by the row just written; if another run spent the same remainder meanwhile, the user's credit is
  // now below zero and this planting stands down before claiming or sending (a failed read stands down too).
  for (const k of Object.keys(carry) as CarryKind[]) {
    if ((await a.repo.carryCreditRaw(w.userPubkey, k).catch(() => -1n)) < 0n) {
      await a.repo.setPlantingStatus(planting.id, "failed");
      await discard(built);
      return { wallet: w.pubkey, reason: "claimed elsewhere" };
    }
  }
  const claimed = await a.repo.claimSwaps(claim.map((s) => s.signature), planting.id);
  if (claimed !== claim.length) {
    // Another run got there first: give back whatever this one took and let that run finish.
    await a.repo.releaseSwaps(planting.id);
    await a.repo.setPlantingStatus(planting.id, "failed");
    await discard(built);
    return { wallet: w.pubkey, reason: "claimed elsewhere" };
  }
  const tidy = () => discard(built);

  // T8 carry: the price is checked again right before the send (the build used waitS 0). Review I2: a live feed may wait up to
  // PRE_SEND_WAIT_S here (claimed, nothing sent yet). Still unusable: nothing is sent; the round-ups and the carry go back.
  if (leg !== null && cfg) {
    try {
      await a.chain.priceFresh(leg, cfg, feedAlive ? waitWithin(PRE_SEND_WAIT_S, ctx.deadline) : 0);
      // A posted price (SKR) has no account to poll: the one the build posted is judged under the same on-chain cfg, no wait (a
      // fresher price needs a new post, so a rebuild, which is the next run's).
      const why = built.postedPrice ? postedPriceRefusal(leg, built.postedPrice, cfg) : null;
      if (why) throw new Error(`the posted ${LEG_SPEC[leg].asset} price ${why}`);
    } catch (e) {
      await a.repo.releaseSwaps(planting.id);
      await a.repo.setPlantingStatus(planting.id, "failed");
      await legSkipped(a, w, asset, `price unusable at send: ${message(e)}`);
      await tidy();
      return { wallet: w.pubkey, reason: "leg failed" };
    }
  }

  // From here the transaction may be on chain: an error (a database write, the confirm, the share read) is "send unknown",
  // never "build failed" (09-29), so it does not count toward the outage stop; the row stays `sent` for the next run to reconcile.
  sendStarted = true;
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
        await tidy();
        return { wallet: w.pubkey, reason: "send failed" };
      }
      if (status === "pending") {
        // Left as `sent` with its round-ups claimed; the next run reconciles it by signature instead of pulling again.
        console.error(`planting for ${w.pubkey} sent but unconfirmed (${built.signature}): ${message(e)}; reconciled next run${built.postedPrice ? "; its posted price account is NOT reclaimed (the planting may still land): reclaim it by hand from the build's cleanup" : ""}`);
        await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: w.pubkey, kind: "pull_failed", detail: { stage: "confirm", err: message(e), signature: built.signature } });
        return { wallet: w.pubkey, reason: "send unknown" };
      }
    }
    await bookConfirmed(a.repo, a.chain, planting, outBefore);
    await tidy();
    return { wallet: w.pubkey, asset, pullCents: amount.pullCents, signature: built.signature };
  } catch (e) {
    console.error(`planting for ${w.pubkey} sent (${built.signature}), booking interrupted: ${message(e)}; reconciled next run`);
    if (built.postedPrice) await tidy();   // landed or failed, the planting no longer reads its price; tidy never throws
    return { wallet: w.pubkey, reason: "send unknown" };
  }
  })();
  } catch (e) {
    if (!sendStarted) await discard(built);
    throw e;
  }
}

/** The error's message, plus its cause when it has one (Node's "fetch failed" keeps the host and the reason only in the cause); redacted (K-M10). */
function message(e: unknown): string {
  return errorText(e);
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}
