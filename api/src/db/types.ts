import type { Rules } from "@/domain/roundup";
import type { Asset } from "@/domain/allocation";
import type { SwapClass } from "@/domain/classify";

export type UserRow = { seedVaultPubkey: string; sgtMint: string; skrName: string | null; proUntil: Date | null; createdAt: Date };

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
};

export type PlantingLegRow = { plantingId: string; asset: Asset; usdcInCents: number; amountOutRaw: bigint; staked: boolean; feeAmountRaw: bigint };

export type WithdrawalRow = {
  id: string;
  userPubkey: string;
  asset: Asset;
  unstakeTs: Date;
  unstakeSignature: string | null;
  withdrawSignature: string | null;
  amountOutRaw: bigint | null;
  rewardDeltaRaw: bigint | null;
};

export type EventKind =
  | "wallet_linked"
  | "over_cap_rejected"
  | "revoke_seen"
  | "pull_failed"
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
