import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";

vi.mock("@/lib/rpc", () => ({ rpc: () => ({}) }));
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(), crankWithdraw: vi.fn(), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/reconcile", () => ({ reconcileOwnStakes: vi.fn(async () => ({ adjusted: [], skipped: [] })) }));
vi.mock("@/lib/planting", () => ({ buildPlantingTx: vi.fn(), simulatePlanting: vi.fn(), sendPlanting: vi.fn(), signatureStatus: vi.fn() }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(), usdcAta: vi.fn() }));

import { GET } from "@/app/api/cron/plant/route";

const SECRET = "cron-secret-for-tests";

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("cron route", () => {
  let repo: MemoryRepo;

  beforeEach(() => {
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
    expect(body.reconciled).toEqual({ adjusted: [], skipped: [] });
  });

  it("answers a JSON 500 with the reason when the run throws, never an empty body", async () => {
    repo.listActiveWallets = async () => { throw new Error("database away"); };
    const res = await GET(new Request("http://x/api/cron/plant", { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("database away");
  });
});
