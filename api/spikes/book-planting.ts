// Books a planting a spike sent without a ledger row (the ten-cent and the demo plantings, plant-once.ts) as a confirmed planting:
// its real signature, its time from the chain, one SKR leg (change = pulled minus the 3c network fee, as the cron books it), the
// wallet's ledger bump. The pot, the garden and the reconciliation then see it. Dry run by default; a booked signature is refused.
// Run from api/: pnpm tsx --env-file=.env.local spikes/book-planting.ts <seed vault pubkey> <trading wallet> <signature> <pulledCents> <amountOutRaw> <expectedOutRaw> [--write]
import { signature as asSignature } from "@solana/kit";
import { createClient } from "@supabase/supabase-js";
import { getRepo } from "../src/db/repo";
import { config } from "../src/lib/config";
import { rpc } from "../src/lib/rpc";
import { NETWORK_FEE_CENTS } from "../src/lib/plant-run";

const FEE_BPS = 50n;
const [userPubkey, walletPubkey, signature, pulledArg, outArg, expectedArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const write = process.argv.includes("--write");
if (!expectedArg) { console.log("usage: book-planting.ts <seed vault pubkey> <trading wallet> <signature> <pulledCents> <amountOutRaw> <expectedOutRaw> [--write]"); process.exit(1); }
const pulledCents = Number(pulledArg);
const amountOutRaw = BigInt(outArg);
const feeAmountRaw = (BigInt(expectedArg) * FEE_BPS) / 10_000n;
const usdcInCents = pulledCents - NETWORK_FEE_CENTS;

const tx = await rpc().getTransaction(asSignature(signature), { maxSupportedTransactionVersion: 0, encoding: "json" }).send();
if (!tx) { console.log("not found on chain; stop"); process.exit(1); }
if (tx.meta?.err) { console.log(`failed on chain: ${JSON.stringify(tx.meta.err)}; stop`); process.exit(1); }
const ts = new Date(Number(tx.blockTime) * 1000);

const db = createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
const { data: existing } = await db.from("plantings").select("id, status").eq("signature", signature).maybeSingle();
if (existing) { console.log(`already booked: ${String(existing.id).slice(0, 8)}... (${existing.status}); stop`); process.exit(1); }
const repo = await getRepo();
if (!(await repo.getUser(userPubkey))) { console.log("no user row; stop"); process.exit(1); }
if (!(await repo.getWallet(walletPubkey))) { console.log("no wallet row; stop"); process.exit(1); }

console.log(`planting ${signature.slice(0, 8)}... landed ${ts.toISOString()} (slot ${tx.slot})`);
console.log(`  row: pulled ${pulledCents}c = change ${usdcInCents}c + network fee ${NETWORK_FEE_CENTS}c; leg SKR ${amountOutRaw} raw out, fee ${feeAmountRaw} raw (0.5% of ${expectedArg} expected); ledger SKR +${usdcInCents}c on ${walletPubkey.slice(0, 6)}...`);
if (!write) { console.log("dry run; add --write to book it"); process.exit(0); }

const row = await repo.insertPlanting(
  { userPubkey, walletPubkey, signature, usdcPulledCents: pulledCents, networkFeeCents: NETWORK_FEE_CENTS, status: "confirmed", aiLine: null },
  [{ asset: "SKR", usdcInCents, amountOutRaw, staked: true, feeAmountRaw, feeCents: 0, rateAtPlanting: null }],
);
const { error } = await db.from("plantings").update({ ts: ts.toISOString() }).eq("id", row.id);
if (error) { console.log(`booked ${row.id} but the time update failed: ${error.message}`); process.exit(1); }
await repo.bumpLedger(walletPubkey, "SKR", usdcInCents);
console.log(`booked ${row.id} at ${ts.toISOString()}`);
