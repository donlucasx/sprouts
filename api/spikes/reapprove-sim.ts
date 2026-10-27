// Read-only mainnet SIMULATION (sigVerify off, nothing sent): does a plain Token Approve of the subscription authority bring a
// revoked-at-the-token-level delegation back? Simulates the recurring transfer with and without the approve in front.
// Run from api/: pnpm tsx --env-file=.env.local spikes/reapprove-sim.ts <wallet> <delegationPda>
import { address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction } from "@solana/kit";
import { getApproveInstruction, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { buildTransferRecurringIx, readDelegation, usdcAta } from "../src/lib/subscriptions";
import { USDC_MINT } from "../src/lib/constants";
import { rpc } from "../src/lib/rpc";

const [w, p] = process.argv.slice(2).map((x) => address(x));
const d = await readDelegation(p);
console.log("delegation exists", d.exists, "delegatee", `${d.delegatee?.slice(0, 4)}...`, "authority", `${d.subscriptionAuthority?.slice(0, 4)}...`);
const [auth] = await findSubscriptionAuthorityPda({ user: w, tokenMint: USDC_MINT });
console.log("authority matches", auth === d.subscriptionAuthority);
const owner = createNoopSigner(w);
const delegatee = createNoopSigner(d.delegatee!);
const approve = getApproveInstruction({ source: await usdcAta(w), delegate: auth, owner, amount: 18446744073709551615n });
const recvAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: owner, owner: d.delegatee!, mint: USDC_MINT });
const pull = await buildTransferRecurringIx({ delegator: w, delegatee, delegationPda: p, amountRaw: 10_000n });
const { value: bh } = await rpc().getLatestBlockhash().send();
for (const [name, ixs] of [["without approve", [recvAta, pull]], ["with approve", [approve, recvAta, pull]]] as const) {
  const tx = getBase64EncodedWireTransaction(compileTransaction(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(owner, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions([...ixs], m))));
  const s = await rpc().simulateTransaction(tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  console.log(name, "->", s.value.err ? JSON.stringify(s.value.err, (_k, v) => (typeof v === "bigint" ? String(v) : v)) : "OK", (s.value.logs ?? []).slice(-2).join(" | "));
}
void TOKEN_PROGRAM_ADDRESS;
