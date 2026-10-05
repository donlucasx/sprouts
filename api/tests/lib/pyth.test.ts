import { describe, it, expect, vi, afterEach } from "vitest";
import { address, AccountRole, generateKeyPairSigner, type Address } from "@solana/kit";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

const accounts = new Map<string, { data: Buffer; owner: string } | null>();
/** Optional per-account generator: the account as it is at the (possibly fake) current time. Wins over `accounts`. */
const live = new Map<string, () => { data: Buffer; owner: string } | null>();
let reads = 0;
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getAccountInfo: (a: string) => ({ send: async () => { reads++; const g = live.get(a); const v = g ? g() : accounts.get(a) ?? null; return { value: v ? { data: [v.data.toString("base64"), "base64"], owner: v.owner } : null }; } }) }) }));
const cfg: { pythApiKey: string | undefined; heliusRpcUrl: string } = { pythApiKey: "test-key", heliusRpcUrl: "https://x" };
vi.mock("@/lib/config", () => ({ config: () => cfg }));

import { parsePriceUpdate, fetchHermesUpdate, toKitInstruction, buildPriceUpdate, priceRefusal, CONF_CAP_BPS, FRESH_MARGIN_S } from "@/lib/pyth";
import { priceSourceFor, buildPriceUpdate as reexported, LEG_SPEC } from "@/lib/leash";
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
  it("USDC lending has no price; SKR has no source and throws", async () => {
    expect(await priceSourceFor(2, NOW)).toEqual({ kind: "none" });
    expect(await priceSourceFor(3, NOW)).toEqual({ kind: "none" });
    await expect(priceSourceFor(0, NOW)).rejects.toThrow(/SKR/);
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

describe("posting is deferred (R324)", () => {
  it("buildPriceUpdate throws, and leash re-exports the same function", async () => {
    const puller = await generateKeyPairSigner();
    await expect(buildPriceUpdate({ puller, feedId: PYTH_FEED.SKR })).rejects.toThrow(/deferred/);
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
