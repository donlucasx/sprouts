import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { eligibleWallets, signWith, connectWith, CONNECT, SIGN, type StdWallet } from "@/lib/wallet-choice";

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

describe("connectWith", () => {
  const withAccounts = (accounts: { address: string; chains?: string[] }[]) => wallet("Backpack", { features: { [CONNECT]: { connect: async () => ({ accounts }) }, [SIGN]: {} } });
  it("takes the wallet's Solana mainnet account when it shares several", async () => {
    expect((await connectWith(withAccounts([{ address: "E1", chains: ["eclipse:mainnet"] }, { address: "S1", chains: ["solana:mainnet"] }]))).address).toBe("S1");
  });
  it("refuses an account on another network and says how to fix it (Backpack on Eclipse, 2026-09-29)", async () => {
    await expect(connectWith(withAccounts([{ address: "E1", chains: ["eclipse:mainnet"] }]))).rejects.toThrow("Switch Backpack to Solana");
  });
  it("accepts an account that names no chains", async () => {
    expect((await connectWith(withAccounts([{ address: "A1" }]))).address).toBe("A1");
  });
});

describe("signWith checks the approval's delegate (contracts 5.5: the link page learns the leash delegatee)", () => {
  // A CreateRecurringDelegation-shaped instruction: Subscriptions program, data[0] = 2, the delegatee at account 3.
  const create = (delegatee: PublicKey) => new TransactionInstruction({ programId: new PublicKey("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"), data: Buffer.from([2]), keys: [
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
    { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, { pubkey: delegatee, isSigner: false, isWritable: false },
  ] });
  it("refuses an approval naming another delegate, without asking the wallet; signs the expected one", async () => {
    let asked = 0;
    const w = wallet("Phantom", { features: { [CONNECT]: {}, [SIGN]: { signTransaction: async () => { asked++; return [{ signedTransaction: new Uint8Array([1]) }]; } } } });
    const leash = Keypair.generate().publicKey;
    await expect(signWith(w, { address: payer.toBase58() }, tx(create(Keypair.generate().publicKey)), leash.toBase58())).rejects.toThrow("unexpected delegate");
    expect(asked).toBe(0);
    await signWith(w, { address: payer.toBase58() }, tx(create(leash)), leash.toBase58());
    expect(asked).toBe(1);
  });
});
