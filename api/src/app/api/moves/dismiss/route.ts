import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { IN_FLIGHT, moveDetail } from "@/lib/moves";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";
const Body = z.object({ id: z.string().min(1) });

/** Contracts 5.4: the user turns the card down; it closes as dismissed and Activity lists it. */
async function postHandler(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  const p = await repo.getMoveProposal(parsed.data.id);
  if (!p || p.userPubkey !== user.seedVaultPubkey) return apiError("move_not_found", { error: "No such move." }, { status: 404 }, lang);
  if (p.status !== "open") return apiError("move_not_open", { error: "This move is no longer open." }, { status: 409 }, lang);
  // K-I1: a move in flight (its redeem signature stored) is never dismissed: the cron or the confirm settles it.
  if (p.redeemSignature) return apiError("move_in_flight", { error: IN_FLIGHT, inFlight: true }, { status: 409 }, lang);
  // Compare-and-set (C-I2): the confirm storing its signatures, or the cron's expiry, may have won since the read above.
  if (!(await repo.transitionMoveProposal(p.id, "open", "dismissed", { notInFlight: true }))) {
    const now = await repo.getMoveProposal(p.id);
    return now?.status === "open" && now.redeemSignature
      ? apiError("move_in_flight", { error: IN_FLIGHT, inFlight: true }, { status: 409 }, lang)
      : apiError("move_not_open", { error: "This move is no longer open." }, { status: 409 }, lang);
  }
  await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_dismissed", detail: moveDetail(p, "dismissed") });
  return NextResponse.json({ dismissed: true });
}
export const POST = withAppErrorLog("moves/dismiss", postHandler);
