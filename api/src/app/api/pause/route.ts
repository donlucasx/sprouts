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
  // R207: the user's pause is recorded on every wallet it covers, one already paused by the run for want of USDC included (else the
  // run would read that wallet's newest cause as no-USDC and resume it), and recorded BEFORE the status moves, so a failed write
  // leaves the wallet as it was rather than paused with no cause.
  for (const w of await repo.listWalletsOf(session.pubkey)) {
    if (w.status === "revoked") continue;
    if (next === "paused") {
      await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: w.pubkey, kind: "paused_by_user", detail: { by: "user" } });
      if (w.status !== "paused") await repo.setWalletStatus(w.pubkey, "paused");
    } else if (w.status !== "active") {
      await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: w.pubkey, kind: "resumed", detail: { by: "user" } });
      await repo.setWalletStatus(w.pubkey, "active");
    }
  }
  const wallets = await repo.listWalletsOf(session.pubkey);
  return NextResponse.json({ paused, wallets: wallets.map((w) => ({ pubkey: w.pubkey, status: w.status })) });
}
