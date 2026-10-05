// SKR posting end to end on a LOCAL validator (contracts 10 item 15): the real buildPriceUpdate, a live Hermes SKR update, the
// mainnet Wormhole + Pyth receiver programs and accounts cloned into solana-test-validator. Proves what a mainnet simulation
// cannot (each pre-tx needs the previous one landed): the VAA verifies FULLY against guardian set 1, post_update writes a
// receiver-owned 134-byte PriceUpdateV2 with byte 40 = 1 and the pinned SKR feed, and the VAA close + the reclaim return the rent.
// Sends only to the local validator; refuses any other RPC. A throwaway puller (airdropped), never PULLER_SECRET_KEY.
//
//   solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
//     --clone-upgradeable-program HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ --clone-upgradeable-program rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ \
//     --clone DaWUKXCyXsnzcvLUyeJRWou8KTn7XtadgTsdhJ6RHS7b --clone 8hQfT7SVhkCrzUSgBq6u2wYEt1sH3xmofZ5ss3YaydZW --clone 8d9szTd157GKCLcxBqiLUgB7mek3v65rbsy2ErRyjwQ5
//   (receiver config, treasury 0, Wormhole guardian set 1), then, with PYTH_API_KEY from the env file and the RPC forced local:
//   HELIUS_RPC_URL=http://127.0.0.1:8899 pnpm tsx --env-file=.env.local spikes/skr-post-localnet.ts
import { appendTransactionMessageInstructions, createTransactionMessage, generateKeyPairSigner, getBase64EncodedWireTransaction, getSignatureFromTransaction, lamports, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, type Signature } from "@solana/kit";
import { buildPriceUpdate, readPostedPrice, type SignedTx } from "../src/lib/pyth";
import { postedPriceRefusal } from "../src/lib/leash";
import { PYTH_FEED } from "../src/lib/venues/addresses";
import { PYTH_RECEIVER } from "../src/lib/constants";
import { rpc } from "../src/lib/rpc";

if (!/^http:\/\/(127\.0\.0\.1|localhost):8899\/?$/.test(process.env.HELIUS_RPC_URL ?? "")) throw new Error("refusing: HELIUS_RPC_URL must be the local validator (http://127.0.0.1:8899)");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function land(tx: SignedTx, label: string): Promise<void> {
  const sig = getSignatureFromTransaction(tx);
  await rpc().sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" }).send();
  for (let i = 0; i < 60; i++) {
    const s = (await rpc().getSignatureStatuses([sig as Signature]).send()).value[0];
    if (s?.err) throw new Error(`${label} failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
      const t = await rpc().getTransaction(sig as Signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed", encoding: "json" }).send();
      console.log(`${label}: landed, ${t?.meta?.computeUnitsConsumed} CU`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`${label}: not confirmed in 30 s`);
}

const puller = await generateKeyPairSigner();
await rpc().requestAirdrop(puller.address, lamports(2_000_000_000n)).send();
for (let i = 0; i < 40 && (await rpc().getBalance(puller.address).send()).value === 0n; i++) await sleep(500);
const before = (await rpc().getBalance(puller.address, { commitment: "confirmed" }).send()).value;

const u = await buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR });
console.log(`Hermes SKR price ${u.price.price}e${u.price.exponent} conf ${u.price.conf}, pre-txs ${u.preTxs.length} (${u.preTxBytes.join(", ")} B), account ${u.account}`);
for (const [i, tx] of u.preTxs.entries()) await land(tx, `pre-tx ${i + 1}/${u.preTxs.length}`);

const info = (await rpc().getAccountInfo(u.account, { encoding: "base64", commitment: "confirmed" }).send()).value;
const bytes = info ? Buffer.from(info.data[0], "base64") : null;
console.log(`posted account: owner ${info?.owner} (receiver ${info?.owner === PYTH_RECEIVER ? "yes" : "NO"}), ${bytes?.length} B, byte 40 = ${bytes?.[40]} (1 = Full)`);
const p = await readPostedPrice(u.account);
console.log(`re-read: feed ${p.feedId === PYTH_FEED.SKR ? "SKR (pinned)" : p.feedId}, price ${p.price}e${p.exponent}, conf ${p.conf}, full ${p.full}, same as Hermes ${p.price === u.price.price && p.publishTime === u.price.publishTime}`);
console.log(`postedPriceRefusal(leg 0): ${postedPriceRefusal(0, p)}`);

const { value: life } = await rpc().getLatestBlockhash().send();
await land(await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(puller, m), (m) => setTransactionMessageLifetimeUsingBlockhash(life, m), (m) => appendTransactionMessageInstructions(u.closeIxs, m))), "reclaim");
console.log(`price account after reclaim: ${(await rpc().getAccountInfo(u.account, { commitment: "confirmed" }).send()).value ? "STILL THERE" : "closed"}`);
const after = (await rpc().getBalance(puller.address, { commitment: "confirmed" }).send()).value;
console.log(`puller net cost ${before - after} lamports (fees, priority fees and the receiver's posting fee; rent returned)`);
