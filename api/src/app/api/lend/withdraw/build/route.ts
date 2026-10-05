import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { receiptBalanceRaw } from "@/lib/holdings";
import { klendRate } from "@/lib/venues/klend";
import { jlendRate } from "@/lib/venues/jlend";
import { jupiterWithdrawableRaw } from "@/lib/venues/withdrawable";
import { buildLendWithdraw } from "@/lib/venues/user-builders";
import { COINS } from "@/domain/coins";
import { VENUE_NAME } from "@/domain/venues";

export const runtime = "nodejs";
const Body = z.object({ asset: z.enum(["USDC_LEND", "SOL_LEND"]), venue: z.enum(["kamino_klend", "jupiter_lend"]) });
const POOL_FULL = "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.";

/**
 * Contracts 5.3: the whole position back to the wallet in one tap; the venue's withdrawable is read first. receiptRaw is the user's
 * receipt ATA balance read the same way /api/me's positions read it (lib/holdings), so the app's compare with the screen's position holds.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { asset, venue } = parsed.data;
  const owner = userAddress(user.seedVaultPubkey);
  const receiptRaw = await receiptBalanceRaw(owner, asset, venue);
  if (receiptRaw === 0n) return NextResponse.json({ error: "Nothing to withdraw here." }, { status: 409 });
  // What the redeem should pay out, and what the venue can pay right now (K-Lend: the reserve's available liquidity; Jupiter Lend: its API's withdrawable).
  const [expectedOutRaw, withdrawable] = venue === "kamino_klend"
    ? await klendRate(asset).then((r) => [(receiptRaw * r.rn) / r.rd, r.availableRaw])
    : await Promise.all([jlendRate(asset).then((r) => (receiptRaw * r.rn) / r.rd), jupiterWithdrawableRaw(asset)]);
  if (withdrawable < expectedOutRaw) return NextResponse.json({ error: POOL_FULL, poolFull: true }, { status: 409 });
  const transaction = await buildUserTransaction(owner, await buildLendWithdraw({ user: owner, asset, venue, receiptRaw }));
  const coin = asset === "USDC_LEND" ? "USDC" : "SOL";
  const brief = `About ${(Number(expectedOutRaw) / 10 ** COINS[asset].decimals).toFixed(coin === "USDC" ? 2 : 4)} ${coin} comes back from ${VENUE_NAME[venue]} to your wallet.`;
  return NextResponse.json(json({ transaction, receiptRaw, expectedOutRaw, brief }));
}
