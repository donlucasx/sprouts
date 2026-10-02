import { describe, it, expect } from "vitest";
import { plantingNotice } from "@/lib/notices";

// audits/watering-ux finding 9: the planting push never said a sprout was waiting to be opened.
describe("plantingNotice", () => {
  it("names the change, the coin, where it sits, and that a sprout waits", () => {
    expect(plantingNotice({ asset: "SKR", usdcInCents: 23, amountOutRaw: "12480000" }, { skrUsd: 0.01833, storeUsd: null }))
      .toBe("$0.23 of change became 12.48 SKR ($0.23), locked to your Seeker. A new sprout is waiting in your garden.");
  });
  it("a stORE planting sits in the Seeker wallet, not locked", () => {
    expect(plantingNotice({ asset: "stORE", usdcInCents: 10, amountOutRaw: "136962377" }, { skrUsd: null, storeUsd: 73 }))
      .toBe("$0.10 of change became 0.0013 stORE ($0.10), in your Seeker wallet. A new sprout is waiting in your garden.");
  });
  it("a cbBTC planting says it sits in the Seeker wallet, with the coin's own decimals", () => {
    expect(plantingNotice({ asset: "cbBTC", usdcInCents: 200, amountOutRaw: "2352" }, { skrUsd: null, storeUsd: null }))
      .toBe("$2.00 of change became 0.00002352 cbBTC, in your Seeker wallet. A new sprout is waiting in your garden.");
  });
});
