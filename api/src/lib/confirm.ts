import { getBase64EncodedWireTransaction, getSignatureFromTransaction, type Signature } from "@solana/kit";
import { rpc } from "./rpc";

/**
 * 11-24 (Kimi audit idea 1): send, then confirm by asking the chain over HTTP, never over a websocket. The Helius free plan's
 * subscriptions failed to connect (SolanaError 8190004) on price posts 11-23 and on three planting confirms 11-24, each leaving a
 * transaction in an unknown state for a day. Every read goes through rpc()'s paced, 429-retried transport.
 *
 * Same contract as kit's sendAndConfirmTransactionFactory at "confirmed": the send runs the node's preflight (a refused preflight
 * throws the same -32002 SolanaError), it sends once (no rebroadcast), and it returns once the signature is confirmed or finalized.
 * A transaction that landed with an error throws ConfirmError "failed"; one whose blockhash expired unseen throws "expired"; past
 * CONFIRM_CAP_MS it throws "unconfirmed". Callers already treat any throw as unknown and ask the chain.
 */
export const CONFIRM_POLL_MS = 2_000;
export const CONFIRM_CAP_MS = 90_000;
/** How often (in polls) the block height is read against the blockhash's lastValidBlockHeight. */
export const HEIGHT_EVERY = 3;

export class ConfirmError extends Error {
  constructor(readonly kind: "failed" | "expired" | "unconfirmed", readonly signature: string, detail: string) {
    super(`transaction ${signature} ${kind}: ${detail}`);
    this.name = "ConfirmError";
  }
}

type Tx = Parameters<typeof getSignatureFromTransaction>[0] & { lifetimeConstraint: { lastValidBlockHeight: bigint } };
type Status = { err: unknown; confirmationStatus: string | null } | null;
export type ConfirmDeps = {
  send: (wireBase64: string) => Promise<unknown>;
  status: (sig: Signature) => Promise<Status>;
  blockHeight: () => Promise<bigint>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

function liveDeps(): ConfirmDeps {
  return {
    send: (wire) => rpc().sendTransaction(wire as Parameters<ReturnType<typeof rpc>["sendTransaction"]>[0], { encoding: "base64", preflightCommitment: "confirmed" }).send(),
    status: async (sig) => (await rpc().getSignatureStatuses([sig]).send()).value[0] as Status,
    blockHeight: () => rpc().getBlockHeight({ commitment: "confirmed" }).send(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  };
}

const json = (v: unknown) => { try { return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)); } catch { return String(v); } };
const landed = (s: Status) => !!s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized");

export async function sendAndConfirmByPolling(tx: Tx, deps: ConfirmDeps = liveDeps()): Promise<Signature> {
  const sig = getSignatureFromTransaction(tx);
  await deps.send(getBase64EncodedWireTransaction(tx));
  const started = deps.now();
  for (let poll = 1; ; poll++) {
    await deps.sleep(CONFIRM_POLL_MS);
    const s = await deps.status(sig);
    if (s?.err) throw new ConfirmError("failed", sig, json(s.err));
    if (landed(s)) return sig;
    if (poll % HEIGHT_EVERY === 0 && (await deps.blockHeight()) > tx.lifetimeConstraint.lastValidBlockHeight) {
      const last = await deps.status(sig);   // it may have landed in the last block before expiry
      if (last?.err) throw new ConfirmError("failed", sig, json(last.err));
      if (landed(last)) return sig;
      throw new ConfirmError("expired", sig, "blockhash expired before the transaction was seen");
    }
    if (deps.now() - started >= CONFIRM_CAP_MS) throw new ConfirmError("unconfirmed", sig, `not confirmed after ${CONFIRM_CAP_MS / 1000} s`);
  }
}
