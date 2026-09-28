// Task 15 step 4: one real swap from the throwaway trading wallet, USDC to BONK on Jupiter, so the Helius webhook books a
// `swaps` row with its round-up. Uses Jupiter's /swap endpoint (a whole transaction, as a wallet app would), no platform fee.
// Run from api/: pnpm tsx --env-file=.env.local spikes/swap-once.ts [usdc amount, default 0.80] [--send]
import { createKeyPairSignerFromPrivateKeyBytes, getBase64Encoder, getBase64EncodedWireTransaction, getTransactionDecoder,
  signTransaction, getSignatureFromTransaction } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rpc } from "../src/lib/rpc";
import { config } from "../src/lib/config";
import { USDC_MINT } from "../src/lib/constants";
import { usdcAta } from "../src/lib/subscriptions";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--send");
const usdc = Number(args[0] ?? "0.80");
const amountRaw = BigInt(Math.round(usdc * 1_000_000));

const saved = JSON.parse(readFileSync(path.join(import.meta.dirname, "keys", "throwaway.json"), "utf8")) as { secret: string };
const wallet = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(saved.secret, "base64url")));
const bal = await rpc().getTokenAccountBalance(await usdcAta(wallet.address)).send().catch(() => null);
console.log(`throwaway ${wallet.address}: ${bal?.value.uiAmountString ?? "0"} USDC; swapping ${usdc} USDC to BONK`);

const headers = { "x-api-key": config().jupiterApiKey, "content-type": "application/json" };
const q = new URLSearchParams({ inputMint: USDC_MINT, outputMint: BONK, amount: amountRaw.toString(), slippageBps: "100", restrictIntermediateTokens: "true" });
const quoteRes = await fetch(`https://api.jup.ag/swap/v1/quote?${q}`, { headers });
if (!quoteRes.ok) { console.log(`quote failed: ${quoteRes.status} ${(await quoteRes.text()).slice(0, 200)}`); process.exit(1); }
const quote = (await quoteRes.json()) as { outAmount: string; routePlan: { swapInfo: { label: string } }[] };
console.log(`quote: ${Number(quote.outAmount) / 1e5} BONK via ${quote.routePlan.map((r) => r.swapInfo.label).join(" + ")}`);

const swapRes = await fetch("https://api.jup.ag/swap/v1/swap", {
  method: "POST", headers,
  body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet.address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: true }),
});
if (!swapRes.ok) { console.log(`swap failed: ${swapRes.status} ${(await swapRes.text()).slice(0, 200)}`); process.exit(1); }
const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };

const signed = await signTransaction([wallet.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(swapTransaction)));
const wire = getBase64EncodedWireTransaction(signed);
const sim = await rpc().simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
if (sim.value.err) {
  console.log(`simulation FAILED: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  for (const l of (sim.value.logs ?? []).slice(-6)) console.log(`   ${l}`);
  process.exit(1);
}
console.log(`simulation OK, ${sim.value.unitsConsumed} compute units${send ? "; sending" : "; dry run, add --send to swap for real"}`);
if (!send) process.exit(0);

const sig = await rpc().sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" }).send();
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1_500));
  const st = (await rpc().getSignatureStatuses([sig]).send()).value[0];
  if (st?.err) { console.log(`swap FAILED on chain: ${JSON.stringify(st.err)}`); process.exit(1); }
  if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
}
console.log(`SWAPPED ${getSignatureFromTransaction(signed)}`);
console.log(`expected round-up: ${(Math.ceil(usdc) - usdc).toFixed(2)} USD; watch the swaps table for this signature within a minute`);
