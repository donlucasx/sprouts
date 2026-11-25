import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { userTransactionCompiler } from "@/lib/user-tx";
import { delegationPda, readDelegation, readSubscriptionAuthority, readUsdcAtaExists } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { buildRelink } from "@/lib/venues/user-builders";
import { rpc } from "@/lib/rpc";
import { withAppErrorLog } from "@/lib/failure-log";
import { rulesRowToRules } from "@/db/types";
import { fitSetup, linkSetupCovered, plannedSetup, setupCount } from "@/lib/user-setup";

export const runtime = "nodejs";

/** Contracts 5.5: the Seed Vault wallet re-links in one signature (revoke the puller delegation, create the leash one). Works before go-live too (his test wallet). */
async function postHandler(request: Request) {
  const lang = langOf(request);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  const wallet = await repo.getWallet(user.seedVaultPubkey);
  if (!wallet || wallet.userPubkey !== user.seedVaultPubkey || wallet.status === "revoked") return apiError("link_wallet_first", { error: "Link this phone's wallet first." }, { status: 409 }, lang);
  if (wallet.linkModel === "leash") return apiError("already_relinked", { error: "This wallet is already re-linked." }, { status: 409 }, lang);
  const me = address(user.seedVaultPubkey);
  const leash = await leashPda(me, me);
  const nonce = randomBytes(8).readBigUInt64LE();
  const [authority, ataExists, current] = await Promise.all([readSubscriptionAuthority(me), readUsdcAtaExists(me), readDelegation(address(wallet.delegationPda))]);
  const live = current.exists;
  const ixs = await buildRelink({ user: me, nonce, startTs: BigInt(Math.floor(Date.now() / 1000)), existingDelegationPda: live ? address(wallet.delegationPda) : null, ...(authority.exists ? { existingInitId: authority.initId } : {}), createAta: !ataExists });
  const simulate = (tx: string) => rpc().simulateTransaction(tx as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  // Task 17a (user rent): the opt-in setup creates lead, as link/[code] (SOL rule, fit, simulate, else today's re-link). An absent, empty
  // or unreadable body (0.1.11 / 0.1.12 send none) or a setupMax that is not 1..7 is no setup: never a refusal.
  const asked = (await request.json().catch(() => null)) as { setupMax?: unknown } | null;
  const setupAsked = asked !== null && typeof asked === "object" && "setupMax" in asked;
  const setup = setupAsked
    ? await plannedSetup(me, async () => rulesRowToRules(await repo.getRules(user.seedVaultPubkey)), setupCount(typeof asked.setupMax === "number" ? asked.setupMax : 0),
      async (n) => linkSetupCovered(BigInt((await rpc().getBalance(me, { commitment: "confirmed" }).send()).value), n))
    : [];
  // One blockhash for the whole build (the setup sizes tried and the plain fallback all compile locally).
  const compile = await userTransactionCompiler(me);
  let transaction: string | null = null;
  let setupAccounts = 0;
  if (setup.length > 0) {
    const fit = await fitSetup((c) => compile([...c, ...ixs]), setup);
    if (fit.transaction !== null) {
      if (!(await simulate(fit.transaction)).value.err) [transaction, setupAccounts] = [fit.transaction, fit.used];
      else console.error(`relink: the re-link with ${fit.used} setup creates would fail for ${me}; built without them`);
    }
  }
  if (transaction === null) {
    transaction = compile(ixs);
    // Simulated before any wallet sees it (as link/[code]): a re-link that would fail asks nothing of the wallet.
    const sim = await simulate(transaction);
    if (sim.value.err) return apiError("relink_would_fail", { error: "This re-link would fail on chain, so nothing was asked of your wallet. Try again in a minute." }, { status: 400 }, lang);
  }
  return NextResponse.json({ transaction, leashPda: leash, delegationPda: await delegationPda({ delegator: me, delegatee: leash, nonce }), revokes: live ? wallet.delegationPda : null, cap: 500, ...(setupAsked ? { setupAccounts } : {}) });
}
export const POST = withAppErrorLog("relink/build", postHandler);
