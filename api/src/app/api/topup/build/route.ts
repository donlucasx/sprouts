import { NextResponse } from "next/server";
import { z } from "zod";
import { address, isAddress } from "@solana/kit";
import { requireSession } from "@/lib/auth-guard";
import { buildTopUp, TopUpRefused, TOPUP_COPY, TOPUP_DEFAULT_CENTS, TOPUP_MAX_CENTS, TOPUP_MIN_CENTS } from "@/lib/topup";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";

// Task 7: `inputMint` (0.1.12) is the coin to swap; absent (0.1.11) or the wSOL mint = the SOL top-up exactly as before.
const Body = z.object({ cents: z.number().int().min(TOPUP_MIN_CENTS).max(TOPUP_MAX_CENTS).optional(), inputMint: z.string().optional() });

/**
 * The SOL top-up's unsigned transaction (10-22): swap the signed-in Seeker wallet's own SOL to `cents` of USDC (default $5, $2 to $25),
 * Jupiter ExactOut, no Sprouts fee, simulated before the wallet sees it. Answers { transaction, usdcRaw, maxLamports?, inputMint, maxInRaw }
 * (maxLamports for SOL only; Task 7: any verified coin the wallet holds, by `inputMint`), or { error }
 * with a sentence the app shows as it is. Moves nothing and records nothing: the user signs, POST /api/topup/confirm sends.
 */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick an amount from $2 to $25." }, { status: 400 });
  const { inputMint } = parsed.data;
  if (inputMint !== undefined && !isAddress(inputMint)) return NextResponse.json({ error: TOPUP_COPY.notSource }, { status: 400 });
  try {
    return NextResponse.json(await buildTopUp(address(session.pubkey), parsed.data.cents ?? TOPUP_DEFAULT_CENTS, inputMint === undefined ? undefined : address(inputMint)));
  } catch (e) {
    if (e instanceof TopUpRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`/api/topup/build: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: TOPUP_COPY.notNow }, { status: 503 });
  }
}
export const POST = withAppErrorLog("topup/build", postHandler);
