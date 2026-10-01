// Spike 3b: one real ten-cent planting from the throwaway wallet into a Seeker's SKR position: pull, swap, stake in one transaction.
// Simulates first and aborts on any error. The only "send" in Plan 1 besides Spike 3a.
// Run from api/: pnpm tsx --env-file=.env.local spikes/plant-once.ts <seed vault address or name.skr> [SKR|stORE|hSOL|JitoSOL|JupSOL|cbBTC] [usdc amount, default 0.10] [--send]
// The pull must fit the delegation's daily allowance (5 USD per period); the delegation state is printed before building.
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pullerSigner } from "../src/lib/puller";
import { config } from "../src/lib/config";
import { delegationPda, readDelegation } from "../src/lib/subscriptions";
import { buildPlantingTx, simulatePlanting, sendPlanting } from "../src/lib/planting";
import { readPosition } from "../src/lib/staking";
import { isAsset, type Asset } from "../src/domain/coins";
import { getBase64EncodedWireTransaction } from "@solana/kit";

/** A Seed Vault address, or a .skr name resolved through AllDomains to its owner. */
async function seedVaultFrom(arg: string) {
  if (!arg.toLowerCase().endsWith(".skr")) return address(arg);
  const { Connection } = await import("@solana/web3.js");
  const { TldParser } = await import("@onsol/tldparser");
  const owner = await new TldParser(new Connection(config().heliusRpcUrl, "confirmed")).getOwnerFromDomainTld(arg.toLowerCase());
  if (!owner) throw new Error(`${arg}: no owner found`);
  return address(typeof owner === "string" ? owner : owner.toBase58());
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const user = await seedVaultFrom(args[0] ?? "");
if (args[1] !== undefined && !isAsset(args[1])) {
  console.log(`bad asset: ${args[1]}`);
  process.exit(1);
}
const asset: Asset = (args[1] as Asset | undefined) ?? "SKR";
const usdc = Number(args[2] ?? "0.10");
const pullRaw = BigInt(Math.round(usdc * 1_000_000));
const doSend = process.argv.includes("--send");

const saved = JSON.parse(readFileSync(path.join(import.meta.dirname, "keys/throwaway.json"), "utf8")) as { secret: string; nonce: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));
const puller = await pullerSigner();
const pda = await delegationPda({ delegator: wallet.address, delegatee: puller.address, nonce: BigInt(saved.nonce) });

const d = await readDelegation(pda);
const periodEnds = new Date(Number(d.periodStartTs + d.periodLengthS) * 1000);
console.log(`delegation ${pda}: allowance ${Number(d.amountPerPeriodRaw) / 1e6} USDC per period, pulled this period ${Number(d.pulledInPeriodRaw) / 1e6}, period ends ${periodEnds.toISOString()}`);
console.log(`pulling ${usdc} USDC (${pullRaw} raw)`);
const before = await readPosition(user);
console.log(`position before: ${before.stakedRaw} raw SKR staked`);
const built = await buildPlantingTx({ delegator: wallet.address, user, asset, pullRaw, feeBps: 50, delegationPda: pda });
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
await sendPlanting(built);
console.log(`PLANTED ${built.signature}`);
const after = await readPosition(user);
console.log(`position after: ${after.stakedRaw} raw SKR staked (+${after.stakedRaw - before.stakedRaw})`);
