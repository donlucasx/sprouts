import type { Repo } from "@/db/repo";
import { alertFounder, type AlertCard } from "./founder-alert";
import { creditCycleStart } from "./helius-count";

export {
  HELIUS_CYCLE_DAY, FLUSH_AT_CREDITS, FLUSH_AFTER_MS, HELIUS_REST_COST, creditCycleStart, rpcCreditCost, countHelius, flushHeliusCredits,
  countingFetch, setHeliusFlushTarget, pendingHeliusCredits, _resetHeliusCredits, type HeliusCreditWriter,
} from "./helius-count";

/**
 * 11-19: Sprouts counts the Helius credits it spends, per billing cycle, so the founder hears at 70% and 90% of the plan's credits
 * (his ruling: upgrade at 70%). 11-26: the Developer plan (10,000,000 a cycle) replaced the free plan's 1,000,000. Each function instance keeps a pending count (rpc.ts's transport per request and per 429
 * retry, helius.ts per REST call, countingFetch for web3.js Connections and raw DAS posts, the swap webhook per delivered item).
 * Review fix 1: a request that counts anything writes the pending count as one `helius_credits` event in its after() hook once the
 * pending count reaches FLUSH_AT_CREDITS (50) or its oldest unflushed credit is over FLUSH_AFTER_MS (60 s) old: at most one insert
 * per request. The daily run flushes its own count, then sums this cycle's rows and alerts once per level. Fix round 2: the
 * counting lives in helius-count.ts (no api imports, so the app's tests can load rpc.ts); this module adds the check and the post.
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
export const HELIUS_MONTHLY_CREDITS = 10_000_000;   // Developer plan, since 11-26 (was 1,000,000 on the free plan)
export const HELIUS_ALERT_LEVELS = [70, 90] as const;   // percent

/** The ops card for a level reached. */
export function heliusCreditAlertCard(level: number, credits: number, cycle: string): AlertCard {
  return {
    channel: "ops",
    title: `Helius credits at ${level}%`,
    text: `About ${credits.toLocaleString("en-US")} of ${HELIUS_MONTHLY_CREDITS.toLocaleString("en-US")} Helius credits used this cycle (since ${cycle}), counted by Sprouts itself. Other apps on the same key are not counted.`,
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

