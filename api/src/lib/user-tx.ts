import {
  address, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction, type Address, type Blockhash, type Instruction, type Base64EncodedWireTransaction,
} from "@solana/kit";
import { rpc } from "./rpc";
import { signatureStatus } from "./planting";
import { isHttp429 } from "./http429";

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
/**
 * 11-25 (3 top-up confirms answered 500 "Too Many Requests" seconds after the send; Kimi hotfix #6-8): a status read Helius refuses
 * with 429 counts as "pending" for that round and the poll goes on, so a rate limit can only turn an outcome into "pending" (202),
 * never into a 500 or a false "nothing moved". `deadlineMs` (a Date.now() value) ends the poll early so the route answers inside its
 * maxDuration; `resend` (the top-up: its first send was refused) runs every 3rd round, errors ignored (same signed bytes: harmless).
 */
export async function waitConfirmed(signature: string, tries = 20, everyMs = 1_500, opts: { deadlineMs?: number; resend?: () => Promise<void> } = {}): Promise<"confirmed" | "failed" | "pending"> {
  for (let i = 0; i < tries; i++) {
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) return "pending";
    if (opts.resend && i > 0 && i % 3 === 0) await opts.resend().catch(() => undefined);
    let s: "confirmed" | "failed" | "pending";
    try {
      s = await signatureStatus(signature);
    } catch (e) {
      if (!isHttp429(e)) throw e;
      s = "pending";
    }
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
  try {
    const { value: valid } = await rpc().isBlockhashValid(posted.blockhash as Blockhash, { commitment: "confirmed" }).send();
    if (valid) return "pending";
    const s = await signatureStatus(posted.signature);
    return s === "pending" ? "expired" : s;
  } catch (e) {
    if (isHttp429(e)) return "pending";   // 11-25: a rate limit never reads as "expired" (nothing moved) while it might have landed
    throw e;
  }
}

/** The plain answer while a send has not confirmed and its blockhash is still valid (his device round 3, item 7): it may still land,
 * so the user looks before signing a second one (review, round 3 fix 1). */
export const STILL_WAITING = {
  withdraw: "It may still go through. Check Activity in a minute before you try again.",
  cancel: "It may still go through. Check the basket in a minute before you try again.",
  revoke: "It may still go through. Check Settings in a minute before you try again.",
} as const;

export const userAddress = (pubkey: string) => address(pubkey);
