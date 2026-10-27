// Read-only mainnet SIMULATION (sigVerify off, nothing sent): the re-link link/[code] now builds for a wallet whose USDC approval
// was removed (revoke the old delegation, Approve, create with the live init id), then a pull on the NEW delegation.
// Run from api/: pnpm tsx --env-file=.env.local spikes/relink-reapprove-sim.ts <wallet> <oldDelegationPda>
import { address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, type Instruction } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { buildApproveOnceIxs, buildRevokeDelegationIx, buildTransferRecurringIx, delegationPda, readSubscriptionAuthority, readUsdcApproved } from "../src/lib/subscriptions";
import { leashPda } from "../src/lib/leash";
import { USDC_MINT } from "../src/lib/constants";
import { rpc } from "../src/lib/rpc";

const [w, old] = process.argv.slice(2).map((x) => address(x));
const auth = await readSubscriptionAuthority(w);
const approved = await readUsdcApproved(w);
console.log("authority exists", auth.exists, "approved", approved);
const leash = await leashPda(w, w);
const nonce = 123456789n;
const pda = await delegationPda({ delegator: w, delegatee: leash, nonce });
const sim = async (name: string, reapprove: boolean) => {
  const ixs: Instruction[] = [buildRevokeDelegationIx({ delegator: w, delegationPda: old }), ...(await buildApproveOnceIxs({ delegator: w, delegatee: leash, capRaw: 5_000_000n, nonce, existingInitId: auth.exists ? auth.initId : undefined, reapprove }))];
  ixs.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: createNoopSigner(w), owner: leash, mint: USDC_MINT }));
  ixs.push(await buildTransferRecurringIx({ delegator: w, delegatee: createNoopSigner(leash), delegationPda: pda, amountRaw: 10_000n }));
  const { value: bh } = await rpc().getLatestBlockhash().send();
  const tx = getBase64EncodedWireTransaction(compileTransaction(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(createNoopSigner(w), m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions(ixs, m))));
  const s = await rpc().simulateTransaction(tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  console.log(name, "->", s.value.err ? JSON.stringify(s.value.err, (_k, v) => (typeof v === "bigint" ? String(v) : v)) : "OK");
};
await sim("re-link as before (no approve)", false);
await sim("re-link with reapprove", true);
