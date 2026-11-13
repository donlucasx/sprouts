// Ops dashboard auth: a bearer token for the JSON route, a password plus signed cookie for the page.
// Every helper answers false when its setting is unset, so a route built on it can only ever 404, never open.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

export const OPS_COOKIE = "sprouts_ops";
export const OPS_COOKIE_MAX_AGE_S = 7 * 24 * 3600;

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
  // Hash both sides so the comparison is fixed-length and the password's length does not leak.
  return same(sha(given), sha(pw));
}

const sha = (x: string) => createHash("sha256").update(x).digest("hex");
// The password hash is part of the MAC input, so changing OPS_PASSWORD revokes every issued cookie.
const mac = (secret: string, password: string, exp: string) => createHmac("sha256", secret).update(`${exp}.${sha(password)}`).digest("hex");

/** `"<expMs>.<hex hmac-sha256(OPS_SECRET, `<expMs>.<sha256(OPS_PASSWORD)>`)>"`: the MAC covers the expiry AND a hash of OPS_PASSWORD, so changing the password invalidates cookies. Throws when OPS_SECRET or OPS_PASSWORD is unset (the login route checks first). */
export function signOpsCookie(expMs: number): string {
  const secret = config().opsSecret;
  if (!secret) throw new Error("OPS_SECRET is not set");
  const password = config().opsPassword;
  if (!password) throw new Error("OPS_PASSWORD is not set");
  const exp = String(expMs);
  return `${exp}.${mac(secret, password, exp)}`;
}

export function verifyOpsCookie(value: string | undefined, nowMs: number): boolean {
  try {
    const secret = config().opsSecret;
    const password = config().opsPassword;
    if (!secret || !password || !value) return false;
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const [exp, given] = parts;
    if (!/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(given)) return false;
    if (!same(given, mac(secret, password, exp))) return false;
    return Number(exp) > nowMs;
  } catch {
    return false;
  }
}
