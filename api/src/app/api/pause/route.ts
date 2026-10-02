import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { badRequest } from "@/lib/bad-request";
import { ReauthSchema, verifyReauth } from "@/lib/reauth";

export const runtime = "nodejs";

const Body = z.object({ paused: z.boolean(), reauth: ReauthSchema.optional() }).strict();

/**
 * The switch on Home (R147). Off pauses every linked wallet with the session alone: nothing is pulled or planted until it is turned
 * back on, while swaps keep rounding up as waiting change. On asks the Seeker for ONE fresh sign-in (R84) and resumes them all,
 * where the per-wallet route would ask one per wallet (the nonce is single use). A revoked wallet is left alone (it links again).
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("pause", parsed.error);
  const repo = await getRepo();
  const { paused } = parsed.data;
  if (!paused) {
    const check = await verifyReauth(repo, session.pubkey, parsed.data.reauth, "Turning Sprouts back on");
    if (!check.ok) return NextResponse.json({ error: check.error, reauth: true }, { status: 403 });
  }
  const next = paused ? "paused" : "active";
  for (const w of await repo.listWalletsOf(session.pubkey)) {
    if (w.status === "revoked" || w.status === next) continue;
    await repo.setWalletStatus(w.pubkey, next);
    if (next === "active") await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: w.pubkey, kind: "resumed", detail: { by: "user" } });
  }
  const wallets = await repo.listWalletsOf(session.pubkey);
  return NextResponse.json({ paused, wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status })) });
}
