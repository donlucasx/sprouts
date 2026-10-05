import type { Rules } from "@/domain/roundup";
import type { Asset, Split, Stop } from "@/domain/coins";
import type { SwapClass } from "@/domain/classify";

export type UserRow = {
  seedVaultPubkey: string;
  sgtMint: string;
  skrName: string | null;
  proUntil: Date | null;
  createdAt: Date;
  wateredAt: Date | null;
  /** The position's shares and the share price on the day the Seeker joined: put in, not earned (R61). */
  joinedShares: bigint;
  joinedSharePrice: bigint;
};

export type WalletStatus = "active" | "paused" | "revoked";

export type WalletRow = {
  pubkey: string;
  userPubkey: string;
  delegationPda: string;
  dailyCapCents: number;
  status: WalletStatus;
  webhookAdded: boolean;
  /** Cents delivered per asset (one jsonb map since 0005); a missing coin is zero. */
  ledgerCents: Partial<Record<Asset, number>>;
  createdAt: Date;
};

/**
 * `prevAllocation` and `allocationDay` are set only by the daily run (the undo, spec 4.5); any save by the user clears them.
 * `pinsByUndo` (R137, 0006): the pins were written by an undo; a save that turns the manager back on drops them, a save that carries pins clears the mark.
 */
export type RulesRow = Rules & { userPubkey: string; updatedAt: Date; prevAllocation: Split | null; allocationDay: string | null; pinsByUndo: boolean };

export type SwapRow = {
  signature: string;
  walletPubkey: string;
  ts: Date;
  inMint: string;
  inAmount: number;
  outMint: string;
  outAmount: number;
  usdSizeCents: number | null;
  class: SwapClass;
  roundupCents: number;
  plantingId: string | null;
  createdAt: Date;
};

export type PlantingStatus = "sent" | "confirmed" | "failed";

export type PlantingRow = {
  id: string;
  userPubkey: string;
  walletPubkey: string;
  ts: Date;
  signature: string | null;
  usdcPulledCents: number;
  networkFeeCents: number;
  status: PlantingStatus;
  aiLine: string | null;
  /** The position's shares right before the send, right after confirmation, and the difference: what this planting added [A16]. */
  sharesBefore: bigint | null;
  sharesAfter: bigint | null;
  sharesMinted: bigint | null;
  /**
   * SKR slippage remainder ledger (security audit R207 #2; spec 3.2 step 4): `skrCarryInRaw` is the user's earlier remainder this
   * planting's stake drew from the puller's account (reserved while `sent`, spent once `confirmed`, given back if `failed`);
   * `skrSurplusRaw` is what this planting's swap delivered above the quote's minimum, read once after confirmation, null until then.
   */
  skrCarryInRaw: bigint;
  skrSurplusRaw: bigint | null;
};

/** `feeCents` is the 0.5% taken in USDC (R105); `rateAtPlanting` is the coin's `coin_days.rate` that day, null before the first snapshot. */
export type PlantingLegRow = { plantingId: string; asset: Asset; usdcInCents: number; amountOutRaw: bigint; staked: boolean; feeAmountRaw: bigint; feeCents: number; rateAtPlanting: number | null };

export type WithdrawalSource = "sprouts" | "wallet";

export type WithdrawalRow = {
  id: string;
  userPubkey: string;
  asset: Asset;
  unstakeTs: Date;
  unstakeSignature: string | null;
  withdrawSignature: string | null;
  /** What the crank delivered after the cooldown; `amountRaw` is what was fixed at unstake time [A14]. */
  amountOutRaw: bigint | null;
  rewardDeltaRaw: bigint | null;
  cancelSignature: string | null;
  sharesUnstaked: bigint | null;
  amountRaw: bigint | null;
  /** The part of the pick above what was earned at sign time: it lowers what is put in [A15]. */
  principalRaw: bigint;
  /** "wallet": an unstake the Seed Vault made itself, found by the reconciliation; it carries no signature [A2]. */
  source: WithdrawalSource;
  /** Set by the crank when the chain had nothing unstaking for this row [A11]. */
  skippedAt: Date | null;
};

export type StakeAdjustmentRow = { id: string; userPubkey: string; ts: Date; kind: "own_stake" | "own_unstake"; sharesDelta: bigint; amountRaw: bigint; sharePrice: bigint };

/** One sign-in on one device (R84): the token itself is never stored, only its SHA-256. */
export type SessionRow = { tokenHash: string; userPubkey: string; device: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null };

/** One model call, with what it cost, so the budget is read from the table. The manager's daily calls have no user (kind `split`). */
export type WatcherCallKind = "compile" | "explain" | "propose" | "split";
export type WatcherCallRow = { id: number; ts: Date; userPubkey: string | null; kind: WatcherCallKind; inputTokens: number; outputTokens: number; costMicrocents: number };

export type EventKind =
  | "wallet_linked"
  | "over_cap_rejected"
  | "revoke_seen"
  | "pull_failed"
  | "withdraw_failed"
  | "withdraw_skipped"
  | "run_stopped"
  | "paused_no_usdc"
  | "paused_by_user"   // security audit (R207): a user pause is recorded, so the cron can tell it from a no-USDC pause
  | "resumed"
  | "proposal_made"
  | "proposal_accepted"
  | "split_changed"
  | "split_undone"
  | "leg_fallback"
  | "leg_skipped"
  | "coin_no_data";

export type EventRow = { id: number; userPubkey: string | null; walletPubkey: string | null; ts: Date; kind: EventKind; detail: unknown };

/** One coin's daily snapshot (spec 5.2). `rate` is the growth measure for the coin's kind; `ok` false means no read landed. */
export type CoinDayRow = {
  day: string; asset: Asset; rate: number | null; ratePrev: number | null; ratePrevDays: number | null;
  priceUsd: number | null; liquidityUsd: number | null; priceChange24h: number | null; tradeable: boolean; lastUpdateEpoch: number | null; ok: boolean;
};

/** One stop's split for one day (spec 6.7): what was applied, the raw model answer beside it, and why it fell back if it did. */
export type SplitDayRow = { day: string; stop: Stop; split: Split; modelAnswer: unknown | null; why: string | null; fallback: string | null; callId: number | null };

export type LinkCodeRow = {
  code: string;
  userPubkey: string;
  expiresAt: Date;
  nonce: bigint;
  walletPubkey: string | null;
  delegationPda: string | null;
  used: boolean;
};

/** The domain rules from a rules row (drops the row's identity columns). */
export function rulesRowToRules(r: RulesRow): Rules {
  return {
    roundupOn: r.roundupOn,
    roundupToCents: r.roundupToCents,
    pctOn: r.pctOn,
    pctBps: r.pctBps,
    pctThresholdCents: r.pctThresholdCents,
    plantThresholdCents: r.plantThresholdCents,
    plantMaxDays: r.plantMaxDays,
    dailyCapCents: r.dailyCapCents,
    managed: r.managed,
    stop: r.stop,
    pins: { ...r.pins },
    allocation: { ...r.allocation },
  };
}
