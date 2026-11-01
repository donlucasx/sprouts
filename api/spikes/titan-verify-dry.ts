// Read-only (11-01): the missed Titan sells through the booking's leg reader AND the on-chain re-check, the clock set to the block
// time (the live webhook runs within seconds of it). Writes nothing. No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/titan-verify-dry.ts <wallet prefix> <sig prefix>...
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";
import { extractSwapLegs, type HeliusEnhancedTx } from "../src/lib/book-swap";
import { checkSwapOnChain, fetchTransaction } from "../src/lib/verify-swap";
import { usdSizeCents } from "../src/domain/sizing";

const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: ws } = await db.from("wallets").select("pubkey").like("pubkey", `${process.argv[2]}%`);
const wallet = ws?.[0]?.pubkey as string;
const rpc = config().heliusRpcUrl;
const key = new URL(rpc).searchParams.get("api-key");
const sigs = (await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet, { limit: 50 }] }) })).json()) as { result?: { signature: string }[] };
const wanted = (sigs.result ?? []).map((s) => s.signature).filter((s) => process.argv.slice(3).some((p) => s.startsWith(p)));
const txs = (await (await fetch(`https://api.helius.xyz/v0/transactions?api-key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactions: wanted }) })).json()) as HeliusEnhancedTx[];
for (const tx of txs) {
  const legs = extractSwapLegs(tx, wallet);
  if (!legs) { console.log(tx.signature.slice(0, 8), "NO LEGS"); continue; }
  const chain = await fetchTransaction(tx.signature);
  const verdict = checkSwapOnChain(chain, { wallet, legs, timestamp: tx.timestamp, nowS: tx.timestamp + 5 });
  const jup = async (m: string) => {
    const r = (await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${m}`)).json()) as Record<string, { usdPrice?: number }>;
    return r[m]?.usdPrice ?? null;
  };
  console.log(tx.signature.slice(0, 8), `${legs.inAmount} ${legs.inMint.slice(0, 4)} -> ${legs.outAmount} ${legs.outMint.slice(0, 4)}`, "verify:", verdict ?? "OK", "size cents (today's prices):", await usdSizeCents(legs, jup));
}
