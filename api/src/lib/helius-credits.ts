import { after } from "next/server";
import type { Repo } from "@/db/repo";
import { alertFounder, type AlertCard } from "./founder-alert";

/**
 * 11-19: Sprouts counts the Helius credits it spends, per billing cycle, so the founder hears at 70% and 90% of the free plan's
 * 1,000,000 (his ruling: upgrade at 70%). Each function instance keeps a pending count (rpc.ts's transport per request and per 429
 * retry, helius.ts per REST call, countingFetch for web3.js Connections and raw DAS posts, the swap webhook per delivered item).
 * Review fix 1: a request that counts anything writes the pending count as one `helius_credits` event in its after() hook once the
 * pending count reaches FLUSH_AT_CREDITS (50) or its oldest unflushed credit is over FLUSH_AFTER_MS (60 s) old: at most one insert
 * per request. The daily run flushes its own count, then sums this cycle's rows and alerts once per level.
 *
 * What the estimate misses (it errs LOW):
 * - an instance that is recycled before a flush loses its tail: under FLUSH_AT_CREDITS, so at most ~50 credits per instance lifetime
 *   (plus a request whose after() never ran);
 * - wss subscriptions (planting, staking, pyth sends) are not counted; a webhook GET counts 1 (unpublished price);
 * - another app on the same key is not counted at all (the alert text says so).
 * What errs SAFE (late or early, never silent):
 * - the check runs in the daily job (14:00 UTC), so an alert can lag a crossing by up to ~24 h;
 * - the cycle boundary is the 14th at 00:00 UTC, an assumption from the dashboard's date (its own time zone is not shown): a few
 *   hours of the old cycle may be summed into the new one, which reads high, never low.
 */
export const HELIUS_MONTHLY_CREDITS = 1_000_000;
export const HELIUS_ALERT_LEVELS = [70, 90] as const;   // percent
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
  try {
    after(async () => {
      try {
        const { getRepo } = await import("@/db/repo");
        await flushHeliusCredits(await getRepo(), new Date());
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
export async function flushHeliusCredits(repo: Repo, now: Date): Promise<number> {
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

/** The ops card for a level reached. */
export function heliusCreditAlertCard(level: number, credits: number, cycle: string): AlertCard {
  return {
    channel: "ops",
    title: `Helius credits at ${level}%`,
    text: `About ${credits.toLocaleString("en-US")} of 1,000,000 Helius credits used this cycle (since ${cycle}), counted by Sprouts itself. Other apps on the same key are not counted.`,
    todo: "Check the Helius dashboard. Cut previews and the swap check, or move the other app off this key",
  };
}

/**
 * Sums every `helius_credits` row of this cycle (no row cap). For the highest level reached that has no `helius_credit_alert`
 * { cycle, level } yet (and no higher one), posts to ops and, only when the post was delivered, writes that marker. A failed post
 * writes nothing, so the next daily check posts again (a duplicate beats a lost alert). A lower level is never posted after a
 * higher one in the same cycle.
 */
export async function checkHeliusCredits(a: { repo: Repo; now: Date; alert?: (level: number, credits: number) => Promise<boolean> }): Promise<{ cycle: string; credits: number; alerted: number | null }> {
  const cycle = creditCycleStart(a.now);
  const since = new Date(`${cycle}T00:00:00Z`);
  const inCycle = (d: unknown) => (d as { cycle?: unknown } | null)?.cycle === cycle;
  const rows = await a.repo.listEventsByKind("helius_credits", since);
  const credits = rows.filter((r) => inCycle(r.detail)).reduce((s, r) => {
    const c = Number((r.detail as { credits?: unknown }).credits);
    return Number.isFinite(c) && c > 0 ? s + c : s;
  }, 0);
  const reached = HELIUS_ALERT_LEVELS.filter((l) => credits * 100 >= l * HELIUS_MONTHLY_CREDITS);
  if (!reached.length) return { cycle, credits, alerted: null };
  const level = Math.max(...reached);
  const posted = (await a.repo.listEventsByKind("helius_credit_alert", since))
    .filter((r) => inCycle(r.detail))
    .map((r) => Number((r.detail as { level?: unknown }).level));
  if (posted.some((p) => p >= level)) return { cycle, credits, alerted: null };
  const alert = a.alert ?? ((l: number, c: number) => alertFounder(heliusCreditAlertCard(l, c, cycle)));
  if (!(await alert(level, credits))) {
    console.error(`helius credits: the ${level}% alert was not delivered; the next daily check tries again`);
    return { cycle, credits, alerted: null };
  }
  await a.repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credit_alert", detail: { cycle, level } });
  return { cycle, credits, alerted: level };
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
