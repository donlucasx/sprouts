// Read-only: a wallet's status and its last events, by address prefix. Run from api/: tsx --env-file=.env.local spikes/wallet-status-peek.ts
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";
const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: w } = await db.from("wallets").select("pubkey,status").like("pubkey", "52vz%");
for (const x of w ?? []) console.log("status", x.status);
const { data: ev } = await db.from("events").select("ts,kind").like("wallet_pubkey", "52vz%").order("ts", { ascending: false }).limit(4);
for (const e of ev ?? []) console.log(String(e.ts).slice(0, 19), e.kind);
