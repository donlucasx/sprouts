import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Repo } from "@/db/repo";
import { MemoryRepo } from "@/db/memory";
import type { HeliusEnhancedTx } from "@/lib/book-swap";
import type { ChainTx } from "@/lib/verify-swap";
import { checkMissedSwaps, LOOKBACK_S, MAX_PAGES, PAGE_SIZE, type SwapCheckReads, type SigInfo } from "@/lib/swap-check";
import fixtureJson from "../fixtures/helius-swap.json";

// Ops #9: the daily missed-swap check. Detection only: it reports, it never books.
const fixture = fixtureJson as unknown as HeliusEnhancedTx;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WALLET = "WALLETaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
const prices = async (m: string) => (m === "So11111111111111111111111111111111111111112" ? 150 : null);

const NOW = new Date("2026-11-14T12:00:00Z");
const nowS = Math.floor(NOW.getTime() / 1000);
const HOUR = 3600;

/** The fixture's $1.17 USDC -> BONK swap (83 cents of round-up), for `wallet`, at `ts`. */
function swapTx(sig: string, ts: number, wallet = WALLET, over: Partial<HeliusEnhancedTx> = {}): HeliusEnhancedTx {
  const s = JSON.stringify(fixture).replaceAll("\"WALLET\"", JSON.stringify(wallet));
  return { ...(JSON.parse(s) as HeliusEnhancedTx), signature: sig, timestamp: ts, ...over };
}
const bal = (wallet: string, accountIndex: number, mint: string, amount: string, decimals: number) => ({ accountIndex, mint, owner: wallet, uiTokenAmount: { amount, decimals } });
function chain(ts: number, wallet = WALLET, signer = true): ChainTx {
  return {
    blockTime: BigInt(ts),
    meta: { err: null, preBalances: [1_000_000_000n], postBalances: [999_995_000n], preTokenBalances: [bal(wallet, 1, USDC, "5000000", 6)], postTokenBalances: [bal(wallet, 1, USDC, "3830000", 6), bal(wallet, 2, BONK, "5200050000", 5)] },
    transaction: { message: { accountKeys: [{ pubkey: wallet, signer }] } },
  };
}

type World = { sigs: Map<string, SigInfo[]>; txs: Map<string, HeliusEnhancedTx>; chains: Map<string, ChainTx | null> };

function reads(w: World, over: Partial<SwapCheckReads> = {}): SwapCheckReads & { calls: { sig: number; enh: string[][]; tx: string[] } } {
  const calls = { sig: 0, enh: [] as string[][], tx: [] as string[] };
  return {
    calls,
    signatures: async (wallet, before) => {
      calls.sig++;
      const all = w.sigs.get(wallet) ?? [];
      const start = before ? all.findIndex((s) => s.signature === before) + 1 : 0;
      return all.slice(start, start + PAGE_SIZE);
    },
    enhanced: async (sigs) => { calls.enh.push(sigs); return sigs.flatMap((s) => (w.txs.has(s) ? [w.txs.get(s)!] : [])); },
    fetchTx: async (sig) => { calls.tx.push(sig); return w.chains.get(sig) ?? null; },
    priceUsd: prices,
    puller: "PULLER",
    ...over,
  };
}

let repo: MemoryRepo;
let world: World;

async function link(pubkey: string, user: string, linkedAt = new Date(NOW.getTime() - 10 * 86_400_000)) {
  await repo.upsertUser({ seedVaultPubkey: user, sgtMint: `M-${user}`, skrName: null });
  (await repo.addWallet({ pubkey, userPubkey: user, delegationPda: "D", dailyCapCents: 500 })).createdAt = linkedAt;
}
/** A swap on chain for the wallet: listed by getSignaturesForAddress, parsed by Helius, readable by getTransaction. */
function onChainSwap(sig: string, ts: number, wallet = WALLET) {
  const list = world.sigs.get(wallet) ?? [];
  list.push({ signature: sig, blockTime: ts, err: null });
  list.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  world.sigs.set(wallet, list);
  world.txs.set(sig, swapTx(sig, ts, wallet));
  world.chains.set(sig, chain(ts, wallet));
}
const run = (r: SwapCheckReads, over: { clock?: () => number; deadlineMs?: number; hardStopMs?: number; boundAt?: number; exclude?: Set<string>; repo?: Repo } = {}) =>
  checkMissedSwaps({ repo: over.repo ?? repo, now: NOW, reads: r, exclude: over.exclude ?? new Set(), deadlineMs: over.deadlineMs ?? Infinity, hardStopMs: over.hardStopMs ?? Infinity, boundAt: over.boundAt, clock: over.clock ?? (() => 0) });

/** Only these reads may be called on the repo during a check; anything else (any write, getRules' default insert) is recorded. */
const READS = new Set(["listActiveWallets", "getWallet", "listSwaps", "topUpKinds", "findRules"]);
function readOnly(r: MemoryRepo): { repo: Repo; other: string[] } {
  const other: string[] = [];
  const repo = new Proxy(r, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof v !== "function") return v;
      if (!READS.has(String(prop))) other.push(String(prop));
      return (v as (...x: unknown[]) => unknown).bind(target);
    },
  }) as unknown as Repo;
  return { repo, other };
}

beforeEach(async () => {
  repo = new MemoryRepo();
  world = { sigs: new Map(), txs: new Map(), chains: new Map() };
  await link(WALLET, "U");
});

afterEach(() => vi.useRealTimers());

describe("checkMissedSwaps", () => {
  it("is strictly read-only: only the listed reads are called (a user with no rules gets the defaults, nothing is written)", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const W2 = "SECONDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    await link(W2, "U2");
    onChainSwap("MISSED2222222222", nowS - 3 * HOUR, W2);
    onChainSwap("TOPUP11111111111", nowS - 4 * HOUR);
    await repo.addEvent({ userPubkey: "U", walletPubkey: WALLET, kind: "topup_sent", detail: { signature: "TOPUP11111111111" } });
    await repo.saveRules("U2", { roundupToCents: 500 });
    const rulesBefore = new Map((repo as unknown as { rules: Map<string, unknown> }).rules);
    const eventsBefore = repo.events.length;
    const ro = readOnly(repo);
    const out = await run(reads(world), { repo: ro.repo });
    expect(ro.other).toEqual([]);
    expect(out.missed.map((m) => [m.sig, m.roundupCents])).toEqual([["MISSED11", 83], ["MISSED22", 383]]);   // U: defaults (no row); U2: its own $5 rule
    expect((repo as unknown as { rules: Map<string, unknown> }).rules).toEqual(rulesBefore);   // no default rules row created for U
    expect(repo.events.length).toBe(eventsBefore);
    expect(await repo.unplantedSwaps(WALLET)).toEqual([]);
  });

  it("M1: a hung read is cut at the bound: wallets already concluded keep their result, the rest are deferred, never missed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const W2 = "SECONDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    await link(W2, "U2");
    onChainSwap("MISSED2222222222", nowS - 3 * HOUR, W2);
    const base = reads(world);
    const r = { ...base, enhanced: async (sigs: string[]) => (sigs.includes("MISSED2222222222") ? new Promise<never>(() => {}) : base.enhanced(sigs)) };
    const p = checkMissedSwaps({ repo, now: NOW, reads: r, exclude: new Set(), deadlineMs: Infinity, hardStopMs: Infinity, boundAt: Date.now() + 10_000 });
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ checked: 1, unchecked: [], deferred: 1, missed: [{ sig: "MISSED11" }] });
  });

  it("M1: cut at the bound before the wallet list was read: the step fails (null record), never a 0-wallet green", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repo.listActiveWallets = () => new Promise(() => {});
    const p = checkMissedSwaps({ repo, now: NOW, reads: reads(world), exclude: new Set(), deadlineMs: Infinity, hardStopMs: Infinity, boundAt: Date.now() + 1_000 });
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await caught).toMatch(/before the wallet list/);
  });

  it("reports a swap on chain that is not in swaps and that the chain check passes; books nothing", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const r = reads(world);
    const out = await run(r);
    expect(out.missed).toEqual([{ wallet: "WALL…aa1", sig: "MISSED11", ts: new Date((nowS - 5 * HOUR) * 1000).toISOString().slice(0, 16) + "Z", roundupCents: 83 }]);
    expect(out).toMatchObject({ checked: 1, unchecked: [], deferred: 0 });
    expect(await repo.unplantedSwaps(WALLET)).toEqual([]);   // detection only
    expect(r.calls.tx).toEqual(["MISSED1111111111"]);
  });

  it("a booked swap is filtered out BEFORE the enhanced call (no Helius parse, no getTransaction)", async () => {
    onChainSwap("BOOKED1111111111", nowS - 5 * HOUR);
    onChainSwap("SPAM111111111111", nowS - 6 * HOUR);
    world.txs.set("SPAM111111111111", { ...swapTx("SPAM111111111111", nowS - 6 * HOUR), tokenTransfers: [], events: {} });
    await repo.insertSwap({ signature: "BOOKED1111111111", walletPubkey: WALLET, ts: new Date((nowS - 5 * HOUR) * 1000), inMint: USDC, inAmount: 1, outMint: BONK, outAmount: 1, usdSizeCents: 117, class: "memecoin", roundupCents: 83 });
    const r = reads(world);
    const out = await run(r);
    expect(out.missed).toEqual([]);
    expect(out.checked).toBe(1);
    expect(r.calls.enh).toEqual([["SPAM111111111111"]]);
    expect(r.calls.tx).toEqual([]);
  });

  it("no unbooked signature: no enhanced call at all", async () => {
    const r = reads(world);
    expect((await run(r)).checked).toBe(1);
    expect(r.calls.enh).toEqual([]);
  });

  it("ignores swaps from before the wallet linked, older than the 48 h window, failed ones, and the last 15 minutes (webhook in flight)", async () => {
    repo = new MemoryRepo();
    await link(WALLET, "U", new Date((nowS - 10 * HOUR) * 1000));
    onChainSwap("PRELINK111111111", nowS - 20 * HOUR);
    onChainSwap("OLD1111111111111", nowS - LOOKBACK_S - HOUR);
    onChainSwap("FRESH11111111111", nowS - 60);
    onChainSwap("FAILED1111111111", nowS - 2 * HOUR);
    world.sigs.get(WALLET)!.find((s) => s.signature === "FAILED1111111111")!.err = { InstructionError: [0, "Custom"] };
    const r = reads(world);
    const out = await run(r);
    expect(out.missed).toEqual([]);
    expect(out.checked).toBe(1);
    expect(r.calls.enh.flat()).toEqual([]);
  });

  it("a page-cap hit marks the wallet unchecked (never 0 missed from a partial read) and spends no enhanced call", async () => {
    for (let i = 0; i < MAX_PAGES * PAGE_SIZE + 1; i++) onChainSwap(`SPAM${String(i).padStart(12, "0")}`, nowS - HOUR - i);
    onChainSwap("MISSED1111111111", nowS - 2 * HOUR);
    const r = reads(world);
    const out = await run(r);
    expect(out).toMatchObject({ checked: 0, missed: [], unchecked: [{ wallet: "WALL…aa1", why: "page_cap" }] });
    expect(r.calls.sig).toBe(MAX_PAGES);
    expect(r.calls.enh).toEqual([]);
  });

  it("pages past a full page when its last signature is still inside the window", async () => {
    for (let i = 0; i < PAGE_SIZE + 3; i++) onChainSwap(`S${String(i).padStart(15, "0")}`, nowS - HOUR - i * 60);
    const r = reads(world);
    const out = await run(r);
    expect(r.calls.sig).toBe(2);
    expect(out.checked).toBe(1);
    expect(out.missed).toHaveLength(PAGE_SIZE + 3);
  });

  it("a signature read error marks the wallet unchecked; the next wallet is still checked", async () => {
    const W2 = "SECONDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    await link(W2, "U2");
    onChainSwap("MISSED2222222222", nowS - 3 * HOUR, W2);
    const base = reads(world);
    const r = { ...base, signatures: async (w: string, b?: string) => { if (w === WALLET) throw new Error("429"); return base.signatures(w, b); } };
    const out = await run(r);
    expect(out.unchecked).toEqual([{ wallet: "WALL…aa1", why: "read_error" }]);
    expect(out.checked).toBe(1);
    expect(out.missed.map((m) => m.sig)).toEqual(["MISSED22"]);
  });

  it("an enhanced answer missing a signature marks the wallet unchecked (partial read)", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    onChainSwap("UNPARSED11111111", nowS - 6 * HOUR);
    world.txs.delete("UNPARSED11111111");
    const out = await run(reads(world));
    expect(out).toMatchObject({ checked: 0, missed: [], unchecked: [{ wallet: "WALL…aa1", why: "partial_read" }] });
  });

  it("a getTransaction that throws or finds nothing marks the wallet unchecked, not missed", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const r1 = reads(world, { fetchTx: async () => { throw new Error("rpc down"); } });
    expect(await run(r1)).toMatchObject({ checked: 0, missed: [], unchecked: [{ why: "read_error" }] });
    world.chains.set("MISSED1111111111", null);
    expect(await run(reads(world))).toMatchObject({ checked: 0, missed: [], unchecked: [{ why: "read_error" }] });
  });

  it("an unpriced swap (no stable leg, no price) marks the wallet unchecked, never silently checked with 0 missed", async () => {
    onChainSwap("UNPRICED1111111", nowS - 5 * HOUR);
    const UNK = "Unknown1111111111111111111111111111111111111";
    world.txs.set("UNPRICED1111111", JSON.parse(JSON.stringify(world.txs.get("UNPRICED1111111")).replaceAll(USDC, UNK)));
    const c = world.chains.get("UNPRICED1111111")!;
    const remint = (b: { mint: string }[]) => b.map((x) => ({ ...x, mint: x.mint === USDC ? UNK : x.mint }));
    world.chains.set("UNPRICED1111111", { ...c, meta: { ...c.meta!, preTokenBalances: remint(c.meta!.preTokenBalances as never) as never, postTokenBalances: remint(c.meta!.postTokenBalances as never) as never } });
    const out = await run(reads(world));
    expect(out).toMatchObject({ checked: 0, missed: [], unchecked: [{ wallet: "WALL…aa1", why: "price_unavailable" }] });
  });

  it("a swap the chain refuses (the wallet did not sign it) is not missed", async () => {
    onChainSwap("NOTMINE111111111", nowS - 5 * HOUR);
    world.chains.set("NOTMINE111111111", chain(nowS - 5 * HOUR, WALLET, false));
    expect(await run(reads(world))).toMatchObject({ checked: 1, missed: [] });
  });

  it("a Sprouts top-up and a puller-paid planting are not missed", async () => {
    onChainSwap("TOPUP11111111111", nowS - 5 * HOUR);
    await repo.addEvent({ userPubkey: "U", walletPubkey: WALLET, kind: "topup_sent", detail: { signature: "TOPUP11111111111" } });
    onChainSwap("PLANT11111111111", nowS - 6 * HOUR);
    world.txs.set("PLANT11111111111", swapTx("PLANT11111111111", nowS - 6 * HOUR, WALLET, { feePayer: "PULLER" }));
    const r = reads(world);
    expect(await run(r)).toMatchObject({ checked: 1, missed: [] });
    expect(r.calls.tx).toEqual([]);
  });

  it("excluded wallets (OPS_EXCLUDE_WALLETS, by wallet or user key) and paused wallets are not checked or counted", async () => {
    const W2 = "SECONDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    await link(W2, "TESTUSER");
    const W3 = "PAUSEDccccccccccccccccccccccccccccccccccccc3";
    await link(W3, "U3");
    await repo.setWalletStatus(W3, "paused");
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const r = reads(world);
    const out = await run(r, { exclude: new Set([WALLET, "TESTUSER"]) });
    expect(out).toMatchObject({ checked: 0, unchecked: [], deferred: 0, missed: [] });
    expect(r.calls.sig).toBe(0);
  });

  it("starts no wallet past the deadline: the rest are counted deferred, not checked and not missed", async () => {
    const W2 = "SECONDbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    await link(W2, "U2");
    onChainSwap("MISSED2222222222", nowS - 3 * HOUR, W2);
    let t = 0;
    const r = reads(world);
    const out = await run({ ...r, signatures: async (w, b) => { t = 100; return r.signatures(w, b); } }, { clock: () => t, deadlineMs: 50 });
    expect(out).toMatchObject({ checked: 1, deferred: 1 });
    expect(out.missed).toEqual([]);
  });

  it("a wallet still running at the hard stop is deferred, never concluded", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    let t = 0;
    const r = reads(world);
    const out = await run({ ...r, enhanced: async (s) => { t = 1_000; return r.enhanced(s); } }, { clock: () => t, deadlineMs: 500, hardStopMs: 900 });
    expect(out).toMatchObject({ checked: 0, deferred: 1, missed: [], unchecked: [] });
  });

  it("counts its Helius calls (free-tier load is visible in the run record)", async () => {
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    const out = await run(reads(world));
    expect(out.calls).toEqual({ signatures: 1, enhanced: 1, transactions: 1 });
  });

  it("the swaps table read is the user's swaps, so a capped read inside the window marks the wallet unchecked", async () => {
    const list = vi.spyOn(repo, "listSwaps").mockImplementation(async () => Array.from({ length: 1000 }, (_, i) => ({ signature: `B${i}`, walletPubkey: WALLET, ts: new Date((nowS - HOUR) * 1000) }) as never));
    onChainSwap("MISSED1111111111", nowS - 5 * HOUR);
    expect(await run(reads(world))).toMatchObject({ checked: 0, missed: [], unchecked: [{ why: "partial_read" }] });
    list.mockRestore();
  });
});
