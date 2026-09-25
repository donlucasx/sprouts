// Spike 3b: one real ten-cent planting from the throwaway wallet into a Seeker's SKR position: pull, swap, stake in one transaction.
// Simulates first and aborts on any error. The only "send" in Plan 1 besides Spike 3a.
// Run from api/: pnpm tsx --env-file=.env.local spikes/plant-once.ts <seed vault address> [SKR|stORE] [--send]
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pullerSigner } from "../src/lib/puller";
import { delegationPda } from "../src/lib/subscriptions";
import { buildPlantingTx, simulatePlanting, sendPlanting } from "../src/lib/planting";
import { readPosition } from "../src/lib/staking";
import { getBase64EncodedWireTransaction } from "@solana/kit";

const user = address(process.argv[2] ?? "");
const asset = (process.argv[3] === "stORE" ? "stORE" : "SKR") as "SKR" | "stORE";
const doSend = process.argv.includes("--send");

const saved = JSON.parse(readFileSync(path.join(import.meta.dirname, "keys/throwaway.json"), "utf8")) as { secret: string; nonce: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));
const puller = await pullerSigner();
const pda = await delegationPda({ delegator: wallet.address, delegatee: puller.address, nonce: BigInt(saved.nonce) });

const before = await readPosition(user);
console.log(`position before: ${before.stakedRaw} raw SKR staked`);
const built = await buildPlantingTx({ delegator: wallet.address, user, asset, pullRaw: 100_000n, feeBps: 50, delegationPda: pda });
const bytes = Buffer.from(getBase64EncodedWireTransaction(built.tx), "base64").length;
console.log(`built ${asset} planting: ${bytes} bytes, expected out ${built.expectedOutRaw}, minimum ${built.minOutRaw}, lookup tables ${built.lookupTables.length}`);
const sim = await simulatePlanting(built);
console.log(`simulation ${sim.ok ? "OK" : "FAILED"}: ${sim.units} compute units`);
if (!sim.ok) {
  console.log(JSON.stringify(sim.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  for (const l of sim.logs.slice(-8)) console.log(`   ${l}`);
  process.exit(1);
}
if (!doSend) {
  console.log("dry run; pass --send to plant for real");
  process.exit(0);
}
const signature = await sendPlanting(built);
console.log(`PLANTED ${signature}`);
const after = await readPosition(user);
console.log(`position after: ${after.stakedRaw} raw SKR staked (+${after.stakedRaw - before.stakedRaw})`);
