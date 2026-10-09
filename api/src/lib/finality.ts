import { signature as toSignature } from "@solana/kit";
import { rpc } from "./rpc";

/** One signature's status as getSignatureStatuses reports it; null when the node has not seen it. */
export type SigStatus = { confirmationStatus: string | null; err: unknown } | null;

const POLL_MS = 2_000;
const RPC_TIMEOUT_MS = 10_000;

/**
 * True once every signature is finalized AND succeeded, polling every 2 s for up to `waitMs`. A finalized failed transaction answers
 * false: a booked row pointing at one is wrong, and the reconcile then defers instead of booking against it (R499 audit F5).
 * Unseen signatures (null) keep it waiting. Pure: the status reader and the clock are passed in.
 */
export async function pollFinalized(a: {
  sigs: string[]; waitMs: number; statuses: (sigs: string[]) => Promise<SigStatus[]>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const now = a.now ?? Date.now;
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const end = now() + a.waitMs;
  for (;;) {
    const value = await a.statuses(a.sigs);
    if (value.some((s) => s !== null && s.err !== null && s.err !== undefined)) return false;
    if (value.length === a.sigs.length && value.every((s) => s?.confirmationStatus === "finalized")) return true;
    if (now() + POLL_MS > end) return false;
    await sleep(POLL_MS);
  }
}

/** pollFinalized against the RPC; getSignatureStatuses takes at most 256 signatures per call, and each call times out after 10 s. */
export async function signaturesFinalized(sigs: string[], waitMs: number): Promise<boolean> {
  return pollFinalized({
    sigs, waitMs,
    statuses: async (all) => {
      const out: SigStatus[] = [];
      for (let i = 0; i < all.length; i += 256) {
        const { value } = await rpc().getSignatureStatuses(all.slice(i, i + 256).map((x) => toSignature(x)), { searchTransactionHistory: true })
          .send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        out.push(...value.map((s) => (s ? { confirmationStatus: s.confirmationStatus ?? null, err: s.err } : null)));
      }
      return out;
    },
  });
}
