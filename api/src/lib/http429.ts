import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";

/**
 * True for kit's HTTP-transport error with status 429, read from its code and context, never its message. 11-24: read from the
 * context directly (a redacted copy keeps name and context but is not kit's class), on the error or anywhere in its cause chain.
 */
export function isHttp429(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const ctx = (cur as { name?: unknown; context?: { __code?: unknown; statusCode?: unknown } } | null);
    if (ctx && ctx.name === "SolanaError" && ctx.context?.__code === SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR && ctx.context?.statusCode === 429) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
