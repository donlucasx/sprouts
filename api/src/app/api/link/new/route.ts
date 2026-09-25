import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FIFTEEN_MINUTES = 15 * 60_000;

function newCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** A six-character link code for the web page, with the nonce that will seed this wallet's delegation address. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const code = newCode();
  const nonce = randomBytes(8).readBigUInt64LE();
  const expiresAt = new Date(Date.now() + FIFTEEN_MINUTES);
  await (await getRepo()).putLinkCode({ code, userPubkey: session.pubkey, expiresAt, nonce });
  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() });
}
