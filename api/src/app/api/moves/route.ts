import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { json } from "@/lib/json";

export const runtime = "nodejs";

/** Contracts 5.4: the user's open move card (the same shape /api/me serves as moveProposal), or null. */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const open = await repo.openMoveProposal(user.seedVaultPubkey);
  return NextResponse.json(json({
    proposal: open
      ? { id: open.id, ts: open.ts, asset: open.asset, from: open.fromVenue, to: open.toVenue, receiptRaw: open.receiptRaw, valueUsd: open.valueUsd,
          fromAvg7Pct: open.fromAvg7Pct, toAvg7Pct: open.toAvg7Pct, gain30dUsd: open.gain30dUsd, costUsd: open.costUsd }
      : null,
  }));
}
