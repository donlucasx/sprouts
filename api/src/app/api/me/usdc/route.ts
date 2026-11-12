import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { requireSession } from "@/lib/auth-guard";
import { readUsdcBalanceRaw } from "@/lib/subscriptions";
import { rpc } from "@/lib/rpc";
import { priceUsd } from "@/lib/jupiter";
import { affordableTopUps } from "@/lib/topup";
import { WSOL_MINT } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Read-only: the USDC in the signed-in Seeker's own wallet, for Link a wallet's note before "This phone's wallet" approves (round-ups
 * are paid only from USDC in the linked wallet). `usdcRaw` is null when the chain could not be read, so the app shows no note
 * rather than a wrong zero. Moves nothing, signs nothing.
 *
 * 10-27: `topUpCents`, the "Add USDC" amounts this wallet's SOL covers (affordableTopUps); [] = none, so the app shows the address to
 * send USDC to; null = unknown (no balance or no price), so the app offers every amount and the build route decides.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const me = address(session.pubkey);
  const [usdc, sol, solUsd] = await Promise.all([
    readUsdcBalanceRaw(me).then((r) => r.toString(), (e) => {
      console.error(`/api/me/usdc: the balance could not be read (${e instanceof Error ? e.message : String(e)})`);
      return null;
    }),
    Promise.resolve().then(() => rpc().getBalance(me).send()).then((r) => BigInt(r.value), () => null),
    Promise.resolve().then(() => priceUsd(WSOL_MINT)).catch(() => null),
  ]);
  const topUpCents = sol !== null && solUsd !== null ? affordableTopUps(sol, solUsd) : null;
  // 0.1.10: the wallet's SOL in lamports (null when unread), so Link a wallet can say BEFORE the approval that it needs a little SOL
  // (5 of 31 failed links 10-14 to 11-12 were wallets with no SOL for the rent and fee).
  return NextResponse.json({ usdcRaw: usdc, topUpCents, solLamports: sol === null ? null : sol.toString() });
}
