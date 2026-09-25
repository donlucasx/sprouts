import { describe, it, expect } from "vitest";
import { pickAsset } from "@/domain/allocation";

describe("pickAsset", () => {
  it("100/0 always picks SKR", () => expect(pickAsset({ SKR: 5000, stORE: 0 }, { SKR: 100, stORE: 0 })).toBe("SKR"));

  it("0/100 always picks stORE", () => expect(pickAsset({ SKR: 0, stORE: 0 }, { SKR: 0, stORE: 100 })).toBe("stORE"));

  it("70/30 from zero picks SKR first", () => expect(pickAsset({ SKR: 0, stORE: 0 }, { SKR: 70, stORE: 30 })).toBe("SKR"));

  it("70/30 after 700 SKR and 0 stORE picks stORE", () => expect(pickAsset({ SKR: 700, stORE: 0 }, { SKR: 70, stORE: 30 })).toBe("stORE"));

  it("converges: ten $2 plantings at 70/30 give 7 SKR and 3 stORE", () => {
    const ledger = { SKR: 0, stORE: 0 };
    const picks: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = pickAsset(ledger, { SKR: 70, stORE: 30 });
      picks.push(a);
      ledger[a] += 200;
    }
    expect(picks.filter((p) => p === "SKR").length).toBe(7);
  });
});
