import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { TERMS_VERSION } from "@/lib/terms";

export const runtime = "nodejs";
const Body = z.object({ version: z.string().max(32) });

/** R283, contracts 5.6: the signed-in user accepts the current Terms + Privacy. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (parsed.data.version !== TERMS_VERSION) return NextResponse.json({ error: "That is not the current Terms. Reload and read them again." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // Already accepted: the first acceptance stands (its time, its one event).
  if (user.termsVersion === TERMS_VERSION && user.termsAcceptedAt) return NextResponse.json({ acceptedVersion: TERMS_VERSION, acceptedAt: user.termsAcceptedAt.toISOString() });
  const at = new Date();
  await repo.setTermsAccepted(session.pubkey, TERMS_VERSION, at);
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "terms_accepted", detail: { version: TERMS_VERSION } });
  return NextResponse.json({ acceptedVersion: TERMS_VERSION, acceptedAt: at.toISOString() });
}
