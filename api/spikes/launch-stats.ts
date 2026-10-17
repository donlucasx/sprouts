// Read-only launch counts: users, wallets, sessions, swaps, plantings, with newest rows. No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/launch-stats.ts [sinceISO]
import { createClient } from "@supabase/supabase-js";
import { config } from "../src/lib/config";

const since = process.argv[2] ?? "2026-10-14T20:50:00Z";
const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const short = (s: unknown) => (typeof s === "string" ? `${s.slice(0, 4)}...${s.slice(-4)}` : String(s));
for (const t of ["users", "wallets", "sessions", "swaps", "plantings"]) {
  const tsCol = t === "swaps" || t === "plantings" ? "ts" : "created_at";
  const all = await db.from(t).select("*", { count: "exact", head: true });
  const fresh = await db.from(t).select("*", { count: "exact", head: true }).gte(tsCol, since);
  console.log(`${t}: total ${all.count ?? all.error?.message}, since launch ${fresh.count ?? fresh.error?.message}`);
}
const { data: users } = await db.from("users").select("*").order("created_at", { ascending: true });
console.log("users (all, oldest first):");
for (const u of users ?? []) console.log(`  ${String(u.created_at).slice(0, 19)} ${short(u.seed_vault_pubkey)} ${u.skr_name ?? "-"}`);
const { data: sess } = await db.from("sessions").select("*").gte("created_at", since).order("created_at", { ascending: true });
console.log(`sessions since launch (${sess?.length ?? 0}):`);
for (const s of sess ?? []) console.log(`  ${String(s.created_at).slice(0, 19)} user ${short(s.user_pubkey)}`);
