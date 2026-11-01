import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import type { EventKind } from "@/db/types";
import { requireSession, rateLimited } from "@/lib/auth-guard";

export const runtime = "nodejs";

export const SUPPORT_TOPICS = ["link", "planting", "withdraw", "idea", "other"] as const;
/** 11-01 (his ruling): replies go by email only, so the email is required. A day's cap keeps the table and the webhook quiet. */
export const SUPPORT_DAILY_CAP = 5;
export const SUPPORT_MESSAGE_MAX = 2000;

const Body = z.object({
  topic: z.enum(SUPPORT_TOPICS).nullable().optional(),
  message: z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX),
  email: z.string().trim().max(254).email(),
  // What the app knows about itself; free text from the client, so only plain characters are kept.
  app: z.object({ version: z.string().max(20), device: z.string().max(40) }).partial().optional(),
});

/** The failures worth seeing beside a message: the last few, newest first. */
const RECENT: EventKind[] = ["link_started", "link_failed", "signin_failed", "pull_failed", "withdraw_failed", "withdraw_skipped", "leg_skipped", "paused_no_usdc"];
const plain = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\w .()+-]/g, "").slice(0, max) : null);

/**
 * 11-01 (his "contact support" ask): Settings > Message us. Stored as a support_message event and sent to the founder's webhook with
 * what the server already knows (the .skr name, the wallets and their state, the last failures), so a reply needs no back and forth.
 * The reply goes by email from hello@sprouts.money; nothing comes back into the app.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (rateLimited(`support:${session.pubkey}`, 3)) return NextResponse.json({ error: "Wait a minute and send it again." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const dayAgo = Date.now() - 24 * 3600_000;
  const sent = await repo.listEvents(session.pubkey, ["support_message"], SUPPORT_DAILY_CAP);
  if (sent.filter((e) => e.ts.getTime() > dayAgo).length >= SUPPORT_DAILY_CAP) {
    return NextResponse.json({ error: "You have sent 5 messages today. We read them all and will reply by email." }, { status: 429 });
  }
  const [user, wallets, recent] = await Promise.all([repo.getUser(session.pubkey), repo.listWalletsOf(session.pubkey), repo.listEvents(session.pubkey, RECENT, 3)]);
  const { topic, message, email, app } = parsed.data;
  await repo.addEvent({
    kind: "support_message",
    userPubkey: session.pubkey,
    walletPubkey: null,
    detail: {
      topic: topic ?? null,
      message,
      email,
      app: { version: plain(app?.version, 20), device: plain(app?.device, 40) },
      context: {
        skrName: user?.skrName ?? null,
        wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status })),
        recent: recent.map((e) => ({ kind: e.kind, ts: e.ts.toISOString(), step: (e.detail as { step?: unknown } | null)?.step ?? null })),
      },
    },
  });
  return NextResponse.json({ ok: true });
}
