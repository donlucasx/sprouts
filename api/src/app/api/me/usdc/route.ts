import { NextResponse } from "next/server";
import { address } from "@solana/kit";
import { requireSession } from "@/lib/auth-guard";
import { readUsdcBalanceRaw } from "@/lib/subscriptions";
import { rpc } from "@/lib/rpc";
import { sharedPriceUsd } from "@/lib/shared-reads";
import { affordableTopUps, topUpSources } from "@/lib/topup";
import { WSOL_MINT } from "@/lib/constants";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { linkSetupCovered, missingSetupMints, SETUP_MAX } from "@/lib/user-setup";

export const runtime = "nodejs";

/**
 * Read-only: the USDC in the signed-in Seeker's own wallet, for Link a wallet's note before "This phone's wallet" approves (round-ups
 * are paid only from USDC in the linked wallet). `usdcRaw` is null when the chain could not be read, so the app shows no note
 * rather than a wrong zero. Moves nothing, signs nothing.
 *
 * 10-27: `topUpCents`, the "Add USDC" amounts this wallet's SOL covers (affordableTopUps); [] = none, so the app shows the address to
 * send USDC to; null = unknown (no balance or no price), so the app offers every amount and the build route decides.
 *
 * Task 7 (0.1.12): `topUpSources`, the coins this wallet can top up from, SOL first (lib/topup.ts topUpSources); null when the
 * balances or prices could not be read. Only with `?sources=1` (Home's read in 0.1.12): it costs a Helius token-accounts read and Jupiter
 * calls, so the background refresh, Link a wallet and every 0.1.11 install get the old shape without the key, at the old cost.
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
    Promise.resolve().then(() => sharedPriceUsd(WSOL_MINT)).catch(() => null),   // 11-23: display only, the shared 120 s read
  ]);
  const topUpCents = sol !== null && solUsd !== null ? affordableTopUps(sol, solUsd) : null;
  // 0.1.10: the wallet's SOL in lamports (null when unread), so Link a wallet can say BEFORE the approval that it needs a little SOL
  // (5 of 31 failed links 10-14 to 11-12 were wallets with no SOL for the rent and fee).
  const body = { usdcRaw: usdc, topUpCents, solLamports: sol === null ? null : sol.toString() };
  // Kimi (user rent): both opt-ins are read BEFORE either answers, so `?sources=1&setup=1` carries both keys.
  const params = new URL(request.url).searchParams;
  const wantSources = params.get("sources") === "1";
  const wantSetup = params.get("setup") === "1";
  if (!wantSources && !wantSetup) return NextResponse.json(body);
  const [sources, setupAccounts] = await Promise.all([
    wantSources
      ? topUpSources(me, sol, solUsd, topUpCents).catch((e) => {
        console.error(`/api/me/usdc: the top-up coins could not be read (${e instanceof Error ? e.message : String(e)})`);
        return null;
      })
      : Promise.resolve(undefined),
    wantSetup ? setupCount(me, sol) : Promise.resolve(undefined),
  ]);
  return NextResponse.json({ ...body, ...(wantSources ? { topUpSources: sources } : {}), ...(wantSetup ? { setupAccounts } : {}) });
}

/**
 * Task 17a (user rent, design 6): `setupAccounts`, how many of this wallet's coin and receipt accounts for its switched-on coins are
 * missing, at most SETUP_MAX; 0 when the SOL does not cover them by the link rule (so the line the app shows and the link it builds
 * agree) or when the SOL, the rules or the accounts could not be read. The app shows the cost from this count and its own SOL price.
 */
async function setupCount(me: ReturnType<typeof address>, sol: bigint | null): Promise<number> {
  if (sol === null) return 0;
  try {
    const repo = await getRepo();
    const missing = await missingSetupMints(me, rulesRowToRules(await repo.getRules(me)));
    const n = Math.min(missing.length, SETUP_MAX);
    return n > 0 && linkSetupCovered(sol, n) ? n : 0;
  } catch (e) {
    console.error(`/api/me/usdc: the setup accounts could not be read (${e instanceof Error ? e.message : String(e)})`);
    return 0;
  }
}
