import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { ASSETS } from "@/domain/coins";
import type { Pins } from "@/domain/roundup";
import { effectiveSplit, STOP_DEFAULTS } from "@/domain/split";
import { dayOf } from "@/domain/day";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";

/**
 * The undo (spec 4.5, R122): yesterday's split comes back as pins and the Yield Manager turns off, so tomorrow's run cannot redo
 * the change. One level: only the manager's latest change, and only until the user saves anything. Nothing on chain moves.
 */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const current = await repo.getRules(session.pubkey);
  const prev = current.prevAllocation;
  if (!prev) return NextResponse.json({ error: "Nothing to undo." }, { status: 409 });
  const pins: Pins = {};
  for (const c of ASSETS) if (c !== "SKR" && prev[c] > 0) pins[c] = prev[c];
  // 10-23: a coin switched off stays off through the undo (a 0 pin means off with the manager off too now).
  for (const c of ASSETS) if (current.pins[c] === 0) pins[c] = 0;
  // The pins are marked as the undo's (R137): turning the manager back on drops them, so it is free again; pins set by hand are not marked.
  // The split is recomputed from the pins so a switched-off coin (SKR included) is never in the allocation. It equals `prev` only while
  // every coin in `prev` is still on; a coin switched off since moves its share to the rest coin.
  const allocation = effectiveSplit({ managed: false, stop: current.stop, pins, stopSplit: STOP_DEFAULTS[current.stop] });
  const saved = await repo.saveRules(session.pubkey, { managed: false, pins, pinsByUndo: true, allocation, prevAllocation: null, allocationDay: null });
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "split_undone", detail: { from: current.allocation, to: saved.allocation, day: dayOf(new Date()) } });
  return NextResponse.json(rulesRowToRules(saved));
}
export const POST = withAppErrorLog("rules/undo", postHandler);
