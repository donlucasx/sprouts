import {
  createDefaultRpcTransport, createSolanaRpcFromTransport,
  type Rpc, type RpcTransport, type SolanaRpcApi,
} from "@solana/kit";
import { config } from "./config";
import { redactError } from "./redact";
import { countHelius, rpcCreditCost } from "./helius-count";

let cached: Rpc<SolanaRpcApi> | null = null;

/** K-M10: the default transport, with any error it throws redacted (the URL carries the Helius key) before a caller logs it. */
export function rpc(): Rpc<SolanaRpcApi> {
  if (!cached) cached = createSolanaRpcFromTransport(rpcTransport(config().heliusRpcUrl));
  return cached;
}

/** Waits between 429 retries: about 0.5 s, 1 s, 2 s. */
export const RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;
/** A Retry-After header longer than this is cut to it, so one request never parks a cron run for long. */
export const RETRY_AFTER_CAP_MS = 2_000;
// 11-26: the user-facing routes' longer 429 budget lives in retry-budget.ts (no rpc import, so route tests that mock "@/lib/rpc" keep it).
export { USER_RETRY_DELAYS_MS, withUserRetryBudget } from "./retry-budget";
import { retryBudget } from "./retry-budget";

export type RetryOptions = { sleep?: (ms: number) => Promise<void>; random?: () => number };

/** The HTTP transport for `url`: each attempt counted (Helius credits), 429s retried (withRetryOn429), then any error redacted. Exported for tests. */
export function rpcTransport(url: string, opts: RetryOptions = {}): RpcTransport {
  // 11-24: every attempt (a retry too) waits its turn in the process-wide pace, then is counted and sent.
  const retrying = withRetryOn429(withRpcPace(countingTransport(createDefaultRpcTransport({ url }))), opts);
  return (async (req: Parameters<RpcTransport>[0]) => {
    try {
      return await retrying(req);
    } catch (e) {
      throw redactError(e);
    }
  }) as RpcTransport;
}

/** 11-19: counts each request it sends by method (rpcCreditCost); inside the 429 retry, since each attempt is billed. */
export function countingTransport(inner: RpcTransport): RpcTransport {
  return (async (req: Parameters<RpcTransport>[0]) => {
    const method = (req.payload as { method?: unknown } | null)?.method;
    countHelius(rpcCreditCost(typeof method === "string" ? method : "?"));
    return inner(req);
  }) as RpcTransport;
}

/**
 * 11-13: Helius answers HTTP 429 when the daily run's reads and sends bunch up (seen on the free plan, 10 requests a second: that day
 * one SKR price post and one withdrawal crank failed and waited a day; the Developer plan since 11-26 allows 50 a second, sendTransaction
 * 5 and DAS 10, so a 429 is rarer, not gone). kit reports it as SolanaError SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR (8100002) with
 * context.statusCode 429 and context.headers (the response's Headers). Such a request is tried again up to 3 times, after about
 * 0.5 s, 1 s and 2 s (4 times, adding about 4 s, inside withUserRetryBudget), each times a random 0.5x-1.5x so parallel 429'd reads
 * spread out, or after the server's Retry-After (at most 2 s). Worst case about 5.25 s added per request (11.25 s on the user budget).
 * Any other error throws at once, unchanged.
 *
 * Retrying a 429'd sendTransaction is safe: the node rejected the request before reading it, so nothing was forwarded; and if a
 * copy ever did land, a resend of the same signed bytes carries the same signature, which the network dedupes (one transaction).
 */
export function withRetryOn429(inner: RpcTransport, opts: RetryOptions = {}): RpcTransport {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  return (async (req: Parameters<RpcTransport>[0]) => {
    const delays = retryBudget.getStore() ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        return await inner(req);
      } catch (e) {
        if (!isHttp429(e) || attempt >= delays.length) throw e;
        const after = retryAfterMs(e);
        await sleep(after ?? Math.round(delays[attempt] * (0.5 + random())));
      }
    }
  }) as RpcTransport;
}

export { isHttp429 } from "./http429";
import { isHttp429 } from "./http429";

/**
 * 11-24 (the daily run with 100 wallets met Helius 429s past every retry and stopped): at most RPC_MAX_RPS requests start in any
 * rolling second, per process, first come first served. 11-26 (Helius Developer plan, Kimi scope 2 A): 8 -> 30. The plan allows 50 a
 * second for the whole key; 30 per process leaves room for the webhook and a second instance (the pace cannot see other instances),
 * and a 429 that still gets through is retried (withRetryOn429), then a cheap "rpc busy" skip for one wallet, not an outage. No own pace
 * for sendTransaction (5/s) or DAS (10/s): sends are user-paced and safe to retry, DAS rides cached reads; add one only if the logs
 * show method-specific 429s. A wait over a second is logged so the pace can be tuned.
 */
export const RPC_MAX_RPS = 30;
export type PaceOptions = { maxPerSecond?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void };
export function createPace(opts: PaceOptions = {}): () => Promise<void> {
  // 11-27: the queue itself moved to pace.ts (the Jupiter pace is the same queue over a 60 s window); this is the RPC's 1 s one.
  const pace = createWindowPace({ max: opts.maxPerSecond ?? RPC_MAX_RPS, windowMs: 1000, now: opts.now, sleep: opts.sleep, log: opts.log, label: "rpc pace", logOverMs: 1000 });
  return () => pace();
}
import { createWindowPace } from "./pace";
// The test suite runs without the process-wide pace (its fake clocks would queue requests behind a frozen second); the pace itself
// is tested through createPace.
const processPace = createPace({ maxPerSecond: process.env.VITEST ? 0 : RPC_MAX_RPS });
/** The transport behind the pace: each call waits for `pace` (the process-wide one unless a test passes its own), then sends. */
export function withRpcPace(inner: RpcTransport, pace: () => Promise<void> = processPace): RpcTransport {
  return (async (req: Parameters<RpcTransport>[0]) => {
    await pace();
    return inner(req);
  }) as RpcTransport;
}

/** The Retry-After header (seconds or an HTTP date) in ms, capped at RETRY_AFTER_CAP_MS; null when absent or unreadable. */
function retryAfterMs(e: unknown): number | null {
  const headers = (e as { context?: { headers?: unknown } }).context?.headers;
  const raw = headers && typeof (headers as Headers).get === "function" ? (headers as Headers).get("retry-after") : null;
  if (!raw) return null;
  const secs = Number(raw.trim());
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}
