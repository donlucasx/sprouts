// Ops dashboard auth: a bearer token for the JSON route, a password plus signed cookie for the page.
// Every helper answers false when its setting is unset, so a route built on it can only ever 404, never open.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

export const OPS_COOKIE = "sprouts_ops";
export const OPS_COOKIE_MAX_AGE_S = 30 * 24 * 3600;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function opsTokenOk(header: string | null): boolean {
  const token = config().opsToken;
  if (!token) return false;
  return same(header ?? "", `Bearer ${token}`);
}

export function opsPasswordOk(given: string): boolean {
  const pw = config().opsPassword;
  if (!pw) return false;
  return same(given, pw);
}

const mac = (secret: string, exp: string) => createHmac("sha256", secret).update(exp).digest("hex");

/** `"<expMs>.<hex hmac-sha256(OPS_SECRET, expMs)>"`. Throws when OPS_SECRET is unset (the login route checks first). */
export function signOpsCookie(expMs: number): string {
  const secret = config().opsSecret;
  if (!secret) throw new Error("OPS_SECRET is not set");
  const exp = String(expMs);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifyOpsCookie(value: string | undefined, nowMs: number): boolean {
  try {
    const secret = config().opsSecret;
    if (!secret || !value) return false;
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const [exp, given] = parts;
    if (!/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(given)) return false;
    if (!same(given, mac(secret, exp))) return false;
    return Number(exp) > nowMs;
  } catch {
    return false;
  }
}
