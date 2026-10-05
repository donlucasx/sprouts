import { loadSession } from "./session";
import type { Asset, AutoVenue, LendAsset, LiveAsset, Stop, Split, Pins, Venue } from "./coins";
export { ASSETS } from "./coins";
export type { Asset, AutoVenue, LendAsset, LiveAsset, Stop, Split, Pins, Venue } from "./coins";

/** The API's origin: public, overridable at build time through eas.json's env (Task 0 ruling: no env file in the app). */
export const API_ORIGIN = process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://sprouts.money";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** One fetch for every call: JSON in, JSON out, the session bearer when there is one, the API's own sentence on failure. */
export async function api<T>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.auth !== false) {
    const s = await loadSession();
    if (s) headers.authorization = `Bearer ${s.token}`;
  }
  const res = await fetch(`${API_ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

// Response types the screens use. Every raw amount is a decimal string (bigint on the wire). Contracts section 5; the fields Track A
// adds are OPTIONAL here on purpose (the app ships before the API and phones keep cached reads): read them with `?? default`.
export type VetoReason = "incentive_spike" | "near_full" | "deposits_fleeing" | "data_suspect";
export type MoveStatus = "open" | "dismissed" | "expired" | "done" | "failed";
/** One wallet-held leg as /api/me serves it (zero balances are omitted); USDC_LEND/SOL_LEND are one aggregated row each, heldRaw in UNDERLYING units. */
export type Holding = { asset: LiveAsset; heldRaw: string; putInCents: number; valueUsd: number | null; earnedUsd: number | null; earnedUnderlyingRaw: string | null; growthPct?: number | null };
/** Contracts 5.2: one lending position per (asset, venue) with receiptRaw > 0. receiptRaw in receipt units; underlyingRaw in USDC 6 / SOL 9. */
export type LendingPosition = { asset: LendAsset; venue: AutoVenue; receiptMint: string; receiptRaw: string; underlyingRaw: string; valueUsd: number | null; ratePct: number | null; avg7Pct: number | null; earnedUsd: number | null; putInCents: number; withdrawableUsd: number | null; poolFull: boolean };
/** Contracts 7.2: the two-line garden sign the API serves ready to draw. */
export type LendSign = { line1: "USDC" | "SOL"; line2: string; venue: AutoVenue; ratePct: number };
/** Contracts 5.4. */
export type MoveProposal = { id: string; ts: string; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: string; valueUsd: number; fromAvg7Pct: number; toAvg7Pct: number; gain30dUsd: number; costUsd: number };
export type FoundVenue = { day: string; project: string; symbol: string; asset: "USDC" | "SOL"; apyBasePct: number | null; tvlUsd: number | null; note: string | null };
/** Contracts 5.1. */
export type VenueRow = { venue: Venue; asset: LendAsset; name: string; auto: boolean; supplyPct: number | null; rewardsPct: number | null; avg7Pct: number | null; daysMeasured: number; utilizationPct: number | null; tvlUsd: number | null; withdrawableUsd: number | null; eligible: boolean; verdict: "ok" | "avoid" | null; reason: VetoReason | null; picked: boolean; note: string | null };
export type VenuesResponse = { day: string; venues: VenueRow[]; picks: Partial<Record<LendAsset, AutoVenue | null>>; why: string | null; found: FoundVenue[] };
/** The Yield Manager block of /api/me. `changedDay` is a UTC date; `stopSplit` is today's split for the user's stop (the stop default before the first run). */
export type Manager = { managed: boolean; stop: Stop; pins: Pins; changedDay: string | null; undoAvailable: boolean; why: string | null; fallback: string | null; stopSplit: Split;
  picks?: Partial<Record<LendAsset, AutoVenue | null>>; legsEnabled?: LiveAsset[] | null };   // contracts 5.2: legsEnabled null = not leashed
/** One split change as /api/activity serves it; old rows carry JitoSOL/JupSOL keys (contracts 5.7), so the maps are partial and string-keyed. */
/** `managed` is the switch after a save by you; `turnedOn` when that save moved it off to on (absent on rows from before 10-01). */
export type SplitRow = { ts: string; by: "manager" | "you" | "undo"; from: Partial<Record<string, number>>; to: Partial<Record<string, number>>; stop: string | null; why: string | null; fallback: string | null; managed?: boolean | null; turnedOn?: boolean };

export type MeResponse = {
  user: { pubkey: string; skrName: string | null; joinedAt: string; wateredAt: string | null };
  pot: {
    skrStakedRaw: string; skrPutInRaw: string; skrEarnedRaw: string; skrPickedRaw: string; skrPrincipalPickedRaw: string; joinedValueRaw: string;
    fruit: number; nextFruitProgress: number; skrUnstakingRaw: string; skrUnstakeReadyAt: string | null;
    storeRaw: string; storePutInRaw: string; storeEarnedRaw: string; storeRedeemRate: string | null;
    skrUsd: number | null; storeUsd: number | null; asOf: string;
  };
  holdings: Holding[];
  manager: Manager;
  history: {
    plantings: { id: string; ts: string; asset: Asset; usdcInCents: number; amountOutRaw: string; feeCents: number; signature: string | null; venue?: AutoVenue | null }[];
    picks: { ts: string; asset: Asset; amountRaw: string }[];
  };
  nextPlanting: { pendingCents: number; thresholdCents: number; capLeftCents: number; asset: LiveAsset };
  lastReceipt: { ts: string; usdcPulledCents: number; networkFeeCents: number; asset: Asset; amountOutRaw: string; feeCents: number; feeAmountRaw?: string; usdPrice: number | null; signature: string | null; venue?: AutoVenue | null } | null;
  basket: { id: string; asset: "SKR"; amountRaw: string; unstakeTs: string; readyAt: string; delivered: boolean; deliveredSignature: string | null } | null;
  wallets: { pubkey: string; status: "active" | "paused" | "revoked"; dailyCapCents: number; linkModel?: "puller" | "leash" }[];
  rules: {
    roundupOn: boolean; roundupToCents: number; pctOn: boolean; pctBps: number; pctThresholdCents: number; plantThresholdCents: number; plantMaxDays: number; dailyCapCents: number;
    managed: boolean; stop: Stop; pins: Pins; allocation: Split;
  };
  // contracts 5.2, Track A: absent from the API on main a6d6f32
  positions?: LendingPosition[];
  lendSigns?: Partial<Record<LendAsset, LendSign | null>>;
  relink?: { needed: boolean; wallets: { pubkey: string; via: "app" | "link_page" }[] };
  terms?: { currentVersion: string; acceptedVersion: string | null };
  moveProposal?: MoveProposal | null;
};

/** As GET /api/activity answers (Plan 2 Task 2), newest first, fifty of each. Contracts 5.7 adds the optional lists. */
export type ActivityResponse = {
  splits: SplitRow[];
  swaps: { signature: string; ts: string; walletPubkey: string; usdSizeCents: number | null; class: string; roundupCents: number; plantingId: string | null }[];
  plantings: {
    id: string; ts: string; status: "sent" | "confirmed" | "failed"; signature: string | null; usdcPulledCents: number; networkFeeCents: number;
    legs: { asset: Asset; usdcInCents: number; amountOutRaw: string; feeCents: number; feeAmountRaw: string; usdPrice: number | null; venue?: AutoVenue | null }[];
  }[];
  withdrawals: {
    id: string; ts: string; asset: Asset; source: "sprouts" | "wallet"; amountRaw: string | null; principalRaw: string;
    unstakeSignature: string | null; withdrawSignature: string | null; cancelled: boolean; delivered: boolean;
  }[];
  /** underlyingRaw: asked of Track A (this plan's contract note); without it the line names no amount. */
  lendWithdrawals?: { ts: string; asset: LendAsset; venue: AutoVenue; receiptRaw: string; underlyingRaw?: string; signature: string }[];
  moves?: { ts: string; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: string; status: MoveStatus }[];
  found?: FoundVenue[];
};
