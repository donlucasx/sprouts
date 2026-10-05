// Task 12 measurement: the leashed size of a planting COMPUTED from the code on the SAME Jupiter route as its unleashed build, so the
// leash's own cost is isolated from route variance. Builds the real unleashed planting (buildPlantingTx), decompiles it, swaps
// today's transferRecurring for the leash pull + settle (buildPullIx / buildSettleIx, the leg's real accounts), recompresses with the
// same tables and measures. Nothing is simulated or sent (the leash program is not deployed yet). SKR's price account is a fresh
// address outside every table, as a posted price account would be.
// Run: cd api && pnpm tsx --env-file=.env.local spikes/leash-size-delta.ts <seed vault> <linked wallet> <delegation pda> [--assume-alt] <legs...>
import { address, appendTransactionMessageInstructions, compileTransaction, compressTransactionMessageUsingAddressLookupTables, createTransactionMessage,
  decompileTransactionMessage, fetchAddressesForLookupTables, generateKeyPairSigner, getCompiledTransactionMessageDecoder, getTransactionEncoder, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, type Address, type Blockhash, type Instruction } from "@solana/kit";
import { buildPlantingTx, MEASURE_ALT } from "../src/lib/planting";
import { buildPullIx, buildSettleIx, leashLegOf, legAccounts, LEG_SPEC } from "../src/lib/leash";
import { PYTH_ACCOUNT } from "../src/lib/venues/addresses";
import { SUBSCRIPTIONS_PROGRAM } from "../src/lib/constants";
import { sproutsAltAddresses } from "../src/lib/alt";
import { pullerSigner } from "../src/lib/puller";
import { rpc } from "../src/lib/rpc";
import { accountLocks, parseLeg, MAX_TX_BYTES } from "../scripts/simulate-legs-lib";

const argv = process.argv.slice(2);
const assumeAlt = argv.includes("--assume-alt");
const [user, wallet, delegation, ...names] = argv.filter((x) => !x.startsWith("--"));
const puller = await pullerSigner();
const measureAlt = assumeAlt ? await sproutsAltAddresses(puller.address) : undefined;
for (const name of names) {
  const leg = parseLeg(name);
  try {
    const b = await buildPlantingTx({ delegator: address(wallet), user: address(user), asset: leg.asset, venue: leg.venue, pullRaw: 1_000_000n, delegationPda: address(delegation), leashed: false, carryIn: {}, ...(measureAlt ? { measureAlt } : {}) });
    const onChain = b.lookupTables.filter((t) => t !== MEASURE_ALT);
    const tables = { ...(await fetchAddressesForLookupTables(onChain, rpc())), ...(measureAlt ? { [MEASURE_ALT]: measureAlt } : {}) };
    const compiled = getCompiledTransactionMessageDecoder().decode(b.tx.messageBytes);
    const msg = decompileTransactionMessage(compiled, { addressesByLookupTableAddress: tables });
    const ixs = [...msg.instructions] as Instruction[];
    const i = ixs.findIndex((x) => x.programAddress === SUBSCRIPTIONS_PROGRAM);
    if (i < 0) throw new Error("no transferRecurring in the unleashed build");
    const l = leashLegOf(leg.asset, leg.venue);
    const feed = LEG_SPEC[l].feed;
    const priceAccount: Address | undefined = feed === null ? undefined : feed === "SKR" ? (await generateKeyPairSigner()).address : PYTH_ACCOUNT[feed];
    const la = await legAccounts({ leg: l, user: address(user), ...(priceAccount ? { priceAccount } : {}) });
    const common = { user: address(user), leg: l, minOutRaw: 1n, amountRaw: 1_000_000n, legAccounts: la };
    const pull = await buildPullIx({ ...common, puller, delegator: address(wallet), delegationPda: address(delegation) });
    const settle = await buildSettleIx({ ...common, preRaw: 0n });
    const leashed = [...ixs.slice(0, i), pull, ...ixs.slice(i + 1), settle];
    const m = pipe(createTransactionMessage({ version: 0 }), (x) => setTransactionMessageFeePayer(puller.address, x),
      (x) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 0n }, x),
      (x) => appendTransactionMessageInstructions(leashed, x), (x) => compressTransactionMessageUsingAddressLookupTables(x, tables));
    const tx = compileTransaction(m);
    const size = getTransactionEncoder().encode(tx).length;
    const locks = accountLocks(new Uint8Array(tx.messageBytes));
    console.log(`DELTA ${name}${assumeAlt ? " assume-alt" : ""} unleashed=${b.sizeBytes} B/${accountLocks(new Uint8Array(b.tx.messageBytes))} locks -> leashed(computed)=${size} B/${locks} locks (+${size - b.sizeBytes} B, ${MAX_TX_BYTES - size} B headroom)`);
  } catch (e) {
    console.log(`DELTA ${name}${assumeAlt ? " assume-alt" : ""} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await new Promise((r) => setTimeout(r, 3_000));
}
process.exit(0);
