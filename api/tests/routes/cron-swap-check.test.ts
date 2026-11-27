import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { dayOf } from "@/domain/day";

// 11-27 (Kimi swap-check scope items 1, 3, 5, 6): the missed-swap check's own daily route.
vi.mock("@/lib/rpc", () => ({ rpc: () => ({}) }));
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn(async (_a: unknown) => true) }));
vi.mock("@/lib/founder-alert", async (orig) => ({ ...(await orig<object>()), alertFounder: alertMock }));
type Args = { deadlineMs: number; hardStopMs: number; boundAt?: number; exclude: Set<string>; history?: { through: Map<string, number>; hasHistory: boolean } };
const record = (missed: { wallet: string; sig: string; ts: string; roundupCents: number }[] = []) => ({ checked: 3, unchecked: [], deferred: 0, missed, calls: { signatures: 3, enhanced: 1, transactions: 1 }, through: "2026-11-27T12:45:00.000Z", checkedWallets: ["5t9Y…J9t"], skipped: { puller: 0, top_up: 0, refused: 0, not_this_wallet: 0 } });
const { swapCheckMock } = vi.hoisted(() => ({ swapCheckMock: vi.fn(async (_a: Args): Promise<unknown> => null) }));
const { readsMock } = vi.hoisted(() => ({ readsMock: vi.fn(async () => ({})) }));
vi.mock("@/lib/swap-check", async (orig) => ({ ...(await orig<object>()), checkMissedSwaps: swapCheckMock, realSwapCheckReads: readsMock }));

import { GET } from "@/app/api/cron/swap-check/route";

const SECRET = "cron-secret-for-tests";
const get = (auth: string | null = `Bearer ${SECRET}`) => GET(new Request("http://x/api/cron/swap-check", auth ? { headers: { authorization: auth } } : {}));
const MISS = { wallet: "5t9Y…J9t", sig: "44gdAAAA", ts: "2026-11-27T09:14Z", roundupCents: 66 };

let repo: MemoryRepo;
beforeAll(() => { process.env.CRON_SECRET = SECRET; });
beforeEach(() => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  swapCheckMock.mockReset();
  swapCheckMock.mockImplementation(async () => record([MISS]));
  alertMock.mockClear();
  readsMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** An earlier run's record in the twin table, finished `daysAgo` days before now. */
async function earlierRun(daysAgo: number, check: unknown) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  const day = dayOf(at);
  await repo.claimSwapCheckRun(day, at, new Date(0));
  await repo.finishSwapCheckRun(day, true, { swapCheck: check, seconds: 100 }, new Date(at.getTime() + 100_000), at);
}

describe("GET /api/cron/swap-check", () => {
  it("refuses without the bearer", async () => {
    expect((await get(null)).status).toBe(401);
    expect(swapCheckMock).not.toHaveBeenCalled();
  });

  it("runs the check under its own cutoffs and records it in swap_check_runs, the plant run's swapCheck shape", async () => {
    const before = Date.now();
    const res = await get();
    expect(res.status).toBe(200);
    const a = swapCheckMock.mock.calls[0][0];
    expect(a.deadlineMs - before).toBeGreaterThanOrEqual(729_000);
    expect(a.deadlineMs - before).toBeLessThanOrEqual(731_000);
    expect(a.hardStopMs - a.deadlineMs).toBe(25_000);
    expect(a.boundAt! - a.deadlineMs).toBe(30_000);
    const rec = repo.swapCheckRuns.get(dayOf(new Date()));
    expect(rec?.ok).toBe(true);
    expect(rec?.summary).toMatchObject({ swapCheck: { checked: 3, missed: [{ sig: "44gdAAAA", roundupCents: 66, reason: "no_trace" }] } });
    expect(repo.cronRuns.size).toBe(0);   // never the plant run's table or lock
  });

  it("its own lock: a second trigger while today's check is going stops with 409, before any read", async () => {
    expect(await repo.claimSwapCheckRun(dayOf(new Date()), new Date(), new Date(0))).toBe(true);
    const res = await get();
    expect(res.status).toBe(409);
    expect(swapCheckMock).not.toHaveBeenCalled();
  });

  it("does not collide with the plant run's lock (a plant run going today does not stop it)", async () => {
    expect(await repo.claimCronRun(dayOf(new Date()), new Date(), new Date(0))).toBe(true);
    expect((await get()).status).toBe(200);
  });

  it("a check that throws is null in the record (ok false, the light goes grey), never 'nothing missed'", async () => {
    swapCheckMock.mockRejectedValueOnce(new Error("helius down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get();
    err.mockRestore();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { swapCheck: unknown }).swapCheck).toBeNull();
    expect(repo.swapCheckRuns.get(dayOf(new Date()))).toMatchObject({ ok: false, summary: { swapCheck: null } });
  });

  it("Kimi 3: passes the last week's records as the lookback; with no earlier record, no history (plain 48 h)", async () => {
    await get();
    expect(swapCheckMock.mock.calls[0][0].history?.hasHistory).toBe(false);
    swapCheckMock.mockClear();
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await earlierRun(3, { ...record(), through: "2026-11-24T12:45:00.000Z", checkedWallets: ["AAAA…aaa"] });
    await get();
    const h = swapCheckMock.mock.calls[0][0].history!;
    expect(h.hasHistory).toBe(true);
    expect(h.through.get("AAAA…aaa")).toBe(Date.parse("2026-11-24T12:45:00.000Z") / 1000);
  });

  it("Kimi 6: a wallet that misses again after missing in the previous run gets one ops card; a first miss does not", async () => {
    await get();
    expect(alertMock).not.toHaveBeenCalled();
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await earlierRun(1, record([{ ...MISS, sig: "OLDMISS1" }]));
    await get();
    expect(alertMock).toHaveBeenCalledTimes(1);
    const card = alertMock.mock.calls[0][0] as { channel: string; title: string; text: string };
    expect(card.channel).toBe("ops");
    expect(card.title).toBe("Same wallet missed swaps two runs in a row");
    expect(card.text).toContain("5t9Y…J9t: 44gdAAAA (no_trace)");
  });

  it("Kimi 6: the same miss re-read by the overlapping window is not a repeat", async () => {
    await earlierRun(1, record([MISS]));
    await get();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("Kimi 6: each miss carries what the webhook left (a swap_refused event for it)", async () => {
    await repo.addEvent({ userPubkey: null, walletPubkey: "5t9YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJ9t", kind: "swap_refused", detail: { reason: "not_recent", sig: "44gdAAAA" } });
    const body = (await (await get()).json()) as { swapCheck: { missed: { reason: string }[] } };
    expect(body.swapCheck.missed[0].reason).toBe("refused:not_recent");
  });

  it("M1: a check whose read hangs returns by the 760 s bound, and the record is still written", async () => {
    const actual = await vi.importActual<typeof import("@/lib/swap-check")>("@/lib/swap-check");
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    readsMock.mockResolvedValueOnce({ signatures: () => new Promise(() => {}), enhanced: async () => [], fetchTx: async () => null, priceUsd: async () => null, puller: "P" } as never);
    let started = false;
    swapCheckMock.mockImplementationOnce((a) => { started = true; return actual.checkMissedSwaps(a as never) as never; });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let settled = false;
      const p = get().finally(() => { settled = true; });
      const waitUntil = performance.now() + 5_000;
      while (!started && performance.now() < waitUntil) await new Promise((r) => setImmediate(r));
      expect(started).toBe(true);
      await vi.advanceTimersByTimeAsync(760_000 - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 1_000 && !settled; i++) await new Promise((r) => setImmediate(r));
      expect(settled).toBe(true);
      expect((await p).status).toBe(200);
      const rec = repo.swapCheckRuns.get(dayOf(new Date()));
      expect(rec?.ok).toBe(true);
      expect(rec?.summary).toMatchObject({ swapCheck: { checked: 0, deferred: 1, missed: [], unchecked: [] } });
    } finally {
      vi.useRealTimers();
      err.mockRestore();
    }
  });
});
