import { address, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, type Address } from "@solana/kit";

type CompiledIx = { programAddressIndex: number; accountIndices?: readonly number[]; data?: Uint8Array };

/** `blockhash`: the lifetime the transaction carries (the API builds every one with a blockhash, never a durable nonce). */
export type PostedTx = { signature: string; blockhash: string; feePayer: Address; programs: Address[]; instructions: { program: Address; data: Uint8Array; accounts: Address[] }[]; walletAdded: Address[]; wire: string };

/**
 * Programs a wallet may add to a transaction before it signs, set aside rather than refused (Phantom, 2026-09-29): its own priority
 * fee (the compute budget program) and Lighthouse's assertions, which make the transaction fail if balances change unexpectedly.
 * Neither can move funds, and the fee payer, the only one paying for them, is the wallet that chose to add them.
 */
export const WALLET_ADDED_PROGRAMS: readonly Address[] = [address("ComputeBudget111111111111111111111111111111"), address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95")];

/**
 * A client may only hand the API a transaction the API built for it [A3]: the fee payer must be the expected wallet, the wallet's
 * signature must be present, and every instruction must call a program in the allowlist (or one a wallet adds, set aside). Anything else is refused before
 * anything is sent. Amounts are read from the transaction, never from the body. Static accounts only: the transactions the API
 * builds for a wallet (approve-once, revoke, unstake, cancel) carry no lookup table.
 */
export function verifyPostedTransaction(a: { base64: string; feePayer: Address; programs: Address[] }): PostedTx {
  let tx;
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(a.base64));
  } catch {
    throw new Error("That is not a transaction.");
  }
  let message;
  try {
    message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    throw new Error("That is not a transaction.");
  }
  if ("addressTableLookups" in message && message.addressTableLookups && message.addressTableLookups.length > 0) throw new Error("This transaction uses a lookup table Sprouts did not build.");
  const keys = message.staticAccounts as Address[];
  const feePayer = keys[0];
  if (feePayer !== a.feePayer) throw new Error("This transaction was not built for this wallet.");
  const signature = tx.signatures[a.feePayer];
  if (!signature || signature.every((b) => b === 0)) throw new Error("The wallet has not signed this transaction.");
  const compiled = ("instructions" in message ? message.instructions : []) as readonly CompiledIx[];
  const all = compiled.map((ix) => ({
    program: keys[ix.programAddressIndex], data: ix.data ?? new Uint8Array(), accounts: (ix.accountIndices ?? []).map((i) => keys[i]),
  }));
  for (const ix of all) {
    if (!a.programs.includes(ix.program) && !WALLET_ADDED_PROGRAMS.includes(ix.program)) throw new Error("This transaction touches a program Sprouts does not use.");
  }
  // The routes read only what the API built; what the wallet added is listed apart.
  const instructions = all.filter((ix) => a.programs.includes(ix.program));
  const walletAdded = all.filter((ix) => !a.programs.includes(ix.program)).map((ix) => ix.program);
  return { signature: getSignatureFromTransaction(tx), blockhash: String(message.lifetimeToken), feePayer, programs: instructions.map((i) => i.program), instructions, walletAdded, wire: a.base64 };
}
