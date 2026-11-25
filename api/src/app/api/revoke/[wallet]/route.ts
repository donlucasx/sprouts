import { langOf } from "@/lib/i18n";
import { apiError, settleCode } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { clientIp, rateLimited } from "@/lib/auth-guard";
import { buildRevokeIxs, readDelegation } from "@/lib/subscriptions";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { buildUserTransaction, sendPosted, waitConfirmed, settleUnconfirmed, STILL_WAITING } from "@/lib/user-tx";
import { SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";
import { withAppErrorLog, addressOrNull } from "@/lib/failure-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ signedTransaction: z.string() });

function parseWallet(raw: string): Address | null {
  try {
    return address(raw);
  } catch {
    return null;
  }
}

/**
 * The full revoke for a trading wallet to sign (the delegation and the USDC authority), no session needed: the wallet's own
 * signature is the proof. An unknown or already revoked wallet answers 200 with no transaction [A22]. That IS an answer to "does
 * this wallet use Sprouts" (security R207 #9), but not a new one: every live delegation is a Subscriptions account whose header
 * names the delegator and the delegatee (the puller), so one getProgramAccounts call filtered on the puller lists every linked
 * wallet. Gating this route on a signed message would cost every revoke a second wallet prompt and hide nothing the chain does
 * not already show, so the route is rate limited per caller IP as well as per wallet, which stops cheap enumeration through it.
 */
async function getHandler(request: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const lang = langOf(request);
  const { wallet: raw } = await ctx.params;
  const wallet = parseWallet(raw);
  if (!wallet) return apiError("bad_address", { error: "That does not look like a Solana address." }, { status: 400 }, lang);
  if (rateLimited(`revoke-ip:${clientIp(request)}`, 20) || rateLimited(`revoke:${wallet}`)) return apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429 }, lang);
  const row = await (await getRepo()).getWallet(wallet);
  if (!row || row.status === "revoked") return NextResponse.json({ transaction: null });
  const transaction = await buildUserTransaction(wallet, await buildRevokeIxs({ delegator: wallet, delegationPda: address(row.delegationPda) }));
  return NextResponse.json({ transaction });
}

/** Sends the revoke the wallet signed [A3]; once the delegation is gone from the chain, the wallet is marked revoked. */
async function postHandler(request: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const lang = langOf(request);
  const { wallet: raw } = await ctx.params;
  const wallet = parseWallet(raw);
  if (!wallet) return apiError("bad_address", { error: "That does not look like a Solana address." }, { status: 400 }, lang);
  // Per caller IP (R207 #7): a send holds a function for up to 30 s of polling, so a loop from one address is slowed here.
  if (rateLimited(`revoke-post:${clientIp(request)}`)) return apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429 }, lang);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  const repo = await getRepo();
  const row = await repo.getWallet(wallet);
  if (!row || row.status === "revoked") return apiError("nothing_to_revoke", { error: "Nothing to revoke." }, { status: 409 }, lang);

  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: wallet, programs: [SUBSCRIPTIONS_PROGRAM] });
  } catch (e) {
    return apiError("bad_transaction", { error: e instanceof Error ? e.message : String(e) }, { status: 400 }, lang);
  }
  const pda = address(row.delegationPda);
  if (!posted.instructions.some((ix) => ix.accounts.includes(pda))) return apiError("wrong_transaction", { error: "This revoke is for another delegation." }, { status: 400 }, lang);
  let status;
  try {
    await sendPosted(posted.wire);
    status = await waitConfirmed(posted.signature);
  } catch {
    status = await waitConfirmed(posted.signature, 3); // review I3
  }
  const settled = status === "pending" ? await settleUnconfirmed(posted) : status;   // item 8
  if (settled !== "confirmed") return apiError(settleCode(settled), { error: settled === "failed" ? "The revoke failed on chain." : settled === "expired" ? "It did not go through. Nothing changed. Try again." : STILL_WAITING.revoke }, { status: 409 }, lang);
  let d = await readDelegation(pda);
  for (let i = 0; i < 3 && d.exists; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    d = await readDelegation(pda);
  }
  if (d.exists) return apiError("chain_catching_up", { error: "The chain still shows the delegation. Check again in a minute." }, { status: 409 }, lang);
  await repo.setWalletStatus(wallet, "revoked");
  await repo.addEvent({ userPubkey: row.userPubkey, walletPubkey: wallet, kind: "revoke_seen", detail: { signature: posted.signature, by: "user" } });
  return NextResponse.json({ revoked: true });
}
/** The wallet in the URL (a public address, as the link failures store), never a caller key. */
const revokeWho = async (_req: Request, _f: { status: number; error: string }, ctx: { params: Promise<{ wallet: string }> }) => ({ userPubkey: null, walletPubkey: addressOrNull((await ctx.params).wallet) });
export const GET = withAppErrorLog("revoke", getHandler, revokeWho);
export const POST = withAppErrorLog("revoke", postHandler, revokeWho);
