import { NextResponse } from "next/server";
import { address, type Address, type Base64EncodedWireTransaction } from "@solana/kit";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { clientIp, rateLimited } from "@/lib/auth-guard";
import { config } from "@/lib/config";
import { delegationPda, waitForDelegation } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { heliusAddAddress } from "@/lib/helius";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { rpc } from "@/lib/rpc";
import { SUBSCRIPTIONS_PROGRAM, USDC_MINT } from "@/lib/constants";
import { findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export const runtime = "nodejs";
export const maxDuration = 60; // the delegation poll (up to 10 s) plus the send

/** The approve-once terms link/[code] builds (buildApproveOnceIxs): $5 a day, a one-day period, no expiry. */
const DAILY_CAP_RAW = 5_000_000n;
const DAY_S = 86_400n;
const Body = z.object({ code: z.string().length(6), wallet: z.string().min(32).max(44), waitMs: z.number().int().min(0).max(10_000).optional(), signedTransaction: z.string().optional() });
/** The delegation a leash link for (wallet, garden) names, or null when the garden id is not an address. */
async function leashDelegationPda(wallet: Address, garden: string, nonce: bigint): Promise<Address | null> {
  let user: Address;
  try {
    user = address(garden);
  } catch {
    return null;
  }
  return delegationPda({ delegator: wallet, delegatee: await leashPda(wallet, user), nonce });
}

/** Links the wallet once its delegation is on chain: consumes the code, records the wallet, adds it to the swap webhook. */
export async function POST(request: Request) {
  // Per caller IP (R207 #7): the confirm can hold a function for up to 10 s, so a loop from one address is slowed here.
  if (rateLimited(`link-confirm:${clientIp(request)}`, 20)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const code = parsed.data.code.toUpperCase();
  let wallet: Address;
  try {
    wallet = address(parsed.data.wallet);
  } catch {
    return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  }

  const repo = await getRepo();
  const link = await repo.peekLinkCode(code);
  if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
  if (!link.walletPubkey || !link.delegationPda) return NextResponse.json({ error: "Fetch the approval for this code first." }, { status: 409 });
  if (link.walletPubkey !== wallet) return NextResponse.json({ error: "This code was already used with another wallet. Get a new code in the app, then try again." }, { status: 409 });
  const existing = await repo.getWallet(wallet);
  if (existing && existing.userPubkey !== link.userPubkey && existing.status !== "revoked") {
    return NextResponse.json({ error: "This wallet is linked to another Seeker. Revoke it there first." }, { status: 409 });
  }

  // The phone's own wallet posts the signed approval here [A3]: it must be this wallet's own approval for this delegation, then the API sends it.
  if (parsed.data.signedTransaction) {
    let posted;
    try {
      // The approval may begin by creating the wallet's USDC account (a wallet that never held USDC).
      posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: wallet, programs: [SUBSCRIPTIONS_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS] });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    const boundPda = address(link.delegationPda);
    if (!posted.instructions.some((ix) => ix.accounts.includes(boundPda))) return NextResponse.json({ error: "This approval is for another delegation. Get a new code in the app, then try again." }, { status: 400 });
    try {
      await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    } catch (e) {
      // A lost answer is not a lost approval (review I3): the delegation poll below decides, and the app retries confirm with the same code.
      console.error(`link confirm: send answered with an error for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const delegation = await waitForDelegation(address(link.delegationPda), parsed.data.waitMs ?? 10_000);
  if (!delegation.exists) return NextResponse.json({ error: "No delegation found for this wallet yet. Sign the approval first." }, { status: 409 });
  // K-M4 (like relink/confirm): the chain must show the terms the link page built: this wallet as delegator, a delegatee that derives
  // the bound PDA, $5 a day, a one-day period, no expiry, on USDC, under this wallet's USDC subscription authority. Anything else
  // records nothing and leaves the code unburned (fails closed).
  const [authority] = await findSubscriptionAuthorityPda({ user: wallet, tokenMint: USDC_MINT });
  const termsOk = delegation.delegator === wallet && !!delegation.delegatee
    && (await delegationPda({ delegator: wallet, delegatee: delegation.delegatee, nonce: link.nonce })) === link.delegationPda
    && delegation.amountPerPeriodRaw === DAILY_CAP_RAW && delegation.periodLengthS === DAY_S && delegation.expiryTs === 0n
    && delegation.mint === USDC_MINT && delegation.subscriptionAuthority === authority;
  if (!termsOk) {
    console.error(`link confirm: the delegation at ${link.delegationPda} is not the approve-once Sprouts built for ${wallet}`);
    return NextResponse.json({ error: "This approval is not the one Sprouts asked for. Nothing was linked; get a new code in the app." }, { status: 409 });
  }

  const taken = await repo.takeLinkCode(code, wallet);
  if (!taken) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });

  // The webhook add comes first so the wallet row can carry its outcome; a Helius failure never fails the link (repair pass later).
  let webhookAdded = true;
  try {
    await heliusAddAddress(config().heliusWebhookId, wallet);
  } catch (e) {
    webhookAdded = false;
    console.error(`helius add address failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // R297 / contracts 3.4, review I3: 'leash' only when the bound delegation is exactly the one named for leashPda(wallet, garden);
  // anything else (the puller, a rotated puller, a garden id that is not an address) is 'puller', which after go-live plants nothing
  // and asks for a re-link: the classification fails toward the safe side.
  const linkModel = (await leashDelegationPda(wallet, link.userPubkey, link.nonce)) === link.delegationPda ? "leash" : "puller";
  await repo.addWallet({ pubkey: wallet, userPubkey: link.userPubkey, delegationPda: link.delegationPda, dailyCapCents: Number(delegation.amountPerPeriodRaw / 10_000n), webhookAdded, linkModel });
  await repo.addEvent({ userPubkey: link.userPubkey, walletPubkey: wallet, kind: "wallet_linked", detail: { webhookAdded, linkModel } });
  const user = await repo.getUser(link.userPubkey);
  return NextResponse.json({ linked: true, skrName: user?.skrName ?? null });
}
