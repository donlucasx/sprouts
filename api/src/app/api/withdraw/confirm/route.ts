import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, sharePrice, userStakePda } from "@/lib/staking";
import { getUnstakeInstructionDataDecoder, UNSTAKE_DISCRIMINATOR } from "@/generated/staking";
import { potForUser, sharesToRaw } from "@/lib/pot";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { sendPosted, waitConfirmed, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { SKR_STAKING_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";

const Body = z.object({ signedTransaction: z.string() });
const COOLDOWN_S = 172_800n;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Sends the unstake the Seed Vault signed and records the basket. The shares come from the transaction's own data, never from the
 * body [A3]; the chain must show the unstake before a row is written; the fruit-first split uses the position as it was before
 * the unstake (the shares it took, added back) [A15].
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (await repo.pendingWithdrawal(user.seedVaultPubkey)) return NextResponse.json({ error: "One basket at a time." }, { status: 409 });

  const owner = userAddress(user.seedVaultPubkey);
  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: owner, programs: [SKR_STAKING_PROGRAM] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const ix = posted.instructions[0];
  if (posted.instructions.length !== 1 || !same(ix.data.slice(0, 8), UNSTAKE_DISCRIMINATOR)) return NextResponse.json({ error: "That is not an unstake." }, { status: 400 });
  if (!ix.accounts.includes(await userStakePda(owner))) return NextResponse.json({ error: "That unstake is for another position." }, { status: 400 });
  const { shares } = getUnstakeInstructionDataDecoder().decode(ix.data);
  const price = await sharePrice();
  const amountRaw = sharesToRaw(shares, price);

  try {
    await sendPosted(posted.wire);
  } catch {
    return NextResponse.json({ error: "The withdrawal did not go through. Nothing moved." }, { status: 409 });
  }
  const status = await waitConfirmed(posted.signature);
  if (status !== "confirmed") return NextResponse.json({ error: status === "failed" ? "The withdrawal failed on chain. Nothing moved." : "The chain has not confirmed the withdrawal yet. Check again in a minute." }, { status: 409 });
  let after = await readPosition(owner);
  for (let i = 0; i < 3 && after.unstakingRaw === 0n; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    after = await readPosition(owner);
  }
  if (after.unstakingRaw === 0n) return NextResponse.json({ error: "The chain has not shown the withdrawal yet. Check again in a minute." }, { status: 409 });

  // Fruit first, the rest principal [A15]: earned as it stood before this unstake, which took `shares` from the position.
  const earnedNow = (await potForUser(repo, user, { position: { ...after, shares: after.shares + shares }, sharePrice: price })).skrEarnedRaw;
  const principalRaw = amountRaw > earnedNow ? amountRaw - earnedNow : 0n;
  const row = await repo.insertWithdrawal({ userPubkey: user.seedVaultPubkey, asset: "SKR", source: "sprouts", unstakeSignature: posted.signature, sharesUnstaked: shares, amountRaw, principalRaw });
  const readyAt = after.unstakeTs !== null ? new Date(Number(after.unstakeTs + COOLDOWN_S) * 1000) : new Date(row.unstakeTs.getTime() + Number(COOLDOWN_S) * 1000);
  return NextResponse.json(json({ basket: { id: row.id, asset: "SKR", amountRaw, unstakeTs: row.unstakeTs, readyAt, delivered: false, deliveredSignature: null } }));
}
