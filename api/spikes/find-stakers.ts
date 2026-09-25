// Prints recent real (payer, user) pairs from stake transactions on the SKR staking program, for the simulations.
// Run from api/: pnpm tsx --env-file=.env.local spikes/find-stakers.ts
import { address, getBase58Encoder, type Address } from "@solana/kit";
import { rpc } from "../src/lib/rpc";
import { SKR_STAKING_PROGRAM } from "../src/lib/constants";
import { getStakeInstructionDataEncoder } from "../src/generated/staking";

const disc = Buffer.from(getStakeInstructionDataEncoder().encode({ amount: 0n }).slice(0, 8)).toString("hex");
const b58 = getBase58Encoder();
const sigs = await rpc().getSignaturesForAddress(SKR_STAKING_PROGRAM, { limit: 150 }).send();
console.log(`${sigs.length} recent signatures`);
const pairs: { payer: Address; user: Address; signature: string }[] = [];
let seen = 0;
for (const s of sigs) {
  if (s.err || pairs.length >= 3) continue;
  const tx = await rpc().getTransaction(s.signature, { maxSupportedTransactionVersion: 0, encoding: "json" }).send();
  if (!tx) continue;
  seen++;
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  for (const ix of tx.transaction.message.instructions) {
    if (keys[ix.programIdIndex] !== SKR_STAKING_PROGRAM) continue;
    const data = Buffer.from(b58.encode(ix.data)).toString("hex");
    if (!data.startsWith(disc) || ix.accounts.length < 5) continue;
    const payer = address(keys[ix.accounts[3]]), user = address(keys[ix.accounts[4]]);
    if (!pairs.some((p) => p.user === user)) pairs.push({ payer, user, signature: s.signature });
  }
}
console.log(`${seen} transactions read`);
for (const p of pairs) console.log(`payer=${p.payer} user=${p.user} sig=${p.signature}`);
if (pairs.length < 2) console.log("fewer than two stake transactions found; raise the limit");
