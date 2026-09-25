// Spike 3a: a throwaway trading wallet approves the puller (init subscription authority + recurring delegation, $5/day).
// First run: generates the wallet into spikes/keys/throwaway.json (git-ignored) and prints its address; fund it with $1 USDC
// and 0.01 SOL, then run again: it simulates, sends, and prints the delegation state, the nonce and the delegation address.
// Run from api/: pnpm tsx --env-file=.env.local spikes/delegate-throwaway.ts
import { createKeyPairSignerFromPrivateKeyBytes, pipe, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction, signTransaction,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, sendAndConfirmTransactionFactory, createSolanaRpcSubscriptions,
  assertIsTransactionWithBlockhashLifetime, assertIsTransactionWithinSizeLimit } from "@solana/kit";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { rpc } from "../src/lib/rpc";
import { pullerSigner } from "../src/lib/puller";
import { config } from "../src/lib/config";
import { buildApproveOnceIxs, delegationPda, readDelegation, usdcAta } from "../src/lib/subscriptions";

const keysDir = path.join(import.meta.dirname, "keys");
const keyFile = path.join(keysDir, "throwaway.json");
mkdirSync(keysDir, { recursive: true });

if (!existsSync(keyFile)) {
  const secret = randomBytes(32);
  const nonce = randomBytes(8).readBigUInt64LE();
  writeFileSync(keyFile, JSON.stringify({ secret: secret.toString("base64url"), nonce: nonce.toString() }), { mode: 0o600 });
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(secret));
  console.log(`throwaway wallet ${signer.address}`);
  console.log("Fund it with $1 USDC and 0.01 SOL, then run this script again.");
  process.exit(0);
}

const saved = JSON.parse(readFileSync(keyFile, "utf8")) as { secret: string; nonce: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));
const nonce = BigInt(saved.nonce);
const puller = await pullerSigner();
const pda = await delegationPda({ delegator: wallet.address, delegatee: puller.address, nonce });
console.log(`throwaway ${wallet.address}, puller ${puller.address}, nonce ${nonce}, delegation ${pda}`);

const before = await readDelegation(pda);
if (before.exists) {
  console.log(`delegation already exists: ${before.amountPerPeriodRaw} raw per period, pulled ${before.pulledInPeriodRaw}`);
  process.exit(0);
}
const usdc = await rpc().getTokenAccountBalance(await usdcAta(wallet.address)).send().catch(() => null);
console.log(`throwaway USDC balance: ${usdc?.value.uiAmountString ?? "no account yet (fund it first)"}`);

const ixs = await buildApproveOnceIxs({ delegator: wallet.address, delegatee: puller.address, capRaw: 5_000_000n, nonce });
const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
// The builder marks the delegator with a placeholder signer (in production the wallet app signs the bytes). Signing the
// compiled transaction with the raw keypair mirrors that path; a KeyPairSigner as fee payer would be a second signer for the same address.
const message = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayer(wallet.address, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m), (m) => appendTransactionMessageInstructions(ixs, m));
const tx = await signTransaction([wallet.keyPair], compileTransaction(message));
assertIsTransactionWithBlockhashLifetime(tx);
assertIsTransactionWithinSizeLimit(tx);

const sim = await rpc().simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
if (sim.value.err) {
  console.log(`simulation FAILED: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  for (const l of (sim.value.logs ?? []).slice(-6)) console.log(`   ${l}`);
  process.exit(1);
}
console.log(`simulation OK, ${sim.value.unitsConsumed} compute units; sending`);
const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
await send(tx, { commitment: "confirmed" });
console.log(`sent ${getSignatureFromTransaction(tx)}`);
const after = await readDelegation(pda);
console.log(`delegation exists=${after.exists} amountPerPeriod=${after.amountPerPeriodRaw} periodLength=${after.periodLengthS}s`);
console.log(`THROWAWAY_ADDRESS=${wallet.address}`);
console.log(`THROWAWAY_DELEGATION_PDA=${pda}`);
