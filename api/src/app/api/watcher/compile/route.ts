import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { callTool } from "@/lib/anthropic";
import { compileRule, costMicrocents, watcherBudget, WatcherError } from "@/lib/watcher";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().trim().min(1).max(300) }).strict();

/**
 * Rules in plain English (spec 6): the typed rule becomes a patch the Rules screen shows as a draft. Nothing is saved here; the
 * save is PUT /api/rules with its own checks. The budget is read before the model is called and the call is recorded after.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const paused = await watcherBudget(repo, session.pubkey, new Date());
  if (paused === "month") return NextResponse.json({ error: "The watcher is resting this month. The controls below still work." }, { status: 503 });
  if (paused === "day") return NextResponse.json({ error: "That is enough for today. The controls below still work." }, { status: 429 });
  const current = rulesRowToRules(await repo.getRules(session.pubkey));
  try {
    const r = await compileRule({ text: parsed.data.text, current, model: callTool });
    await repo.addWatcherCall({ userPubkey: session.pubkey, kind: "compile", ...r.usage, costMicrocents: costMicrocents(r.usage) });
    return NextResponse.json({ patch: r.patch, understood: r.understood, notes: r.notes });
  } catch (e) {
    if (!(e instanceof WatcherError)) throw e;
    if (e.usage) await repo.addWatcherCall({ userPubkey: session.pubkey, kind: "compile", ...e.usage, costMicrocents: costMicrocents(e.usage) });
    return NextResponse.json({ error: "The watcher could not read that. Use the controls below." }, { status: 502 });
  }
}
