// Revokes one of the throwaway wallet's delegations to the puller (rent returns to the throwaway; no money moves).
// Use: the throwaway holds two live delegations (the 09-25 one from the spike and the 09-28 one from the link routes);
// the puller must hold one per wallet. Run from api/: pnpm tsx --env-file=.env.local spikes/revoke-delegation.ts <delegation pda> [--send]
import { address, createKeyPairSignerFromPrivateKeyBytes, pipe, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction, signTransaction,
  getBase64EncodedWireTransaction, getSignatureFromTransaction } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rpc } from "../src/lib/rpc";
import { buildRevokeDelegationIx, readDelegation } from "../src/lib/subscriptions";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--send");
const pda = address(args[0] ?? "");
const saved = JSON.parse(readFileSync(path.join(import.meta.dirname, "keys", "throwaway.json"), "utf8")) as { secret: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));

const before = await readDelegation(pda);
if (!before.exists) { console.log(`delegation ${pda}: not on chain (already revoked?)`); process.exit(0); }
console.log(`delegation ${pda}: ${Number(before.amountPerPeriodRaw) / 1e6} USDC per period; revoking from ${wallet.address}`);

const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
const message = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayer(wallet.address, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
  (m) => appendTransactionMessageInstructions([buildRevokeDelegationIx({ delegator: wallet.address, delegationPda: pda })], m));
const tx = await signTransaction([wallet.keyPair], compileTransaction(message));
const wire = getBase64EncodedWireTransaction(tx);
const sim = await rpc().simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
if (sim.value.err) {
  console.log(`simulation FAILED: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  for (const l of (sim.value.logs ?? []).slice(-6)) console.log(`   ${l}`);
  process.exit(1);
}
console.log(`simulation OK, ${sim.value.unitsConsumed} compute units${send ? "; sending" : "; dry run, add --send to revoke for real"}`);
if (!send) process.exit(0);
const sig = await rpc().sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1_500));
  const st = (await rpc().getSignatureStatuses([sig]).send()).value[0];
  if (st?.err) { console.log(`revoke FAILED on chain: ${JSON.stringify(st.err)}`); process.exit(1); }
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
}
console.log(`REVOKED ${getSignatureFromTransaction(tx)}`);
console.log(`delegation on chain now: exists=${(await readDelegation(pda)).exists}`);
