import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { receiptBalanceRaw, lendingFrom, latestVenueRows } from "@/lib/holdings";
import { klendRate } from "@/lib/venues/klend";
import { jlendRate } from "@/lib/venues/jlend";
import { jupiterWithdrawableRaw } from "@/lib/venues/rates";
import { buildMove } from "@/lib/venues/user-builders";
import { carryMoves, IN_FLIGHT, moveBuiltDetail, moveCarriesFor, moveDepositRaw } from "@/lib/moves";
import { COINS, type LendAsset } from "@/domain/coins";
import { VENUE_SHORT, type AutoVenue } from "@/domain/venues";
import { dayOf } from "@/domain/day";

export const runtime = "nodejs";
export const maxDuration = 60;
const Body = z.object({ id: z.string().min(1) });
const POOL_FULL = "A venue can pause withdrawals when its pool is fully lent out; your money stays yours.";
const rateOf = (venue: AutoVenue, asset: LendAsset) => (venue === "kamino_klend" ? klendRate(asset) : jlendRate(asset));

/**
 * Contracts 5.4 with S3 = ONE: `[redeem, deposit]`, two ALT-free v0 txs the Seed Vault signs in one session. The redeem takes
 * min(the card's receipt, the wallet's receipt now); the deposit is 99.9% of the redeem's expected out, capped by the source
 * position's underlyingRaw as /api/me serves it (the app's sign.ts cap). The amounts are recorded (`move_built`): the confirm sends
 * only these, rebuilt by the server, never an amount a client posts.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const p = await repo.getMoveProposal(parsed.data.id);
  if (!p || p.userPubkey !== user.seedVaultPubkey) return NextResponse.json({ error: "No such move." }, { status: 404 });
  if (p.status !== "open") return NextResponse.json({ error: "This move is no longer open." }, { status: 409 });
  // K-I2: a move in flight is never rebuilt with new amounts (its signed pair and the build it was pinned to settle it).
  if (p.redeemSignature) return NextResponse.json({ error: IN_FLIGHT, inFlight: true }, { status: 409 });
  const owner = userAddress(user.seedVaultPubkey);
  const { asset, fromVenue: from, toVenue: to } = p;
  let balance: bigint;
  let src: { rn: bigint; rd: bigint };
  let dst: { rn: bigint; rd: bigint };
  let withdrawable: bigint;
  try {
    balance = await receiptBalanceRaw(owner, asset, from);
    if (balance === 0n) return NextResponse.json({ error: "Nothing to move here." }, { status: 409 });
    // What the source can pay right now (K-Lend: the reserve's available liquidity; Jupiter Lend: its API's withdrawable), as Withdraw reads it.
    if (from === "kamino_klend") { const k = await klendRate(asset); src = k; withdrawable = k.availableRaw; }
    else { src = await jlendRate(asset); withdrawable = await jupiterWithdrawableRaw(asset); }
    dst = await rateOf(to, asset);
  } catch (e) {
    console.error(`moves build: venue read failed for ${asset} ${from} -> ${to}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Could not read the venue just now. Try again in a minute." }, { status: 503 });
  }
  const receiptRaw = p.receiptRaw < balance ? p.receiptRaw : balance;
  const expectedOutRaw = (receiptRaw * src.rn) / src.rd;
  if (withdrawable < expectedOutRaw) return NextResponse.json({ error: POOL_FULL, poolFull: true }, { status: 409 });
  // What /api/me serves for this position (same receipt account, same rows, same carried legs): the app's deposit cap.
  const day = dayOf(new Date());
  const rows = await latestVenueRows(repo, day);
  const legs = carryMoves((await Promise.all((await repo.listConfirmedPlantings(user.seedVaultPubkey)).map((x) => repo.plantingLegs(x.id)))).flat(), await moveCarriesFor(repo, user.seedVaultPubkey));
  const served = lendingFrom({ positions: [{ asset, venue: from, receiptRaw: balance }], legs, rows, prices: {} })[0].underlyingRaw;
  const depositRaw = moveDepositRaw({ expectedOutRaw, servedUnderlyingRaw: served });
  if (depositRaw <= 0n) return NextResponse.json({ error: "Could not size this move just now. Try again tomorrow." }, { status: 409 });
  const parts = { user: owner, asset, from, to, receiptRaw, depositRaw };
  const transactions = [
    await buildUserTransaction(owner, await buildMove({ ...parts, part: "redeem" })),
    await buildUserTransaction(owner, await buildMove({ ...parts, part: "deposit" })),
  ];
  // The rates /api/me values with (the snapshot), so a done move's carried earned matches the screen; the live rate when none.
  const snap = (v: AutoVenue, live: { rn: bigint; rd: bigint }) => rows.find((r) => r.venue === v && r.asset === asset)?.exchangeRate ?? Number(live.rn) / Number(live.rd);
  await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_built", detail: moveBuiltDetail({
    id: p.id, asset, from, to, receiptRaw, sourceReceiptRaw: balance, depositRaw, fromRate: snap(from, src), toRate: snap(to, dst), toReceiptRaw: (depositRaw * dst.rd) / dst.rn,
  }) });
  const coin = asset === "USDC_LEND" ? "USDC" : "SOL";
  const fmt = (raw: bigint) => (Number(raw) / 10 ** COINS[asset].decimals).toFixed(coin === "USDC" ? 2 : 4);
  const brief = `Moves your ${coin} from ${VENUE_SHORT[from]} to ${VENUE_SHORT[to]}: about ${fmt(expectedOutRaw)} ${coin} out, ${fmt(depositRaw)} ${coin} in.`;
  return NextResponse.json(json({ transactions, receiptRaw, depositRaw, brief }));
}
