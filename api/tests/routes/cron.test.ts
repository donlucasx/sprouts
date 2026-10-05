import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";

vi.mock("@/lib/rpc", () => ({ rpc: () => ({}) }));
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(), crankWithdraw: vi.fn(), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/reconcile", () => ({ reconcileOwnStakes: vi.fn(async () => ({ adjusted: [], skipped: [], deferred: [] })) }));
vi.mock("@/lib/planting", () => ({ buildPlantingTx: vi.fn(), simulatePlanting: vi.fn(), sendPlanting: vi.fn(), signatureStatus: vi.fn() }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(), usdcAta: vi.fn() }));
const { order, snapshotMock, decideMock, applyMock, venuesMock, movesMock } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    snapshotMock: vi.fn(async () => { order.push("coins"); return [{ asset: "SKR", ok: true }, { asset: "hSOL", ok: true }, { asset: "cbBTC", ok: false }]; }),
    decideMock: vi.fn(async (_a: unknown) => { order.push("decide"); return [{ stop: "careful", fallback: null }, { stop: "balanced", fallback: null }, { stop: "bold", fallback: "model" }]; }),
    applyMock: vi.fn(async () => { order.push("apply"); return { changed: ["U"] }; }),
    venuesMock: vi.fn(async () => { order.push("venues"); return [{ ok: true }, { ok: false }]; }),
    movesMock: vi.fn(async (_a: unknown) => { order.push("moves"); return { proposed: ["U"], expired: [] }; }),
  };
});
vi.mock("@/lib/venues/rates", () => ({ snapshotVenues: venuesMock, scoutYields: vi.fn(async () => []), realVenueReads: vi.fn(() => ({})) }));
vi.mock("@/lib/moves", () => ({ proposeMoves: movesMock }));
vi.mock("@/lib/plant-run", async (orig) => {
  const actual = await orig<typeof import("@/lib/plant-run")>();
  return { ...actual, runPlanting: vi.fn(async (a: Parameters<typeof actual.runPlanting>[0]) => { order.push("plant"); return actual.runPlanting(a); }) };
});
vi.mock("@/lib/coin-data", () => ({ snapshotCoins: snapshotMock, IMPACT_LIMIT_PCT: 1 }));
vi.mock("@/lib/split-run", () => ({ decideSplits: decideMock, applyToUsers: applyMock }));
vi.mock("@/lib/jupiter", () => ({ getQuote: vi.fn(), pricesUsd: vi.fn() }));
vi.mock("@/lib/store", () => ({ storeRedeemRate: vi.fn() }));
vi.mock("@/lib/anthropic", () => ({ callTool: vi.fn() }));

import { GET } from "@/app/api/cron/plant/route";

const SECRET = "cron-secret-for-tests";

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("cron route", () => {
  let repo: MemoryRepo;

  beforeEach(() => {
    order.length = 0;
    delete process.env.MOVES_ENABLED;
    repo = new MemoryRepo();
    setRepoForTests(repo);
  });

  it("refuses without the bearer", async () => {
    expect((await GET(new Request("http://x/api/cron/plant"))).status).toBe(401);
  });

  it("answers 200 with the run summary on an empty database (the keepalive must not need a user row)", async () => {
    // The first production run on 2026-09-28 planted correctly and then answered 500: the keepalive read rules for a user
    // that does not exist, which the schema's foreign key refuses. The in-memory repo mirrors that rule now.
    const res = await GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { planting: { planted: unknown[]; skipped: unknown[] }; withdrawals: { cranked: unknown[]; failed: unknown[] }; reconciled: unknown };
    expect(body.planting.planted).toEqual([]);
    expect(body.withdrawals.cranked).toEqual([]);
    expect(body.reconciled).toEqual({ adjusted: [], skipped: [], deferred: [] });
  });

  it("runs the snapshot, the decision and the apply before planting, and reports them", async () => {
    const res = await GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { coins: number; splits: { stop: string; fallback: string | null }[]; applied: number };
    expect(body.coins).toBe(2);
    expect(body.splits.map((s) => s.stop)).toEqual(["careful", "balanced", "bold"]);
    expect(body.applied).toBe(1);
    expect(snapshotMock.mock.invocationCallOrder[0]).toBeLessThan(decideMock.mock.invocationCallOrder[0]);
    expect(decideMock.mock.invocationCallOrder[0]).toBeLessThan(applyMock.mock.invocationCallOrder[0]);
  });

  const get = () => GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));

  it("runs venues, coins, decide, apply, moves, then plant, and reports venues and moves", async () => {
    const res = await get();
    expect(order).toEqual(["venues", "coins", "decide", "apply", "moves", "plant"]);
    const body = (await res.json()) as { venues: number; moves: number };
    expect(body.venues).toBe(1);
    expect(body.moves).toBe(1);
  });

  it("skips the moves step when MOVES_ENABLED is false", async () => {
    process.env.MOVES_ENABLED = "false";
    const body = (await (await get()).json()) as { moves: number | null };
    expect(order).toEqual(["venues", "coins", "decide", "apply", "plant"]);
    expect(body.moves).toBeNull();
  });

  it("a failed venues or moves step is logged and the planting still runs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    venuesMock.mockRejectedValueOnce(new Error("JUPITER_API_KEY is not set"));
    movesMock.mockRejectedValueOnce(new Error("moves boom"));
    const res = await get();
    expect(res.status).toBe(200);
    expect(order).toContain("plant");
    const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("venues failed: JUPITER_API_KEY is not set");
    expect(logged).toContain("moves failed: moves boom");
    const body = (await res.json()) as { venues: number | null; moves: number | null };
    expect(body.venues).toBeNull();
    expect(body.moves).toBeNull();
    err.mockRestore();
  });

  it("the moves step reads positions only inside its deadline, and the decide step gets the scout", async () => {
    await get();
    const a = movesMock.mock.calls.at(-1)![0] as { positions(u: string): Promise<unknown>; solUsd: number };
    expect(typeof a.solUsd).toBe("number");
    expect(typeof (decideMock.mock.calls.at(-1)![0] as { scout: unknown }).scout).toBe("function");
    const real = Date.now;
    Date.now = () => real() + 10 * 60_000;
    try { await expect(a.positions("U")).rejects.toThrow(/deadline/); } finally { Date.now = real; }
  });

  it("a failed snapshot never stops the planting run", async () => {
    snapshotMock.mockRejectedValueOnce(new Error("rpc down"));
    const res = await GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { coins: number | null; planting: { planted: unknown[] } };
    expect(body.coins).toBeNull();
    expect(body.planting.planted).toEqual([]);
  });

  it("answers a JSON 500 with the reason when the run throws, never an empty body", async () => {
    repo.listActiveWallets = async () => { throw new Error("database away"); };
    const res = await GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("database away");
  });
});
