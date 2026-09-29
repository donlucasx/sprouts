import type { Rules } from "@/domain/roundup";
import type { Asset } from "@/domain/allocation";
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
  ledgerSkrCents: number;
  ledgerStoreCents: number;
  createdAt: Date;
};

export type RulesRow = Rules & { userPubkey: string; updatedAt: Date };

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
};

export type PlantingLegRow = { plantingId: string; asset: Asset; usdcInCents: number; amountOutRaw: bigint; staked: boolean; feeAmountRaw: bigint };

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

export type EventKind =
  | "wallet_linked"
  | "over_cap_rejected"
  | "revoke_seen"
  | "pull_failed"
  | "withdraw_failed"
  | "withdraw_skipped"
  | "run_stopped"
  | "paused_no_usdc"
  | "resumed"
  | "proposal_made"
  | "proposal_accepted";

export type EventRow = { id: number; userPubkey: string | null; walletPubkey: string | null; ts: Date; kind: EventKind; detail: unknown };

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
    allocation: { ...r.allocation },
  };
}
