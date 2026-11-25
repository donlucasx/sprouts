import { createNoopSigner, getBase64Encoder, type Address, type Instruction } from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findEventAuthorityPda, STAKE_DISCRIMINATOR } from "@/generated/staking";
import type { Repo } from "@/db/repo";
import type { EventRow, UserRow } from "@/db/types";
import { GUARDIAN_POOL, MIN_STAKE_RAW, SKR_MINT, SKR_STAKING_PROGRAM, STAKE_CONFIG, STAKE_VAULT, SYSTEM_PROGRAM } from "./constants";
import { buildStakeIx, skrAta, userStakePda, type Position } from "./staking";
import { COMPUTE_BUDGET, computeBudget, toTopUpIx, type TopUpIx } from "./topup";
import { assetBalanceRaw } from "./holdings";
import { buildUserTransaction } from "./user-tx";
import { rpc } from "./rpc";
import { signatureStatuses } from "./planting";
import { DUST_SHARES, expectedShares, ledgerKey } from "./reconcile";
import { rawToShares, sharesToRaw } from "./pot";

/**
 * 0.1.13 item 3, "Plant my SKR" (his rulings 11-25; Kimi scope check audits/kimi-0113-plant-skr-scope-2026-11-25.md): SKR held liquid
 * in the Seed Vault wallet, staked straight into the position Sprouts plants into (user_stake[user, GUARDIAN_POOL]). One signature,
 * one SKR staking `stake` (payer = user = the Seed Vault key) after a capped compute budget; no swap, and no Sprouts instruction of any
 * kind. The API builds it (POST /api/stake/build), the phone checks it (app sign.ts 'stake'), the Seed Vault signs, POST
 * /api/stake/confirm sends it and books it.
 */

/** Kimi #3: the server's off switch. STAKE_PLANT_OFF=1 hides the marker (/api/me idleSkr null) and refuses build and confirm (503). */
export const stakePlantOff = (): boolean => process.env.STAKE_PLANT_OFF === "1";

/** His ruling: the marker shows from $5 of liquid SKR. */
export const IDLE_SKR_MIN_CENTS = 500;
/** The stake's compute budget: the program's stake (with a first-time user_stake create) runs well under this. Priority: 0.00000012 SOL. */
export const STAKE_CU_LIMIT = 120_000;
export const STAKE_CU_PRICE_MICROLAMPORTS = 1_000n;
/** Kimi #7: build reads the balance fresh and simulates, so it is limited per session (calls per minute). */
export const STAKE_BUILD_LIMIT = 6;
export const STAKE_BUILD_WINDOW_MS = 60_000;

/** Build-written copy (his review owed): no fee wording, never "free" (his rule 11-25). */
export const PLANT_COPY = {
  off: "Planting SKR from your wallet is paused right now. Nothing was asked of your wallet.",
  busy: "Too many tries. Wait a minute, then try again.",
  badAmount: "Pick an amount of SKR to plant.",
  stale: "Your SKR balance changed. Nothing was asked of your wallet. Pick an amount again.",
  notNow: "Sprouts could not build this just now. Nothing was asked of your wallet. Try again in a minute.",
  wouldFail: "This would fail on chain, so nothing was asked of your wallet. Try again in a minute.",
} as const;

/** The confirm route's answers (api/stake/confirm). */
export const PLANT_CONFIRM = {
  notStake: "This is not a Sprouts SKR planting, so nothing was sent.",
  notMarked: "Could not start planting. Nothing moved. Try again.",
  failed: "The planting failed on chain. Your SKR stayed in your wallet.",
  expired: "It did not go through. Nothing moved. Try again.",
  pending: "Your SKR was sent but is not confirmed yet. Check Home in a minute before you try again.",
} as const;

/** A refusal the app shows as it is, never a transaction. */
export class PlantRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "PlantRefused";
  }
}

/**
 * /api/me `idleSkr`: the Seed Vault wallet's own liquid SKR and its dollars (floored cents), or null: switched off, unread (raw null),
 * no price, or under IDLE_SKR_MIN_CENTS.
 */
export function idleSkrFrom(raw: bigint | null, skrUsd: number | null): { raw: string; usdCents: number } | null {
  if (stakePlantOff() || raw === null || raw <= 0n || typeof skrUsd !== "number" || !Number.isFinite(skrUsd) || skrUsd <= 0) return null;
  const usdCents = Math.floor((Number(raw) / 1e6) * skrUsd * 100);
  return usdCents >= IDLE_SKR_MIN_CENTS ? { raw: raw.toString(), usdCents } : null;
}

/** Every account the stake names, derived from the user alone (the phone derives the same, sign.ts). */
export async function plantSkrAccounts(user: Address): Promise<{ userStake: string; ata: string; events: string }> {
  const [userStake, ata, [events]] = await Promise.all([userStakePda(user), skrAta(user), findEventAuthorityPda()]);
  return { userStake, ata, events };
}

const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const no = (why: string): never => { throw new Error(`SKR planting refused: ${why}`); };

/**
 * What a Plant my SKR transaction may hold, and nothing else (the app runs the same check before the wallet is asked, sign.ts 'stake'):
 * the top-up's compute budget rule (at most one limit and one price, no accounts, priority at most 0.001 SOL, Kimi #4), then ONE stake
 * of the SKR staking program, its data exactly the discriminator and a u64 amount, its 12 accounts pinned in the generated builder's
 * order: user_stake (this user's PDA), stake config, guardian pool, payer (the user), user (the user), the user's own SKR account, the
 * stake vault, the SKR mint, the token program, the system program, the program's event authority, the program. `amountRaw`, when
 * given, must be exactly the amount. Returns the amount staked.
 */
export function checkPlantSkr(ixs: TopUpIx[], a: { user: string; userStake: string; ata: string; events: string; amountRaw?: bigint }): { amountRaw: bigint } {
  for (const ix of ixs) {
    if (ix.program !== COMPUTE_BUDGET && ix.program !== SKR_STAKING_PROGRAM) no(`program ${ix.program} is not used by an SKR planting`);
    for (const s of ix.signers ?? []) if (s !== a.user) no(`signer ${s} is not the wallet`);
  }
  const i = computeBudget(ixs);
  if (ixs.length !== i + 1) no("not exactly one stake after the compute budget");
  const ix = ixs[i];
  if (ix.program !== SKR_STAKING_PROGRAM) no("no stake");
  if (ix.data.length !== 16 || !STAKE_DISCRIMINATOR.every((b, k) => ix.data[k] === b)) no("an instruction that is not a stake");
  const want = [a.userStake, STAKE_CONFIG, GUARDIAN_POOL, a.user, a.user, a.ata, STAKE_VAULT, SKR_MINT, TOKEN_PROGRAM_ADDRESS, SYSTEM_PROGRAM, a.events, SKR_STAKING_PROGRAM] as string[];
  if (ix.accounts.length !== want.length || want.some((w, k) => ix.accounts[k] !== w)) no("the stake's accounts are not this wallet's own");
  const amountRaw = u64At(ix.data, 8);
  if (amountRaw <= 0n) no("a stake of nothing");
  if (a.amountRaw !== undefined && amountRaw !== a.amountRaw) no(`the stake is ${amountRaw}, not the amount asked`);
  return { amountRaw };
}

/** The instructions: the capped compute budget, then buildStakeIx with payer = user = the Seed Vault key. */
export async function plantSkrIxs(user: Address, amountRaw: bigint): Promise<Instruction[]> {
  return [
    getSetComputeUnitLimitInstruction({ units: STAKE_CU_LIMIT }),
    getSetComputeUnitPriceInstruction({ microLamports: STAKE_CU_PRICE_MICROLAMPORTS }),
    await buildStakeIx({ payer: createNoopSigner(user), user, amountRaw }),
  ];
}

const MAX_WIRE_BYTES = 1232;

/**
 * The unsigned stake of `amountRaw` (Kimi #9): the balance read fresh (never ownerCached, memo.ts: never a money path), and an amount
 * above it REFUSED (409, the app re-reads /api/me and offers again), never clamped. Checked with the confirm's own rule, compiled with no
 * lookup table, simulated. Moves and records nothing.
 */
export async function buildPlantSkr(user: Address, amountRaw: bigint): Promise<{ transaction: string; amountRaw: string }> {
  if (amountRaw < MIN_STAKE_RAW || amountRaw > 0xffff_ffff_ffff_ffffn) throw new PlantRefused(PLANT_COPY.badAmount, 400);
  const balance = await assetBalanceRaw(user, "SKR");
  if (amountRaw > balance) throw new PlantRefused(PLANT_COPY.stale, 409);
  const ixs = await plantSkrIxs(user, amountRaw);
  checkPlantSkr(ixs.map(toTopUpIx), { user, ...(await plantSkrAccounts(user)), amountRaw });
  const transaction = await buildUserTransaction(user, ixs);
  if (getBase64Encoder().encode(transaction).length > MAX_WIRE_BYTES) throw new PlantRefused(PLANT_COPY.notNow, 503);
  const sim = await rpc().simulateTransaction(transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) {
    console.error(`plant-skr: simulation failed for ${user}: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    throw new PlantRefused(PLANT_COPY.wouldFail, 400);
  }
  return { transaction, amountRaw: amountRaw.toString() };
}

// ---- The record (Kimi #5, #6): two events per stake, both keyed by its signature, scoped to the user (wallet = the user).

const KINDS = ["skr_plant_sent", "skr_planted"] as const;
const sigOf = (e: EventRow) => (e.detail as { signature?: unknown } | null)?.signature;
async function plantEvents(repo: Repo, user: string): Promise<EventRow[]> {
  return repo.listEvents(user, [...KINDS], 200);
}

/** BEFORE the send (as markTopUpSent): a stake that lands after the confirm's deadline is settled from it. Throws: the caller must not send. */
export async function markPlantSent(repo: Repo, m: { user: string; signature: string; amountRaw: string }): Promise<void> {
  if ((await plantEvents(repo, m.user)).some((e) => e.kind === "skr_plant_sent" && sigOf(e) === m.signature)) return;
  await repo.addEvent({ userPubkey: m.user, walletPubkey: m.user, kind: "skr_plant_sent", detail: { signature: m.signature, amountRaw: m.amountRaw } });
}

/** True when this signature already has its Activity row (a retried confirm of the same signed transaction). */
export async function plantRecorded(repo: Repo, user: string, signature: string): Promise<boolean> {
  return (await plantEvents(repo, user)).some((e) => e.kind === "skr_planted" && sigOf(e) === signature);
}

/**
 * Only on `confirmed`: the `skr_planted` row, at most once per signature. Answers true when THIS call's row is the signature's only one,
 * the claim that lets the caller book the adjustment: two racing confirms that both wrote a row each see two and neither books
 * (reconcile books it next day); Activity shows one row per signature. A failed write is logged, never thrown (the SKR already moved).
 */
export async function recordPlanted(repo: Repo, m: { user: string; signature: string; amountRaw: string; sentAt: Date }): Promise<boolean> {
  try {
    if (await plantRecorded(repo, m.user, m.signature)) return false;
    await repo.addEvent({ userPubkey: m.user, walletPubkey: m.user, kind: "skr_planted", detail: { signature: m.signature, amountRaw: m.amountRaw, sentAt: m.sentAt.toISOString() } });
    return (await plantEvents(repo, m.user)).filter((e) => e.kind === "skr_planted" && sigOf(e) === m.signature).length === 1;
  } catch (e) {
    console.error(`skr planting ${m.signature}: landed, but its Activity row was not written: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

const SETTLE_DAYS = 7;
const SETTLE_MAX = 20;

/**
 * Kimi #6 (the settleTopUps pattern): a stake whose confirm ended 202 "pending" and landed later has a mark and no row. Activity calls
 * this: the recent open marks are asked on chain in ONE call, and the landed ones get their row. Their put in is NOT booked here: the
 * daily reconcile books a stake it finds (more shares than the ledger expects), so the money is right and only the same-day split of
 * put in and earned waits for it. A failed chain read leaves the marks for the next load. Answers the rows, one per signature, newest first.
 */
export async function settlePlants(repo: Repo, user: string, now = new Date()): Promise<{ ts: Date; signature: string; amountRaw: string }[]> {
  const events = await plantEvents(repo, user);
  const landed = new Set(events.filter((e) => e.kind === "skr_planted").map(sigOf));
  const since = now.getTime() - SETTLE_DAYS * 86_400_000;
  const marks = events
    .filter((e) => e.kind === "skr_plant_sent" && e.ts.getTime() >= since && !landed.has(sigOf(e)))
    .slice(0, SETTLE_MAX)
    .flatMap((e) => {
      const d = e.detail as { signature?: unknown; amountRaw?: unknown } | null;
      return typeof d?.signature === "string" && typeof d.amountRaw === "string" && /^\d+$/.test(d.amountRaw) ? [{ signature: d.signature, amountRaw: d.amountRaw, sentAt: e.ts }] : [];
    });
  const rows: { ts: Date; signature: string; amountRaw: string }[] = [];
  try {
    const statuses = await signatureStatuses(marks.map((m) => m.signature));
    for (const [i, m] of marks.entries()) {
      if (statuses[i] !== "confirmed") continue;
      await recordPlanted(repo, { user, ...m });
      rows.push({ ts: m.sentAt, signature: m.signature, amountRaw: m.amountRaw });
    }
  } catch (err) {
    console.error(`skr planting settle for ${user}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const e of events) {
    if (e.kind !== "skr_planted") continue;
    const d = e.detail as { signature?: unknown; amountRaw?: unknown; sentAt?: unknown } | null;
    if (typeof d?.signature !== "string" || typeof d.amountRaw !== "string" || !/^\d+$/.test(d.amountRaw)) continue;
    const ts = typeof d.sentAt === "string" && !Number.isNaN(Date.parse(d.sentAt)) ? new Date(d.sentAt) : e.ts;
    rows.push({ ts, signature: d.signature, amountRaw: d.amountRaw });
  }
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.signature) ? false : (seen.add(r.signature), true))).sort((x, y) => y.ts.getTime() - x.ts.getTime());
}

export type PlantChain = { readPosition(user: string): Promise<Position>; sharePrice(): Promise<bigint> };

/**
 * Kimi #2, #11: the confirmed stake's put in, booked at once, exactly as reconcileOwnStakes would book it (reconcile.ts): a fresh position
 * read, the delta against the ledger's expectation (expectedShares), the delta's SKR at the current share price (sharesToRaw), one
 * `own_stake` adjustment. The next reconcile counts it in its expectation and books nothing more. Skipped on any doubt (reconcile is
 * the fallback, next day): a planting still `sent` or without minted shares, a ledger that moved during the read, or a delta that is not
 * this stake (not positive, or off this stake's shares by more than the dust or 0.1%: another wallet stake or unstake not yet booked, or
 * a read that does not show the stake yet). Answers whether it booked.
 *
 * Known gap (accepted): the daily reconcile running for this same user in the same few milliseconds between its ledger re-read and its
 * write could book the stake too; its next run then reads fewer shares than expected with nothing unstaking and defers (logged), as
 * reconcile.ts does for any lagging read. The window needs a stake already finalized at the reconcile's read.
 */
export async function bookPlantedStake(a: { repo: Repo; user: UserRow; amountRaw: bigint; chain: PlantChain }): Promise<boolean> {
  const who = a.user.seedVaultPubkey;
  const skip = (why: string) => { console.error(`plant-skr: ${who} put in not booked at confirm (${why}); the daily reconcile books it`); return false; };
  try {
    const ledger = async () => {
      const [plantings, withdrawals, adjustments] = await Promise.all([a.repo.listConfirmedPlantings(who), a.repo.listWithdrawals(who, 10_000), a.repo.listStakeAdjustments(who)]);
      return { plantings, withdrawals, adjustments, key: ledgerKey(plantings, withdrawals, adjustments) };
    };
    const before = await ledger();
    if (before.plantings.some((p) => p.sharesMinted === null)) return skip("a planting without minted shares");
    if ((await a.repo.listSentPlantings(new Date(Date.now() + 86_400_000))).some((p) => p.userPubkey === who)) return skip("a planting still marked sent");
    const [position, price] = await Promise.all([a.chain.readPosition(who), a.chain.sharePrice()]);
    if ((await ledger()).key !== before.key) return skip("the ledger moved during the read");
    if (price <= 0n) return skip("no share price");
    const delta = position.shares - expectedShares(a.user.joinedShares, before.plantings, before.withdrawals, before.adjustments);
    const want = rawToShares(a.amountRaw, price);
    const slack = want / 1_000n > DUST_SHARES ? want / 1_000n : DUST_SHARES;
    if (delta <= 0n || (delta > want ? delta - want : want - delta) > slack) return skip(`delta ${delta} shares, the stake is about ${want}`);
    await a.repo.addStakeAdjustment({ userPubkey: who, kind: "own_stake", sharesDelta: delta, amountRaw: sharesToRaw(delta, price), sharePrice: price });
    return true;
  } catch (e) {
    return skip(e instanceof Error ? e.message : String(e));
  }
}
