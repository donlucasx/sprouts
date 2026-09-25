// Spike 2: a ten-cent USDC to SKR quote with the 50 bps platform fee, swap-instructions for the puller, the SOL price,
// and a probe of the newer v2 build endpoint (does it return raw instructions?). Needs JUPITER_API_KEY.
// Run from api/: pnpm tsx --env-file=.env.local spikes/jupiter-check.ts
import { getQuote, getSwapInstructions, priceUsd } from "../src/lib/jupiter";
import { pullerSigner } from "../src/lib/puller";
import { config } from "../src/lib/config";
import { USDC_MINT, SKR_MINT, STORE_MINT } from "../src/lib/constants";
import { WSOL } from "../src/domain/sizing";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const puller = await pullerSigner();
console.log(`puller ${puller.address}`);

const quote = await getQuote({ inputMint: USDC_MINT, outputMint: SKR_MINT, amountRaw: 100_000n, platformFeeBps: 50, maxAccounts: 24, onlyDirectRoutes: true });
console.log(`SKR quote: in ${quote.inAmount} out ${quote.outAmount} min ${quote.otherAmountThreshold} hops ${quote.routePlan.length}`);
const q = quote as unknown as { platformFee?: { amount?: string; feeBps?: number } };
console.log(`platform fee on the quote: ${JSON.stringify(q.platformFee ?? null)} (is outAmount net of it? compare with a no-fee quote below)`);
const noFee = await getQuote({ inputMint: USDC_MINT, outputMint: SKR_MINT, amountRaw: 100_000n, maxAccounts: 24, onlyDirectRoutes: true });
console.log(`no-fee quote out ${noFee.outAmount}; with fee out ${quote.outAmount}; ratio ${(Number(quote.outAmount) / Number(noFee.outAmount)).toFixed(4)}`);

const storeQuote = await getQuote({ inputMint: USDC_MINT, outputMint: STORE_MINT, amountRaw: 100_000n, platformFeeBps: 50, maxAccounts: 24, onlyDirectRoutes: false });
console.log(`stORE quote: out ${storeQuote.outAmount} hops ${storeQuote.routePlan.length}`);

// swap-instructions with a platform fee requires feeAccount: the fee wallet's token account for the output mint.
// Before FEE_WALLET is set, the puller's own SKR account stands in (same shape; the real fee leg is exercised by Spike 3b).
const feeOwner = process.env.FEE_WALLET ? address(process.env.FEE_WALLET) : puller.address;
const [feeAccount] = await findAssociatedTokenPda({ owner: feeOwner, mint: SKR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
console.log(`feeAccount ${feeAccount} (owner ${feeOwner === puller.address ? "puller, stand-in" : "fee wallet"})`);
const ixs = await getSwapInstructions({ quote, userPublicKey: puller.address, feeAccount });
console.log(`swap-instructions: setup ${ixs.setup.length}, swap accounts ${ixs.swap.accounts?.length}, cleanup ${ixs.cleanup ? 1 : 0}, lookup tables ${ixs.lookupTables.length}, compute budget ${ixs.computeBudget.length}`);

console.log(`SOL price: ${await priceUsd(WSOL)}`);

// v2 probe: does the successor return raw instructions (K15)?
const v2 = await fetch(`https://api.jup.ag/swap/v2/order?inputMint=${USDC_MINT}&outputMint=${SKR_MINT}&amount=100000&taker=${puller.address}`, { headers: { "x-api-key": config().jupiterApiKey } });
console.log(`v2 order: HTTP ${v2.status}`);
if (v2.ok) {
  const j = (await v2.json()) as Record<string, unknown>;
  console.log(`v2 order keys: ${Object.keys(j).join(", ")}`);
  const build = await fetch(`https://api.jup.ag/swap/v2/build`, { method: "POST", headers: { "x-api-key": config().jupiterApiKey, "content-type": "application/json" }, body: JSON.stringify({ ...j, taker: puller.address }) });
  console.log(`v2 build: HTTP ${build.status}`);
  if (build.ok) { const b = (await build.json()) as Record<string, unknown>; console.log(`v2 build keys: ${Object.keys(b).join(", ")}`); }
  else console.log((await build.text()).slice(0, 300));
} else console.log((await v2.text()).slice(0, 300));
