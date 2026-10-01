import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { ASSETS } from "@/domain/coins";
import type { Pins } from "@/domain/roundup";
import { dayOf } from "@/domain/day";

export const runtime = "nodejs";

/**
 * The undo (spec 4.5, R122): yesterday's split comes back as pins and the Yield Manager turns off, so tomorrow's run cannot redo
 * the change. One level: only the manager's latest change, and only until the user saves anything. Nothing on chain moves.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const current = await repo.getRules(session.pubkey);
  const prev = current.prevAllocation;
  if (!prev) return NextResponse.json({ error: "Nothing to undo." }, { status: 409 });
  const pins: Pins = {};
  for (const c of ASSETS) if (c !== "SKR" && prev[c] > 0) pins[c] = prev[c];
  const saved = await repo.saveRules(session.pubkey, { managed: false, pins, allocation: prev, prevAllocation: null, allocationDay: null });
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "split_undone", detail: { from: current.allocation, to: prev, day: dayOf(new Date()) } });
  return NextResponse.json(rulesRowToRules(saved));
}
