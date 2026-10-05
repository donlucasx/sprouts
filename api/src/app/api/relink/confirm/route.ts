import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Base64EncodedWireTransaction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { CREATE_RECURRING_DELEGATION_DISCRIMINATOR } from "@solana/subscriptions";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { waitForDelegation } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { rpc } from "@/lib/rpc";
import { SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60; // the delegation poll (up to 10 s) plus the send
const Body = z.object({ signedTransaction: z.string() });

/** Contracts 5.5: the create's delegatee must be leashPda(user, user) and its delegator the session wallet; then the delegation must appear. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const me = address(user.seedVaultPubkey);
  // Only this user's own linked Seed Vault wallet, still on the puller, is re-linked here (as the build checks).
  const wallet = await repo.getWallet(me);
  if (!wallet || wallet.userPubkey !== me || wallet.status === "revoked") return NextResponse.json({ error: "Link this phone's wallet first." }, { status: 409 });
  if (wallet.linkModel === "leash") return NextResponse.json({ error: "This wallet is already re-linked." }, { status: 409 });
  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: me, programs: [SUBSCRIPTIONS_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const creates = posted.instructions.filter((ix) => ix.program === SUBSCRIPTIONS_PROGRAM && ix.data[0] === Number(CREATE_RECURRING_DELEGATION_DISCRIMINATOR));
  const leash = await leashPda(me, me);
  if (creates.length !== 1 || creates[0].accounts[0] !== me || creates[0].accounts[3] !== leash) return NextResponse.json({ error: "This approval is not the Sprouts re-link." }, { status: 400 });
  const pda = creates[0].accounts[2];
  try {
    await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
  } catch (e) {
    // A lost answer is not a lost re-link: the poll below decides, and the app checks again.
    console.error(`relink confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!(await waitForDelegation(pda, 10_000)).exists) return NextResponse.json({ error: "No re-link found on chain yet. Check again in a minute." }, { status: 409 });
  await repo.setWalletLink(me, { delegationPda: pda, linkModel: "leash" });
  await repo.addEvent({ userPubkey: me, walletPubkey: me, kind: "relinked", detail: { delegationPda: pda } });
  return NextResponse.json({ relinked: true, linkModel: "leash", delegationPda: pda });
}
