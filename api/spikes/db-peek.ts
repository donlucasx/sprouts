// Read-only look at one trading wallet's state: its row, its user's rules, unplanted swaps, recent events, plantings,
// and whether the Helius webhook lists it. Nothing is written; no secret is printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/db-peek.ts <wallet>
import { createClient } from "@supabase/supabase-js";
import { getRepo } from "../src/db/repo";
import { config } from "../src/lib/config";

const wallet = process.argv[2] ?? "";
const repo = await getRepo();
const row = await repo.getWallet(wallet);
console.log(row ? `wallet: user ${row.userPubkey.slice(0, 6)}..., status ${row.status}, cap ${row.dailyCapCents}c, webhookAdded ${row.webhookAdded}, delegation ${row.delegationPda}, ledger SKR ${row.ledgerSkrCents}c stORE ${row.ledgerStoreCents}c` : "wallet row: none");
if (row) {
  const rules = await repo.getRules(row.userPubkey);
  console.log(`rules: ${JSON.stringify(rules, (_k, v) => (v instanceof Date ? v.toISOString() : v))}`);
  const swaps = await repo.unplantedSwaps(wallet);
  console.log(`unplanted swaps: ${swaps.length}`);
  for (const s of swaps) console.log(`  ${s.signature.slice(0, 12)}... ${s.ts.toISOString()} size ${s.usdSizeCents}c roundup ${s.roundupCents}c kind ${(s as { kind?: string }).kind ?? "?"}`);
}
const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: events } = await db.from("events").select("ts, kind, detail").eq("wallet_pubkey", wallet).order("ts", { ascending: false }).limit(6);
console.log(`events (${events?.length ?? 0}):`);
for (const e of events ?? []) console.log(`  ${String(e.ts).slice(0, 19)} ${e.kind} ${JSON.stringify(e.detail)}`);
const { data: plantings } = await db.from("plantings").select("id, ts, status, signature, usdc_pulled_cents, network_fee_cents").eq("wallet_pubkey", wallet).order("ts", { ascending: false }).limit(5);
console.log(`plantings (${plantings?.length ?? 0}):`);
for (const p of plantings ?? []) {
  console.log(`  ${String(p.ts).slice(0, 19)} ${p.status} pulled ${p.usdc_pulled_cents}c (network fee ${p.network_fee_cents}c) ${p.signature ? String(p.signature) : "no signature"}`);
  const { data: legs } = await db.from("planting_legs").select("asset, usdc_in_cents, amount_out_raw").eq("planting_id", p.id);
  for (const l of legs ?? []) console.log(`    leg ${l.asset}: ${l.usdc_in_cents}c -> ${l.amount_out_raw} raw`);
}
const res = await fetch(`https://api.helius.xyz/v0/webhooks/${config().heliusWebhookId}?api-key=${config().heliusApiKey}`);
if (res.ok) {
  const hook = (await res.json()) as { accountAddresses: string[]; webhookURL: string; transactionTypes: string[] };
  console.log(`webhook: ${hook.accountAddresses.length} addresses, lists this wallet: ${hook.accountAddresses.includes(wallet)}, url ${hook.webhookURL}, types ${hook.transactionTypes.join(",")}`);
} else {
  console.log(`webhook read failed: ${res.status}`);
}
