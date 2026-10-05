import { describe, it, expect } from "vitest";
import { jupiterWithdrawableRaw } from "@/lib/venues/withdrawable";

const EARN = [
  { address: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", liquiditySupplyData: { withdrawable: "123456789" } },
  { address: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", liquiditySupplyData: { withdrawable: "42" } },
];

describe("jupiterWithdrawableRaw: Jupiter Lend's withdrawable by f-token mint", () => {
  it("reads each asset's own row", async () => {
    expect(await jupiterWithdrawableRaw("USDC_LEND", async () => EARN)).toBe(123_456_789n);
    expect(await jupiterWithdrawableRaw("SOL_LEND", async () => EARN)).toBe(42n);
  });
  it("a missing row or field throws (never reads as a pool that can pay)", async () => {
    await expect(jupiterWithdrawableRaw("SOL_LEND", async () => [EARN[0]])).rejects.toThrow();
    await expect(jupiterWithdrawableRaw("USDC_LEND", async () => [{ address: EARN[0].address }])).rejects.toThrow();
  });
});
