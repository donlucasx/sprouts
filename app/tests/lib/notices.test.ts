import { describe, it, expect } from "vitest";
import { plantingNotice } from "@/lib/notices";

// R172 (10-02): one line, "Your change was planted: $0.23 became 12.48 SKR.", the coin's value kept where it is known.
describe("plantingNotice", () => {
  it("names the change and what it became, in one sentence", () => {
    expect(plantingNotice({ asset: "SKR", usdcInCents: 23, amountOutRaw: "12480000" }, { skrUsd: 0.01833, storeUsd: null }))
      .toBe("Your change was planted: $0.23 became 12.48 SKR ($0.23).");
  });
  it("a stORE planting reads the same way", () => {
    expect(plantingNotice({ asset: "stORE", usdcInCents: 10, amountOutRaw: "136962377" }, { skrUsd: null, storeUsd: 73 }))
      .toBe("Your change was planted: $0.10 became 0.0013 stORE ($0.10).");
  });
  it("a cbBTC planting keeps the coin's own decimals, no value when its price is unknown", () => {
    expect(plantingNotice({ asset: "cbBTC", usdcInCents: 200, amountOutRaw: "2352" }, { skrUsd: null, storeUsd: null }))
      .toBe("Your change was planted: $2.00 became 0.00002352 cbBTC.");
  });
});
