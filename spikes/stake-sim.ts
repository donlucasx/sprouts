// Spike 1: three staking simulations on mainnet, no side effects (sigVerify off, blockhash replaced).
// Run from api/: pnpm tsx --env-file=.env.local ../spikes/stake-sim.ts [payerAddress]
// Without an argument the puller is the payer (it must hold at least 1 SKR); with an address, that holder is the payer
// (any address works in simulation, which is how research 13 ran the probes before the puller existed).
import { address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, generateKeyPairSigner, createNoopSigner,
  type Instruction, type TransactionSigner } from "@solana/kit";
import { getStakeInstructionAsync } from "../api/src/generated/staking";
import { rpc } from "../api/src/lib/rpc";
import { pullerSigner } from "../api/src/lib/puller";
import { buildStakeIx, userStakePda, skrAta } from "../api/src/lib/staking";
import { STAKE_CONFIG, GUARDIAN_POOL, STAKE_VAULT, SKR_MINT } from "../api/src/lib/constants";

const EXISTING_STAKER = address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m");
const payer: TransactionSigner = process.argv[2] ? createNoopSigner(address(process.argv[2])) : await pullerSigner();
console.log(`payer ${payer.address}`);

async function simulate(label: string, ix: Instruction) {
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions([ix], m));
  const wire = getBase64EncodedWireTransaction(compileTransaction(msg));
  const res = await rpc().simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
  const err = res.value.err ? `FAIL ${JSON.stringify(res.value.err)}` : `OK cu=${res.value.unitsConsumed}`;
  console.log(`${label}: ${err}`);
  for (const l of (res.value.logs ?? []).slice(-3)) console.log(`   ${l}`);
}

await simulate("PROBE1 payer stakes into an existing user's position", await buildStakeIx({ payer, user: EXISTING_STAKER, amountRaw: 1_000_000n }));
await simulate("PROBE2 payer stakes into a fresh user's position", await buildStakeIx({ payer, user: (await generateKeyPairSigner()).address, amountRaw: 1_000_000n }));
// PROBE3: source = the existing staker's own SKR account, the staker not signing: expected custom error 6007 Unauthorized.
await simulate("PROBE3 payer stakes from the user's own account without the user signing", await getStakeInstructionAsync({
  stakeConfig: STAKE_CONFIG, guardianPool: GUARDIAN_POOL, payer, user: EXISTING_STAKER, userStake: await userStakePda(EXISTING_STAKER),
  userTokenAccount: await skrAta(EXISTING_STAKER), stakeVault: STAKE_VAULT, mint: SKR_MINT, amount: 1_000_000n,
}));
