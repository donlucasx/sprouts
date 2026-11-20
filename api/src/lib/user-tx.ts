import {
  address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, type Address, type Blockhash, type Instruction, type Base64EncodedWireTransaction,
} from "@solana/kit";
import { rpc } from "./rpc";
import { signatureStatus } from "./planting";

/**
 * One blockhash read, then any number of local compiles of buildUserTransaction's shape (Task 17a review: a build that tries several
 * setup sizes, or falls back to none, reads the blockhash once, as link/[code] does).
 */
export async function userTransactionCompiler(user: Address): Promise<(ixs: readonly Instruction[]) => string> {
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  return (ixs) => getBase64EncodedWireTransaction(compileTransaction(pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(user), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  )));
}

/** A v0 transaction for a wallet to sign: the wallet as fee payer, no lookup table, compiled unsigned (the link GET's shape). */
export async function buildUserTransaction(user: Address, ixs: Instruction[]): Promise<string> {
  return (await userTransactionCompiler(user))(ixs);
}

/** Sends a wire transaction a wallet signed; the API never re-signs it. */
export async function sendPosted(wire: string): Promise<void> {
  await rpc().sendTransaction(wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
}

/** Polls the signature until it confirms, fails, or the tries run out (20 x 1.5 s by default). */
export async function waitConfirmed(signature: string, tries = 20, everyMs = 1_500): Promise<"confirmed" | "failed" | "pending"> {
  for (let i = 0; i < tries; i++) {
    const s = await signatureStatus(signature);
    if (s !== "pending") return s;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, everyMs));
  }
  return "pending";
}

/**
 * Device round 3, item 8 (10-02): what a confirm poll that ended "pending" means. While the transaction's blockhash is still valid
 * it may yet land ("pending"). Once the chain is past its lastValidBlockHeight (isBlockhashValid false) it can never land; the
 * signature is asked once more (signatureStatus searches the history), so a late landing still counts, and otherwise it is "expired":
 * it did not go through, nothing moved. Validity is asked at CONFIRMED, the commitment buildUserTransaction's getLatestBlockhash used
 * (kit's default): the finalized bank runs about 32 slots behind and does not know a young blockhash, so it would read as expired.
 */
export async function settleUnconfirmed(posted: { signature: string; blockhash: string }): Promise<"confirmed" | "failed" | "pending" | "expired"> {
  const { value: valid } = await rpc().isBlockhashValid(posted.blockhash as Blockhash, { commitment: "confirmed" }).send();
  if (valid) return "pending";
  const s = await signatureStatus(posted.signature);
  return s === "pending" ? "expired" : s;
}

/** The plain answer while a send has not confirmed and its blockhash is still valid (his device round 3, item 7): it may still land,
 * so the user looks before signing a second one (review, round 3 fix 1). */
export const STILL_WAITING = {
  withdraw: "It may still go through. Check Activity in a minute before you try again.",
  cancel: "It may still go through. Check the basket in a minute before you try again.",
  revoke: "It may still go through. Check Settings in a minute before you try again.",
} as const;

export const userAddress = (pubkey: string) => address(pubkey);
