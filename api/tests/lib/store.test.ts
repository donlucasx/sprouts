import { describe, it, expect, vi } from "vitest";

// Confirmed on chain 2026-09-30: the ORE stake account 4apcWHDc... (owner stakecNP...) carries the authority at byte 8 (which is
// GexGotZV..., the account the old reader wrongly treated as a token account) and the staked balance as a u64 at byte 40.
const data = Buffer.alloc(120);
data.writeBigUInt64LE(4_459_121_715_960_216n, 40);
const rpcMock = vi.hoisted(() => ({
  getTokenSupply: () => ({ send: async () => ({ value: { amount: "4248382564879665", decimals: 11 } }) }),
  getAccountInfo: () => ({ send: async () => ({ value: { data: ["", "base64"], owner: "stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH" } }) }),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => rpcMock }));

import { parseOreStakeBalance, storeRedeemRate } from "@/lib/store";

describe("the stORE rate (spec 5.3, queue item 7)", () => {
  it("parses the staked balance at byte 40", () => {
    expect(parseOreStakeBalance(data)).toBe(4_459_121_715_960_216n);
  });

  it("the rate is the stake account's balance over the stORE supply, at 1e9 scale", async () => {
    rpcMock.getAccountInfo = () => ({ send: async () => ({ value: { data: [data.toString("base64"), "base64"], owner: "stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH" } }) });
    const rate = await storeRedeemRate();
    expect(Number(rate) / 1e9).toBeCloseTo(1.0496, 4);
  });

  it("refuses an account owned by anything but ORE's staking program", async () => {
    rpcMock.getAccountInfo = () => ({ send: async () => ({ value: { data: [data.toString("base64"), "base64"], owner: "11111111111111111111111111111111" } }) });
    await expect(storeRedeemRate()).rejects.toThrow(/owner/);
  });
});
