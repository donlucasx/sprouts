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
  events?: {
    swap?: {
      nativeInput?: { account: string; amount: string } | null;
      nativeOutput?: { account: string; amount: string } | null;
      tokenInputs?: { userAccount: string; mint: string; tokenAmount: number }[];
      tokenOutputs?: { userAccount: string; mint: string; tokenAmount: number }[];
    };
  };
};

const LAMPORTS = 1e9;

/**
 * The wallet's own in and out legs. The swap event is preferred (it names the wallet's legs, native SOL included);
 * the token-transfer scan is the fallback (first transfer out of the wallet, last transfer into it, so multi-hop routes read right).
 */
export function extractSwapLegs(tx: HeliusEnhancedTx, wallet: string): SwapLegs | null {
  const ev = tx.events?.swap;
  if (ev) {
    const tokenIn = ev.tokenInputs?.find((t) => t.userAccount === wallet);
    const tokenOut = ev.tokenOutputs?.find((t) => t.userAccount === wallet);
    const nativeIn = ev.nativeInput && ev.nativeInput.account === wallet ? { mint: WSOL, tokenAmount: Number(ev.nativeInput.amount) / LAMPORTS } : undefined;
    const nativeOut = ev.nativeOutput && ev.nativeOutput.account === wallet ? { mint: WSOL, tokenAmount: Number(ev.nativeOutput.amount) / LAMPORTS } : undefined;
    const inn = tokenIn ?? nativeIn;
    const out = tokenOut ?? nativeOut;
    if (inn && out) return { wallet, inMint: inn.mint, inAmount: Number(inn.tokenAmount), outMint: out.mint, outAmount: Number(out.tokenAmount) };
  }
  const out = tx.tokenTransfers.find((t) => t.fromUserAccount === wallet);
  const inn = [...tx.tokenTransfers].reverse().find((t) => t.toUserAccount === wallet);
  if (!out || !inn) return null;
  return { wallet, inMint: out.mint, inAmount: out.tokenAmount, outMint: inn.mint, outAmount: inn.tokenAmount };
}

export type BookResult = { booked: true; walletPubkey: string; roundupCents: number } | { booked: false };

/** Book one swap for the first known, non-revoked wallet among its parties: size it, class it, compute the round-up, insert once. */
export async function bookSwap(a: { repo: Repo; tx: HeliusEnhancedTx; priceUsd: PriceLookup }): Promise<BookResult> {
  if (a.tx.type !== "SWAP") return { booked: false };
  const parties = new Set<string>([a.tx.feePayer]);
  for (const t of a.tx.tokenTransfers) { parties.add(t.fromUserAccount); parties.add(t.toUserAccount); }
  for (const t of a.tx.events?.swap?.tokenInputs ?? []) parties.add(t.userAccount);
  for (const t of a.tx.events?.swap?.tokenOutputs ?? []) parties.add(t.userAccount);
  if (a.tx.events?.swap?.nativeInput) parties.add(a.tx.events.swap.nativeInput.account);
  for (const pubkey of parties) {
    if (!pubkey) continue;
    const wallet = await a.repo.getWallet(pubkey);
    if (!wallet || wallet.status === "revoked") continue;
    const legs = extractSwapLegs(a.tx, pubkey);
    if (!legs) continue;
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
