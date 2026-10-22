import { NextResponse } from "next/server";
import { z } from "zod";
import { address } from "@solana/kit";
import { requireSession } from "@/lib/auth-guard";
import { buildTopUp, TopUpRefused, TOPUP_DEFAULT_CENTS, TOPUP_MAX_CENTS, TOPUP_MIN_CENTS } from "@/lib/topup";

export const runtime = "nodejs";

const Body = z.object({ cents: z.number().int().min(TOPUP_MIN_CENTS).max(TOPUP_MAX_CENTS).optional() });

/**
 * The SOL top-up's unsigned transaction (10-22): swap the signed-in Seeker wallet's own SOL to `cents` of USDC (default $5, $2 to $25),
 * Jupiter ExactOut, no Sprouts fee, simulated before the wallet sees it. Answers { transaction, usdcRaw, maxLamports }, or { error }
 * with a sentence the app shows as it is. Moves nothing and records nothing: the user signs, POST /api/topup/confirm sends.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick an amount from $2 to $25." }, { status: 400 });
  try {
    return NextResponse.json(await buildTopUp(address(session.pubkey), parsed.data.cents ?? TOPUP_DEFAULT_CENTS));
  } catch (e) {
    if (e instanceof TopUpRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`/api/topup/build: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Sprouts could not build the top-up just now. Nothing was asked of your wallet. Try again in a minute." }, { status: 503 });
  }
}
