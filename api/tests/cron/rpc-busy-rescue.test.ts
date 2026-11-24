import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { rescueCandidates, rescueWallets } from "@/lib/plant-run";
import { isHttp429 } from "@/lib/http429";
import { createPace } from "@/lib/rpc";
import { redactError } from "@/lib/redact";

// 11-24 incident: the daily run with 100 wallets met Helius 429s past every retry; three in a row tripped the outage stop and 56
// wallets waited a day. A 429 is "try later", the RPC is paced, and the hourly job rescues what the daily run could not reach.
const NOW = new Date("2026-11-24T14:11:00Z");
/** kit's SolanaError for an HTTP 429 from the RPC (code 8100002, context.statusCode 429), built by shape. */
const http429 = () => Object.assign(new Error("Solana error #8100002"), { name: "SolanaError", context: { __code: 8100002, statusCode: 429 } });

async function users(n: number) {
  const repo = new MemoryRepo();
  for (let i = 0; i < n; i++) {
    await repo.upsertUser({ seedVaultPubkey: `U${i}`, sgtMint: `M${i}`, skrName: null });
    await repo.addWallet({ pubkey: `W${i}`, userPubkey: `U${i}`, delegationPda: `D${i}`, dailyCapCents: 500 });
    await repo.insertSwap({ signature: `x${i}`, walletPubkey: `W${i}`, ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
  }
  return repo;
}

describe("isHttp429", () => {
  it("reads kit's 429 by code and status, also from a redacted copy and from a cause; never a 503 or a look-alike message", () => {
    expect(isHttp429(http429())).toBe(true);
    expect(isHttp429(redactError(http429()))).toBe(true);
    expect(isHttp429(new Error("wrapped", { cause: http429() }))).toBe(true);
    expect(isHttp429(Object.assign(new Error("x"), { name: "SolanaError", context: { __code: 8100002, statusCode: 503 } }))).toBe(false);
    expect(isHttp429(new Error("429 Too Many Requests"))).toBe(false);
    expect(isHttp429(null)).toBe(false);
  });
});

describe("createPace", () => {
  it("lets at most N requests start in any rolling second, first come first served", async () => {
    let t = 0;
    const slept: number[] = [];
    const pace = createPace({ maxPerSecond: 3, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, log: () => {} });
    const started: number[] = [];
    await Promise.all(Array.from({ length: 7 }, (_, i) => pace().then(() => started.push(t))));
    expect(started).toEqual([0, 0, 0, 1000, 1000, 1000, 2000]);
  });
  it("is a no-op at 0", async () => {
    const pace = createPace({ maxPerSecond: 0, now: () => 0, sleep: async () => { throw new Error("never"); } });
    await Promise.all(Array.from({ length: 50 }, () => pace()));
  });
});

describe("same-day rescue", () => {
  const run = (skipped: { wallet: string; reason: string }[], finished = true) => ({ startedAt: NOW, finishedAt: finished ? new Date(NOW.getTime() + 278_000) : null, summary: { planting: { planted: [], skipped } } });
  it("takes only capacity skips from a finished run", () => {
    expect((rescueCandidates(run([
      { wallet: "A", reason: "run stopped" }, { wallet: "B", reason: "run deadline" }, { wallet: "C", reason: "rpc busy" }, { wallet: "D", reason: "jupiter busy" },
      { wallet: "E", reason: "below threshold" }, { wallet: "F", reason: "build failed" }, { wallet: "G", reason: "no usdc" }, { wallet: "A", reason: "run stopped" },
    ])) as string[]).sort()).toEqual(["A", "B", "C", "D"]);
    expect(rescueCandidates(run([{ wallet: "A", reason: "run stopped" }], false), NOW.getTime() + 60_000)).toEqual([]);
    expect(rescueCandidates(null)).toEqual([]);
    expect(rescueCandidates({ finishedAt: NOW, summary: { planting: null } })).toEqual([]);
  });
  it("a run that died unfinished (Vercel's 300 s kill) makes every wallet a candidate once it is stale; a running one, none", () => {
    const dead = { startedAt: NOW, finishedAt: null, summary: null };
    expect(rescueCandidates(dead, NOW.getTime() + 6 * 60_000)).toBe("all");
    expect(rescueCandidates(dead, NOW.getTime() + 5 * 60_000)).toEqual([]);
  });
  it("'all' keeps every active wallet whose user has not planted since the run started", async () => {
    const repo = await users(3);
    await repo.insertPlanting({ userPubkey: "U0", walletPubkey: "W0", signature: "s0", usdcPulledCents: 100, networkFeeCents: 1, status: "confirmed", aiLine: null, ts: new Date(NOW.getTime() + 1000) } as never, []);
    const out = await rescueWallets(repo, await repo.listActiveWallets(), { wallets: "all", since: NOW });
    expect(out.map((w) => w.pubkey).sort()).toEqual(["W1", "W2"]);
  });
  it("keeps active candidates whose user has no planting since the run started", async () => {
    const repo = await users(4);
    await repo.insertPlanting({ userPubkey: "U1", walletPubkey: "W1", signature: "s1", usdcPulledCents: 100, networkFeeCents: 1, status: "sent", aiLine: null, ts: new Date(NOW.getTime() + 60_000) } as never, []);
    await repo.insertPlanting({ userPubkey: "U2", walletPubkey: "W2", signature: "s2", usdcPulledCents: 100, networkFeeCents: 1, status: "confirmed", aiLine: null, ts: new Date(NOW.getTime() - 86_400_000) } as never, []);
    const active = await repo.listActiveWallets();
    const out = await rescueWallets(repo, active, { wallets: ["W0", "W1", "W2"], since: NOW });
    expect(out.map((w) => w.pubkey).sort()).toEqual(["W0", "W2"]);
    expect(await rescueWallets(repo, active, undefined)).toEqual([]);
  });
});
