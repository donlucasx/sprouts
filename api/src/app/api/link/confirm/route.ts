import { NextResponse } from "next/server";
import { address, type Address } from "@solana/kit";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { readDelegation } from "@/lib/subscriptions";
import { heliusAddAddress } from "@/lib/helius";

export const runtime = "nodejs";

const Body = z.object({ code: z.string().length(6), wallet: z.string().min(32).max(44), waitMs: z.number().int().min(0).max(10_000).optional() });
const RETRY_MS = 2_000;

/** Waits for the delegation to appear (RPC lag right after the signature), up to `waitMs`. */
async function delegationAppears(pda: Address, waitMs: number) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const d = await readDelegation(pda);
    if (d.exists) return d;
    if (Date.now() >= deadline) return d;
    await new Promise((r) => setTimeout(r, Math.min(RETRY_MS, Math.max(0, deadline - Date.now()))));
  }
}

/** Links the wallet once its delegation is on chain: consumes the code, records the wallet, adds it to the swap webhook. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const code = parsed.data.code.toUpperCase();
  let wallet: Address;
  try {
    wallet = address(parsed.data.wallet);
  } catch {
    return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  }

  const repo = await getRepo();
  const link = await repo.peekLinkCode(code);
  if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
  if (!link.walletPubkey || !link.delegationPda) return NextResponse.json({ error: "Fetch the approval for this code first." }, { status: 409 });
  if (link.walletPubkey !== wallet) return NextResponse.json({ error: "This code belongs to another wallet." }, { status: 409 });

  const delegation = await delegationAppears(address(link.delegationPda), parsed.data.waitMs ?? 10_000);
  if (!delegation.exists) return NextResponse.json({ error: "No delegation found for this wallet yet. Sign the approval first." }, { status: 409 });

  const taken = await repo.takeLinkCode(code, wallet);
  if (!taken) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });

  await repo.addWallet({ pubkey: wallet, userPubkey: link.userPubkey, delegationPda: link.delegationPda, dailyCapCents: Number(delegation.amountPerPeriodRaw / 10_000n) });
  let webhookAdded = true;
  try {
    await heliusAddAddress(config().heliusWebhookId, wallet);
  } catch (e) {
    webhookAdded = false;
    console.error(`helius add address failed for ${wallet}: ${e instanceof Error ? e.message : String(e)}`);
  }
  await repo.addEvent({ userPubkey: link.userPubkey, walletPubkey: wallet, kind: "wallet_linked", detail: { webhookAdded } });
  const user = await repo.getUser(link.userPubkey);
  return NextResponse.json({ linked: true, skrName: user?.skrName ?? null });
}
