// Spike 1: three staking simulations on mainnet, no side effects (sigVerify off, blockhash replaced).
// Run from api/: pnpm tsx --env-file=.env.local spikes/stake-sim.ts [payerAddress] [existingStakerAddress]
// Without arguments the puller is the payer (it must hold at least 1 SKR). With a first address, that SKR holder is the payer
// (any real address works in simulation, which is how research 13 ran the probes before the puller existed). The second
// address is a real user with a staked position (spikes/find-stakers.ts prints recent ones); it must differ from the payer.
import { address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, generateKeyPairSigner, createNoopSigner,
  type Instruction, type TransactionSigner } from "@solana/kit";
import { getStakeInstructionAsync } from "../src/generated/staking";
import { rpc } from "../src/lib/rpc";
import { pullerSigner } from "../src/lib/puller";
import { buildStakeIx, userStakePda, skrAta } from "../src/lib/staking";
import { STAKE_CONFIG, GUARDIAN_POOL, STAKE_VAULT, SKR_MINT, SKR_STAKING_PROGRAM } from "../src/lib/constants";

if (!process.argv[3]) { console.log("usage: stake-sim.ts <payer or - for the puller> <existing staker>"); process.exit(1); }
const EXISTING_STAKER = address(process.argv[3]);
const payer: TransactionSigner = process.argv[2] && process.argv[2] !== "-" ? createNoopSigner(address(process.argv[2])) : await pullerSigner();
console.log(`payer ${payer.address}, existing staker ${EXISTING_STAKER}`);

async function simulate(label: string, ix: Instruction) {
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions([ix], m));
  const wire = getBase64EncodedWireTransaction(compileTransaction(msg));
  const res = await rpc().simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
  const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  const err = res.value.err ? `FAIL ${json(res.value.err)}` : `OK cu=${res.value.unitsConsumed}`;
  console.log(`${label}: ${err}`);
  for (const l of (res.value.logs ?? []).slice(-3)) console.log(`   ${l}`);
}

await simulate("PROBE1 payer stakes into an existing user's position", await buildStakeIx({ payer, user: EXISTING_STAKER, amountRaw: 1_000_000n }));
await simulate("PROBE2 payer stakes into a fresh user's position", await buildStakeIx({ payer, user: (await generateKeyPairSigner()).address, amountRaw: 1_000_000n }));
// PROBE3: source = the existing staker's own SKR account, the staker not signing: expected custom error 6007 Unauthorized.
await simulate("PROBE3 payer stakes from the user's own account without the user signing", await getStakeInstructionAsync({
  stakeConfig: STAKE_CONFIG, guardianPool: GUARDIAN_POOL, payer, user: EXISTING_STAKER, userStake: await userStakePda(EXISTING_STAKER),
  userTokenAccount: await skrAta(EXISTING_STAKER), stakeVault: STAKE_VAULT, mint: SKR_MINT, program: SKR_STAKING_PROGRAM, amount: 1_000_000n,
}));
