import { NextResponse } from "next/server";
import { address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, type Address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { clientIp, rateLimited } from "@/lib/auth-guard";
import { buildApproveOnceIxs, buildRevokeDelegationIx, delegationPda, readDelegation, readSubscriptionAuthority, readUsdcAtaExists } from "@/lib/subscriptions";
import { pullerSigner } from "@/lib/puller";
import { leashLive, leashPda } from "@/lib/leash";
import { rpc } from "@/lib/rpc";
import { ownerLabel } from "@/lib/owner-label";

export const runtime = "nodejs";

const DAILY_CAP_CENTS = 500; // not exported: Next.js allows only handler exports from a route file
const DAILY_CAP_RAW = 5_000_000n;

/**
 * The approve-once transaction for a trading wallet, unsigned: the wallet (Phantom on the web page, or the phone's wallet) signs it.
 * The approval is simulated first; the code binds to the first wallet whose approval would land and is consumed only on confirm.
 * With no `?wallet=` it answers only `{ owner }`, the preview the page shows before connecting (R207 #5); every answer carries
 * `owner`, so the page can check the approval is for the garden the user confirmed.
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  if (rateLimited(`link:${clientIp(request)}`)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });

  const { code } = await ctx.params;
  const walletParam = new URL(request.url).searchParams.get("wallet");
  const repo = await getRepo();
  const link = await repo.peekLinkCode(code.toUpperCase());
  if (walletParam === null) {
    if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
    return NextResponse.json({ owner: ownerLabel(await repo.getUser(link.userPubkey), link.userPubkey) });
  }
  let wallet: Address;
  try {
    wallet = address(walletParam);
  } catch {
    return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  }

  if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
  if (link.walletPubkey && link.walletPubkey !== wallet) return NextResponse.json({ error: "This code was already used with another wallet. Get a new code in the app, then try again." }, { status: 409 });

  // A wallet another Seeker still holds cannot be taken over; a revoked one can be linked again, by anyone (review I3). The 409
  // tells a code holder the wallet is linked elsewhere (R207 #9); the chain says so too (the delegation names delegator and puller).
  const existing = await repo.getWallet(wallet);
  if (existing && existing.userPubkey !== link.userPubkey && existing.status !== "revoked") {
    return NextResponse.json({ error: "This wallet is linked to another Seeker. Revoke it there first." }, { status: 409 });
  }

  const puller = (await pullerSigner()).address;
  // R297 / contracts 3.4: after go-live new links point at the leash PDA of (this wallet, this garden); before, at the puller.
  const delegatee = leashLive() ? await leashPda(wallet, address(link.userPubkey)) : puller;
  const pda = await delegationPda({ delegator: wallet, delegatee, nonce: link.nonce });
  if (link.walletPubkey && link.delegationPda && link.delegationPda !== pda) {
    // Bound before the go-live switch flipped (or the puller rotated): the confirm would look for the old delegation, so stop here.
    return NextResponse.json({ error: "This code was made before Sprouts changed how links work. Get a new code in the app, then try again." }, { status: 409 });
  }

  // A wallet that linked before already has its USDC authority on chain: re-init would fail, so the create carries its init id.
  // A wallet with no USDC account yet gets it created in the same approval (the init needs it).
  const [authority, ataExists] = await Promise.all([readSubscriptionAuthority(wallet), readUsdcAtaExists(wallet)]);
  const ixs = await buildApproveOnceIxs({ delegator: wallet, delegatee, capRaw: DAILY_CAP_RAW, nonce: link.nonce, existingInitId: authority.exists ? authority.initId : undefined, createAta: !ataExists });
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
  // Simulated before any wallet sees it (MetaMask with no SOL, 2026-09-29): a wallet that cannot pay the rent hears it in plain
  // words, and the code is bound only to a wallet whose approval would land, so a failed try leaves it free for another wallet.
  const sim = await rpc().simulateTransaction(transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) return NextResponse.json({ error: simulationError(sim.value.err, sim.value.logs ?? []) }, { status: 400 });
  if (!link.walletPubkey) await repo.bindLinkCode(link.code, wallet, pda);
  const owner = ownerLabel(await repo.getUser(link.userPubkey), link.userPubkey);
  return NextResponse.json({ transaction, cap: DAILY_CAP_CENTS, puller, delegatee, delegationPda: pda, revokes, owner });
}

/** A failed simulation in the words the user needs: no SOL for the rent and fee, or a failure that would happen on chain. */
function simulationError(err: unknown, logs: readonly string[]): string {
  const text = JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const noSol = err === "AccountNotFound" || /InsufficientFundsFor(Fee|Rent)/.test(text) || logs.some((l) => /insufficient lamports/i.test(l));
  if (noSol) return "This wallet needs a little SOL first: about 0.01 SOL covers the one-time rent (refunded when you revoke) and the fee. Nothing was signed.";
  return `This approval would fail on chain (${text.slice(0, 120)}), so no wallet was asked to sign it. Try again, or get a new code.`;
}
