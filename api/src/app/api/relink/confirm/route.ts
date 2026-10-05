import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Base64EncodedWireTransaction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { CREATE_RECURRING_DELEGATION_DISCRIMINATOR, REVOKE_DELEGATION_DISCRIMINATOR, findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { delegationPda, readDelegation, waitForDelegation } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { rpc } from "@/lib/rpc";
import { SUBSCRIPTIONS_PROGRAM, USDC_MINT } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60; // the delegation poll (up to 10 s) plus the send
const Body = z.object({ signedTransaction: z.string() });
const CAP_RAW = 5_000_000n;
const DAY_S = 86_400n;
const NOT_RELINK = "This approval is not the Sprouts re-link.";
const WRONG_MINT = "The approval on chain is not for USDC, so nothing was recorded. Start the re-link again.";
const LATE = "No re-link found on chain yet. Check again in a minute.";
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const i64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(at, true);

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
  // Review I1: the create is checked in full BEFORE anything is sent: its data (u8 2, nonce, amount, period, start, expiry, init id;
  // 49 bytes) carries $5 per day with no expiry, and every account is the one derived here, the delegation from the posted nonce.
  const creates = posted.instructions.filter((ix) => ix.program === SUBSCRIPTIONS_PROGRAM && ix.data[0] === Number(CREATE_RECURRING_DELEGATION_DISCRIMINATOR));
  if (creates.length !== 1) return NextResponse.json({ error: NOT_RELINK }, { status: 400 });
  const [create] = creates;
  const leash = await leashPda(me, me);
  const [authority] = await findSubscriptionAuthorityPda({ user: me, tokenMint: USDC_MINT });
  if (create.data.length !== 49 || u64At(create.data, 9) !== CAP_RAW || u64At(create.data, 17) !== DAY_S || i64At(create.data, 33) !== 0n) return NextResponse.json({ error: NOT_RELINK }, { status: 400 });
  const pda = await delegationPda({ delegator: me, delegatee: leash, nonce: u64At(create.data, 1) });
  if (create.accounts[0] !== me || create.accounts[1] !== authority || create.accounts[2] !== pda || create.accounts[3] !== leash) return NextResponse.json({ error: NOT_RELINK }, { status: 400 });
  // Review I2: a live old delegation must be revoked in this same transaction, so the puller never keeps its authority.
  const old = address(wallet.delegationPda);
  const oldLive = (await readDelegation(old)).exists;
  const revokesOld = posted.instructions.some((ix) => ix.program === SUBSCRIPTIONS_PROGRAM && ix.data.length === 1 && ix.data[0] === Number(REVOKE_DELEGATION_DISCRIMINATOR) && ix.accounts[0] === me && ix.accounts[1] === old);
  if (oldLive && !revokesOld) return NextResponse.json({ error: "This re-link does not revoke your current approval. Nothing was sent; start the re-link again." }, { status: 400 });
  try {
    await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
  } catch (e) {
    // A lost answer is not a lost re-link: the reads below decide, and the app checks again.
    console.error(`relink confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // After the poll the chain itself must show the leash delegation (delegator, delegatee, $5 per day, no expiry) and the old one gone;
  // anything short of that records nothing.
  const d = await waitForDelegation(pda, 10_000);
  if (!d.exists) return NextResponse.json({ error: LATE }, { status: 409 });
  if (d.delegator !== me || d.delegatee !== leash || d.amountPerPeriodRaw !== CAP_RAW || d.periodLengthS !== DAY_S || d.expiryTs !== 0n) {
    console.error(`relink confirm: the delegation at ${pda} is not the leash delegation for ${me}`);
    return NextResponse.json({ error: NOT_RELINK }, { status: 400 });
  }
  // Task 19 re-review: the delegation must be for USDC and sit under this user's USDC subscription authority.
  if (d.mint !== USDC_MINT || d.subscriptionAuthority !== authority) {
    console.error(`relink confirm: the delegation at ${pda} is not on the USDC mint / this user's authority for ${me}`);
    return NextResponse.json({ error: WRONG_MINT }, { status: 409 });
  }
  if (old !== pda && (await readDelegation(old)).exists) return NextResponse.json({ error: LATE }, { status: 409 });
  await repo.setWalletLink(me, { delegationPda: pda, linkModel: "leash", dailyCapCents: Number(d.amountPerPeriodRaw / 10_000n) });
  await repo.addEvent({ userPubkey: me, walletPubkey: me, kind: "relinked", detail: { delegationPda: pda, oldDelegationPda: old, revoked: oldLive } });
  return NextResponse.json({ relinked: true, linkModel: "leash", delegationPda: pda });
}
