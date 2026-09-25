// Supabase smoke: a throwaway user row, its default rules, then both rows deleted. Proves the URL, the key and the schema.
// Run from api/: pnpm tsx --env-file=.env.local spikes/db-smoke.ts
import { createClient } from "@supabase/supabase-js";
import { getRepo } from "../src/db/repo";
import { config } from "../src/lib/config";

const pubkey = `smoke-${Date.now()}`;
const repo = await getRepo();
const user = await repo.upsertUser({ seedVaultPubkey: pubkey, sgtMint: `smoke-mint-${Date.now()}`, skrName: null });
console.log(`user row: ${user.seedVaultPubkey}`);
const rules = await repo.getRules(pubkey);
console.log(`default rules: roundup to ${rules.roundupToCents} cents, pct ${rules.pctBps} bps over ${rules.pctThresholdCents} cents, plant at ${rules.plantThresholdCents} cents or ${rules.plantMaxDays} days`);
const db = createClient(config().supabaseUrl, config().supabaseServiceKey);
for (const [table, col] of [["rules", "user_pubkey"], ["users", "seed_vault_pubkey"]] as const) {
  const { error } = await db.from(table).delete().eq(col, pubkey);
  if (error) throw new Error(`${table} cleanup: ${error.message}`);
}
console.log("cleaned up; smoke OK");
