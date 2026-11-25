import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { TERMS_VERSION } from "@/lib/terms";

export const runtime = "nodejs";
const Body = z.object({ version: z.string().max(32) });

/** R283, contracts 5.6: the signed-in user accepts the current Terms + Privacy. */
export async function POST(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  if (parsed.data.version !== TERMS_VERSION) return apiError("terms_outdated", { error: "That is not the current Terms. Reload and read them again." }, { status: 400 }, lang);
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  // Already accepted: the first acceptance stands (its time, its one event).
  if (user.termsVersion === TERMS_VERSION && user.termsAcceptedAt) return NextResponse.json({ acceptedVersion: TERMS_VERSION, acceptedAt: user.termsAcceptedAt.toISOString() });
  const at = new Date();
  await repo.setTermsAccepted(session.pubkey, TERMS_VERSION, at);
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: null, kind: "terms_accepted", detail: { version: TERMS_VERSION } });
  return NextResponse.json({ acceptedVersion: TERMS_VERSION, acceptedAt: at.toISOString() });
}
