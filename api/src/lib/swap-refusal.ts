import type { Repo } from "@/db/repo";

/**
 * Ops #9 (11-14): the missed-swaps measurement found 3 swaps on chain that were never booked and could not say why: the webhook
 * route only logged a refused or failed item to the Vercel log. Now each one also leaves a `swap_refused` event, so "never
 * delivered" can be told from "delivered and refused". Routine items (not a swap, a top-up, a puller planting, already booked) write
 * nothing: a spam-heavy wallet sends hundreds of them. The detail is a short reason enum and the first 8 characters of the
 * signature; never the refusal text (it can quote an RPC error), never the payload.
 */
export type RefusalReason =
  | "not_found" | "failed_on_chain" | "not_signer" | "no_block_time" | "time_mismatch" | "not_recent"
  | "in_leg_over" | "out_leg_over" | "chain_read_error" | "error" | "other";

/** verify-swap.ts's refusal strings, by their fixed wording (checkSwapOnChain and onChainVerifier). */
export function refusalReason(text: string): RefusalReason {
  if (text === "not found on chain") return "not_found";
  if (text === "failed on chain") return "failed_on_chain";
  if (text === "the wallet did not sign it") return "not_signer";
  if (text === "no block time") return "no_block_time";
  if (text.startsWith("the event's time ")) return "time_mismatch";
  if (text.startsWith("the block time ") && text.endsWith(" is not recent")) return "not_recent";
  if (text.startsWith("the in-leg ")) return "in_leg_over";
  if (text.startsWith("the out-leg ")) return "out_leg_over";
  if (text.startsWith("the chain could not be read")) return "chain_read_error";
  return "other";
}

/** How long one event write may hold the webhook's booking loop (failure-log.ts's LOG_WAIT_MS). */
export const REFUSAL_WAIT_MS = 2_000;
/** One delivery writes at most this many refusal events: a flood of forged or odd items cannot fill the table. */
export const MAX_REFUSAL_EVENTS_PER_DELIVERY = 10;

/** First 8 base58 characters of the signature (a posted value: anything else is dropped). */
const shortSig = (sig: unknown) => String(sig ?? "").replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 8);

/** Writes one `swap_refused` event. Never throws; gives up waiting after REFUSAL_WAIT_MS (the write may still land). */
export async function recordSwapRefusal(repo: Repo, r: { signature: string; walletPubkey: string | null; reason: RefusalReason }, waitMs = REFUSAL_WAIT_MS): Promise<void> {
  const write = (async () => {
    try {
      await repo.addEvent({ kind: "swap_refused", userPubkey: null, walletPubkey: r.walletPubkey, detail: { reason: r.reason, sig: shortSig(r.signature) } });
    } catch (e) {
      console.error(`swap_refused not recorded: ${e instanceof Error ? e.name : "error"}`);
    }
  })();
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([write, new Promise<void>((resolve) => { t = setTimeout(resolve, waitMs); })]);
  clearTimeout(t);
}
