// The Sprouts lookup table (contracts 3.2): authority and payer = the puller. A mainnet write the OWNER runs (about 0.002 SOL + 0.00022 SOL per entry).
// Create:  cd api && pnpm tsx --env-file=.env.local scripts/create-alt.ts --create      -> prints SPROUTS_ALT=<address>
// Extend:  cd api && pnpm tsx --env-file=.env.local scripts/create-alt.ts --extend <alt> -> adds only the missing entries
import { address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, fetchAddressesForLookupTables, type Instruction } from "@solana/kit";
import { getCreateLookupTableInstructionAsync, getExtendLookupTableInstruction } from "@solana-program/address-lookup-table";
import { rpc } from "../src/lib/rpc";
import { pullerSigner } from "../src/lib/puller";
import { sproutsAltAddresses } from "../src/lib/alt";
import { sendPriceTxs } from "../src/lib/pyth";

const puller = await pullerSigner();
const send = async (ixs: Instruction[]) => {
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  await sendPriceTxs([await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(puller, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions(ixs, m)))]);
};
const want = await sproutsAltAddresses(puller.address);
let alt: string;
if (process.argv[2] === "--create") {
  const recentSlot = await rpc().getSlot({ commitment: "finalized" }).send();
  const create = await getCreateLookupTableInstructionAsync({ authority: puller, payer: puller, recentSlot });
  alt = create.accounts[0].address;
  await send([create]);
  console.log(`SPROUTS_ALT=${alt}`);
} else if (process.argv[2] === "--extend" && process.argv[3]) {
  alt = address(process.argv[3]);
} else throw new Error("usage: --create | --extend <alt>");
// Read at "confirmed": a table created a moment ago (sendPriceTxs waits for confirmed) is not yet visible at the default commitment.
const have = new Set(((await fetchAddressesForLookupTables([address(alt)], rpc(), { commitment: "confirmed" }))[address(alt)] ?? []) as string[]);
const missing = want.filter((a) => !have.has(a));
for (let i = 0; i < missing.length; i += 20) {
  await send([getExtendLookupTableInstruction({ address: address(alt), authority: puller, payer: puller, addresses: missing.slice(i, i + 20) })]);
  console.log(`extended ${Math.min(i + 20, missing.length)}/${missing.length}`);
}
console.log(`${alt}: ${want.length} wanted, ${missing.length} added`);
