import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { ReauthSchema, verifyReauth } from "@/lib/reauth";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";

const Body = z.object({ action: z.enum(["pause", "resume"]), reauth: ReauthSchema.optional() });

/** Pause or resume one of the user's linked wallets. Resume asks the Seeker for a fresh sign-in (R84); a revoked wallet links again instead [A20]. */
async function postHandler(request: Request, ctx: { params: Promise<{ pubkey: string }> }) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const { pubkey } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const wallet = await repo.getWallet(pubkey);
  if (!wallet || wallet.userPubkey !== session.pubkey) return apiError("wallet_not_found", { error: "No such wallet." }, { status: 404 });
  if (wallet.status === "revoked") return apiError("wallet_revoked", { error: "This wallet was revoked. Link it again to plant from it." }, { status: 409 });
  if (parsed.data.action === "resume") {
    const check = await verifyReauth(repo, session.pubkey, parsed.data.reauth, "Resuming a wallet");
    if (!check.ok) return apiError("reauth_required", { error: check.error, reauth: true }, { status: 403 });
  }
  const status = parsed.data.action === "pause" ? "paused" : "active";
  // R207: the cause first, then the status (a failed write leaves the wallet as it was, never paused with no cause)
  await repo.addEvent({ userPubkey: session.pubkey, walletPubkey: pubkey, kind: status === "active" ? "resumed" : "paused_by_user", detail: { by: "user" } });
  await repo.setWalletStatus(pubkey, status);
  return NextResponse.json({ pubkey, status });
}
export const POST = withAppErrorLog("wallets", postHandler);
