import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";

const SEVEN_DAYS = "7d";

function key(): Uint8Array {
  return new TextEncoder().encode(config().sessionSecret);
}

/** A signed session for a Seeker that proved its key and its Genesis Token. Seven days; the app refreshes by signing in again. */
export async function issueSession(pubkey: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(pubkey).setIssuedAt().setExpirationTime(SEVEN_DAYS).sign(key());
}

/** The pubkey inside a valid session token, or null. */
export async function readSession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
