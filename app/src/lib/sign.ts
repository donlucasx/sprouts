import { getBase64Encoder, getBase64EncodedWireTransaction, getTransactionDecoder, type Transaction } from "@solana/kit";

/** The API builds every transaction; the Seed Vault signs the bytes; the API sends. The app never talks to an RPC. */
export function makeSigner(signTransaction: (tx: Transaction) => Promise<Transaction>) {
  return async function signWithSeeker(base64: string): Promise<string> {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
    const signed = await signTransaction(tx);
    return getBase64EncodedWireTransaction(signed);
  };
}
