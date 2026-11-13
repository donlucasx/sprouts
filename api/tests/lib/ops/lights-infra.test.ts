import { describe, it, expect } from "vitest";
import { swapWatchingLight, swapsArrivingLight, pricesLight, gasLight, programLight, supportLight, PYTH_ACCESS_ENDS } from "@/lib/ops/lights";

const H = 3_600_000;
const NOW = new Date("2026-11-12T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const W = (n: number) => `Fake${n}Wallet1111111111111111111111111111111`;

describe("PYTH_ACCESS_ENDS", () => {
  it("is 2026-12-31T23:59:59Z", () => expect(PYTH_ACCESS_ENDS.toISOString()).toBe("2026-12-31T23:59:59.000Z"));
});

describe("swapWatchingLight", () => {
  it("green: all covered", () => {
    const l = swapWatchingLight({ linked: [W(1), W(2)], onWebhook: [W(1), W(2), W(3)] });
    expect(l.state).toBe("green");
    expect(l.key).toBe("swapWatching");
  });
  it("red: 1 missing, count only, no address", () => {
    const l = swapWatchingLight({ linked: [W(1), W(2)], onWebhook: [W(1)] });
    expect(l.state).toBe("red");
    expect(l.fact).toBe("1 linked wallet is not being watched; its swaps will be missed");
    expect(l.action).toBe("Ask Claude to re-add them.");
    expect(l.fact).not.toContain("Fake");
  });
  it("red: plural", () => {
    expect(swapWatchingLight({ linked: [W(1), W(2)], onWebhook: [] }).fact).toBe("2 linked wallets are not being watched; their swaps will be missed");
  });
  it("duplicate linked entries count once", () => {
    expect(swapWatchingLight({ linked: [W(1), W(1)], onWebhook: [] }).fact).toBe("1 linked wallet is not being watched; its swaps will be missed");
  });
  it("info: nothing linked is not a health claim", () => {
    expect(swapWatchingLight({ linked: [], onWebhook: [] }).state).toBe("info");
  });
});

describe("swapsArrivingLight", () => {
  const l = (o: Partial<Parameters<typeof swapsArrivingLight>[0]>) => swapsArrivingLight({ now: NOW, linkedCount: 3, lastSwapAt: ago(2 * H), unpriced24h: 0, ...o });
  it("info when 0 linked", () => expect(l({ linkedCount: 0, lastSwapAt: null }).state).toBe("info"));
  it("green at 2 h", () => {
    const r = l({});
    expect(r.state).toBe("green");
    expect(r.key).toBe("swapsArriving");
  });
  it("boundary: exactly 24 h green, 24 h + 1 ms amber", () => {
    expect(l({ lastSwapAt: ago(24 * H) }).state).toBe("green");
    expect(l({ lastSwapAt: ago(24 * H + 1) }).state).toBe("amber");
  });
  it("amber at 30 h", () => expect(l({ lastSwapAt: ago(30 * H) }).state).toBe("amber"));
  it("boundary: exactly 72 h amber, 72 h + 1 ms red", () => {
    expect(l({ lastSwapAt: ago(72 * H) }).state).toBe("amber");
    expect(l({ lastSwapAt: ago(72 * H + 1) }).state).toBe("red");
  });
  it("red at 80 h with 3 linked", () => expect(l({ lastSwapAt: ago(80 * H) }).state).toBe("red"));
  it("red: never a swap while wallets are linked", () => expect(l({ lastSwapAt: null }).state).toBe("red"));
  it("amber: unpriced shown with count", () => {
    const r = l({ unpriced24h: 2 });
    expect(r.state).toBe("amber");
    expect(r.fact).toContain("2 swaps are missing a dollar value");
    expect(r.action).toBeTruthy();
  });
  it("red keeps its state with unpriced", () => expect(l({ lastSwapAt: ago(80 * H), unpriced24h: 2 }).state).toBe("red"));
  it("green fact has no unpriced noise", () => expect(l({}).fact).toBe("Last swap 2 h ago"));
  it("future swap timestamp is unknown, not fresh", () => expect(l({ lastSwapAt: new Date(NOW.getTime() + H) }).state).toBe("unknown"));
});

describe("pricesLight", () => {
  type F = Parameters<typeof pricesLight>[0]["feeds"][number];
  const sol = (s: number): F => ({ name: "SOL", publishTime: ago(s * 1000), maxAgeS: 60 });
  const btc = (s: number): F => ({ name: "cbBTC", publishTime: ago(s * 1000), maxAgeS: 600 });
  const ore = (s: number): F => ({ name: "ORE", publishTime: ago(s * 1000), maxAgeS: 60 });
  const p = (feeds: F[], skr: "ok" | "failed" | "no-key" = "ok", accessEnds = PYTH_ACCESS_ENDS) => pricesLight({ now: NOW, feeds, skr, accessEnds });

  it("green: SOL 30 s, cbBTC 500 s, skr ok", () => {
    const r = p([sol(30), btc(500)]);
    expect(r.state).toBe("green");
    expect(r.key).toBe("prices");
  });
  it("boundary: SOL exactly 60 s green, 61 s amber", () => {
    expect(p([sol(60)]).state).toBe("green");
    expect(p([sol(61)]).state).toBe("amber");
  });
  it("amber SOL 90 s", () => expect(p([sol(90)]).state).toBe("amber"));
  it("boundary: exactly 15 min amber, 15 min + 1 s red", () => {
    expect(p([ore(900)]).state).toBe("amber");
    expect(p([ore(901)]).state).toBe("red");
  });
  it("red: ORE 16 min", () => expect(p([sol(10), ore(960)]).state).toBe("red"));
  it("red beats unknown and amber", () => expect(p([sol(90), ore(960)], "failed").state).toBe("red"));
  it("skr failed is red", () => expect(p([sol(10)], "failed").state).toBe("red"));
  it("skr no-key is not red and the fact does not claim it was checked", () => {
    const r = p([sol(10)], "no-key");
    expect(r.state).not.toBe("red");
    expect(r.fact).toContain("SKR price checks are off");
    expect(r.fact).not.toMatch(/SKR ok/);
  });
  it("empty feeds: unknown, never green", () => expect(p([]).state).toBe("unknown"));
  it("publish time up to 60 s ahead reads as age 0", () => expect(p([{ name: "SOL", publishTime: new Date(NOW.getTime() + 60_000), maxAgeS: 60 }]).state).toBe("green"));
  it("publish time more than 60 s ahead is unknown", () => expect(p([{ name: "SOL", publishTime: new Date(NOW.getTime() + 61_000), maxAgeS: 60 }]).state).toBe("unknown"));
  it("fact always has the days left", () => {
    const r = p([sol(10)]);
    const days = Math.ceil((PYTH_ACCESS_ENDS.getTime() - NOW.getTime()) / (24 * H));
    expect(r.fact).toContain(`Free price data ends in ${days} days (Dec 31)`);
    expect(p([]).fact).toContain("Free price data ends in");
    expect(p([sol(10)], "failed").fact).toContain("Free price data ends in");
  });
  it("days left floors at 0", () => expect(p([sol(10)], "ok", new Date("2026-01-01T00:00:00Z")).fact).toContain("Free price data ends in 0 days (Jan 1)"));
  it("names the stale feed", () => expect(p([sol(10), ore(960)]).fact).toContain("ORE"));
});

describe("gasLight", () => {
  const g = (sol: number) => gasLight({ lamports: BigInt(Math.round(sol * 1e9)) });
  it("green 0.6", () => {
    expect(g(0.6).state).toBe("green");
    expect(g(0.6).key).toBe("gas");
  });
  it("boundary: exactly 0.5 SOL amber, just above green", () => {
    expect(g(0.5).state).toBe("amber");
    expect(gasLight({ lamports: 500_000_001n }).state).toBe("green");
  });
  it("amber 0.3", () => expect(g(0.3).state).toBe("amber"));
  it("boundary: exactly 0.1 SOL amber, just below red", () => {
    expect(g(0.1).state).toBe("amber");
    expect(gasLight({ lamports: 99_999_999n }).state).toBe("red");
  });
  it("red 0.05", () => expect(g(0.05).state).toBe("red"));
  it("fact shows the balance", () => {
    expect(g(0.3).fact).toBe("The wallet that pays network fees holds 0.300 SOL");
    expect(g(0.3).label).toBe("Network fee wallet");
  });
});

describe("programLight", () => {
  const e = [true, true, false, true, true, true, true, true];
  it("green when matching", () => {
    const l = programLight({ enabled: [...e], expected: e, leashLive: true });
    expect(l.state).toBe("green");
    expect(l.key).toBe("program");
    expect(l.fact).not.toContain("LEASH");
  });
  it("red when one leg differs, still shows LEASH_LIVE", () => {
    const en = [...e];
    en[3] = false;
    const l = programLight({ enabled: en, expected: e, leashLive: false });
    expect(l.state).toBe("red");
    expect(l.fact).toContain("option 4");
    expect(l.fact).toContain("live savings switch is off");
    expect(l.action).toBeTruthy();
  });
  it("red when lengths differ", () => {
    const l = programLight({ enabled: e.slice(0, 7), expected: e, leashLive: true });
    expect(l.state).toBe("red");
    expect(l.fact).toBe("Read 7 settings but expected 8");
  });
  it("unknown when nothing to compare", () => expect(programLight({ enabled: [], expected: [], leashLive: true }).state).toBe("unknown"));
});

describe("supportLight", () => {
  it("always info", () => {
    for (const [count7d, newestAt] of [[0, null], [3, ago(5 * H)], [40, ago(6 * 24 * H)]] as const) {
      const l = supportLight({ now: NOW, count7d, newestAt });
      expect(l.state).toBe("info");
      expect(l.key).toBe("support");
    }
  });
  it("facts", () => {
    expect(supportLight({ now: NOW, count7d: 0, newestAt: null }).fact).toContain("0");
    const f = supportLight({ now: NOW, count7d: 3, newestAt: ago(5 * H) }).fact;
    expect(f).toContain("3");
    expect(f).toContain("5 h");
    expect(f).toBe("3 support messages this week, newest 5 h ago");
  });
});
