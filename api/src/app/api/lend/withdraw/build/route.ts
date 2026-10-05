import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { receiptBalanceRaw } from "@/lib/holdings";
import { klendRate } from "@/lib/venues/klend";
import { jlendRate } from "@/lib/venues/jlend";
import { jupiterWithdrawableRaw } from "@/lib/venues/rates";
import { buildLendWithdraw } from "@/lib/venues/user-builders";
import { COINS } from "@/domain/coins";
import { VENUE_NAME } from "@/domain/venues";

export const runtime = "nodejs";
// R359: `amountRaw` (optional) is what to take out, in the underlying's raw units (USDC 6 / SOL 9 decimals); absent = the whole position.
const Body = z.object({ asset: z.enum(["USDC_LEND", "SOL_LEND"]), venue: z.enum(["kamino_klend", "jupiter_lend"]), amountRaw: z.string().regex(/^\d+$/).optional() });
/** R359: the smallest withdrawal, and the smallest rest a partial may leave (a smaller rest is taken too): 0.01 USDC, 0.0001 SOL. */
const LEND_MIN_RAW = { USDC_LEND: 10_000n, SOL_LEND: 100_000n } as const;
const MIN_TEXT = { USDC_LEND: "0.01 USDC", SOL_LEND: "0.0001 SOL" } as const;
const POOL_FULL = "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.";

/**
 * Contracts 5.3, amended by R359: the whole position, or `amountRaw` of it, back to the wallet; the venue's withdrawable is read first.
 * A partial redeems ceil(amount x rd / rn) of the receipt (at least the amount comes back at the rate read); a rest worth under
 * LEND_MIN_RAW is redeemed too (`all: true`, and the brief says so). receiptRaw is the user's
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
  const asked = parsed.data.amountRaw === undefined ? null : BigInt(parsed.data.amountRaw);
  if (asked !== null && asked < LEND_MIN_RAW[asset]) return NextResponse.json({ error: `The smallest withdrawal is ${MIN_TEXT[asset]}.` }, { status: 400 });
  const owner = userAddress(user.seedVaultPubkey);
  let receiptRaw: bigint;
  let expectedOutRaw: bigint;
  let withdrawable: bigint;
  let rate: { rn: bigint; rd: bigint };
  try {
    receiptRaw = await receiptBalanceRaw(owner, asset, venue);
    if (receiptRaw === 0n) return NextResponse.json({ error: "Nothing to withdraw here." }, { status: 409 });
    // What the redeem should pay out, and what the venue can pay right now (K-Lend: the reserve's available liquidity; Jupiter Lend: its API's withdrawable).
    [rate, withdrawable] = venue === "kamino_klend"
      ? await klendRate(asset).then((r) => [r, r.availableRaw] as const)
      : await Promise.all([jlendRate(asset), jupiterWithdrawableRaw(asset)]);
  } catch (e) {
    console.error(`lend withdraw build: venue read failed for ${asset} on ${venue}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Could not read the venue just now. Try again in a minute." }, { status: 503 });
  }
  const wholeOutRaw = (receiptRaw * rate.rn) / rate.rd;
  let redeemRaw = receiptRaw;
  let dust = false;
  if (asked !== null) {
    if (asked > wholeOutRaw) return NextResponse.json({ error: "That is more than this position holds." }, { status: 400 });
    const need = (asked * rate.rd + rate.rn - 1n) / rate.rn;   // ceil: at least `asked` comes back at this rate
    const rest = need >= receiptRaw ? 0n : receiptRaw - need;
    if (rest > 0n && (rest * rate.rn) / rate.rd >= LEND_MIN_RAW[asset]) redeemRaw = need;
    else dust = rest > 0n;
  }
  const all = redeemRaw === receiptRaw;
  expectedOutRaw = all ? wholeOutRaw : (redeemRaw * rate.rn) / rate.rd;
  if (withdrawable < expectedOutRaw) return NextResponse.json({ error: POOL_FULL, poolFull: true }, { status: 409 });
  const transaction = await buildUserTransaction(owner, await buildLendWithdraw({ user: owner, asset, venue, receiptRaw: redeemRaw }));
  const coin = asset === "USDC_LEND" ? "USDC" : "SOL";
  const brief = `About ${(Number(expectedOutRaw) / 10 ** COINS[asset].decimals).toFixed(coin === "USDC" ? 2 : 4)} ${coin} comes back from ${VENUE_NAME[venue]} to your wallet.${dust ? " The rest is too small to leave, so this takes it all." : all || asked === null ? "" : " The rest keeps earning."}`;
  // `receiptRaw` is what this transaction redeems (the whole receipt when `all`), the amount the app's signer checks.
  return NextResponse.json(json({ transaction, receiptRaw: redeemRaw, expectedOutRaw, all, brief }));
}
