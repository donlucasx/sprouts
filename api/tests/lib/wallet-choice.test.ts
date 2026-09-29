import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { eligibleWallets, signWith, CONNECT, SIGN, type StdWallet } from "@/lib/wallet-choice";

// The desktop link and revoke pages used whatever extension sat in Phantom's slot, and NUFI took it (2026-09-29). They now list the
// Wallet Standard wallets installed in the browser and let the user pick; signing keeps the program allow-list [A10].
const wallet = (name: string, o: Partial<StdWallet> = {}): StdWallet => ({
  name, icon: "data:image/svg+xml;base64,", chains: ["solana:mainnet"], accounts: [],
  features: { [CONNECT]: { connect: async () => ({ accounts: [] }) }, [SIGN]: { signTransaction: async () => [] } }, ...o,
});
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const payer = Keypair.generate().publicKey;
function tx(ix: TransactionInstruction): string {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: [ix] }).compileToV0Message();
  return b64(new VersionedTransaction(msg).serialize());
}

describe("eligibleWallets", () => {
  it("keeps wallets that can connect and sign a transaction on mainnet, Phantom, Solflare and Backpack first, then by name, once each", () => {
    const list = [
      wallet("Zeta"), wallet("Backpack"), wallet("Nufi"), wallet("Solflare"), wallet("Phantom"), wallet("Phantom"),
      wallet("NoSign", { features: { [CONNECT]: {} } }),
      wallet("Devnet", { chains: ["solana:devnet"] }),
    ];
    expect(eligibleWallets(list).map((w) => w.name)).toEqual(["Phantom", "Solflare", "Backpack", "Nufi", "Zeta"]);
  });
});

describe("signWith", () => {
  it("refuses a transaction that touches a program Sprouts does not use, without asking the wallet", async () => {
    let asked = false;
    const w = wallet("Phantom", { features: { [CONNECT]: {}, [SIGN]: { signTransaction: async () => { asked = true; return []; } } } });
    const bad = tx(new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }));
    await expect(signWith(w, { address: payer.toBase58() }, bad)).rejects.toThrow("touches a program Sprouts does not use");
    expect(asked).toBe(false);
  });

  it("hands the wallet the bytes, the account and mainnet, and returns its signed bytes as base64", async () => {
    const good = tx(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey("11111111111111111111111111111112"), lamports: 1 }));
    const seen: { transaction?: Uint8Array; chain?: string; account?: unknown }[] = [];
    const account = { address: payer.toBase58() };
    const w = wallet("Solflare", { features: { [CONNECT]: {}, [SIGN]: { signTransaction: async (input: { transaction: Uint8Array; chain: string; account: unknown }) => { seen.push(input); return [{ signedTransaction: new Uint8Array([7, 8, 9]) }]; } } } });
    expect(await signWith(w, account, good)).toBe(b64(new Uint8Array([7, 8, 9])));
    expect(b64(seen[0].transaction!)).toBe(good);
    expect(seen[0].chain).toBe("solana:mainnet");
    expect(seen[0].account).toBe(account);
  });
});
