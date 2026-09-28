import { NextResponse } from "next/server";
import { address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, type Address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rateLimited } from "@/lib/auth-guard";
import { buildApproveOnceIxs, buildRevokeDelegationIx, delegationPda, readDelegation, readSubscriptionAuthority } from "@/lib/subscriptions";
import { pullerSigner } from "@/lib/puller";
import { rpc } from "@/lib/rpc";

export const runtime = "nodejs";

const DAILY_CAP_CENTS = 500; // not exported: Next.js allows only handler exports from a route file
const DAILY_CAP_RAW = 5_000_000n;

/**
 * The approve-once transaction for a trading wallet, unsigned: the wallet (Phantom on the web page, or the phone's wallet) signs it.
 * The code binds to the first wallet that fetches it and is consumed only on confirm.
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(`link:${ip}`)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const { code } = await ctx.params;
  const walletParam = new URL(request.url).searchParams.get("wallet") ?? "";
  let wallet: Address;
  try {
    wallet = address(walletParam);
  } catch {
    return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  }

  const repo = await getRepo();
  const link = await repo.peekLinkCode(code.toUpperCase());
  if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
  if (link.walletPubkey && link.walletPubkey !== wallet) return NextResponse.json({ error: "This code belongs to another wallet." }, { status: 409 });

  // A wallet another Seeker still holds cannot be taken over; a revoked one can be linked again, by anyone (review I3).
  const existing = await repo.getWallet(wallet);
  if (existing && existing.userPubkey !== link.userPubkey && existing.status !== "revoked") {
    return NextResponse.json({ error: "This wallet is linked to another Seeker. Revoke it there first." }, { status: 409 });
  }

  const puller = (await pullerSigner()).address;
  const pda = await delegationPda({ delegator: wallet, delegatee: puller, nonce: link.nonce });
  if (!link.walletPubkey) await repo.bindLinkCode(link.code, wallet, pda);

  // A wallet that linked before already has its USDC authority on chain: re-init would fail, so the create carries its init id.
  const authority = await readSubscriptionAuthority(wallet);
  const ixs = await buildApproveOnceIxs({ delegator: wallet, delegatee: puller, capRaw: DAILY_CAP_RAW, nonce: link.nonce, existingInitId: authority.exists ? authority.initId : undefined });
  // One delegation per wallet: if the previous one is still live, the same approval revokes it first (review I4).
  let revokes: string | null = null;
  if (existing && existing.delegationPda !== pda && (await readDelegation(address(existing.delegationPda))).exists) {
    ixs.unshift(buildRevokeDelegationIx({ delegator: wallet, delegationPda: address(existing.delegationPda) }));
    revokes = existing.delegationPda;
  }
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(wallet), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const transaction = getBase64EncodedWireTransaction(compileTransaction(message));
  return NextResponse.json({ transaction, cap: DAILY_CAP_CENTS, puller, delegationPda: pda, revokes });
}
