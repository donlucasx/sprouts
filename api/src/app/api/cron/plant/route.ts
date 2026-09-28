import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { rpc } from "@/lib/rpc";
import { runPlanting, type Chain } from "@/lib/plant-run";
import { runWithdrawCrank } from "@/lib/withdraw-run";
import { readDelegation, usdcAta } from "@/lib/subscriptions";
import { buildPlantingTx, simulatePlanting, sendPlanting, signatureStatus, type BuiltPlanting } from "@/lib/planting";
import { readPosition, crankWithdraw } from "@/lib/staking";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(header: string | null): boolean {
  const expected = Buffer.from(`Bearer ${config().cronSecret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The real chain behind the run: delegation reads, balances, and the planting builder from the libraries. */
function realChain(): Chain {
  return {
    readDelegation: (pda) => readDelegation(address(pda)),
    usdcBalanceRaw: async (owner) => {
      // A missing token account is "no USDC"; anything else (an RPC outage) throws, so the wallet is skipped, not paused (review I8).
      const ata = await usdcAta(address(owner));
      const info = await rpc().getAccountInfo(ata, { encoding: "base64" }).send();
      if (!info.value) return 0n;
      const { value } = await rpc().getTokenAccountBalance(ata).send();
      return BigInt(value.amount);
    },
    buildPlantingTx: (a) => buildPlantingTx({ ...a, delegator: address(a.delegator), user: address(a.user), delegationPda: address(a.delegationPda) }),
    simulatePlanting: (b) => simulatePlanting(b as BuiltPlanting),
    sendPlanting: (b) => sendPlanting(b as BuiltPlanting),
    signatureStatus,
  };
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Once a day (Vercel cron, bearer = CRON_SECRET): plant, crank withdrawals, keep the database awake. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const repo = await getRepo();
    const now = new Date();
    const planting = await runPlanting({ repo, now, chain: realChain() });
    const withdrawals = await runWithdrawCrank({ repo, now, chain: { readPosition: (u) => readPosition(address(u)), crankWithdraw: (u) => crankWithdraw(address(u)) } });
    // The first production run (2026-09-28) planted and then answered 500 here: reading rules for a made-up user violates the
    // rules -> users foreign key. The keepalive is now a read that needs no row.
    await repo.keepalive();
    console.log(`cron: planted ${planting.planted.length}, skipped ${planting.skipped.length}, cranked ${withdrawals.cranked.length}, failed ${withdrawals.failed.length}`);
    return NextResponse.json(json({ planting, withdrawals }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`cron failed: ${message}`);
    return NextResponse.json({ error: `Cron failed: ${message}` }, { status: 500 });
  }
}
