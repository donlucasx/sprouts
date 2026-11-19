import { after } from "next/server";

/*
 * Fix round 2: the counting half of the Helius credit alert (helius-credits.ts holds the check and the ops post). rpc.ts imports
 * this module, and the app's tests load rpc.ts with '@' mapped to app/src, so this file imports nothing from api/src (no '@/',
 * no db/, no founder-alert), not even as a type. The module doc is in helius-credits.ts.
 */
export const HELIUS_CYCLE_DAY = 14;                       // the billing cycle starts on the 14th (UTC), per the dashboard
export const FLUSH_AT_CREDITS = 50;
/** A pending count whose oldest credit is older than this is flushed by the next request that counts anything. */
export const FLUSH_AFTER_MS = 60_000;

/** "YYYY-MM-DD" of the latest 14th at or before `now` (UTC). */
export function creditCycleStart(now: Date): string {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  if (now.getUTCDate() < HELIUS_CYCLE_DAY) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(HELIUS_CYCLE_DAY).padStart(2, "0")}`;
}

const TEN_CREDIT_METHODS: ReadonlySet<string> = new Set(["getProgramAccounts", "getAsset", "getAssetsByOwner", "getAssetBatch", "searchAssets", "getTokenAccounts"]);

/** Credits Helius bills for one JSON-RPC call: getProgramAccounts and DAS 10, anything else 1. */
export function rpcCreditCost(method: string): number {
  return TEN_CREDIT_METHODS.has(method) ? 10 : 1;
}

/**
 * Credits per Helius REST call. Webhook edits (create, PUT) 100; a webhook GET is not on Helius's price list, counted as 1 (an
 * RPC-like read: if it is really billed higher this errs low); Parsed Events 10 a page; the Enhanced parse 100.
 */
export const HELIUS_REST_COST = { webhookRead: 1, webhookWrite: 100, parseTransactions: 100, enhancedHistory: 100, parsedEvents: 10 } as const;

let pending = 0;
/** When the oldest credit still pending was counted (null when nothing is pending). */
let firstPendingMs: number | null = null;
let scheduled = false;

/** What a flush writes to: the Repo, narrowed so this module needs no import of db/ (repo.ts registers getRepo below). */
export type HeliusCreditWriter = { addEvent(e: { userPubkey: null; walletPubkey: null; kind: "helius_credits"; detail: { cycle: string; credits: number } }): Promise<void> };
let flushTarget: (() => Promise<HeliusCreditWriter>) | null = null;
/** db/repo.ts calls this at load with getRepo, so a request's after() flush can write without this module importing db/. */
export function setHeliusFlushTarget(get: (() => Promise<HeliusCreditWriter>) | null) {
  flushTarget = get;
}

/**
 * Adds to this instance's pending count. Inside a request, once pending reaches FLUSH_AT_CREDITS or its oldest credit is over
 * FLUSH_AFTER_MS old, schedules one flush in after() (one per request: `scheduled` stays set until that flush ends). Outside a
 * request it only accumulates.
 */
export function countHelius(credits: number, now: Date = new Date()): void {
  if (!(credits > 0)) return;
  if (pending <= 0 || firstPendingMs === null) firstPendingMs = now.getTime();
  pending += credits;
  if (scheduled || (pending < FLUSH_AT_CREDITS && now.getTime() - firstPendingMs <= FLUSH_AFTER_MS)) return;
  const target = flushTarget;
  if (!target) return;   // no repo in this bundle (the app's tests, a script): only accumulate
  try {
    after(async () => {
      try {
        await flushHeliusCredits(await target(), new Date());
      } catch (e) {
        console.error(`helius credits: flush failed (kept pending): ${e instanceof Error ? e.name : "error"}`);
      } finally {
        scheduled = false;
      }
    });
    scheduled = true;
  } catch {
    // Outside a request (a script, a test, module load): only accumulate; the next request or the daily run flushes.
  }
}

/** Writes the pending count as one `helius_credits` event; returns what it wrote. A failed write keeps the count pending (and throws). */
export async function flushHeliusCredits(repo: HeliusCreditWriter, now: Date): Promise<number> {
  const credits = pending;
  if (credits <= 0) return 0;
  const since = firstPendingMs;
  pending -= credits;   // counts made while the write is in flight stay pending
  firstPendingMs = null;
  try {
    await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle: creditCycleStart(now), credits } });
  } catch (e) {
    pending += credits;
    firstPendingMs = since;   // the failed count keeps its age
    throw e;
  }
  return credits;
}

/** The JSON-RPC methods in a request body (one call or a batch); unreadable counts as one plain call. */
function bodyMethods(body: unknown): string[] {
  if (typeof body !== "string") return ["?"];
  try {
    const j = JSON.parse(body) as unknown;
    const calls = Array.isArray(j) ? j : [j];
    return calls.map((c) => (typeof (c as { method?: unknown })?.method === "string" ? (c as { method: string }).method : "?"));
  } catch {
    return ["?"];
  }
}

/** A fetch that counts each JSON-RPC call it sends (web3.js `Connection({ fetch })`, raw DAS posts), then sends it unchanged. */
export function countingFetch(inner: typeof fetch = fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    countHelius(bodyMethods(init?.body).reduce((s, m) => s + rpcCreditCost(m), 0));
    return inner(input, init);
  }) as typeof fetch;
}

/** Tests only. */
export const pendingHeliusCredits = () => pending;
/** Tests only. */
export function _resetHeliusCredits() {
  pending = 0;
  firstPendingMs = null;
  scheduled = false;
}
