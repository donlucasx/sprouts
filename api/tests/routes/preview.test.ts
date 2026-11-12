import { describe, it, expect, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const { walletSwapsMock } = vi.hoisted(() => ({ walletSwapsMock: vi.fn() }));
vi.mock("@/lib/preview", async (orig) => ({ ...(await orig<object>()), walletSwaps: walletSwapsMock }));
import { GET } from "@/app/api/me/preview/route";

let auth: Record<string, string>;
let repo: MemoryRepo;
beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  repo = new MemoryRepo();
  await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  setRepoForTests(repo);
  auth = { authorization: `Bearer ${await issueSession("U", "test-device")}` };
});

describe("GET /api/me/preview", () => {
  it("needs a session", async () => {
    expect((await GET(new Request("http://x/api/me/preview"))).status).toBe(401);
  });

  it("answers the user's own totals, read from their own wallet", async () => {
    walletSwapsMock.mockResolvedValueOnce({ swaps: [{ day: "d", sizeCents: 117 }, { day: "d", sizeCents: 100 }], partial: false });
    const r = await GET(new Request("http://x/api/me/preview", { headers: auth }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ days: 30, swaps: 2, savedCents: 83, perSwapSavedCents: 103, partial: false });
    expect(walletSwapsMock.mock.calls[0][0]).toBe("U");
  });

  it("a user with a linked wallet is refused before any history is read", async () => {
    await repo.upsertUser({ seedVaultPubkey: "L", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: "L", userPubkey: "L", delegationPda: "D", dailyCapCents: 500 });
    const before = walletSwapsMock.mock.calls.length;
    const r = await GET(new Request("http://x/api/me/preview", { headers: { authorization: `Bearer ${await issueSession("L", "test-device")}` } }));
    expect(r.status).toBe(409);
    expect(walletSwapsMock.mock.calls.length).toBe(before);
  });

  it("a history that cannot be read is a 503, not a wrong zero", async () => {
    walletSwapsMock.mockRejectedValueOnce(new Error("history 429"));
    expect((await GET(new Request("http://x/api/me/preview", { headers: auth }))).status).toBe(503);
  });
  it("a fourth read in a minute is refused before the history is read", async () => {
    walletSwapsMock.mockResolvedValue({ swaps: [], partial: false });
    const before = walletSwapsMock.mock.calls.length;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await GET(new Request("http://x/api/me/preview", { headers: { authorization: auth.authorization } }))).status);
    expect(codes.at(-1)).toBe(429);
    expect(walletSwapsMock.mock.calls.length - before).toBeLessThanOrEqual(3);
  });
});
