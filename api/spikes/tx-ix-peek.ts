// Read-only: the token instructions touching an account in its recent transactions (type + delegate/amount only). No secret printed.
// Run from api/: pnpm tsx --env-file=.env.local spikes/tx-ix-peek.ts <tokenAccount> [limit]
import { createSolanaRpc, address } from "@solana/kit";
const [file, lim] = process.argv.slice(2); const acct = (await import("node:fs")).readFileSync(file, "utf8").trim();
const rpc = createSolanaRpc(process.env.HELIUS_RPC_URL!);
const sh = (s?: string) => (s ? `${s.slice(0, 4)}...${s.slice(-4)}` : "-");
const sigs = await rpc.getSignaturesForAddress(address(acct), { limit: Number(lim ?? 12) }).send();
for (const s of sigs) {
  const tx: any = await rpc.getTransaction(s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }).send();
  const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((x: any) => x.instructions)];
  const toks = all.filter((i: any) => i.parsed && (i.program === "spl-token") && JSON.stringify(i.parsed.info, (_k, v) => typeof v === "bigint" ? String(v) : v).includes(acct));
  const progs = [...new Set(tx.transaction.message.instructions.map((i: any) => sh(String(i.programId))))].join(",");
  console.log(new Date(Number(s.blockTime) * 1000).toISOString().slice(0, 19), String(s.signature).slice(0, 8), "top:", progs);
  for (const i of toks) console.log("   ", i.parsed.type, "delegate", sh(i.parsed.info.delegate), "auth", sh(i.parsed.info.authority ?? i.parsed.info.owner ?? i.parsed.info.multisigAuthority), "amt", i.parsed.info.amount ?? i.parsed.info.tokenAmount?.uiAmountString ?? "");
}
