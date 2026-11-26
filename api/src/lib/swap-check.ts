import { address, signature as toSignature } from "@solana/kit";
import type { Repo } from "@/db/repo";
import { defaultRules } from "./rules-read";
import type { PriceLookup } from "@/domain/sizing";
import { bookSwap, type HeliusEnhancedTx } from "./book-swap";
import { checkSwapOnChain, fetchTransaction, type FetchTx } from "./verify-swap";
import { heliusParseTransactions } from "./helius";
import { priceUsd } from "./jupiter";
import { pullerSigner } from "./puller";
import { rpc } from "./rpc";
import { stockMints } from "./token-kind";

/**
 * Ops #9 (11-14): the daily missed-swap check. DETECTION ONLY (owner ruling: crediting charges the user, so nothing is booked here;
 * a miss is credited by hand with spikes/credit-missed-swaps.ts). The 11-13 measurement found 3 of ~146 swaps in 14 days on chain
 * but not in swaps, all creditable, cause unknown.
 *
 * Per active linked wallet (OPS_EXCLUDE_WALLETS left out): its signatures of the last 48 h (paged, at most MAX_PAGES), minus the
 * ones already in swaps, parsed by ONE Helius enhanced call per 100, then run through the SAME bookSwap the webhook uses (legs,
 * puller skip, top-up skip, rules, size, round-up) against a strictly read-only repo (insertSwap only records; getRules reads the
 * row without creating the defaults one, review M2), with the on-chain verify's clock set to the block time (as
 * credit-missed-swaps.ts does). A swap bookSwap would insert for THIS wallet is a miss.
 *
 * The whole check is also cut at `boundAt` (review M1): a read that hangs past every per-wallet guard cannot hold the run; the
 * wallets concluded so far keep their result and every other one is counted deferred.
 *
 * Never concludes "nothing missed" from a partial read: a page-cap hit, a read error, an enhanced answer missing a signature, a
 * transaction the RPC cannot return or a capped swaps read marks the wallet unchecked. Swaps before the wallet linked are not owed.
 * Helius load at 15 wallets: ~15-30 getSignaturesForAddress, ~15 enhanced calls, one getTransaction per candidate miss.
 */

export const LOOKBACK_S = 48 * 3600;
export const PAGE_SIZE = 100;
export const MAX_PAGES = 3;
/** The webhook books within seconds; a swap this fresh may simply be in flight. */
export const GRACE_S = 15 * 60;
/** The user's newest swaps read to tell booked from not (PostgREST's row cap). A full read still inside the window is partial. */
export const BOOKED_READ_LIMIT = 1000;
const ENHANCED_BATCH = 100;

export type SigInfo = { signature: string; blockTime: number | null; err: unknown };
export type SwapCheckReads = {
  /** One page of the wallet's signatures, newest first, before `before` (exclusive). */
  signatures(wallet: string, before?: string): Promise<SigInfo[]>;
  /** Helius's parse of up to 100 signatures. */
  enhanced(signatures: string[]): Promise<HeliusEnhancedTx[]>;
  fetchTx: FetchTx;
  priceUsd: PriceLookup;
  stockMints?: (mints: string[]) => Promise<ReadonlySet<string>>;
  puller: string;
};

export type MissedSwap = { wallet: string; sig: string; ts: string; roundupCents: number };
export type UncheckedWallet = { wallet: string; why: "page_cap" | "read_error" | "partial_read" | "price_unavailable" };
export type SwapCheckRecord = {
  checked: number;
  unchecked: UncheckedWallet[];
  /** Wallets not started (or stopped) because the run ran out of time: neither checked nor concluded. */
  deferred: number;
  missed: MissedSwap[];
  calls: { signatures: number; enhanced: number; transactions: number };
};

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-3)}`;
class Partial extends Error { constructor(readonly why: UncheckedWallet["why"]) { super(why); } }
class OutOfTime extends Error {}


/** The repo with insertSwap replaced by a recorder and getRules by a pure read: nothing is written by the booking. */
function dryRepo(repo: Repo, record: (s: Parameters<Repo["insertSwap"]>[0]) => void): Repo {
  return new Proxy(repo, {
    get(target, prop) {
      if (prop === "insertSwap") return async (s: Parameters<Repo["insertSwap"]>[0]) => { record(s); return true; };
      if (prop === "getRules") return async (u: string) => (await target.findRules(u)) ?? defaultRules(u);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export async function checkMissedSwaps(a: {
  repo: Repo;
  now: Date;
  reads: SwapCheckReads;
  exclude: Set<string>;
  /** No wallet is started at or past this (clock ms). */
  deadlineMs: number;
  /** A wallet still being read at or past this is stopped and counted deferred. */
  hardStopMs: number;
  /** The whole check returns by this (Date.now ms) whatever is still in flight (M1). */
  boundAt?: number;
  clock?: () => number;
}): Promise<SwapCheckRecord> {
  const out: SwapCheckRecord = { checked: 0, unchecked: [], deferred: 0, missed: [], calls: { signatures: 0, enhanced: 0, transactions: 0 } };
  const listed = { total: null as number | null };
  const work = runCheck(a, out, listed);
  if (a.boundAt === undefined) return work;
  let t: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<"cut">((resolve) => { t = setTimeout(() => resolve("cut"), Math.max(0, a.boundAt! - Date.now())); });
  const first = await Promise.race([work, cut]).finally(() => clearTimeout(t));
  if (first !== "cut") return first;
  work.catch(() => {});   // it may still settle later; nothing it does writes
  if (listed.total === null) throw new Error("swap check cut at its bound before the wallet list was read");
  // A snapshot: only wallets that finished count as checked or unchecked (their misses were added when they finished).
  return { checked: out.checked, unchecked: [...out.unchecked], deferred: listed.total - out.checked - out.unchecked.length, missed: [...out.missed], calls: { ...out.calls } };
}

async function runCheck(a: Parameters<typeof checkMissedSwaps>[0], out: SwapCheckRecord, listed: { total: number | null }): Promise<SwapCheckRecord> {
  const clock = a.clock ?? Date.now;
  const nowS = Math.floor(a.now.getTime() / 1000);
  const guard = () => { if (clock() >= a.hardStopMs) throw new OutOfTime(); };
  const wallets = [...new Map((await a.repo.listActiveWallets()).filter((w) => !a.exclude.has(w.pubkey) && !a.exclude.has(w.userPubkey)).map((w) => [w.pubkey, w])).values()];
  listed.total = wallets.length;

  for (const w of wallets) {
    if (clock() >= a.deadlineMs) { out.deferred++; continue; }
    try {
      const from = Math.max(nowS - LOOKBACK_S, Math.floor(w.createdAt.getTime() / 1000));
      const until = nowS - GRACE_S;

      // 1. Signatures in the window, paged; a window that does not end inside MAX_PAGES is a partial read.
      const sigs: SigInfo[] = [];
      let before: string | undefined;
      let complete = false;
      for (let i = 0; i < MAX_PAGES && !complete; i++) {
        guard();
        out.calls.signatures++;
        const page = await a.reads.signatures(w.pubkey, before);
        sigs.push(...page);
        const last = page.at(-1);
        if (page.length < PAGE_SIZE || !last || (last.blockTime !== null && last.blockTime < from)) complete = true;
        else before = last.signature;
      }
      if (!complete) throw new Partial("page_cap");
      const inWindow = sigs.filter((s) => (s.err === null || s.err === undefined) && (s.blockTime === null || (s.blockTime >= from && s.blockTime <= until)));

      // 2. Drop the ones already booked (one read of the user's swaps; a signature is booked once, under any wallet).
      const swaps = await a.repo.listSwaps(w.userPubkey, BOOKED_READ_LIMIT);
      if (swaps.length >= BOOKED_READ_LIMIT && Math.floor(swaps[swaps.length - 1].ts.getTime() / 1000) >= from) throw new Partial("partial_read");
      const booked = new Set(swaps.map((s) => s.signature));
      const unbooked = [...new Set(inWindow.map((s) => s.signature))].filter((s) => !booked.has(s));

      // 3. Helius's parse of the rest; a signature it does not return is a partial read.
      const txs: HeliusEnhancedTx[] = [];
      for (let i = 0; i < unbooked.length; i += ENHANCED_BATCH) {
        guard();
        out.calls.enhanced++;
        const chunk = unbooked.slice(i, i + ENHANCED_BATCH);
        const got = await a.reads.enhanced(chunk);
        if (!Array.isArray(got)) throw new Partial("partial_read");
        const seen = new Set(got.map((t) => t?.signature));
        if (chunk.some((s) => !seen.has(s))) throw new Partial("partial_read");
        txs.push(...got.filter((t) => chunk.includes(t.signature)));
      }

      // 4. The webhook's own booking, dry, with the chain check timed at the block (a getTransaction that fails or finds nothing
      // throws, so the wallet is unchecked rather than concluded).
      const found: MissedSwap[] = [];
      for (const tx of txs) {
        if (tx.timestamp < from || tx.timestamp > until) continue;   // before the link (never owed), or possibly in flight
        guard();
        let inserted: Parameters<Repo["insertSwap"]>[0] | null = null;
        const repo = dryRepo(a.repo, (s) => { inserted = s; });
        const res = await bookSwap({
          repo, tx, priceUsd: a.reads.priceUsd, ignoreFeePayer: a.reads.puller, stockMints: a.reads.stockMints,
          verify: async (x) => {
            guard();
            out.calls.transactions++;
            const chain = await a.reads.fetchTx(x.signature);
            if (!chain) throw new Partial("read_error");
            return checkSwapOnChain(chain, { ...x, nowS: x.timestamp + 5 });
          },
        });
        // No price: the check cannot tell whether this is a miss, so the wallet is reported, not counted checked.
        if (!res.booked && res.unpriced) throw new Partial("price_unavailable");
        const s = inserted as Parameters<Repo["insertSwap"]>[0] | null;
        if (s && s.walletPubkey === w.pubkey) found.push({ wallet: short(w.pubkey), sig: tx.signature.slice(0, 8), ts: `${new Date(tx.timestamp * 1000).toISOString().slice(0, 16)}Z`, roundupCents: s.roundupCents });
      }
      out.missed.push(...found);
      out.checked++;
    } catch (e) {
      if (e instanceof OutOfTime) out.deferred++;
      else out.unchecked.push({ wallet: short(w.pubkey), why: e instanceof Partial ? e.why : "read_error" });
    }
  }
  return out;
}

/** M1: one hung Helius parse costs at most this; the step as a whole is also cut at its bound. */
const ENHANCED_TIMEOUT_MS = 8_000;
const PRICE_TIMEOUT_MS = 2_000;

/** The real reads: the app's RPC (429-retrying, redacted) for signatures and transactions, Helius's parse, Jupiter's price. */
export async function realSwapCheckReads(): Promise<SwapCheckReads> {
  return {
    signatures: async (wallet, before) => {
      const page = await rpc().getSignaturesForAddress(address(wallet), { limit: PAGE_SIZE, commitment: "confirmed", ...(before ? { before: toSignature(before) } : {}) }).send();
      return page.map((s) => ({ signature: String(s.signature), blockTime: s.blockTime === null ? null : Number(s.blockTime), err: s.err }));
    },
    enhanced: (sigs) => heliusParseTransactions(sigs, { timeoutMs: ENHANCED_TIMEOUT_MS }),
    fetchTx: fetchTransaction,
    // A null price makes bookSwap answer `unpriced`, which marks the wallet unchecked (never a silent "nothing missed"); a hung price never holds the run.
    priceUsd: (mint) => Promise.race([priceUsd(mint), new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_TIMEOUT_MS))]),
    stockMints,
    puller: (await pullerSigner()).address,
  };
}
