import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { requireSession } from "@/lib/auth-guard";
import { readUsdcBalanceRaw } from "@/lib/subscriptions";

export const runtime = "nodejs";

/**
 * Read-only: the USDC in the signed-in Seeker's own wallet, for Link a wallet's note before "This phone's wallet" approves (round-ups
 * are paid only from USDC in the linked wallet). `usdcRaw` is null when the chain could not be read, so the app shows no note
 * rather than a wrong zero. Moves nothing, signs nothing.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  try {
    const raw = await readUsdcBalanceRaw(address(session.pubkey));
    return NextResponse.json({ usdcRaw: raw.toString() });
  } catch (e) {
    console.error(`/api/me/usdc: the balance could not be read (${e instanceof Error ? e.message : String(e)})`);
    return NextResponse.json({ usdcRaw: null });
  }
}
