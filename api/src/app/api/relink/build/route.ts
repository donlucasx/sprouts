import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { address, type Address, type Instruction } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildUserTransaction } from "@/lib/user-tx";
import { buildApproveOnceIxs, buildRevokeDelegationIx, delegationPda, readDelegation, readSubscriptionAuthority, readUsdcAtaExists } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { rpc } from "@/lib/rpc";

export const runtime = "nodejs";

const CAP_RAW = 5_000_000n; // $5 a day, the amount the phone pins (contracts 6 relink)

/**
 * Contracts 5.5, in its order: [ATA create when missing], [revoke the current delegation when live], [init the authority when missing],
 * create(delegatee = leashPda(user, user), $5 per 86_400 s, expiry 0). Only the ATA and Subscriptions programs, no ComputeBudget
 * (contracts 6, AMEND s20): the phone's checkApproval accepts exactly this. (Task 18's `buildRelink` in lib/venues/user-builders.ts
 * builds the same set with the revoke first, the other order the phone accepts.)
 */
async function relinkIxs(a: { user: Address; nonce: bigint; existingDelegationPda: Address | null; existingInitId?: bigint; createAta: boolean }): Promise<Instruction[]> {
  const ixs = await buildApproveOnceIxs({ delegator: a.user, delegatee: await leashPda(a.user, a.user), capRaw: CAP_RAW, nonce: a.nonce, ...(a.existingInitId !== undefined ? { existingInitId: a.existingInitId } : {}), createAta: a.createAta });
  if (!a.existingDelegationPda) return ixs;
  const revoke = buildRevokeDelegationIx({ delegator: a.user, delegationPda: a.existingDelegationPda });
  const at = a.createAta && a.existingInitId === undefined ? 1 : 0; // after the ATA create, before the init
  return [...ixs.slice(0, at), revoke, ...ixs.slice(at)];
}

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
  const ixs = await relinkIxs({ user: me, nonce, existingDelegationPda: live ? address(wallet.delegationPda) : null, ...(authority.exists ? { existingInitId: authority.initId } : {}), createAta: !ataExists });
  const transaction = await buildUserTransaction(me, ixs);
  // Simulated before any wallet sees it (as link/[code]): a re-link that would fail asks nothing of the wallet.
  const sim = await rpc().simulateTransaction(transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) return NextResponse.json({ error: "This re-link would fail on chain, so nothing was asked of your wallet. Try again in a minute." }, { status: 400 });
  return NextResponse.json({ transaction, leashPda: leash, delegationPda: await delegationPda({ delegator: me, delegatee: leash, nonce }), revokes: live ? wallet.delegationPda : null, cap: 500 });
}
