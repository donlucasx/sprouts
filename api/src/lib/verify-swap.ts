import { signature as toSignature } from "@solana/kit";
import { WSOL, type SwapLegs } from "@/domain/sizing";
import { rpc } from "./rpc";

/**
 * The on-chain re-check of a swap before it is booked (security R207 #8). The webhook's bearer secret was the whole boundary:
 * anyone holding it could post a made-up "swap" (any signature, any amounts, an old timestamp that forces a planting) for any
 * linked wallet. Now the transaction itself is read from chain and must agree with the event on every field the booking uses.
 * Cost: ONE getTransaction per swap that would be booked (a known wallet with two legs); events for unknown wallets, the puller's
 * own plantings and one-sided transfers are dropped before this runs, so they cost nothing.
 */

/** The parts of a `jsonParsed` getTransaction answer the check reads (numbers may arrive as bigint from @solana/kit). */
export type ChainTx = {
  blockTime: bigint | number | null;
  meta: {
    err: unknown;
    preBalances: readonly (bigint | number)[];
    postBalances: readonly (bigint | number)[];
    preTokenBalances?: readonly ChainTokenBalance[] | null;
    postTokenBalances?: readonly ChainTokenBalance[] | null;
  } | null;
  transaction: { message: { accountKeys: readonly { pubkey: string; signer: boolean }[] } };
};
type ChainTokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };

export type FetchTx = (signature: string) => Promise<ChainTx | null>;

/** Helius posts within seconds of the block; an hour is room for its three retries and nothing like the days a forced plant needs. */
export const MAX_AGE_S = 60 * 60;
/** Helius's `timestamp` IS the block time; two seconds absorbs nothing but rounding. */
export const TIME_SLACK_S = 2;
/** A booked amount may exceed what the chain shows by 1% (decimal rounding in the event)... */
export const AMOUNT_TOLERANCE = 0.01;
/** ...and a native SOL leg by 0.01 SOL more: the lamport delta also carries the fee, priority fee and token-account rent. */
export const SOL_SLACK = 0.01;

/** One getTransaction through the app's RPC: confirmed, v0-aware, parsed so balances carry their owners. */
export const fetchTransaction: FetchTx = async (sig) =>
  (await rpc().getTransaction(toSignature(sig), { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send()) as unknown as ChainTx | null;

/** The wallet's net change in one mint across the transaction, in whole units (positive: it received). WSOL includes native lamports. */
function walletDelta(tx: ChainTx, wallet: string, mint: string): number {
  const meta = tx.meta!;
  const sum = (balances: readonly ChainTokenBalance[] | null | undefined) =>
    (balances ?? []).filter((b) => b.owner === wallet && b.mint === mint).reduce((s, b) => s + Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals, 0);
  let delta = sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
  if (mint === WSOL) {
    const i = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey === wallet);
    if (i >= 0) delta += (Number(meta.postBalances[i] ?? 0) - Number(meta.preBalances[i] ?? 0)) / 1e9;
  }
  return delta;
}

/**
 * Null when the chain agrees with the event, else the reason it is refused. Agreement means: the transaction exists and succeeded,
 * the linked wallet SIGNED it (a wallet merely receiving a transfer is not its swap), its block time is the event's and is recent,
 * and neither booked leg is larger than the wallet's own balance change in that mint (the wallet lost the in-leg, gained the
 * out-leg). Only "larger" is refused: an inflated amount is what moves money (the 1% rule has no ceiling); a smaller one cannot.
 */
export function checkSwapOnChain(chain: ChainTx | null, a: { wallet: string; legs: SwapLegs; timestamp: number; nowS: number }): string | null {
  if (!chain || !chain.meta) return "not found on chain";
  if (chain.meta.err !== null && chain.meta.err !== undefined) return "failed on chain";
  if (!chain.transaction.message.accountKeys.some((k) => k.pubkey === a.wallet && k.signer)) return "the wallet did not sign it";
  if (chain.blockTime === null || chain.blockTime === undefined) return "no block time";
  const blockTime = Number(chain.blockTime);
  if (Math.abs(blockTime - a.timestamp) > TIME_SLACK_S) return `the event's time ${a.timestamp} is not the block's ${blockTime}`;
  if (a.nowS - blockTime > MAX_AGE_S || blockTime - a.nowS > 60) return `the block time ${blockTime} is not recent`;
  const fits = (claimed: number, seen: number, mint: string) => claimed <= seen * (1 + AMOUNT_TOLERANCE) + (mint === WSOL ? SOL_SLACK : 0);
  const spent = -walletDelta(chain, a.wallet, a.legs.inMint);
  if (!fits(a.legs.inAmount, spent, a.legs.inMint)) return `the in-leg ${a.legs.inAmount} is more than the wallet spent (${spent})`;
  const got = walletDelta(chain, a.wallet, a.legs.outMint);
  if (!fits(a.legs.outAmount, got, a.legs.outMint)) return `the out-leg ${a.legs.outAmount} is more than the wallet received (${got})`;
  return null;
}

/**
 * The booking's verifier: fetch once (and once more after two seconds if the RPC has not seen it yet, a webhook can outrun the
 * node), then check. A fetch that throws is a refusal, not a pass: the event is logged and not booked.
 */
export function onChainVerifier(fetchTx: FetchTx = fetchTransaction, opts: { now?: () => number; retryMs?: number } = {}) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  return async (a: { signature: string; wallet: string; legs: SwapLegs; timestamp: number }): Promise<string | null> => {
    let chain: ChainTx | null;
    try {
      chain = await fetchTx(a.signature);
      if (!chain) {
        await new Promise((r) => setTimeout(r, opts.retryMs ?? 2_000));
        chain = await fetchTx(a.signature);
      }
    } catch (e) {
      return `the chain could not be read: ${e instanceof Error ? e.message : String(e)}`;
    }
    return checkSwapOnChain(chain, { wallet: a.wallet, legs: a.legs, timestamp: a.timestamp, nowS: now() });
  };
}
