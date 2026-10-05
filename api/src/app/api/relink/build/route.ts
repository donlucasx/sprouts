import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildUserTransaction } from "@/lib/user-tx";
import { delegationPda, readDelegation, readSubscriptionAuthority, readUsdcAtaExists } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { buildRelink } from "@/lib/venues/user-builders";
import { rpc } from "@/lib/rpc";

export const runtime = "nodejs";

/** Contracts 5.5: the Seed Vault wallet re-links in one signature (revoke the puller delegation, create the leash one). Works before go-live too (his test wallet). */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const wallet = await repo.getWallet(user.seedVaultPubkey);
  if (!wallet || wallet.userPubkey !== user.seedVaultPubkey || wallet.status === "revoked") return NextResponse.json({ error: "Link this phone's wallet first." }, { status: 409 });
  if (wallet.linkModel === "leash") return NextResponse.json({ error: "This wallet is already re-linked." }, { status: 409 });
  const me = address(user.seedVaultPubkey);
  const leash = await leashPda(me, me);
  const nonce = randomBytes(8).readBigUInt64LE();
  const [authority, ataExists, current] = await Promise.all([readSubscriptionAuthority(me), readUsdcAtaExists(me), readDelegation(address(wallet.delegationPda))]);
  const live = current.exists;
  const ixs = await buildRelink({ user: me, nonce, startTs: BigInt(Math.floor(Date.now() / 1000)), existingDelegationPda: live ? address(wallet.delegationPda) : null, ...(authority.exists ? { existingInitId: authority.initId } : {}), createAta: !ataExists });
  const transaction = await buildUserTransaction(me, ixs);
  // Simulated before any wallet sees it (as link/[code]): a re-link that would fail asks nothing of the wallet.
  const sim = await rpc().simulateTransaction(transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) return NextResponse.json({ error: "This re-link would fail on chain, so nothing was asked of your wallet. Try again in a minute." }, { status: 400 });
  return NextResponse.json({ transaction, leashPda: leash, delegationPda: await delegationPda({ delegator: me, delegatee: leash, nonce }), revokes: live ? wallet.delegationPda : null, cap: 500 });
}
