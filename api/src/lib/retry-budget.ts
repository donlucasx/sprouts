import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 11-26 (Helius Developer plan; Kimi limits answer 3b): the user-facing builds where users lost links and withdrawals to a 429 (the link
 * approval GET, withdraw/build) get one more 429 retry than the daily run (rpc.ts RETRY_DELAYS_MS, about 0.5 s, 1 s, 2 s): about 0.5 s,
 * 1 s, 2 s, 4 s. The daily run can skip a wallet and try tomorrow; a user who reads "try again" may not. A link approval's blockhash
 * lives ~60-90 s, so ~4 s more (jittered 2-6 s) is cheap. Kept apart from rpc.ts so route tests that mock "@/lib/rpc" still load it.
 */
export const USER_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

/** The 429 waits for the request in flight: set by withUserRetryBudget, read by rpc.ts's withRetryOn429 (undefined = the default). */
export const retryBudget = new AsyncLocalStorage<readonly number[]>();

/** Runs a route handler with the user-facing 429 budget (USER_RETRY_DELAYS_MS) for every rpc() request it makes; any other caller keeps RETRY_DELAYS_MS. */
export function withUserRetryBudget<A extends unknown[], R>(handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => retryBudget.run(USER_RETRY_DELAYS_MS, () => handler(...args));
}
