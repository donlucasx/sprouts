import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, rateLimited } from "@/lib/auth-guard";
import { addressOrNull, recordFailure } from "@/lib/failure-log";

export const runtime = "nodejs";

/** What the app saw, in its own words: the step it stopped at and the error it showed (or the wallet's). Short on purpose. */
const Body = z.object({
  step: z.enum(["new", "approval", "sign", "confirm"]),
  reason: z.enum(["declined", "dropped", "refused", "api", "other"]),
  error: z.string().max(200),
  wallet: z.string().max(44).optional(),
});

/**
 * 10-31: a link the app saw fail. The server never hears about a wallet that was cancelled or closed before signing (the 10-30 sweep:
 * two Seeker owners made link codes, fetched the approval and stopped, with no event at all), so the app reports it here, signed in,
 * best effort. Recorded as link_failed with `from: "app"`; the session ties it to its owner.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (rateLimited(`link-report:${session.pubkey}`, 5)) return NextResponse.json({ ok: true });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { step, reason, error, wallet } = parsed.data;
  await recordFailure("link_failed", step, { status: 0, error: `${reason}: ${error}`, from: "app" }, async () => ({ userPubkey: session.pubkey, walletPubkey: addressOrNull(wallet) }));
  return NextResponse.json({ ok: true });
}
