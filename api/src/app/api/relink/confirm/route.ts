import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { forgetOwnerReads } from "@/lib/memo";
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
import { withAppErrorLog } from "@/lib/failure-log";
import { isBlockhashExpiredSend } from "@/lib/redact";

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
async function postHandler(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  // 11-25 (load hotfix): this user's Home chain reads on this instance are read fresh after this write (memo.ts ownerCached).
  forgetOwnerReads(session.pubkey);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  const me = address(user.seedVaultPubkey);
  // Only this user's own linked Seed Vault wallet, still on the puller, is re-linked here (as the build checks).
  const wallet = await repo.getWallet(me);
  if (!wallet || wallet.userPubkey !== me || wallet.status === "revoked") return apiError("link_wallet_first", { error: "Link this phone's wallet first." }, { status: 409 }, lang);
  if (wallet.linkModel === "leash") return apiError("already_relinked", { error: "This wallet is already re-linked." }, { status: 409 }, lang);
  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: me, programs: [SUBSCRIPTIONS_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS] });
  } catch (e) {
    return apiError("bad_transaction", { error: e instanceof Error ? e.message : String(e) }, { status: 400 }, lang);
  }
  // Review I1: the create is checked in full BEFORE anything is sent: its data (u8 2, nonce, amount, period, start, expiry, init id;
  // 49 bytes) carries $5 per day with no expiry, and every account is the one derived here, the delegation from the posted nonce.
  const creates = posted.instructions.filter((ix) => ix.program === SUBSCRIPTIONS_PROGRAM && ix.data[0] === Number(CREATE_RECURRING_DELEGATION_DISCRIMINATOR));
  if (creates.length !== 1) return apiError("wrong_transaction", { error: NOT_RELINK }, { status: 400 }, lang);
  const [create] = creates;
  const leash = await leashPda(me, me);
  const [authority] = await findSubscriptionAuthorityPda({ user: me, tokenMint: USDC_MINT });
  if (create.data.length !== 49 || u64At(create.data, 9) !== CAP_RAW || u64At(create.data, 17) !== DAY_S || i64At(create.data, 33) !== 0n) return apiError("wrong_transaction", { error: NOT_RELINK }, { status: 400 }, lang);
  const pda = await delegationPda({ delegator: me, delegatee: leash, nonce: u64At(create.data, 1) });
  if (create.accounts[0] !== me || create.accounts[1] !== authority || create.accounts[2] !== pda || create.accounts[3] !== leash) return apiError("wrong_transaction", { error: NOT_RELINK }, { status: 400 }, lang);
  // Review I2: a live old delegation must be revoked in this same transaction, so the puller never keeps its authority.
  const old = address(wallet.delegationPda);
  const oldLive = (await readDelegation(old)).exists;
  const revokesOld = posted.instructions.some((ix) => ix.program === SUBSCRIPTIONS_PROGRAM && ix.data.length === 1 && ix.data[0] === Number(REVOKE_DELEGATION_DISCRIMINATOR) && ix.accounts[0] === me && ix.accounts[1] === old);
  if (oldLive && !revokesOld) return apiError("relink_keeps_old", { error: "This re-link does not revoke your current approval. Nothing was sent; start the re-link again." }, { status: 400 }, lang);
  // 11-26 (Kimi scope 2 B, as link/confirm): a send refused for an expired blockhash can never land; the late answer says so by its code.
  let blockhashExpired = false;
  try {
    await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
  } catch (e) {
    // A lost answer is not a lost re-link: the reads below decide, and the app checks again.
    blockhashExpired = isBlockhashExpiredSend(e);
    console.error(`relink confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // After the poll the chain itself must show the leash delegation (delegator, delegatee, $5 per day, no expiry) and the old one gone;
  // anything short of that records nothing.
  const d = await waitForDelegation(pda, 10_000);
  // The same English either way (a 0.1.12 app matches LATE); a 0.1.13 app reads blockhash_expired and asks the Seed Vault once more.
  if (!d.exists) return apiError(blockhashExpired ? "blockhash_expired" : "relink_not_on_chain", { error: LATE }, { status: 409 }, lang);
  if (d.delegator !== me || d.delegatee !== leash || d.amountPerPeriodRaw !== CAP_RAW || d.periodLengthS !== DAY_S || d.expiryTs !== 0n) {
    console.error(`relink confirm: the delegation at ${pda} is not the leash delegation for ${me}`);
    return apiError("wrong_transaction", { error: NOT_RELINK }, { status: 400 }, lang);
  }
  // Task 19 re-review: the delegation must be for USDC and sit under this user's USDC subscription authority.
  if (d.mint !== USDC_MINT || d.subscriptionAuthority !== authority) {
    console.error(`relink confirm: the delegation at ${pda} is not on the USDC mint / this user's authority for ${me}`);
    return apiError("wrong_mint", { error: WRONG_MINT }, { status: 409 }, lang);
  }
  if (old !== pda && (await readDelegation(old)).exists) return apiError("relink_not_on_chain", { error: LATE }, { status: 409 }, lang);
  await repo.setWalletLink(me, { delegationPda: pda, linkModel: "leash", dailyCapCents: Number(d.amountPerPeriodRaw / 10_000n) });
  await repo.addEvent({ userPubkey: me, walletPubkey: me, kind: "relinked", detail: { delegationPda: pda, oldDelegationPda: old, revoked: oldLive } });
  return NextResponse.json({ relinked: true, linkModel: "leash", delegationPda: pda });
}
export const POST = withAppErrorLog("relink/confirm", postHandler);
