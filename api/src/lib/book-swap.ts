import type { Repo } from "@/db/repo";
import { rulesRowToRules } from "@/db/types";
import { usdSizeCents, WSOL, type SwapLegs, type PriceLookup } from "@/domain/sizing";
import { classifySwap } from "@/domain/classify";
import { computeRoundupCents } from "@/domain/roundup";

/** The parts of a Helius enhanced transaction the booking reads. */
export type HeliusEnhancedTx = {
  signature: string;
  timestamp: number;
  type: string;
  feePayer: string;
  tokenTransfers: { fromUserAccount: string; toUserAccount: string; mint: string; tokenAmount: number }[];
  nativeTransfers?: { fromUserAccount: string; toUserAccount: string; amount: number }[]; // lamports
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string } | null;
      nativeOutput?: { account: string; amount: string } | null;
      tokenInputs?: SwapTokenLeg[];
      tokenOutputs?: SwapTokenLeg[];
    };
  };
};

/** A token leg of the swap event: Helius nests the amount as raw units plus decimals (there is no flat tokenAmount). */
type SwapTokenLeg = { userAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } };

const LAMPORTS = 1e9;

const legAmount = (t: SwapTokenLeg) => Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals;

/**
 * The wallet's own in and out legs. The swap event is preferred (it names the wallet's legs, native SOL included);
 * the token-transfer scan is the fallback (first transfer out of the wallet, last transfer into it, so multi-hop routes read right).
 */
export function extractSwapLegs(tx: HeliusEnhancedTx, wallet: string): SwapLegs | null {
  const ev = tx.events?.swap;
  if (ev) {
    // A leg is the SUM of the wallet's entries in that coin: a wallet app that takes its fee in the swap lists it as its own
    // entry (10-06, 2xYqKn37…: 0.01215 + 1.48785 USDC), and reading only the first booked a $1.50 swap as 1 cent.
    const sumLeg = (legs: SwapTokenLeg[] | undefined) => {
      const mine = (legs ?? []).filter((t) => t.userAccount === wallet);
      if (mine.length === 0) return undefined;
      const mint = mine[0].mint;
      return { mint, tokenAmount: mine.filter((t) => t.mint === mint).reduce((s, t) => s + legAmount(t), 0) };
    };
    const tokenIn = sumLeg(ev.tokenInputs);
    const tokenOut = sumLeg(ev.tokenOutputs);
    const nativeIn = ev.nativeInput && ev.nativeInput.account === wallet ? { mint: WSOL, tokenAmount: Number(ev.nativeInput.amount) / LAMPORTS } : undefined;
    const nativeOut = ev.nativeOutput && ev.nativeOutput.account === wallet ? { mint: WSOL, tokenAmount: Number(ev.nativeOutput.amount) / LAMPORTS } : undefined;
    const inn = tokenIn ?? nativeIn;
    const out = tokenOut ?? nativeOut;
    if (inn && out) return { wallet, inMint: inn.mint, inAmount: Number(inn.tokenAmount), outMint: out.mint, outAmount: Number(out.tokenAmount) };
  }
  // No swap event (09-30: Phantom's swaps through Jupiter's Order Engine parse as INITIALIZE_ACCOUNT, transfers listed plainly):
  // the wallet's own transfers, native SOL included. A token leg wins over a native one, so rent paid alongside a token swap is
  // not mistaken for the swap; the largest native transfer is the leg otherwise. One side only, or the same mint both ways
  // (a SOL wrap), is not a swap.
  const natives = tx.nativeTransfers ?? [];
  const largest = (xs: { amount: number }[]) => xs.reduce<{ amount: number } | null>((best, t) => (best && best.amount >= t.amount ? best : t), null);
  const tokenOut = tx.tokenTransfers.find((t) => t.fromUserAccount === wallet);
  const tokenIn = [...tx.tokenTransfers].reverse().find((t) => t.toUserAccount === wallet);
  const nativeOut = largest(natives.filter((t) => t.fromUserAccount === wallet));
  const nativeIn = largest(natives.filter((t) => t.toUserAccount === wallet));
  // The coin is the first transfer out (last in); the amount is every transfer of that coin out of (into) the wallet, added up,
  // so a fee the wallet app takes in the same coin counts as spent (10-06, 2xYqKn37…).
  const sumOf = (dir: "fromUserAccount" | "toUserAccount", mint: string) =>
    tx.tokenTransfers.filter((t) => t[dir] === wallet && t.mint === mint).reduce((s, t) => s + t.tokenAmount, 0);
  const out = tokenOut ? { mint: tokenOut.mint, amount: sumOf("fromUserAccount", tokenOut.mint) } : nativeOut ? { mint: WSOL, amount: nativeOut.amount / LAMPORTS } : null;
  const inn = tokenIn ? { mint: tokenIn.mint, amount: sumOf("toUserAccount", tokenIn.mint) } : nativeIn ? { mint: WSOL, amount: nativeIn.amount / LAMPORTS } : null;
  if (!out || !inn || out.mint === inn.mint) return null;
  return { wallet, inMint: out.mint, inAmount: out.amount, outMint: inn.mint, outAmount: inn.amount };
}

export type BookResult = { booked: true; walletPubkey: string; roundupCents: number } | { booked: false; refused?: string };

/** The on-chain re-check (lib/verify-swap, R207 #8): null when the chain agrees, else the reason the swap is refused. */
export type SwapVerifier = (a: { signature: string; wallet: string; legs: SwapLegs; timestamp: number }) => Promise<string | null>;

/**
 * Book one swap for the first known, non-revoked wallet among its parties: size it, class it, compute the round-up, insert once.
 * A transaction the puller paid for is one of Sprouts' own plantings, never a swap to round up (review M14).
 * With `verify` (the webhook always passes it, R207 #8), the swap is re-read from chain before it is booked; the check runs only
 * once a known wallet with two legs is found, so an event Sprouts would ignore anyway costs no RPC call.
 */
export async function bookSwap(a: { repo: Repo; tx: HeliusEnhancedTx; priceUsd: PriceLookup; ignoreFeePayer?: string; verify?: SwapVerifier }): Promise<BookResult> {
  // Not gated on Helius's type: a swap through a router Helius does not know arrives as INITIALIZE_ACCOUNT or UNKNOWN (09-30);
  // the legs decide, and one-sided transfers never have two.
  if (a.ignoreFeePayer && a.tx.feePayer === a.ignoreFeePayer) return { booked: false };
  const parties = new Set<string>([a.tx.feePayer]);
  for (const t of a.tx.tokenTransfers) { parties.add(t.fromUserAccount); parties.add(t.toUserAccount); }
  for (const t of a.tx.nativeTransfers ?? []) { parties.add(t.fromUserAccount); parties.add(t.toUserAccount); }
  for (const t of a.tx.events?.swap?.tokenInputs ?? []) parties.add(t.userAccount);
  for (const t of a.tx.events?.swap?.tokenOutputs ?? []) parties.add(t.userAccount);
  if (a.tx.events?.swap?.nativeInput) parties.add(a.tx.events.swap.nativeInput.account);
  for (const pubkey of parties) {
    if (!pubkey) continue;
    const wallet = await a.repo.getWallet(pubkey);
    if (!wallet || wallet.status === "revoked") continue;
    const legs = extractSwapLegs(a.tx, pubkey);
    if (!legs) continue;
    if (a.verify) {
      const refused = await a.verify({ signature: a.tx.signature, wallet: pubkey, legs, timestamp: a.tx.timestamp });
      if (refused) return { booked: false, refused };
    }
    const rules = rulesRowToRules(await a.repo.getRules(wallet.userPubkey));
    const size = await usdSizeCents(legs, a.priceUsd);
    const roundupCents = computeRoundupCents(size, rules);
    const booked = await a.repo.insertSwap({
      signature: a.tx.signature, walletPubkey: pubkey, ts: new Date(a.tx.timestamp * 1000),
      inMint: legs.inMint, inAmount: legs.inAmount, outMint: legs.outMint, outAmount: legs.outAmount,
      usdSizeCents: size, class: classifySwap(legs), roundupCents,
    });
    return booked ? { booked: true, walletPubkey: pubkey, roundupCents } : { booked: false };
  }
  return { booked: false };
}
