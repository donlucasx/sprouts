import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createNoopSigner } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, sharePrice, buildUnstakeIx } from "@/lib/staking";
import { priceUsd } from "@/lib/jupiter";
import { potForUser } from "@/lib/pot";
import { planPick } from "@/lib/withdraw";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { SKR_MINT } from "@/lib/constants";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";

const Body = z.object({ mode: z.enum(["earned", "amount"]), amountRaw: z.string().regex(/^\d+$/).optional() });
const COOLDOWN_MS = 172_800_000;
const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" }) + " UTC";

/** The unstake transaction for the Seed Vault to sign, with the brief: what leaves, what stays, when it arrives (spec 6). */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.mode === "amount" && !parsed.data.amountRaw)) return apiError("bad_request", { error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 });

  const pending = await repo.pendingWithdrawal(user.seedVaultPubkey);
  if (pending) return apiError("basket_busy", { error: `One basket at a time. Your last withdrawal arrives ${when(new Date(pending.unstakeTs.getTime() + COOLDOWN_MS))}.` }, { status: 409 });

  const owner = userAddress(user.seedVaultPubkey);
  const [position, price, skrUsd] = await Promise.all([readPosition(owner), sharePrice(), priceUsd(SKR_MINT)]);
  // The program allows one cooldown per position: a cooldown the wallet started refuses a second before any signature is asked (review I2).
  if (position.unstakingRaw > 0n) {
    const readyAt = position.unstakeTs === null ? null : new Date(Number(position.unstakeTs) * 1000 + COOLDOWN_MS);
    return apiError("basket_busy", { error: `One basket at a time. Your Seeker's wallet is already ripening a withdrawal${readyAt ? `; it arrives ${when(readyAt)}` : ""}.` }, { status: 409 });
  }
  const pot = await potForUser(repo, user, { position, sharePrice: price });
  let plan;
  try {
    plan = planPick({ mode: parsed.data.mode, amountRaw: parsed.data.amountRaw ? BigInt(parsed.data.amountRaw) : undefined, pot, sharePrice: price, skrUsd });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return apiError(message.includes("more than") ? "withdraw_too_large" : "withdraw_refused", { error: message }, { status: message.includes("more than") ? 400 : 409 });
  }
  const ix = await buildUnstakeIx({ user: createNoopSigner(owner), shares: plan.shares });
  const transaction = await buildUserTransaction(owner, [ix]);
  return NextResponse.json(json({ transaction, shares: plan.shares, amountRaw: plan.amountRaw, prunes: plan.prunes, brief: plan.brief }));
}
export const POST = withAppErrorLog("withdraw/build", postHandler);
