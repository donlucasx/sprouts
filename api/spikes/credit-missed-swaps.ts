// ONE-OFF (11-01, his ruling "credit them"): books swaps the webhook missed before the Titan fix (c8bb6c5), through the SAME
// bookSwap path the webhook uses (legs, top-up skip, the wallet's rules, size, class, round-up, insert-once on the signature).
// The only difference: the on-chain re-check runs with its clock set to the block time, since these swaps are days old and the
// live check refuses anything older than an hour. Every other check (signed by the wallet, succeeded, amounts within the chain's
// balance change) still applies. DRY by default: prints what it would book. `--write` inserts. Re-running is harmless (the
// signature is the key). No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/credit-missed-swaps.ts <wallet prefix> <sig prefix>... [--write]
import { getRepo } from "../src/db/repo";
import type { Repo } from "../src/db/repo";
import { config } from "../src/lib/config";
import { bookSwap, type HeliusEnhancedTx } from "../src/lib/book-swap";
import { checkSwapOnChain, fetchTransaction } from "../src/lib/verify-swap";
import { priceUsd } from "../src/lib/jupiter";

const write = process.argv.includes("--write");
const args = process.argv.slice(2).filter((a) => a !== "--write");
const repo = await getRepo();
const wallets = await (async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
  return (await db.from("wallets").select("pubkey").like("pubkey", `${args[0]}%`)).data ?? [];
})();
if (wallets.length !== 1) throw new Error(`wallet prefix matched ${wallets.length} wallets`);
const wallet = wallets[0].pubkey as string;

const rpc = config().heliusRpcUrl;
const key = new URL(rpc).searchParams.get("api-key");
const sigs = (await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet, { limit: 100 }] }) })).json()) as { result?: { signature: string }[] };
const wanted = (sigs.result ?? []).map((s) => s.signature).filter((s) => args.slice(1).some((p) => s.startsWith(p)));
if (wanted.length !== args.length - 1) throw new Error(`found ${wanted.length} of ${args.length - 1} signatures`);
const txs = (await (await fetch(`https://api.helius.xyz/v0/transactions?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: wanted }) })).json()) as HeliusEnhancedTx[];

// Dry: the real repo for every read, the insert only printed.
const target: Repo = write
  ? repo
  : new Proxy(repo, { get: (r, p) => (p === "insertSwap" ? async (s: unknown) => (console.log("  would insert", JSON.stringify(s)), true) : (r as any)[p]?.bind?.(r) ?? (r as any)[p]) });

for (const tx of txs) {
  const r = await bookSwap({
    repo: target,
    tx,
    priceUsd,
    verify: async (a) => checkSwapOnChain(await fetchTransaction(a.signature), { ...a, nowS: a.timestamp + 5 }),
  });
  console.log(tx.signature.slice(0, 8), write ? "WRITE" : "DRY", JSON.stringify(r));
}
if (write) console.log("pending for the wallet now:", (await repo.unplantedSwaps(wallet)).reduce((s, w) => s + w.roundupCents, 0), "cents");
