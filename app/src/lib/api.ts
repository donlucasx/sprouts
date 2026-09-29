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
export type Asset = "SKR" | "stORE";

export type MeResponse = {
  user: { pubkey: string; skrName: string | null; joinedAt: string; wateredAt: string | null };
  pot: {
    skrStakedRaw: string; skrPutInRaw: string; skrEarnedRaw: string; skrPickedRaw: string; skrPrincipalPickedRaw: string; joinedValueRaw: string;
    fruit: number; nextFruitProgress: number; skrUnstakingRaw: string; skrUnstakeReadyAt: string | null;
    storeRaw: string; storePutInRaw: string; storeEarnedRaw: string; storeRedeemRate: string | null;
    skrUsd: number | null; storeUsd: number | null; asOf: string;
  };
  history: {
    plantings: { id: string; ts: string; asset: Asset; usdcInCents: number; amountOutRaw: string; signature: string | null }[];
    picks: { ts: string; asset: Asset; amountRaw: string }[];
  };
  nextPlanting: { pendingCents: number; thresholdCents: number; capLeftCents: number };
  lastReceipt: { ts: string; usdcPulledCents: number; networkFeeCents: number; asset: Asset; amountOutRaw: string; signature: string | null } | null;
  basket: { id: string; asset: "SKR"; amountRaw: string; unstakeTs: string; readyAt: string; delivered: boolean; deliveredSignature: string | null } | null;
  wallets: { pubkey: string; status: "active" | "paused" | "revoked"; dailyCapCents: number }[];
  rules: { roundupOn: boolean; roundupToCents: number; pctOn: boolean; pctBps: number; pctThresholdCents: number; plantThresholdCents: number; plantMaxDays: number; dailyCapCents: number; allocation: { SKR: number; stORE: number } };
};

/** As GET /api/activity answers (Plan 2 Task 2), newest first, fifty of each. */
export type ActivityResponse = {
  swaps: { signature: string; ts: string; walletPubkey: string; usdSizeCents: number | null; class: string; roundupCents: number; plantingId: string | null }[];
  plantings: {
    id: string; ts: string; status: "sent" | "confirmed" | "failed"; signature: string | null; usdcPulledCents: number; networkFeeCents: number;
    legs: { asset: Asset; usdcInCents: number; amountOutRaw: string; feeAmountRaw: string }[];
  }[];
  withdrawals: {
    id: string; ts: string; asset: Asset; source: "sprouts" | "wallet"; amountRaw: string | null; principalRaw: string;
    unstakeSignature: string | null; withdrawSignature: string | null; cancelled: boolean; delivered: boolean;
  }[];
};
