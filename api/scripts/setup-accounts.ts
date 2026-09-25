// Creates the token accounts the pipeline needs, idempotently, paid by the puller:
// the puller's USDC and SKR accounts (the pull lands in USDC, the swap lands in SKR) and
// the fee wallet's SKR and stORE accounts (Jupiter's platform fee lands there).
// Run once after funding the puller: pnpm tsx --env-file=.env.local scripts/setup-accounts.ts
import { address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners, getSignatureFromTransaction, sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions, assertIsTransactionWithBlockhashLifetime, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { rpc } from "../src/lib/rpc";
import { pullerSigner } from "../src/lib/puller";
import { config } from "../src/lib/config";
import { USDC_MINT, SKR_MINT, STORE_MINT } from "../src/lib/constants";

const puller = await pullerSigner();
const feeWallet = address(config().feeWallet);
const wanted = [
  { owner: puller.address, mint: USDC_MINT, label: "puller USDC" },
  { owner: puller.address, mint: SKR_MINT, label: "puller SKR" },
  { owner: feeWallet, mint: SKR_MINT, label: "fee wallet SKR" },
  { owner: feeWallet, mint: STORE_MINT, label: "fee wallet stORE" },
];
const ixs: Instruction[] = [];
for (const w of wanted) {
  const [ata] = await findAssociatedTokenPda({ owner: w.owner, mint: w.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  console.log(`${w.label}: ${ata}`);
  ixs.push(getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata, owner: w.owner, mint: w.mint }));
}
const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(puller, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions(ixs, m));
const tx = await signTransactionMessageWithSigners(msg);
assertIsTransactionWithBlockhashLifetime(tx);
const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
await send(tx, { commitment: "confirmed" });
console.log(`created or confirmed, signature ${getSignatureFromTransaction(tx)}`);
