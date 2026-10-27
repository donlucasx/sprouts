// Read-only: the newest pull_failed events with their simulation error and logs, plus the wallet's row. No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/pull-failed-peek.ts [walletPrefix]
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";

const prefix = process.argv[2] ?? "BTDG";
const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: ev, error } = await db.from("events").select("*").in("kind", ["pull_failed", "leg_skipped", "paused_no_usdc"]).order("ts", { ascending: false }).limit(12);
if (error) console.log(error.message);
for (const e of ev ?? []) if (String(e.wallet_pubkey ?? "").startsWith(prefix)) console.log(String(e.ts).slice(0, 19), e.kind, JSON.stringify(e.detail, null, 1));
const { data: w } = await db.from("wallets").select("*").like("pubkey", `${prefix}%`);
for (const x of w ?? []) console.log("wallet", JSON.stringify({ ...x, pubkey: `${x.pubkey.slice(0, 4)}...${x.pubkey.slice(-4)}` }));
const { data: p } = await db.from("plantings").select("*").like("wallet_pubkey", `${prefix}%`).order("ts", { ascending: false }).limit(4);
for (const x of p ?? []) console.log("planting", String(x.ts).slice(0, 19), x.status, x.asset ?? "", x.amount_cents ?? x.usdc_cents ?? "");
