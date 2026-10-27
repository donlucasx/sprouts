// Read-only: a wallet's USDC token accounts, their delegate and delegated amount, vs its Sprouts delegation PDA. No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/ata-delegate-peek.ts <owner> <delegationPda>
import { createSolanaRpc, address } from "@solana/kit";
const [owner, pda] = process.argv.slice(2);
const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const res = await rpc.getTokenAccountsByOwner(address(owner), { mint: address(USDC) }, { encoding: "jsonParsed" }).send();
for (const a of res.value) {
  const i = (a.account.data as any).parsed.info;
  console.log(String(a.pubkey), "state", i.state, "amount", i.tokenAmount.uiAmountString, "delegate", i.delegate ? `${i.delegate.slice(0, 4)}...${i.delegate.slice(-4)}` : "NONE", "delegatedAmount", i.delegatedAmount?.uiAmountString ?? "-", "isSproutsPda", i.delegate === pda);
}
const sigs = await rpc.getSignaturesForAddress(res.value[0].pubkey, { limit: 8 }).send();
for (const s of sigs) console.log(new Date(Number(s.blockTime) * 1000).toISOString().slice(0, 19), String(s.signature).slice(0, 10), s.err ? "ERR" : "ok");
