import { NextResponse } from "next/server";
import { readSession, type Session } from "./session";

/** The signed-in Seeker behind a request (and the hash of its token, for sign-out), or the 401 to return. */
export async function requireSession(request: Request): Promise<Session | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = token ? await readSession(token) : null;
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return session;
}

/**
 * The caller's IP as the platform saw it, for the rate limits (security R207 #7). On Vercel the edge sets `x-real-ip` and
 * OVERWRITES `x-forwarded-for` with the client's address (docs: "does not forward external IPs to prevent spoofing"), so a client
 * cannot rotate its bucket by sending its own header. `x-real-ip` is read first (what `@vercel/functions` ipAddress reads); if
 * `x-forwarded-for` ever carries a list, the LAST entry is the hop the platform appended, never the client's prefix. Off Vercel
 * (`next dev`, tests) no header is trusted and every caller shares one "local" bucket.
 */
export function clientIp(request: Request): string {
  if (!process.env.VERCEL) return "local";
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) ?? "unknown";
}

const buckets = new Map<string, { tokens: number; at: number }>();

/**
 * A small per-key token bucket for the public routes: `limit` calls per `windowMs`. In-memory and PER INSTANCE (security R207 #7,
 * accepted for the beta): Vercel may run several instances, so the real ceiling is `limit` times the warm instances, and a cold
 * start forgets every bucket. It slows a loop from one address; it is not a quota. A shared counter would need a table.
 */
export function rateLimited(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: limit, at: now };
  const refill = ((now - b.at) / windowMs) * limit;
  b.tokens = Math.min(limit, b.tokens + refill);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return false;
}
