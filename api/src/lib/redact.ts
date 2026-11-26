/**
 * K-M10: HELIUS_RPC_URL carries the Helius key as `?api-key=`. An error that quotes the URL (undici's "Failed to parse URL from
 * <url>", a websocket close, a library that prints its endpoint) must not put the key in a log line or a response body. Every error
 * string that can carry it goes through here first: the configured URL (and its wss form) becomes "[rpc url]", any other
 * `api-key=` value becomes "[redacted]", as does HELIUS_API_KEY itself wherever it appears (the Helius webhook URL carries it as
 * `?api-key=`, lib/helius.ts; residual O3). Reads the environment directly (never config(), which throws when a value is missing).
 */
export function redact(s: string): string {
  let out = s;
  const url = process.env.HELIUS_RPC_URL;
  if (url) for (const form of [url, url.replace("https://", "wss://")]) out = out.split(form).join("[rpc url]");
  const key = process.env.HELIUS_API_KEY;
  if (key && key.length >= 8) out = out.split(key).join("[redacted]");
  return out.replace(/(api[-_]?key=)[^&\s"'<>)]+/gi, "$1[redacted]");
}

/** An error's message plus its cause's (Node's "fetch failed" keeps the host and the reason only in the cause), redacted. */
export function errorText(e: unknown): string {
  // A simulation's error is an object ({ InstructionError: [2, { Custom: 4 }] }): String() made it "[object Object]" (10-27).
  if (!(e instanceof Error)) return redact(e !== null && typeof e === "object" ? safeJson(e) : String(e));
  const cause = e.cause instanceof Error ? e.cause.message : e.cause !== undefined ? String(e.cause) : "";
  return redact(cause ? `${e.message} (${cause})` : e.message);
}

/** The error itself when nothing in it needs redacting (a SolanaError keeps its class and code); else a copy with message, cause and stack redacted. */
export function redactError(e: unknown): Error {
  if (!(e instanceof Error)) return new Error(redact(String(e)));
  const cause = e.cause instanceof Error ? `${e.cause.message}\n${e.cause.stack ?? ""}` : String(e.cause ?? "");
  const text = `${e.message}\n${e.stack ?? ""}\n${cause}\n${safeJson((e as { context?: unknown }).context)}`;
  if (redact(text) === text) return e;
  const out = new Error(redact(e.message), e.cause !== undefined ? { cause: e.cause instanceof Error ? redactError(e.cause) : redact(String(e.cause)) } : undefined);
  out.name = e.name;
  if (e.stack) out.stack = redact(e.stack);
  // Keep a SolanaError's context (its code and fields) where it carries no URL, so callers that read `context` still work.
  const ctx = (e as { context?: unknown }).context;
  if (ctx !== undefined) Object.defineProperty(out, "context", { value: JSON.parse(redact(safeJson(ctx))), enumerable: false });
  return out;
}

const safeJson = (v: unknown): string => {
  try { return JSON.stringify(v ?? null, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) ?? "null"; } catch { return "null"; }
};

/**
 * 11-01 (Kimi MED, user-d.skr's link): a failed sendTransaction, short and redacted, for a 409 and its stored event. In production a
 * kit SolanaError's message is only "Solana error #-32002; Decode this error..." (the 10-29 incident), so the reason is read from its
 * context: the transaction error (`err`, e.g. {"InstructionError":[2,{"Custom":1}]} or "BlockhashNotFound"), the server's message, and
 * the last program log line. At most 140 characters.
 */
export function sendFailureText(e: unknown): string {
  const ctx = (e as { context?: Record<string, unknown> } | null)?.context;
  const parts: string[] = [];
  if (ctx) {
    if (ctx.err !== undefined && ctx.err !== null) parts.push(typeof ctx.err === "string" ? ctx.err : safeJson(ctx.err));
    if (typeof ctx.__serverMessage === "string") parts.push(ctx.__serverMessage);
    const logs = Array.isArray(ctx.logs) ? (ctx.logs as unknown[]).filter((l): l is string => typeof l === "string") : [];
    // The line that names the problem ("Error: insufficient funds") beats the program's closing "failed" line, which beats the last line.
    const back = [...logs].reverse();
    const last = back.find((l) => /error:|insufficient/i.test(l)) ?? back.find((l) => /failed/i.test(l)) ?? logs[logs.length - 1];
    if (last) parts.push(last);
  }
  // 11-23 (carousel day, 3 links refused with only "Solana error #-32002"): kit puts a preflight failure's TRANSACTION error on `cause`,
  // not in `context.err`, and a failure before execution (blockhash, fee payer, account load) has no logs. Its code names the reason.
  const cause = (e as { cause?: { context?: Record<string, unknown> } } | null)?.cause;
  const causeCode = cause?.context?.__code;
  if (parts.length === 0 || ctx?.err === undefined || ctx?.err === null) {
    if (typeof causeCode === "number" || typeof causeCode === "string") parts.push(`transaction error #${causeCode}`);   // after the log line (Kimi nit: the 140 cap)
  }
  const text = parts.length ? parts.join("; ") : errorText(e);
  return redact(text).replace(/\s+/g, " ").slice(0, 140);
}

/**
 * 11-26 (Kimi scope 2 B): true when a failed sendTransaction says the transaction's blockhash is unknown or expired, so these signed
 * bytes can never land and only a new approval (a fresh blockhash, signed again) can. Read from kit's error and its cause chain: the
 * transaction error code 7050008 (BLOCKHASH_NOT_FOUND, on `cause` for a refused preflight), `err` "BlockhashNotFound", or the node's
 * "Blockhash not found" message; and, as a last check, from sendFailureText's words.
 */
export function isBlockhashExpiredSend(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const ctx = (cur as { context?: Record<string, unknown> } | null)?.context;
    if (ctx) {
      if (ctx.__code === 7050008 || ctx.err === "BlockhashNotFound") return true;
      if (typeof ctx.__serverMessage === "string" && /blockhash not found/i.test(ctx.__serverMessage)) return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return /BlockhashNotFound|blockhash not found|transaction error #7050008/i.test(sendFailureText(e));
}

/**
 * 11-23 (carousel day): the whole send failure for the server log, redacted: the outer context (simulation result: err, logs,
 * unitsConsumed) and each cause's code and context, up to 3 levels. At most 2,000 characters. Never stored in an event.
 */
export function sendFailureDetail(e: unknown): string {
  const levels: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const ctx = (cur as { context?: unknown }).context;
    levels.push(`${i === 0 ? "error" : `cause${i}`}: ${errorText(cur).slice(0, 160)}${ctx !== undefined ? ` ctx=${safeJson(ctx)}` : ""}`);
    cur = (cur as { cause?: unknown }).cause;
  }
  return redact(levels.join(" | ")).replace(/\s+/g, " ").slice(0, 2000);
}
