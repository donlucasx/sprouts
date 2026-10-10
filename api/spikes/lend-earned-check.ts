// Read-only (10-09, his "check"): why a lending row's value can sit above its put in while "earned" reads ~0. Lists one user's
// lending legs (dollars in, receipt out, rate at planting) and the venue's newest rate. Nothing is written; no secret is printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/lend-earned-check.ts <wallet prefix>
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";

const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: w } = await db.from("wallets").select("pubkey, user_pubkey").like("pubkey", `${process.argv[2]}%`);
if (!w?.length) throw new Error("no wallet");
const user = w[0].user_pubkey;
const { data: pl } = await db.from("plantings").select("id, ts, status").eq("user_pubkey", user).eq("status", "confirmed");
const ids = (pl ?? []).map((p) => p.id);
const { data: legs } = await db.from("planting_legs").select("planting_id, asset, venue, usdc_in_cents, amount_out_raw, rate_at_planting").in("planting_id", ids).in("asset", ["USDC_LEND", "SOL_LEND"]);
const ts = new Map((pl ?? []).map((p) => [p.id, String(p.ts).slice(0, 16)]));
for (const l of (legs ?? []).sort((a, b) => (ts.get(a.planting_id)! < ts.get(b.planting_id)! ? -1 : 1)))
  console.log(`${ts.get(l.planting_id)} ${l.asset} ${l.venue} in ${l.usdc_in_cents}c receipt ${l.amount_out_raw} rate@plant ${l.rate_at_planting}`);
for (const [asset, venue] of [["USDC_LEND", "jupiter_lend"], ["SOL_LEND", "jupiter_lend"]]) {
  const { data: d } = await db.from("venue_days").select("day, exchange_rate").eq("asset", asset).eq("venue", venue).order("day", { ascending: false }).limit(3);
  console.log(asset, venue, "recent rates", JSON.stringify(d));
}
const { data: rows } = await db.from("plantings").select("ts, usdc_pulled_cents, network_fee_cents").eq("user_pubkey", user).eq("status", "confirmed").order("ts");
for (const r of rows ?? []) console.log("planting", String(r.ts).slice(0, 16), "pulled", r.usdc_pulled_cents, "network_fee", r.network_fee_cents);
// every planting: its pull, the recorded network fee, and the sum of its legs' usdc_in_cents and fee_cents (all coins)
const { data: all } = await db.from("plantings").select("id, ts, usdc_pulled_cents, network_fee_cents").eq("user_pubkey", user).eq("status", "confirmed").order("ts");
const { data: allLegs } = await db.from("planting_legs").select("planting_id, asset, usdc_in_cents, fee_cents").in("planting_id", (all ?? []).map((p) => p.id));
for (const p of all ?? []) {
  const ls = (allLegs ?? []).filter((l) => l.planting_id === p.id);
  console.log("sum", String(p.ts).slice(0, 16), "pulled", p.usdc_pulled_cents, "netfee", p.network_fee_cents, "legs_in", ls.reduce((s, l) => s + Number(l.usdc_in_cents), 0), "legs_fee", ls.reduce((s, l) => s + Number(l.fee_cents ?? 0), 0), ls.map((l) => l.asset).join("+"));
}
