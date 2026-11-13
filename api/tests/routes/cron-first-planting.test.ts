import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";

vi.mock("@/lib/rpc", () => ({ rpc: () => ({}) }));
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(), crankWithdraw: vi.fn(), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/reconcile", () => ({ reconcileOwnStakes: vi.fn(async () => ({ adjusted: [], skipped: [], deferred: [] })) }));
vi.mock("@/lib/planting", () => ({ buildPlantingTx: vi.fn(), simulatePlanting: vi.fn(), sendPlanting: vi.fn(), signatureStatus: vi.fn() }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(), usdcAta: vi.fn() }));
vi.mock("@/lib/coin-data", () => ({ snapshotCoins: vi.fn(), IMPACT_LIMIT_PCT: 1 }));
vi.mock("@/lib/split-run", () => ({ decideSplits: vi.fn(), applyToUsers: vi.fn() }));
vi.mock("@/lib/venues/rates", () => ({ snapshotVenues: vi.fn(), scoutYields: vi.fn(), realVenueReads: vi.fn() }));
vi.mock("@/lib/withdraw-run", () => ({ runWithdrawCrank: vi.fn() }));
const { result } = vi.hoisted(() => ({ result: { planted: [] as unknown[], skipped: [] as unknown[] } }));
vi.mock("@/lib/plant-run", async (orig) => ({ ...(await orig<object>()), runPlanting: vi.fn(async () => result) }));

import { GET } from "@/app/api/cron/first-planting/route";
import { runPlanting } from "@/lib/plant-run";
import { founderAlertFor, founderCardFor } from "@/lib/founder-alert";
import { reconcileOwnStakes } from "@/lib/reconcile";
import { snapshotCoins } from "@/lib/coin-data";
import { decideSplits, applyToUsers } from "@/lib/split-run";
import { snapshotVenues } from "@/lib/venues/rates";
import { runWithdrawCrank } from "@/lib/withdraw-run";

const SECRET = "cron-secret-for-tests";
const get = (auth: string | null = `Bearer ${SECRET}`) => GET(new Request("http://x/api/cron/first-planting", auth ? { headers: { authorization: auth } } : {}));

beforeAll(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/cron/first-planting (owner 10-22)", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    vi.clearAllMocks();
    result.planted = [];
    result.skipped = [];
    repo = new MemoryRepo();
    setRepoForTests(repo);
  });

  it("refuses without the bearer or with a wrong one, before anything runs", async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get("Bearer nope")).status).toBe(401);
    expect(runPlanting).not.toHaveBeenCalled();
  });

  it("runs the planting alone, in first-only mode: none of the daily steps", async () => {
    const cleanup = vi.spyOn(repo, "cleanupExpired");
    const res = await get();
    expect(res.status).toBe(200);
    expect(vi.mocked(runPlanting).mock.calls.length).toBe(1);
    expect(vi.mocked(runPlanting).mock.calls[0][0]).toMatchObject({ only: "first", repo });
    for (const daily of [snapshotVenues, snapshotCoins, decideSplits, applyToUsers, runWithdrawCrank, reconcileOwnStakes]) expect(daily).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("answers counts and reasons only: no wallet or signature reaches the (public) caller's log", async () => {
    result.planted = [{ wallet: "WalletA", asset: "SKR", pullCents: 60, signature: "SigA" }];
    result.skipped = [{ wallet: "WalletB", reason: "no usdc" }, { wallet: "WalletC", reason: "no usdc" }, { wallet: "WalletD", reason: "below threshold" }];
    const res = await get();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ planted: 1, skipped: 3, reasons: { "no usdc": 2, "below threshold": 1 } });
    expect(text).not.toMatch(/Wallet|Sig/);
  });

  it("a failed run answers 500 without the error's text", async () => {
    vi.mocked(runPlanting).mockRejectedValueOnce(new Error("boom at WalletA"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("WalletA");
  });

  describe("heartbeat event (ops dashboard)", () => {
    const beats = async () => repo.events.filter((e) => e.kind === "first_planting_run");

    it("an authorized run writes exactly one first_planting_run event with counts only", async () => {
      result.planted = [{ wallet: "WalletA", asset: "SKR", pullCents: 60, signature: "SigA" }];
      result.skipped = [{ wallet: "WalletB", reason: "no usdc" }, { wallet: "WalletC", reason: "no usdc" }];
      await get();
      const b = await beats();
      expect(b).toHaveLength(1);
      expect(b[0]).toMatchObject({ userPubkey: null, walletPubkey: null, detail: { planted: 1, skipped: 2 } });
      expect(JSON.stringify(b[0].detail)).not.toMatch(/Wallet|Sig/);
    });

    it("writes one even when nothing was planted", async () => {
      await get();
      expect((await beats())[0].detail).toEqual({ planted: 0, skipped: 0 });
    });

    it("writes none when unauthorized or when the run throws", async () => {
      await get(null);
      await get("Bearer nope");
      vi.mocked(runPlanting).mockRejectedValueOnce(new Error("boom"));
      await get();
      expect(await beats()).toHaveLength(0);
    });

    it("a failing heartbeat write is logged and never changes the response", async () => {
      result.planted = [{ wallet: "WalletA", asset: "SKR", pullCents: 60, signature: "SigA" }];
      vi.spyOn(repo, "addEvent").mockRejectedValueOnce(new Error("db down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await get();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ planted: 1, skipped: 0 });
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it("raises no founder alert or card", () => {
      const e = { kind: "first_planting_run" as const, userPubkey: null, walletPubkey: null, detail: { planted: 1, skipped: 0 } };
      expect(founderAlertFor(e)).toBeNull();
      expect(founderCardFor(e)).toBeNull();
    });
  });
});
