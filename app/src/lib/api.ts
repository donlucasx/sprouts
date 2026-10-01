import { loadSession } from "./session";

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

// Response types the screens use. Every raw amount is a decimal string (bigint on the wire).
export type Asset = "SKR" | "stORE" | "hSOL" | "JitoSOL" | "JupSOL" | "cbBTC";
/** The registry's order, the order every list in the app shows. */
export const ASSETS: readonly Asset[] = ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const;
export type Stop = "careful" | "balanced" | "bold";
/** Whole percents per coin, summing to 100. */
export type Split = Record<Asset, number>;
/** The user's pins: a fixed percent per coin; a missing coin is the manager's to set, or 0 when the manager is off. */
export type Pins = Partial<Record<Asset, number>>;
/** One wallet-held coin as /api/me serves it (zero balances are omitted). */
export type Holding = { asset: Asset; heldRaw: string; putInCents: number; valueUsd: number | null; earnedUsd: number | null; earnedUnderlyingRaw: string | null };
/** The Yield Manager block of /api/me. `changedDay` is a UTC date; `stopSplit` is today's split for the user's stop (the stop default before the first run). */
export type Manager = { managed: boolean; stop: Stop; pins: Pins; changedDay: string | null; undoAvailable: boolean; why: string | null; fallback: string | null; stopSplit: Split };
/** One split change as /api/activity serves it. */
export type SplitRow = { ts: string; by: "manager" | "you" | "undo"; from: Split; to: Split; stop: string | null; why: string | null; fallback: string | null };

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
    plantings: { id: string; ts: string; asset: Asset; usdcInCents: number; amountOutRaw: string; feeCents: number; signature: string | null }[];
    picks: { ts: string; asset: Asset; amountRaw: string }[];
  };
  nextPlanting: { pendingCents: number; thresholdCents: number; capLeftCents: number; asset: Asset };
  lastReceipt: { ts: string; usdcPulledCents: number; networkFeeCents: number; asset: Asset; amountOutRaw: string; feeCents: number; usdPrice: number | null; signature: string | null } | null;
  basket: { id: string; asset: "SKR"; amountRaw: string; unstakeTs: string; readyAt: string; delivered: boolean; deliveredSignature: string | null } | null;
  wallets: { pubkey: string; status: "active" | "paused" | "revoked"; dailyCapCents: number }[];
  rules: {
    roundupOn: boolean; roundupToCents: number; pctOn: boolean; pctBps: number; pctThresholdCents: number; plantThresholdCents: number; plantMaxDays: number; dailyCapCents: number;
    managed: boolean; stop: Stop; pins: Pins; allocation: Split;
  };
};

/** As GET /api/activity answers (Plan 2 Task 2), newest first, fifty of each. */
export type ActivityResponse = {
  splits: SplitRow[];
  swaps: { signature: string; ts: string; walletPubkey: string; usdSizeCents: number | null; class: string; roundupCents: number; plantingId: string | null }[];
  plantings: {
    id: string; ts: string; status: "sent" | "confirmed" | "failed"; signature: string | null; usdcPulledCents: number; networkFeeCents: number;
    legs: { asset: Asset; usdcInCents: number; amountOutRaw: string; feeCents: number; feeAmountRaw: string }[];
  }[];
  withdrawals: {
    id: string; ts: string; asset: Asset; source: "sprouts" | "wallet"; amountRaw: string | null; principalRaw: string;
    unstakeSignature: string | null; withdrawSignature: string | null; cancelled: boolean; delivered: boolean;
  }[];
};
