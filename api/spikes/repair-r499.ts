// R499 repair: removes the phantom wallet unstake the 10-06 21:55 reconcile booked for the Seeker's Seed Vault (52vz): the
// own_unstake -55,278,224 shares, the own_stake +55,278,224 the 22:31 run booked to offset it, and withdrawal 0f704060 (closed as
// skipped 10-09: nothing was ever unstaking on chain). The share books balance with or without the pair; the withdrawal row is what
// shows a 63.58 SKR withdrawal that never happened and prunes the SKR tree. Dry run by default; writes only with --send, and only if
// every row matches exactly and the books still balance against the chain after the change.
// Run from api/: pnpm tsx --env-file=.env.local spikes/repair-r499.ts [--send]
import { address } from "@solana/kit";
import { createClient } from "@supabase/supabase-js";
import { readPosition } from "../src/lib/staking";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const send = process.argv.includes("--send");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const WITHDRAWAL = "0f704060-8703-4754-891d-c6ef94913fda";
const SHARES = "55278224";
const fail = (why: string): never => { console.error(`STOP: ${why}; nothing written`); process.exit(1); };
const must = <T>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) fail(r.error.message); return r.data as T; };

const users = must(await db.from("users").select("seed_vault_pubkey,joined_shares").like("seed_vault_pubkey", "52vz%"));
if (users.length !== 1) fail(`expected one 52vz user, found ${users.length}`);
const user = users[0].seed_vault_pubkey as string;

const w = must(await db.from("withdrawals").select("*").eq("id", WITHDRAWAL));
const adj = must(await db.from("stake_adjustments").select("*").eq("user_pubkey", user).in("shares_delta", [`-${SHARES}`, SHARES]));
if (w.length === 0 && adj.length === 0) { console.log("already repaired: no withdrawal row, no adjustment pair"); process.exit(0); }
if (w.length !== 1) fail(`withdrawal ${WITHDRAWAL} not found`);
const row = w[0];
if (row.user_pubkey !== user || row.source !== "wallet" || row.unstake_signature !== null || row.withdraw_signature !== null
  || row.skipped_at === null || String(row.shares_unstaked) !== SHARES) fail(`withdrawal ${WITHDRAWAL} is not the phantom row`);
const kinds = adj.map((x) => `${x.kind}:${x.shares_delta}`).sort();
// An empty pair is a rerun after the pair was deleted and the withdrawal delete failed: finish the withdrawal.
if (adj.length > 0 && kinds.join(",") !== `own_stake:${SHARES},own_unstake:-${SHARES}`) fail(`adjustment pair is not exactly the two phantom rows: ${kinds.join(",")}`);
for (const x of adj) if (!String(x.ts).startsWith("2026-10-06T2")) fail(`adjustment ${x.id} is not from 10-06 evening (${x.ts})`);

// The books after the change, by the reconcile's own formula: joined + minted - Sprouts picks + remaining adjustments = chain shares.
const plantings = must(await db.from("plantings").select("shares_minted").eq("user_pubkey", user).eq("status", "confirmed"));
const picks = must(await db.from("withdrawals").select("shares_unstaked,source,cancel_signature").eq("user_pubkey", user));
const allAdj = must(await db.from("stake_adjustments").select("id,shares_delta").eq("user_pubkey", user));
const minted = plantings.reduce((s, p) => s + BigInt(p.shares_minted ?? 0), 0n);
const burned = picks.filter((p) => p.source === "sprouts" && p.cancel_signature === null).reduce((s, p) => s + BigInt(p.shares_unstaked ?? 0), 0n);
const pairIds = new Set(adj.map((x) => x.id));
const ownAfter = allAdj.filter((x) => !pairIds.has(x.id)).reduce((s, x) => s + BigInt(x.shares_delta), 0n);
const expected = BigInt(users[0].joined_shares ?? 0) + minted - burned + ownAfter;
const chain = (await readPosition(address(user), "finalized")).shares;
console.log(`user ${user.slice(0, 4)}...: chain shares ${chain}, expected after repair ${expected}, delta ${chain - expected}`);
if (chain - expected <= -10_000n || chain - expected >= 10_000n) fail("the books would not balance after the repair");

console.log(`to delete: withdrawal ${WITHDRAWAL} (wallet, skipped, ${row.amount_raw} raw SKR); adjustments ${[...pairIds].join(", ")}`);
if (!send) { console.log("dry run: add --send to write"); process.exit(0); }
// The rows as they stand, kept beside this script before anything is deleted (audit F7). Run away from the 7 AM cron window.
const backup = path.join(path.dirname(fileURLToPath(import.meta.url)), `repair-r499-backup-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify({ withdrawal: row, adjustments: adj }, null, 2));
console.log(`backup of the rows: ${backup}`);
if (pairIds.size > 0) {
  const gone = must(await db.from("stake_adjustments").delete().in("id", [...pairIds]).select("id"));
  if (gone.length !== pairIds.size) fail(`deleted ${gone.length} of ${pairIds.size} adjustments; rerun to finish`);
}
const goneW = must(await db.from("withdrawals").delete().eq("id", WITHDRAWAL).select("id"));
if (goneW.length !== 1) fail(`the withdrawal delete removed ${goneW.length} rows; rerun to finish`);
// The withdraw_skipped event (10-09 14:12 UTC) still names this withdrawal id; events are a log and nothing joins on it.
console.log("done: removed the phantom withdrawal and the adjustment pair; rerun without --send to confirm 'already repaired'");
