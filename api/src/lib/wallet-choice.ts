import { VersionedTransaction } from "@solana/web3.js";
import { getBase64Encoder, getBase64Decoder } from "@solana/kit";

/** Wallet Standard feature names the pages need: connect, and sign a transaction without sending it (the API sends). */
export const CONNECT = "standard:connect";
export const SIGN = "solana:signTransaction";
const MAINNET = "solana:mainnet";

export type StdAccount = { address: string; chains?: readonly string[] };
export type StdWallet = { name: string; icon: string; chains: readonly string[]; features: Record<string, unknown>; accounts: readonly StdAccount[] };

const PREFERRED = ["Phantom", "Solflare", "Backpack"];

/** The installed wallets that can connect and sign on mainnet, each once: Phantom, Solflare and Backpack first, then by name. */
export function eligibleWallets<W extends StdWallet>(wallets: readonly W[]): W[] {
  const seen = new Set<string>();
  const out: W[] = [];
  for (const w of wallets) {
    if (seen.has(w.name) || !(CONNECT in w.features) || !(SIGN in w.features) || !w.chains.includes(MAINNET)) continue;
    seen.add(w.name);
    out.push(w);
  }
  const rank = (name: string) => (PREFERRED.includes(name) ? PREFERRED.indexOf(name) : PREFERRED.length);
  return out.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

/** The chosen wallet's account for mainnet (the object itself goes back to the wallet when it signs). */
export async function connectWith(w: StdWallet): Promise<StdAccount> {
  const { accounts } = await (w.features[CONNECT] as { connect(): Promise<{ accounts: readonly StdAccount[] }> }).connect();
  const account = accounts.find((a) => a.chains?.includes(MAINNET)) ?? accounts[0];
  if (!account) throw new Error(`${w.name} did not share an account. Unlock it and try again.`);
  return account;
}

/** The programs an approval or a revoke may touch; anything else is refused before the wallet is asked [A10]. */
const ALLOWED = new Set([
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", // Subscriptions
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token
  "ComputeBudget111111111111111111111111111111",
]);

/** The API built the transaction; the chosen wallet signs it; the API sends it. Every program id is checked before the wallet is asked. */
export async function signWith(w: StdWallet, account: StdAccount, base64: string): Promise<string> {
  const bytes = new Uint8Array(getBase64Encoder().encode(base64));
  const tx = VersionedTransaction.deserialize(bytes);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  for (const ix of tx.message.compiledInstructions) {
    if (!ALLOWED.has(keys[ix.programIdIndex])) throw new Error("This approval touches a program Sprouts does not use. Nothing was signed.");
  }
  // Called as a method: some wallets implement the feature as a class and need `this`.
  const feature = w.features[SIGN] as { signTransaction(input: { account: StdAccount; transaction: Uint8Array; chain: string }): Promise<readonly { signedTransaction: Uint8Array }[]> };
  const [out] = await feature.signTransaction({ account, transaction: bytes, chain: MAINNET });
  if (!out) throw new Error(`${w.name} returned no signed transaction. Nothing was sent.`);
  return getBase64Decoder().decode(out.signedTransaction);
}
