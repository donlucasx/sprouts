import { address, signature as toSignature } from "@solana/kit";
import type { Repo } from "@/db/repo";
import { defaultRules } from "./rules-read";
import type { PriceLookup } from "@/domain/sizing";
import { bookSwap, type HeliusEnhancedTx } from "./book-swap";
import { checkSwapOnChain, fetchTransaction, type FetchTx } from "./verify-swap";
import { heliusParseTransactions } from "./helius";
import { sharedPriceUsd } from "./shared-reads";
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
 *
 * 11-27 (Kimi swap-check scope, his ruling "check EVERY wallet daily"): the check has its own daily route (/api/cron/swap-check,
 * 13:00 UTC, 800 s) instead of the plant run's last ~30 s; wallets are read CONCURRENCY at a time (each one's guards unchanged);
 * a wallet's window reaches back to the last run that checked it (at most 7 days), so a deferred wallet's swaps are not lost; and
 * each run records which bookSwap filter dropped the unbooked swaps it read (`skipped`), plus, per miss, what the webhook left
 * (annotateMissReasons) and a founder card when a wallet misses in two runs straight (repeatMisses).
 */

export const LOOKBACK_S = 48 * 3600;
/** 11-27 (Kimi 3): a wallet no run checked lately is read back to its last check, never further than this. */
export const MAX_LOOKBACK_S = 7 * 86_400;
export const PAGE_SIZE = 100;
/** 11-27: 3 -> 10 (a window can now reach 7 days; the route has ~730 s, not ~30). A wallet past this is still unchecked, never concluded. */
export const MAX_PAGES = 10;
/** 11-27 (Kimi 2): wallets read at once. ~20 Helius requests/s at most, under the plan's 50 (the RPC transport paces anyway). */
export const CONCURRENCY = 8;
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

/**
 * `reason` (11-27, Kimi 6; set by annotateMissReasons, after the check): what the webhook left for this swap. `refused:<why>` it was
 * delivered and the chain check said no then; `unpriced` delivered with no price; `no_trace` never delivered, or dropped by a routine
 * skip that writes nothing; `unknown` the events could not be read.
 */
export type MissedSwap = { wallet: string; sig: string; ts: string; roundupCents: number; reason?: string };
/** Why the unbooked swaps the check read were (rightly) not booked: bookSwap's own filters, counted per run (Kimi 6). */
export type SkipCounts = { puller: number; top_up: number; refused: number; not_this_wallet: number };
export type UncheckedWallet = { wallet: string; why: "page_cap" | "read_error" | "partial_read" | "price_unavailable" };
export type SwapCheckRecord = {
  checked: number;
  unchecked: UncheckedWallet[];
  /** Wallets not started (or stopped) because the run ran out of time: neither checked nor concluded. */
  deferred: number;
  missed: MissedSwap[];
  calls: { signatures: number; enhanced: number; transactions: number };
  /** 11-27: the end of this run's window (ISO, now minus the 15 min grace): the next run reads a checked wallet from here at the latest. */
  through?: string;
  /** 11-27: the wallets this run concluded (short keys, as in `missed`): the next run's lookback (checkedThrough). */
  checkedWallets?: string[];
  skipped?: SkipCounts;
};

/**
 * Kimi 3: where a wallet's window starts. With no earlier record at all (the first run of the route), the old 48 h. Otherwise 48 h, or
 * further back to the last run that concluded this wallet when that is older, capped at 7 days; never before the wallet linked.
 * Short keys can collide; a wrong `lastThroughS` can only widen the window (min with 48 h), never narrow it.
 */
export function windowStart(a: { nowS: number; createdS: number; lastThroughS: number | undefined; hasHistory: boolean }): number {
  const base = a.nowS - LOOKBACK_S;
  const cap = a.nowS - MAX_LOOKBACK_S;
  const start = !a.hasHistory ? base : a.lastThroughS === undefined ? cap : Math.max(cap, Math.min(base, a.lastThroughS));
  return Math.max(start, a.createdS);
}

/** Per short wallet key, the newest `through` (seconds) of the earlier runs' records that concluded it. */
export function checkedThrough(records: unknown[]): { through: Map<string, number>; hasHistory: boolean } {
  const through = new Map<string, number>();
  let hasHistory = false;
  for (const r of records) {
    const c = r !== null && typeof r === "object" ? (r as { through?: unknown; checkedWallets?: unknown }) : null;
    const t = typeof c?.through === "string" ? Math.floor(Date.parse(c.through) / 1000) : NaN;
    if (!Number.isFinite(t) || !Array.isArray(c?.checkedWallets)) continue;
    hasHistory = true;
    for (const w of c.checkedWallets) if (typeof w === "string" && !((through.get(w) ?? -Infinity) >= t)) through.set(w, t);
  }
  return { through, hasHistory };
}

export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-3)}`;
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
  /** Wallets read at once (default CONCURRENCY). */
  concurrency?: number;
  /** Earlier runs' lookback (checkedThrough); absent = no history, every wallet's window is 48 h. */
  history?: { through: Map<string, number>; hasHistory: boolean };
}): Promise<SwapCheckRecord> {
  const until = Math.floor(a.now.getTime() / 1000) - GRACE_S;
  const out: SwapCheckRecord = { checked: 0, unchecked: [], deferred: 0, missed: [], calls: { signatures: 0, enhanced: 0, transactions: 0 }, through: new Date(until * 1000).toISOString(), checkedWallets: [], skipped: { puller: 0, top_up: 0, refused: 0, not_this_wallet: 0 } };
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
  return { checked: out.checked, unchecked: [...out.unchecked], deferred: listed.total - out.checked - out.unchecked.length, missed: [...out.missed], calls: { ...out.calls }, through: out.through, checkedWallets: [...out.checkedWallets!], skipped: { ...out.skipped! } };
}

async function runCheck(a: Parameters<typeof checkMissedSwaps>[0], out: SwapCheckRecord, listed: { total: number | null }): Promise<SwapCheckRecord> {
  const clock = a.clock ?? Date.now;
  const nowS = Math.floor(a.now.getTime() / 1000);
  const guard = () => { if (clock() >= a.hardStopMs) throw new OutOfTime(); };
  const wallets = [...new Map((await a.repo.listActiveWallets()).filter((w) => !a.exclude.has(w.pubkey) && !a.exclude.has(w.userPubkey)).map((w) => [w.pubkey, w])).values()];
  listed.total = wallets.length;

  const history = a.history ?? { through: new Map<string, number>(), hasHistory: false };

  // Kimi 2: a bounded pool. Each wallet is still judged alone (its own guard, deadline and partial-read rules); only the order changes.
  let next = 0;
  const worker = async () => {
    while (next < wallets.length) await checkWallet(wallets[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(a.concurrency ?? CONCURRENCY, wallets.length)) }, worker));
  return out;

  async function checkWallet(w: (typeof wallets)[number]) {
    if (clock() >= a.deadlineMs) { out.deferred++; return; }
    // Counted into the run only when the wallet is concluded: a partial or stopped wallet adds nothing.
    const skipped: SkipCounts = { puller: 0, top_up: 0, refused: 0, not_this_wallet: 0 };
    try {
      const from = windowStart({ nowS, createdS: Math.floor(w.createdAt.getTime() / 1000), lastThroughS: history.through.get(short(w.pubkey)), hasHistory: history.hasHistory });
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
        if (tx.feePayer === a.reads.puller) { skipped.puller++; continue; }   // bookSwap's first filter (a Sprouts planting)
        let inserted: Parameters<Repo["insertSwap"]>[0] | null = null;
        let topUp = false;
        const dry = dryRepo(a.repo, (s) => { inserted = s; });
        const repo = new Proxy(dry, { get(t, prop) {
          if (prop === "topUpKinds") return async (sig: string, wallet: string) => { const k = await t.topUpKinds(sig, wallet); if (k.length) topUp = true; return k; };
          return Reflect.get(t, prop, t) as unknown;
        } });
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
        else if (topUp) skipped.top_up++;
        else if (!res.booked && res.refused) skipped.refused++;
        else skipped.not_this_wallet++;   // no swap legs for a known wallet, or booked under another wallet
      }
      out.missed.push(...found);
      out.checked++;
      out.checkedWallets!.push(short(w.pubkey));
      for (const k of Object.keys(skipped) as (keyof SkipCounts)[]) out.skipped![k] += skipped[k];
    } catch (e) {
      if (e instanceof OutOfTime) out.deferred++;
      else out.unchecked.push({ wallet: short(w.pubkey), why: e instanceof Partial ? e.why : "read_error" });
    }
  }
}

/**
 * Kimi 6: what the webhook left for each miss, read once from the events table (swap_refused and zero_roundup since `since`, matched
 * on the wallet and the short signature). Never throws: unreadable events mark every miss `unknown`. Returns a new list.
 */
export async function annotateMissReasons(repo: Repo, missed: MissedSwap[], since: Date): Promise<MissedSwap[]> {
  if (!missed.length) return missed;
  let traces: Map<string, string>;
  try {
    const [refused, unpriced] = await Promise.all([repo.listEventsByKind("swap_refused", since), repo.listEventsByKind("zero_roundup", since)]);
    traces = new Map();
    const key = (wallet: string | null, sig: unknown) => `${wallet ? short(wallet) : "?"}:${String(sig ?? "")}`;
    for (const e of unpriced) traces.set(key(e.walletPubkey, (e.detail as { sig?: unknown } | null)?.sig), "unpriced");
    for (const e of refused) {
      const d = (e.detail ?? {}) as { sig?: unknown; reason?: unknown };
      const why = /^[a-z_]{1,24}$/.test(String(d.reason)) ? String(d.reason) : "other";
      traces.set(key(e.walletPubkey, d.sig), `refused:${why}`);
      // A refusal written with no wallet (an item that matched no known wallet) still names the swap.
      if (!e.walletPubkey) traces.set(`?:${String(d.sig ?? "")}`, `refused:${why}`);
    }
  } catch (e) {
    console.error(`swap check: miss reasons unreadable: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    return missed.map((m) => ({ ...m, reason: "unknown" }));
  }
  return missed.map((m) => ({ ...m, reason: traces.get(`${m.wallet}:${m.sig}`) ?? traces.get(`?:${m.sig}`) ?? "no_trace" }));
}

/**
 * Kimi 6: the wallets that missed a swap in this run AND in the previous one (a new miss now, so one miss re-read by the overlapping
 * window is not a repeat). The repeat is the signal worth a card: one miss is weather, two runs straight is a pattern.
 */
export function repeatMisses(current: MissedSwap[], previous: unknown): string[] {
  const prev = previous !== null && typeof previous === "object" && Array.isArray((previous as { missed?: unknown }).missed)
    ? ((previous as { missed: unknown[] }).missed.filter((m) => m !== null && typeof m === "object") as { wallet?: unknown; sig?: unknown }[])
    : [];
  const prevWallets = new Set(prev.map((m) => String(m.wallet)));
  const prevSigs = new Set(prev.map((m) => String(m.sig)));
  return [...new Set(current.filter((m) => prevWallets.has(m.wallet) && !prevSigs.has(m.sig)).map((m) => m.wallet))];
}

/** M1: one hung Helius parse costs at most this; the step as a whole is also cut at its bound. */
const ENHANCED_TIMEOUT_MS = 8_000;
const PRICE_TIMEOUT_MS = 2_000;

/** The real reads: the app's RPC (429-retrying, redacted) for signatures and transactions, Helius's parse, the shared sizing price (11-28: DAS first, Jupiter fallback, shared across instances: the 13:00 check no longer bursts Jupiter). */
export async function realSwapCheckReads(): Promise<SwapCheckReads> {
  return {
    signatures: async (wallet, before) => {
      const page = await rpc().getSignaturesForAddress(address(wallet), { limit: PAGE_SIZE, commitment: "confirmed", ...(before ? { before: toSignature(before) } : {}) }).send();
      return page.map((s) => ({ signature: String(s.signature), blockTime: s.blockTime === null ? null : Number(s.blockTime), err: s.err }));
    },
    enhanced: (sigs) => heliusParseTransactions(sigs, { timeoutMs: ENHANCED_TIMEOUT_MS }),
    fetchTx: fetchTransaction,
    // A null price makes bookSwap answer `unpriced`, which marks the wallet unchecked (never a silent "nothing missed"); a hung price never holds the run.
    priceUsd: (mint) => Promise.race([sharedPriceUsd(mint), new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_TIMEOUT_MS))]),
    stockMints,
    puller: (await pullerSigner()).address,
  };
}
