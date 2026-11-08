import { dayOf } from "./day";

export type AskQuestion = "wallet_removed" | "brought_you";
/** The answers each question accepts: the values the app sends to POST /api/feedback, and the route's allow-list. */
export const FEEDBACK_OPTIONS = {
  link_failed: ["backed_out", "closed_itself", "warning_worried", "other"],
  wallet_removed: ["testing", "approval", "not_planting", "need_usdc", "other"],
  brought_you: ["skr_staking", "roundups", "looking", "other"],
} as const;
export type FeedbackQuestion = keyof typeof FEEDBACK_OPTIONS;

export type Ask = { question: AskQuestion; ref: string };

/** The ref of a wallet_removed ask: the wallet and the UTC day of its revoke. The app echoes it back unchanged and never reads it. */
export const removedRef = (wallet: string, at: Date): string => `${wallet}:${dayOf(at)}`;

/**
 * At most one question, asked once per ref. A wallet the user removed themselves (revoke_seen "by: user") comes first, the newest
 * unanswered one; then, for a user who took money out without ever linking a wallet, "what brought you here". A revoke Sprouts made is never asked.
 */
export function askFor(a: {
  walletsEver: number;
  withdrawals: number;
  removedWallets: { wallet: string; at: Date }[];
  answered: { question: string; ref: string }[];
}): Ask | null {
  const done = (question: AskQuestion, ref: string) => a.answered.some((x) => x.question === question && x.ref === ref);

  const removed = [...a.removedWallets]
    .sort((p, q) => q.at.getTime() - p.at.getTime())
    .map((r) => removedRef(r.wallet, r.at))
    .find((ref) => !done("wallet_removed", ref));
  if (removed) return { question: "wallet_removed", ref: removed };

  if (a.walletsEver === 0 && a.withdrawals > 0 && !done("brought_you", "brought_you")) return { question: "brought_you", ref: "brought_you" };
  return null;
}
