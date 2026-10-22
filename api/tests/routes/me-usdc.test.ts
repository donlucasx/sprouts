import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/subscriptions", () => ({ readUsdcBalanceRaw: vi.fn(async () => 0n) }));

import { readUsdcBalanceRaw } from "@/lib/subscriptions";
import { GET } from "@/app/api/me/usdc/route";

const get = async (token?: string) => GET(new Request("http://x/api/me/usdc", token ? { headers: { authorization: `Bearer ${token}` } } : {}));

// Link a wallet's note before "This phone's wallet" approves: the signed-in Seeker's own USDC, read only.
describe("GET /api/me/usdc", () => {
  beforeEach(async () => {
    setRepoForTests(new MemoryRepo());
    vi.mocked(readUsdcBalanceRaw).mockReset();
  });

  it("answers the session wallet's USDC in base units, read for that wallet only", async () => {
    vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(2_050_000n);
    const res = await get(await issueSession(U, "M"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usdcRaw: "2050000" });
    expect(vi.mocked(readUsdcBalanceRaw)).toHaveBeenCalledWith(U);
  });

  it("answers null, not zero, when the chain cannot be read", async () => {
    vi.mocked(readUsdcBalanceRaw).mockRejectedValueOnce(new Error("rpc down"));
    const res = await get(await issueSession(U, "M"));
    expect(await res.json()).toEqual({ usdcRaw: null });
  });

  it("requires a session", async () => {
    expect((await get()).status).toBe(401);
  });
});
