import { after } from "next/server";
import type { Repo } from "@/db/repo";
import { alertFounder, type AlertCard } from "./founder-alert";

/**
 * 11-19: Sprouts counts the Helius credits it spends, per billing cycle, so the founder hears at 70% and 90% of the free plan's
 * 1,000,000 (his ruling: upgrade at 70%). Each function instance keeps a pending count (rpc.ts's transport per request and per 429
 * retry, helius.ts per REST call, countingFetch for web3.js Connections and raw DAS posts, the swap webhook per delivered item) and
 * writes it as one `helius_credits` event at FLUSH_AT_CREDITS or every FLUSH_EVERY_MS (inside a request, via after()). The daily
 * run flushes its own count, then sums this cycle's rows and alerts once per level.
 *
 * The estimate errs LOW: an instance that dies before a flush loses at most FLUSH_AT_CREDITS uncounted credits (plus whatever it
 * counted within FLUSH_EVERY_MS); wss subscriptions (planting, staking, pyth sends) are not counted; another app on the same key is
 * not counted at all. So the 70% alert leaves a margin before 100%.
 */
export const HELIUS_MONTHLY_CREDITS = 1_000_000;
export const HELIUS_ALERT_LEVELS = [70, 90] as const;   // percent
export const HELIUS_CYCLE_DAY = 14;                       // the billing cycle starts on the 14th (UTC), per the dashboard
export const FLUSH_AT_CREDITS = 5_000;
export const FLUSH_EVERY_MS = 30 * 60_000;

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
let lastFlushMs = Date.now();
let scheduled = false;

/** Adds to this instance's pending count; at FLUSH_AT_CREDITS or FLUSH_EVERY_MS it schedules a flush (inside a request only). */
export function countHelius(credits: number, now: Date = new Date()): void {
  if (!(credits > 0)) return;
  pending += credits;
  if (scheduled || (pending < FLUSH_AT_CREDITS && now.getTime() - lastFlushMs < FLUSH_EVERY_MS)) return;
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
  pending -= credits;   // counts made while the write is in flight stay pending
  try {
    await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle: creditCycleStart(now), credits } });
  } catch (e) {
    pending += credits;
    throw e;
  }
  lastFlushMs = now.getTime();
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

const ROWS_LIMIT = 50_000;

/**
 * Sums this cycle's `helius_credits` rows. For the highest level reached that has no `helius_credit_alert` { cycle, level } yet
 * (and no higher one), writes that event, then posts to ops. A lower level is never posted after a higher one in the same cycle.
 */
export async function checkHeliusCredits(a: { repo: Repo; now: Date; alert?: (level: number, credits: number) => Promise<void> }): Promise<{ cycle: string; credits: number; alerted: number | null }> {
  const cycle = creditCycleStart(a.now);
  const since = new Date(`${cycle}T00:00:00Z`);
  const inCycle = (d: unknown) => (d as { cycle?: unknown } | null)?.cycle === cycle;
  const rows = await a.repo.listEventsByKind("helius_credits", since, ROWS_LIMIT);
  const credits = rows.filter((r) => inCycle(r.detail)).reduce((s, r) => {
    const c = Number((r.detail as { credits?: unknown }).credits);
    return Number.isFinite(c) && c > 0 ? s + c : s;
  }, 0);
  const reached = HELIUS_ALERT_LEVELS.filter((l) => credits * 100 >= l * HELIUS_MONTHLY_CREDITS);
  if (!reached.length) return { cycle, credits, alerted: null };
  const level = Math.max(...reached);
  const posted = (await a.repo.listEventsByKind("helius_credit_alert", since, 100))
    .filter((r) => inCycle(r.detail))
    .map((r) => Number((r.detail as { level?: unknown }).level));
  if (posted.some((p) => p >= level)) return { cycle, credits, alerted: null };
  // Written before the post: a failed post is lost (logged by alertFounder), never repeated daily.
  await a.repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credit_alert", detail: { cycle, level } });
  const alert = a.alert ?? ((l: number, c: number) => alertFounder(heliusCreditAlertCard(l, c, cycle)));
  await alert(level, credits);
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
  lastFlushMs = Date.now();
  scheduled = false;
}
