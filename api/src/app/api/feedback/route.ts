import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession, rateLimited } from "@/lib/auth-guard";
import { FEEDBACK_OPTIONS } from "@/domain/asks";

export const runtime = "nodejs";

/** A day's cap keeps the table and the founder's webhook quiet; the app asks one question at a time, so a real user never nears it. */
const FEEDBACK_DAILY_CAP = 10;

const Body = z.object({
  question: z.enum(["link_failed", "wallet_removed", "brought_you"]),
  // The ref the server handed out in /api/me (a wallet and a day, or a fixed word); echoed back unchanged.
  ref: z.string().max(120).optional(),
  choice: z.string().max(40),
  text: z.string().trim().max(500).optional(),
  // 11-08 (his ask): an optional email for a reply, validated like Message us's (support/route.ts); an empty field is no email.
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(254).email().optional()),
});

/**
 * 0.1.9: the answer to "What happened?" (link_failed, wallet_removed) or "What brought you to Sprouts?" (brought_you). Stored as a
 * feedback_answer event; /api/me reads the question and ref back so each ref is asked once.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (rateLimited(`feedback:${session.pubkey}`, 6)) return NextResponse.json({ error: "Wait a minute and send it again." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const pickIssue = parsed.error.issues.some((i) => i.path[0] === "choice" || i.path[0] === "question");
    return NextResponse.json({ error: pickIssue ? "Pick one of the answers." : "Bad request." }, { status: 400 });
  }
  const { question, ref, choice, text, email } = parsed.data;
  if (!(FEEDBACK_OPTIONS[question] as readonly string[]).includes(choice)) return NextResponse.json({ error: "Pick one of the answers." }, { status: 400 });
  const repo = await getRepo();
  const dayAgo = Date.now() - 24 * 3600_000;
  const sent = await repo.listEvents(session.pubkey, ["feedback_answer"], FEEDBACK_DAILY_CAP);
  if (sent.filter((e) => e.ts.getTime() > dayAgo).length >= FEEDBACK_DAILY_CAP) {
    return NextResponse.json({ error: "That is enough answers for today. Thank you." }, { status: 429 });
  }
  await repo.addEvent({ kind: "feedback_answer", userPubkey: session.pubkey, walletPubkey: null, detail: { question, ref, choice, text, ...(email ? { email } : {}) } });
  return NextResponse.json({ ok: true });
}
