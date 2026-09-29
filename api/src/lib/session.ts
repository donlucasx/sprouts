import { createHash, randomBytes } from "node:crypto";
import { getRepo } from "@/db/repo";

const SEVEN_DAYS_MS = 7 * 86_400_000;
const MAX_TOKEN_LENGTH = 128;

/** SHA-256, hex: what the sessions table holds. The token itself lives only on the phone (R84). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type Session = { pubkey: string; tokenHash: string };

/**
 * A session for a Seeker that proved its key and its Genesis Token (R84): an opaque random token, valid seven days from now and
 * never extended by use, one live session per wallet per device (the device is the Genesis mint the sign-in proved).
 */
export async function issueSession(pubkey: string, device: string, now: Date = new Date()): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await (await getRepo()).putSession({ tokenHash: hashToken(token), userPubkey: pubkey, device, expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS) });
  return token;
}

/** The Seeker behind a live token, or null: unknown, revoked, or past its seven days. */
export async function readSession(token: string, now: Date = new Date()): Promise<Session | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = hashToken(token);
  const s = await (await getRepo()).getSession(tokenHash);
  if (!s || s.revokedAt !== null || s.expiresAt.getTime() <= now.getTime()) return null;
  return { pubkey: s.userPubkey, tokenHash };
}

/** "Sign out": this session ends at once. */
export async function signOut(tokenHash: string): Promise<void> {
  await (await getRepo()).revokeSession(tokenHash);
}

/** "Sign out of all devices": every session of this Seeker ends at once. */
export async function signOutEverywhere(pubkey: string): Promise<void> {
  await (await getRepo()).revokeAllSessions(pubkey);
}
