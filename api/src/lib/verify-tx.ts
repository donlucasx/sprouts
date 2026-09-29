import { getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, type Address } from "@solana/kit";

export type PostedTx = { signature: string; feePayer: Address; programs: Address[]; instructions: { program: Address; data: Uint8Array; accounts: Address[] }[]; wire: string };

/**
 * A client may only hand the API a transaction the API built for it [A3]: the fee payer must be the expected wallet, the wallet's
 * signature must be present, and every instruction must call a program in the allowlist. Anything else is refused before
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
  const instructions = (message.instructions ?? []).map((ix) => ({
    program: keys[ix.programAddressIndex], data: ix.data ?? new Uint8Array(), accounts: (ix.accountIndices ?? []).map((i) => keys[i]),
  }));
  for (const ix of instructions) if (!a.programs.includes(ix.program)) throw new Error("This transaction touches a program Sprouts does not use.");
  return { signature: getSignatureFromTransaction(tx), feePayer, programs: instructions.map((i) => i.program), instructions, wire: a.base64 };
}
