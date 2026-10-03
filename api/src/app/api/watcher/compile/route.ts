import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { callTool } from "@/lib/anthropic";
import { compileRule, costMicrocents, reserveWatcherCall, WatcherError } from "@/lib/watcher";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().trim().min(1).max(300) }).strict();

/**
 * Rules in plain English (spec 6): the typed rule becomes a patch the Rules screen shows as a draft. Nothing is saved here; the
 * save is PUT /api/rules with its own checks. The call is RESERVED against the budget before the model is called (R207 #6: a
 * read-then-record budget let a burst of concurrent requests all through) and settled to its real cost after.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const held = await reserveWatcherCall(repo, { userPubkey: session.pubkey, now: new Date() });
  if ("refused" in held && held.refused === "month") return NextResponse.json({ error: "The watcher is resting this month. The controls below still work." }, { status: 503 });
  if ("refused" in held) return NextResponse.json({ error: "That is enough for today. The controls below still work." }, { status: 429 });
  try {
    const current = rulesRowToRules(await repo.getRules(session.pubkey));
    const r = await compileRule({ text: parsed.data.text, current, model: callTool });
    await repo.settleWatcherCall(held.id, { ...r.usage, costMicrocents: costMicrocents(r.usage) });
    return NextResponse.json({ patch: r.patch, understood: r.understood, notes: r.notes });
  } catch (e) {
    // A failed call that still cost tokens keeps its row at the real cost; one that never reached the model frees its place.
    // Anything else (a thrown database read) keeps the row at its estimate: counted, never under-counted.
    if (!(e instanceof WatcherError)) throw e;
    if (e.usage) await repo.settleWatcherCall(held.id, { ...e.usage, costMicrocents: costMicrocents(e.usage) });
    else await repo.deleteWatcherCall(held.id);
    return NextResponse.json({ error: "The watcher could not read that. Use the controls below." }, { status: 502 });
  }
}
