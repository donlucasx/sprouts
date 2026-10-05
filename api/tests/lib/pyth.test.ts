import { describe, it, expect, vi, afterEach } from "vitest";
import { address, AccountRole, generateKeyPairSigner, getCompiledTransactionMessageDecoder, getTransactionEncoder, type Address } from "@solana/kit";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

const accounts = new Map<string, { data: Buffer; owner: string } | null>();
/** Optional per-account generator: the account as it is at the (possibly fake) current time. Wins over `accounts`. */
const live = new Map<string, () => { data: Buffer; owner: string } | null>();
let reads = 0;
let blockhashReads = 0;
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getAccountInfo: (a: string) => ({ send: async () => { reads++; const g = live.get(a); const v = g ? g() : accounts.get(a) ?? null; return { value: v ? { data: [v.data.toString("base64"), "base64"], owner: v.owner } : null }; } }),
  getLatestBlockhash: () => ({ send: async () => { blockhashReads++; return { value: { blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", lastValidBlockHeight: 100n } }; } }),
  getMinimumBalanceForRentExemption: (bytes: bigint) => ({ send: async () => (bytes + 128n) * 6_960n }),
}) }));
const cfg: { pythApiKey: string | undefined; heliusRpcUrl: string } = { pythApiKey: "test-key", heliusRpcUrl: "https://x" };
vi.mock("@/lib/config", () => ({ config: () => cfg }));

import { parsePriceUpdate, fetchHermesUpdate, toKitInstruction, buildPriceUpdate, priceRefusal, CONF_CAP_BPS, FRESH_MARGIN_S } from "@/lib/pyth";
import { priceSourceFor, buildPriceUpdate as reexported, LEG_SPEC, skrPriceSource, postedPriceRefusal } from "@/lib/leash";
import { PYTH_ACCOUNT, PYTH_FEED } from "@/lib/venues/addresses";

const RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
function priceUpdate(a: { feedId: string; price: bigint; conf: bigint; exponent: number; publishTime: number; full?: boolean }) {
  const b = Buffer.alloc(134);
  Buffer.from("22f123639d7ef4cd", "hex").copy(b, 0);
  b[40] = a.full === false ? 0 : 1;
  Buffer.from(a.feedId, "hex").copy(b, 41);
  b.writeBigInt64LE(a.price, 73);
  b.writeBigUInt64LE(a.conf, 81);
  b.writeInt32LE(a.exponent, 89);
  b.writeBigInt64LE(BigInt(a.publishTime), 93);
  return b;
}
const NOW = 1_791_200_000;

describe("PriceUpdateV2 (contracts 2.6 layout)", () => {
  it("reads feed id, price, conf, exponent, publish time and the Full flag", () => {
    const p = parsePriceUpdate(new Uint8Array(priceUpdate({ feedId: PYTH_FEED.SOL, price: 12_147_000_000n, conf: 10_000_000n, exponent: -8, publishTime: NOW })));
    expect(p).toEqual({ feedId: PYTH_FEED.SOL, price: 12_147_000_000n, conf: 10_000_000n, exponent: -8, publishTime: BigInt(NOW), full: true });
    expect(() => parsePriceUpdate(new Uint8Array(100))).toThrow(/134/);
  });
});

describe("priceSourceFor: the feed rule (contracts 1.4, AMEND 10-04 s20 R324: sponsored only, never post)", () => {
  afterEach(() => { accounts.clear(); live.clear(); });
  it("USDC lending has no price; SKR without PYTH_API_KEY has no source and throws, with it posts (contracts 10 item 15)", async () => {
    expect(await priceSourceFor(2, NOW)).toEqual({ kind: "none" });
    expect(await priceSourceFor(3, NOW)).toEqual({ kind: "none" });
    cfg.pythApiKey = undefined;
    await expect(priceSourceFor(0, NOW)).rejects.toThrow(/leg 0 \(SKR\) has no price source: PYTH_API_KEY is not set/);
    expect(skrPriceSource()).toBe(false);
    cfg.pythApiKey = "test-key";
    expect(skrPriceSource()).toBe(true);
    expect(await priceSourceFor(0, NOW)).toEqual({ kind: "post", feedId: PYTH_FEED.SKR });
    expect(reads).toBe(0);   // a post leg reads no sponsored account
  });
  it("SOL uses the sponsored account under 40 s; older, Partial, another feed or another owner throws (no post)", async () => {
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 39 }), owner: RECEIVER });
    expect(await priceSourceFor(6, NOW)).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.SOL });
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 40 }), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/40 s old/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 5, full: false }), owner: RECEIVER });
    await expect(priceSourceFor(4, NOW)).rejects.toThrow(/Full/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.CBBTC, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 5 }), owner: RECEIVER });
    await expect(priceSourceFor(5, NOW)).rejects.toThrow(/holds feed 2817d7bf, not the pinned SOL feed/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 5 }), owner: "11111111111111111111111111111111" });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/is owned by 11111111111111111111111111111111, not the Pyth receiver/);
  });
  it("T8 minors: each cause has its own message (missing, wrong owner, not Full, RPC error, stale) so the run's log tells them apart", async () => {
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/7UVimffx\w+ is missing \(leg 6 skips this run\)/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 5, full: false }), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/is not Full \(partial verification\)/);
    live.set(PYTH_ACCOUNT.SOL, () => { throw new Error("fetch failed: 429 Too Many Requests"); });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/^RPC error reading the sponsored SOL account .*429/);
    live.clear();
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 45 }), owner: RECEIVER });
    const stale = await priceSourceFor(6, NOW).catch((e: Error) => e.message);
    expect(stale).toMatch(/45 s old/);
    expect(stale).not.toMatch(/RPC error|missing|owned by|Full/);
  });
  it("T8 carry: the on-chain max_age_s and conf_cap_bps (readLeashConfig) override the shipped defaults", async () => {
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 10_000n, conf: 150n, exponent: -8, publishTime: NOW - 45 }), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/45 s old \(usable under 40 s\)/);
    await expect(priceSourceFor(6, NOW, 60, { maxAgeS: 120 })).rejects.toThrow(/confidence 150 is over 100 bps/);
    expect(await priceSourceFor(6, NOW, 60, { maxAgeS: 120, confCapBps: 200 })).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.SOL });
    await expect(priceSourceFor(6, NOW, 60, { maxAgeS: 60, confCapBps: 200 })).rejects.toThrow(/usable under 40 s/);
  });
  it("cbBTC uses its sponsored account under 580 s (max_age_s 600, R324)", async () => {
    accounts.set(PYTH_ACCOUNT.CBBTC, { data: priceUpdate({ feedId: PYTH_FEED.CBBTC, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 288 }), owner: RECEIVER });
    expect(await priceSourceFor(7, NOW)).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.CBBTC });
    accounts.set(PYTH_ACCOUNT.CBBTC, { data: priceUpdate({ feedId: PYTH_FEED.CBBTC, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 580 }), owner: RECEIVER });
    await expect(priceSourceFor(7, NOW)).rejects.toThrow(/580 s old/);
  });
  it("ORE (leg 1) reads its own sponsored account with the 40 s window", async () => {
    accounts.set(PYTH_ACCOUNT.ORE, { data: priceUpdate({ feedId: PYTH_FEED.ORE, price: 50_000_000_000n, conf: 0n, exponent: -8, publishTime: NOW - 10 }), owner: RECEIVER });
    expect(await priceSourceFor(1, NOW)).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.ORE });
    expect(LEG_SPEC[1].maxAgeS - FRESH_MARGIN_S).toBe(40);
    expect(LEG_SPEC[7].maxAgeS - FRESH_MARGIN_S).toBe(580);
  });
  it("a missing account, a wrong length or a wrong discriminator throws", async () => {
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/is missing/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: Buffer.alloc(100), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/134/);
    const bad = priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 5 });
    bad[0] ^= 1;
    accounts.set(PYTH_ACCOUNT.SOL, { data: bad, owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/PriceUpdateV2/);
  });
});

describe("priceRefusal: the program's read_price checks after the layout (price.rs, contracts 2.6)", () => {
  const p = (price: bigint, conf: bigint, exponent = -8) => ({ feedId: PYTH_FEED.SOL, price, conf, exponent, publishTime: BigInt(NOW), full: true });
  it("the conf cap is 100 bps (contracts 2.3), the value the API writes into every leg's config", () => {
    expect(CONF_CAP_BPS).toBe(100);
  });
  it("accepts a positive price inside the cap; conf exactly at the cap passes (program: conf*10000 > price*cap refuses)", () => {
    expect(priceRefusal(p(10_000n, 0n))).toBeNull();
    expect(priceRefusal(p(10_000n, 100n))).toBeNull();
  });
  it("refuses one unit over the cap, a non-positive price, an exponent outside -12..0 and p_low <= 0", () => {
    expect(priceRefusal(p(10_000n, 101n))).toMatch(/confidence/);
    expect(priceRefusal(p(0n, 0n))).toMatch(/^price 0 is not positive/);
    expect(priceRefusal(p(-5n, 0n))).toMatch(/^price -5 is not positive/);
    expect(priceRefusal(p(10_000n, 0n, -13))).toMatch(/exponent/);
    expect(priceRefusal(p(10_000n, 0n, 1))).toMatch(/exponent/);
    expect(priceRefusal(p(1n, 1n), 10_000)).toMatch(/p_low/);
  });
  it("priceSourceFor skips a leg whose sponsored price the program would refuse (no wait in test mode)", async () => {
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 10_000n, conf: 101n, exponent: -8, publishTime: NOW - 5 }), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/confidence/);
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 0n, conf: 0n, exponent: -8, publishTime: NOW - 5 }), owner: RECEIVER });
    await expect(priceSourceFor(6, NOW)).rejects.toThrow(/price 0 is not positive/);
    accounts.clear();
  });
});

/**
 * The wait, against the gaps measured by API Task 0 S4 (10-04 17:56-18:25 PDT): SOL and ORE update every 50-55 s (max age 55 s),
 * cbBTC every ~270 s (max age 280 s). A feed that updates every `gapS` seconds, starting at `t0`, is simulated under fake timers.
 */
describe("priceSourceFor: waiting for the next sponsored update (measured gaps)", () => {
  afterEach(() => { vi.useRealTimers(); live.clear(); reads = 0; });
  const T0 = NOW * 1000;
  function feed(acct: Address, feedId: string, a: { lastUpdateS: number; gapS: number; stallAfterS?: number }) {
    live.set(acct, () => {
      const t = Math.floor(Date.now() / 1000);
      let pub = a.lastUpdateS;
      while (pub + a.gapS <= t && (a.stallAfterS === undefined || pub + a.gapS <= a.stallAfterS)) pub += a.gapS;
      return { data: priceUpdate({ feedId, price: 15_000_000_000n, conf: 5_000_000n, exponent: -8, publishTime: pub }), owner: RECEIVER };
    });
  }
  /** Settles the call and stamps WHEN it settled (fake time), so the wait is measured, not the time the test advanced. */
  const settle = <T,>(pr: Promise<T>) => pr.then((v) => ({ v, e: null as Error | null, waitedMs: Date.now() - T0 }), (e: Error) => ({ v: null, e, waitedMs: Date.now() - T0 }));

  it("SOL at 54 s old (55 s gap) waits about 1 s for the next update, then uses the sponsored account", async () => {
    vi.useFakeTimers({ now: T0 });
    feed(PYTH_ACCOUNT.SOL, PYTH_FEED.SOL, { lastUpdateS: NOW - 54, gapS: 55 });
    const r = settle(priceSourceFor(6));
    await vi.advanceTimersByTimeAsync(4_000);
    const out = await r;
    expect(out.e).toBeNull();
    expect(out.v).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.SOL });
    expect(out.waitedMs).toBeLessThanOrEqual(2_000);   // one 2 s poll
  });
  it("SOL just past the window (41 s, 55 s gap) waits ~14 s, well inside the 60 s budget", async () => {
    vi.useFakeTimers({ now: T0 });
    feed(PYTH_ACCOUNT.SOL, PYTH_FEED.SOL, { lastUpdateS: NOW - 41, gapS: 55 });
    const r = settle(priceSourceFor(5));
    await vi.advanceTimersByTimeAsync(20_000);
    const out = await r;
    expect(out.v).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.SOL });
    expect(out.waitedMs).toBeGreaterThanOrEqual(14_000);
    expect(out.waitedMs).toBeLessThanOrEqual(16_000);
  });
  it("ORE at the slowest measured gap (55 s, just updated at 40 s old) never needs more than 16 s", async () => {
    for (const age of [40, 45, 50, 54]) {
      vi.useFakeTimers({ now: T0 });
      feed(PYTH_ACCOUNT.ORE, PYTH_FEED.ORE, { lastUpdateS: NOW - age, gapS: 55 });
      const r = settle(priceSourceFor(1));
      await vi.advanceTimersByTimeAsync(60_000);
      const out = await r;
      expect(out.v).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.ORE });
      expect(out.waitedMs).toBeLessThanOrEqual(16_000);
      vi.useRealTimers();
    }
  });
  it("a stalled SOL feed (no update for 60 s more) is polled every 2 s, then the leg skips with the age", async () => {
    vi.useFakeTimers({ now: T0 });
    feed(PYTH_ACCOUNT.SOL, PYTH_FEED.SOL, { lastUpdateS: NOW - 45, gapS: 55, stallAfterS: NOW });
    const r = settle(priceSourceFor(6));
    await vi.advanceTimersByTimeAsync(70_000);
    const out = await r;
    expect(out.v).toBeNull();
    expect(out.e!.message).toMatch(/s old \(usable under 40 s\): leg 6 skips this run/);
    expect(out.waitedMs).toBeLessThanOrEqual(60_000);
    expect(reads).toBeGreaterThanOrEqual(29);   // 0 s, 2 s, ..., 58 s
    expect(reads).toBeLessThanOrEqual(31);
  });
  it("cbBTC at its oldest measured age (280 s, ~270 s gap) is used at once, no wait", async () => {
    vi.useFakeTimers({ now: T0 });
    feed(PYTH_ACCOUNT.CBBTC, PYTH_FEED.CBBTC, { lastUpdateS: NOW - 280, gapS: 290 });
    const out = await settle(priceSourceFor(7));
    expect(out.v).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.CBBTC });
    expect(out.waitedMs).toBe(0);
    expect(reads).toBe(1);
  });
  it("T8 minor: a fresh price the program would REFUSE (conf over the cap) is waited on, and used once the next update is acceptable", async () => {
    vi.useFakeTimers({ now: T0 });
    live.set(PYTH_ACCOUNT.SOL, () => {
      const t = Math.floor(Date.now() / 1000);
      // a wide-confidence print at NOW - 5, replaced by a tight one 7 s later
      const tight = t >= NOW + 7;
      return { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 15_000_000_000n, conf: tight ? 5_000_000n : 900_000_000n, exponent: -8, publishTime: tight ? NOW + 7 : NOW - 5 }), owner: RECEIVER };
    });
    const r = settle(priceSourceFor(6));
    await vi.advanceTimersByTimeAsync(12_000);
    const out = await r;
    expect(out.e).toBeNull();
    expect(out.v).toEqual({ kind: "sponsored", account: PYTH_ACCOUNT.SOL });
    expect(out.waitedMs).toBeGreaterThanOrEqual(7_000);
    expect(out.waitedMs).toBeLessThanOrEqual(8_000);
    expect(reads).toBe(5);   // 0, 2, 4, 6 s refused; 8 s accepted
  });
  it("a refused value that never clears skips the leg after the wait, naming the refusal (not the age)", async () => {
    vi.useFakeTimers({ now: T0 });
    live.set(PYTH_ACCOUNT.SOL, () => ({ data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 15_000_000_000n, conf: 900_000_000n, exponent: -8, publishTime: Math.floor(Date.now() / 1000) - 1 }), owner: RECEIVER }));
    const r = settle(priceSourceFor(6, undefined, 10));
    await vi.advanceTimersByTimeAsync(20_000);
    const out = await r;
    expect(out.e!.message).toMatch(/confidence 900000000 is over 100 bps.*leg 6 skips this run/);
    expect(out.waitedMs).toBeLessThanOrEqual(10_000);
  });
  it("a Partial or wrong-feed account fails at once, without waiting (the next update will not fix it)", async () => {
    vi.useFakeTimers({ now: T0 });
    accounts.set(PYTH_ACCOUNT.SOL, { data: priceUpdate({ feedId: PYTH_FEED.SOL, price: 1n, conf: 0n, exponent: -8, publishTime: NOW - 50, full: false }), owner: RECEIVER });
    const out = await settle(priceSourceFor(6));
    expect(out.e!.message).toMatch(/Full/);
    expect(out.waitedMs).toBe(0);
    accounts.clear();
  });
});

// A real Hermes answer for SKR, recorded 10-05 with the crypto-entitled key (spikes/hermes-fixture.ts): a 292-byte VAA with 3
// signatures from guardian set 1, one price update with a 12-hash proof.
const HERMES_SKR = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/hermes-skr-update.json"), "utf8")) as { binary: { data: string[] }; parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[] };
const SKR_PUBLISH = HERMES_SKR.parsed[0].price.publish_time;
const WORMHOLE = "HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ";
const SYSTEM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const anchorDisc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
const hermesWith = (over: Partial<{ price: string; conf: string }> = {}) => vi.fn(async () => new Response(JSON.stringify({ ...HERMES_SKR, parsed: [{ ...HERMES_SKR.parsed[0], price: { ...HERMES_SKR.parsed[0].price, ...over } }] })));
/** Each signed pre-tx decompiled: its fee payer, signers, and per instruction the program, the data's first 8 bytes and the accounts. */
function decode(tx: { messageBytes: ArrayLike<number> }) {
  const m = getCompiledTransactionMessageDecoder().decode(Uint8Array.from(tx.messageBytes)) as unknown as { header: { numSignerAccounts: number }; staticAccounts: string[]; instructions: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[] };
  return { payer: m.staticAccounts[0], signers: m.staticAccounts.slice(0, m.header.numSignerAccounts),
    ixs: m.instructions.map((i) => ({ program: m.staticAccounts[i.programAddressIndex], disc: Buffer.from(i.data ?? []).subarray(0, 8).toString("hex"), data: Buffer.from(i.data ?? []), accounts: (i.accountIndices ?? []).map((x) => m.staticAccounts[x]) })) };
}

describe("postedPriceRefusal: the re-read posted account, judged like read_price (leg 0)", () => {
  const ok = { feedId: PYTH_FEED.SKR, price: 1_830_000n, conf: 1_216n, exponent: -8, publishTime: BigInt(NOW - 1), full: true };
  it("null when usable; names each refusal; honours the on-chain max age and cap", () => {
    expect(postedPriceRefusal(0, ok, {}, NOW)).toBeNull();
    expect(postedPriceRefusal(0, { ...ok, full: false }, {}, NOW)).toMatch(/not Full/);
    expect(postedPriceRefusal(0, { ...ok, feedId: PYTH_FEED.SOL }, {}, NOW)).toMatch(/not the pinned SKR feed/);
    expect(postedPriceRefusal(0, { ...ok, publishTime: BigInt(NOW - 40) }, {}, NOW)).toBe("is 40 s old (usable under 40 s)");
    expect(postedPriceRefusal(0, { ...ok, publishTime: BigInt(NOW - 40) }, { maxAgeS: 90 }, NOW)).toBeNull();
    expect(postedPriceRefusal(0, ok, { confCapBps: 1 }, NOW)).toMatch(/confidence .* over 1 bps/);
    expect(postedPriceRefusal(2, ok, {}, NOW)).toMatch(/no feed/);
  });
});

describe("buildPriceUpdate: a posted SKR price (contracts 3.2 row 2b, 10 item 15; the receiver SDK 0.16.0)", () => {
  afterEach(() => { vi.unstubAllGlobals(); cfg.pythApiKey = "test-key"; blockhashReads = 0; });
  it("the VAA write + verify, then post_update into a fresh account and the VAA's close, in puller-signed pre-txs under 1,232 B", async () => {
    vi.stubGlobal("fetch", hermesWith());
    const puller = await generateKeyPairSigner();
    const u = await buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 1 });
    // The price is Hermes's parse; the planting re-reads the posted account before it trusts it.
    const p = HERMES_SKR.parsed[0].price;
    expect(u.price).toEqual({ feedId: PYTH_FEED.SKR, price: BigInt(p.price), conf: BigInt(p.conf), exponent: p.expo, publishTime: BigInt(p.publish_time), full: true });
    // Measured (10-05): post_update does not fit in the leashed SKR planting (about 871 B + 64 B signature + 96 B accounts + ~340 B data), so it rides the pre-txs.
    expect(u.postIx).toBeNull();
    expect(u.preTxs.length).toBe(2);
    expect(u.preTxBytes).toEqual(u.preTxs.map((t) => getTransactionEncoder().encode(t).length));
    for (const n of u.preTxBytes) expect(n).toBeLessThanOrEqual(1232);
    const txs = u.preTxs.map(decode);
    for (const t of txs) expect(t.payer).toBe(puller.address);
    for (const t of u.preTxs) for (const sig of Object.values(t.signatures)) expect(sig).not.toBeNull();   // every signer signed
    const flat = txs.flatMap((t) => t.ixs.filter((i) => i.program !== COMPUTE_BUDGET));
    expect(flat.map((i) => i.program === SYSTEM ? "create" : `${i.program === WORMHOLE ? "wormhole" : i.program === RECEIVER ? "receiver" : i.program}:${i.disc}`)).toEqual([
      "create", `wormhole:${anchorDisc("init_encoded_vaa")}`, `wormhole:${anchorDisc("write_encoded_vaa")}`, `wormhole:${anchorDisc("verify_encoded_vaa_v1")}`,
      `receiver:${anchorDisc("post_update")}`, `wormhole:${anchorDisc("close_encoded_vaa")}`,
    ]);
    const [create, , , verify, post, closeVaa] = flat;
    const encodedVaa = create.accounts[1];
    // Full verification: verify_encoded_vaa_v1 against the guardian set the VAA names, then post_update reads that verified account.
    expect(verify.accounts).toContain(encodedVaa);
    expect(post.accounts).toContain(encodedVaa);
    expect(post.accounts).toContain(u.account);
    expect(post.accounts[0]).toBe(puller.address);   // the puller pays and is the write authority
    expect(post.data[post.data.length - 1]).toBe(0);   // treasury 0 (DEFAULT_TREASURY_ID): one stable address, never random
    expect(closeVaa.accounts).toContain(encodedVaa);
    // Each tx's CU limit covers its instructions' budgets (verify alone is 350k).
    const verifyTx = txs.find((t) => t.ixs.some((i) => i.disc === anchorDisc("verify_encoded_vaa_v1")))!;
    const cuLimit = verifyTx.ixs.find((i) => i.program === COMPUTE_BUDGET && i.data[0] === 2)!.data.readUInt32LE(1);
    expect(cuLimit).toBeGreaterThanOrEqual(350_000);
    // The fresh price account signs its own creation; the VAA account signs its own; nothing else but the puller.
    expect(txs.flatMap((t) => t.signers).sort()).toEqual([puller.address, puller.address, encodedVaa, u.account].sort());
    // After the planting: reclaim the price account's rent (the VAA is already closed in the pre-txs).
    expect(u.closeIxs.map((i) => [i.programAddress, Buffer.from(i.data!).subarray(0, 8).toString("hex")])).toEqual([[RECEIVER, anchorDisc("reclaim_rent")]]);
    expect(u.closeIxs[0].accounts!.map((a) => a.address)).toContain(u.account);
    // If a pre-tx fails midway: close the VAA account and reclaim the price account, each on its own (either may not exist).
    expect(u.rescueIxs.map((i) => Buffer.from(i.data!).subarray(0, 8).toString("hex"))).toEqual([anchorDisc("close_encoded_vaa"), anchorDisc("reclaim_rent")]);
  });
  it("a price that is already maxAgeS - FRESH_MARGIN_S old is refused before anything is built (no blockhash read)", async () => {
    vi.stubGlobal("fetch", hermesWith());
    const puller = await generateKeyPairSigner();
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 60 - FRESH_MARGIN_S })).rejects.toThrow(/Hermes SKR price is 40 s old \(usable under 40 s\)/);
    expect((await buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 39 })).preTxs.length).toBe(2);
    // the on-chain max_age_s is honoured when given
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 25, maxAgeS: 45 })).rejects.toThrow(/25 s old \(usable under 25 s\)/);
    blockhashReads = 0;
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 50 })).rejects.toThrow(/old/);
    expect(blockhashReads).toBe(0);
  });
  it("a price the program would refuse (the conf cap) is refused before anything is built", async () => {
    vi.stubGlobal("fetch", hermesWith({ conf: String(BigInt(HERMES_SKR.parsed[0].price.price) / 50n) }));   // 200 bps > 100
    const puller = await generateKeyPairSigner();
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 1 })).rejects.toThrow(/confidence .* is over 100 bps/);
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR, nowS: SKR_PUBLISH + 1, confCapBps: 300 })).resolves.toBeDefined();
  });
  it("an answer for another feed is refused (the leg pins its feed id)", async () => {
    vi.stubGlobal("fetch", hermesWith());
    const puller = await generateKeyPairSigner();
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.CBBTC, nowS: SKR_PUBLISH + 1 })).rejects.toThrow(/Hermes answered feed 38846ec4 for 2817d7bf/);
  });
  it("without PYTH_API_KEY nothing is fetched; leash re-exports the same function", async () => {
    cfg.pythApiKey = undefined;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(buildPriceUpdate({ puller: await generateKeyPairSigner(), feedId: PYTH_FEED.SKR })).rejects.toThrow(/PYTH_API_KEY/);
    expect(f).not.toHaveBeenCalled();
    expect(reexported).toBe(buildPriceUpdate);
  });
});

describe("Hermes (Bearer auth; measured 10-04: x-api-key answers 401)", () => {
  afterEach(() => { vi.unstubAllGlobals(); cfg.pythApiKey = "test-key"; });
  it("asks with Authorization: Bearer and returns the base64 updates plus the parsed price", async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      headers = init.headers;
      return new Response(JSON.stringify({ binary: { encoding: "base64", data: ["AAAA"] }, parsed: [{ id: PYTH_FEED.CBBTC, price: { price: "6200000000000", conf: "1000000000", expo: -8, publish_time: NOW } }] }));
    }));
    const u = await fetchHermesUpdate(PYTH_FEED.CBBTC);
    expect(headers.authorization).toBe("Bearer test-key");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(u.data).toEqual(["AAAA"]);
    expect(u.price).toEqual({ feedId: PYTH_FEED.CBBTC, price: 6_200_000_000_000n, conf: 1_000_000_000n, exponent: -8, publishTime: BigInt(NOW), full: true });
  });
  it("a 403 (no entitlement) throws with the status, so that leg skips the day", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not entitled: feed", { status: 403 })));
    await expect(fetchHermesUpdate(PYTH_FEED.SKR)).rejects.toThrow(/403/);
  });
  it("without PYTH_API_KEY it throws before any request (the key is optional since R324)", async () => {
    cfg.pythApiKey = undefined;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fetchHermesUpdate(PYTH_FEED.SKR)).rejects.toThrow(/PYTH_API_KEY/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("toKitInstruction (web3.js -> kit bridge for the Pyth SDK)", () => {
  it("maps signer and writable flags to roles and attaches the ephemeral signer", async () => {
    const eph = Keypair.generate();
    const puller = await generateKeyPairSigner();
    const ix = new TransactionInstruction({ programId: new PublicKey(RECEIVER), keys: [
      { pubkey: new PublicKey(puller.address), isSigner: true, isWritable: true },
      { pubkey: eph.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(PYTH_ACCOUNT.SOL), isSigner: false, isWritable: false },
    ], data: Buffer.from([1, 2, 3]) });
    const eSigner = { address: address(eph.publicKey.toBase58()) } as never;
    const k = toKitInstruction(ix, new Map([[puller.address as string, puller], [eph.publicKey.toBase58(), eSigner]]));
    expect(k.programAddress).toBe(RECEIVER);
    expect(k.accounts!.map((a) => a.role)).toEqual([AccountRole.WRITABLE_SIGNER, AccountRole.WRITABLE_SIGNER, AccountRole.READONLY]);
    expect((k.accounts![1] as { signer?: unknown }).signer).toBe(eSigner);
    expect(Array.from(k.data!)).toEqual([1, 2, 3]);
  });
});
