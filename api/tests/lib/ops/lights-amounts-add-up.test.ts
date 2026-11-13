import { describe, it, expect } from "vitest";
import { amountsAddUpLight, type AddUpRow } from "@/lib/ops/lights";

const row = (over: Partial<AddUpRow> = {}): AddUpRow => ({ id: "ab12…xyz", claimedCents: 500, pulledCents: 500, legsCents: 500, legCount: 1, ...over });

describe("amountsAddUpLight", () => {
  it("green when every saving adds up, even with none", () => {
    expect(amountsAddUpLight({ rows: [] })).toMatchObject({ key: "amountsAddUp", label: "Amounts add up", state: "green" });
    const l = amountsAddUpLight({ rows: [row(), row({ claimedCents: 501, legsCents: 499 })] });
    expect(l.state).toBe("green");
    expect(l.action).toBeUndefined();
  });
  it("red when round-ups claimed are more than pulled; names the count and the biggest gap in dollars", () => {
    const l = amountsAddUpLight({ rows: [row(), row({ claimedCents: 2200, pulledCents: 500, legsCents: 500 }), row({ claimedCents: 700 })] });
    expect(l).toMatchObject({ state: "red", fact: "2 savings don't add up, biggest gap $17.00", action: "Ask Claude to check them today." });
  });
  it("singular wording and cents in the gap", () => {
    expect(amountsAddUpLight({ rows: [row({ claimedCents: 2231, pulledCents: 500, legsCents: 500 })] }).fact).toBe("1 saving doesn't add up, biggest gap $17.31");
  });
  it("red when the legs do not add up to what was pulled", () => {
    const l = amountsAddUpLight({ rows: [row({ legsCents: 0, legCount: 0 })] });
    expect(l).toMatchObject({ state: "red", fact: "1 saving doesn't add up, biggest gap $5.00" });
  });
  it("legs: one extra cent of rounding is allowed per extra leg, no more", () => {
    expect(amountsAddUpLight({ rows: [row({ legsCents: 502, legCount: 3 })] }).state).toBe("green");
    expect(amountsAddUpLight({ rows: [row({ legsCents: 503, legCount: 3 })] }).state).toBe("red");
    expect(amountsAddUpLight({ rows: [row({ legsCents: 502, legCount: 1 })] }).state).toBe("red");
  });
  it("claimed less than pulled is amber (a bigger pull than the round-ups)", () => {
    const l = amountsAddUpLight({ rows: [row({ claimedCents: 100 })] });
    expect(l).toMatchObject({ state: "amber", fact: "1 saving pulled more than its round-ups, biggest gap $4.00", action: "Ask Claude to check them today." });
  });
  it("red wins over amber and the count covers only the red ones", () => {
    const l = amountsAddUpLight({ rows: [row({ claimedCents: 100 }), row({ claimedCents: 900 })] });
    expect(l).toMatchObject({ state: "red", fact: "1 saving doesn't add up, biggest gap $4.00" });
  });
  it("a gap of exactly 1 cent is fine, 2 is not", () => {
    expect(amountsAddUpLight({ rows: [row({ claimedCents: 501 })] }).state).toBe("green");
    expect(amountsAddUpLight({ rows: [row({ claimedCents: 502 })] }).state).toBe("red");
  });
  it("never puts an id in the fact", () => {
    expect(amountsAddUpLight({ rows: [row({ claimedCents: 900 })] }).fact).not.toContain("ab12");
  });
});
