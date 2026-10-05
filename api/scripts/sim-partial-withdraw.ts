/**
 * R359 read-only check: for each given user's live lending positions, ask the build route for HALF the position, then simulate the
 * unsigned transaction on mainnet (sigVerify off, the blockhash replaced). Nothing is signed or sent. Run from api/:
 *   npx tsx --env-file=<api/.env.local> scripts/sim-partial-withdraw.ts <pubkey> [<pubkey> ...] | --all
 */
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { issueSession } from "@/lib/session";
import { getRepo } from "@/db/repo";
import { readLendingPositions } from "@/lib/holdings";
import { rpc } from "@/lib/rpc";
import { RECEIPT } from "@/lib/venues/addresses";
import { POST as build } from "@/app/api/lend/withdraw/build/route";

async function main() {
  const repo = await getRepo();
  const args = process.argv.slice(2);
  const pks = args[0] === "--all" ? (await repo.listUsers()).map((u) => u.seedVaultPubkey) : args;
  for (const pk of pks) {
    const user = await repo.getUser(pk);
    if (!user) { console.log(`${pk}: no such user`); continue; }
    const owner = address(user.seedVaultPubkey);
    const positions = await readLendingPositions(owner);
    if (positions.length || args[0] !== "--all") console.log(`${pk.slice(0, 6)}: ${positions.length} lending position(s)`);
    for (const p of positions) {
      const ask = async (body: object) => build(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${await issueSession(pk, user.sgtMint ?? "M")}` }, body: JSON.stringify(body) }));
      const whole = await (await ask({ asset: p.asset, venue: p.venue })).json();
      if (!whole.transaction) { console.log(`  ${p.asset}/${p.venue}: whole build refused: ${JSON.stringify(whole)}`); continue; }
      const half = (BigInt(whole.expectedOutRaw) / 2n).toString();
      const res = await ask({ asset: p.asset, venue: p.venue, amountRaw: half });
      const body = await res.json();
      console.log(`  ${p.asset}/${p.venue}: receipt ${p.receiptRaw}, whole out ${whole.expectedOutRaw}; asked ${half} -> ${res.status} ${JSON.stringify({ receiptRaw: body.receiptRaw, expectedOutRaw: body.expectedOutRaw, all: body.all, brief: body.brief, error: body.error })}`);
      if (!body.transaction) continue;
      const mint = RECEIPT[p.asset][p.venue].mint;
      const [receiptAta] = await findAssociatedTokenPda({ owner, mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
      const sim = await rpc().simulateTransaction(body.transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "jsonParsed", addresses: [receiptAta, owner] } }).send();
      const v = sim.value as unknown as { err: unknown; logs: string[] | null; accounts: ({ data: { parsed?: { info?: { tokenAmount?: { amount: string } } } }; lamports: bigint } | null)[] };
      const before = await rpc().getBalance(owner, { commitment: "confirmed" }).send();
      const after = v.accounts?.[1]?.lamports;
      console.log(`  simulate: err=${JSON.stringify(v.err)}; receipt after ${v.accounts?.[0]?.data?.parsed?.info?.tokenAmount?.amount ?? "?"} (was ${p.receiptRaw}); SOL lamports ${before.value} -> ${after} (fee included)`);
      if (v.err) console.log((v.logs ?? []).slice(-8).join("\n"));
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
