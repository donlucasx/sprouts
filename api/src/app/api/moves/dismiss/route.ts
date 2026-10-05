import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { moveDetail } from "@/lib/moves";

export const runtime = "nodejs";
const Body = z.object({ id: z.string().min(1) });

/** Contracts 5.4: the user turns the card down; it closes as dismissed and Activity lists it. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const p = await repo.getMoveProposal(parsed.data.id);
  if (!p || p.userPubkey !== user.seedVaultPubkey) return NextResponse.json({ error: "No such move." }, { status: 404 });
  if (p.status !== "open") return NextResponse.json({ error: "This move is no longer open." }, { status: 409 });
  await repo.setMoveProposalStatus(p.id, "dismissed");
  await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_dismissed", detail: moveDetail(p, "dismissed") });
  return NextResponse.json({ dismissed: true });
}
