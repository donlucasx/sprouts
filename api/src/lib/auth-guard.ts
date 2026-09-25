import { NextResponse } from "next/server";
import { readSession } from "./session";

/** The signed-in Seeker behind a request, or the 401 to return. */
export async function requireSession(request: Request): Promise<{ pubkey: string } | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const pubkey = token ? await readSession(token) : null;
  if (!pubkey) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return { pubkey };
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** A small per-key token bucket for the public routes: `limit` calls per `windowMs`. In-memory, per instance, enough for the beta. */
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
