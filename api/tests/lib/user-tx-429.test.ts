import { describe, expect, it, vi, beforeEach } from "vitest";

// 11-25 (3 top-up confirms answered 500 on Helius 429s; Kimi hotfix #6-8): a rate limit only ever reads as "pending".
const { statuses, valid } = vi.hoisted(() => ({ statuses: [] as Array<string | Error>, valid: { v: true as boolean | Error } }));
const http429 = () => Object.assign(new Error("Solana error #8100002"), { name: "SolanaError", context: { __code: 8100002, statusCode: 429 } });
vi.mock("@/lib/planting", () => ({ signatureStatus: vi.fn(async () => { const s = statuses.shift() ?? "pending"; if (s instanceof Error) throw s; return s; }) }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ isBlockhashValid: () => ({ send: async () => { if (valid.v instanceof Error) throw valid.v; return { value: valid.v }; } }) }) }));

import { settleUnconfirmed, waitConfirmed } from "@/lib/user-tx";

describe("waitConfirmed / settleUnconfirmed under Helius 429s", () => {
  beforeEach(() => { statuses.length = 0; valid.v = true; });
  it("a 429 on a status read is a pending round; the poll goes on and sees the landing", async () => {
    statuses.push(http429(), http429(), "confirmed");
    expect(await waitConfirmed("sig", 5, 0)).toBe("confirmed");
  });
  it("any other error still throws", async () => {
    statuses.push(new Error("boom"));
    await expect(waitConfirmed("sig", 5, 0)).rejects.toThrow("boom");
  });
  it("stops at the deadline with pending", async () => {
    expect(await waitConfirmed("sig", 50, 0, { deadlineMs: Date.now() - 1 })).toBe("pending");
  });
  it("re-sends every 3rd round when asked, and a failing re-send never breaks the poll", async () => {
    const resend = vi.fn(async () => { throw http429(); });
    statuses.push("pending", "pending", "pending", "pending", "confirmed");
    expect(await waitConfirmed("sig", 10, 0, { resend })).toBe("confirmed");
    expect(resend).toHaveBeenCalledTimes(1);
  });
  it("settleUnconfirmed: a 429 is pending, never expired (nothing-moved) while it might have landed", async () => {
    valid.v = http429();
    expect(await settleUnconfirmed({ signature: "sig", blockhash: "bh" })).toBe("pending");
    valid.v = false; statuses.push("pending");
    expect(await settleUnconfirmed({ signature: "sig", blockhash: "bh" })).toBe("expired");
  });
});
