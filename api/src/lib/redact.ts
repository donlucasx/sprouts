/**
 * K-M10: HELIUS_RPC_URL carries the Helius key as `?api-key=`. An error that quotes the URL (undici's "Failed to parse URL from
 * <url>", a websocket close, a library that prints its endpoint) must not put the key in a log line or a response body. Every error
 * string that can carry it goes through here first: the configured URL (and its wss form) becomes "[rpc url]", any other
 * `api-key=` value becomes "[redacted]". Reads the environment directly (never config(), which throws when a value is missing).
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
  if (!(e instanceof Error)) return redact(String(e));
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
