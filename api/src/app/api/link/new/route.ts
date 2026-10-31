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
  const repo = await getRepo();
  await repo.putLinkCode({ code, userPubkey: session.pubkey, expiresAt, nonce });
  // 10-31: the start of a link, kept past the code's own purge (a day after expiry): with no wallet_linked after it, a drop-off.
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "link_started", detail: { expiresAt: expiresAt.toISOString() } })
    .catch((e: unknown) => console.error(`link_started not recorded: ${e instanceof Error ? e.name : "error"}`));
  return NextResponse.json({ code, expiresAt: expiresAt.toISOString() });
}
