import { describe, it, expect } from "vitest";
import { costMicrocents, MONTH_CAP_MICROCENTS } from "@/lib/ai-budget";

describe("costMicrocents (Haiku 5.5: $0.10 per million tokens in, $0.50 per million out)", () => {
  it("prices a call in microcents", () => {
    expect(costMicrocents({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(10_000_000);
    expect(costMicrocents({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(50_000_000);
    expect(costMicrocents({ inputTokens: 400, outputTokens: 60 })).toBe(4_000 + 3_000);
  });
  it("the month cap is $10", () => {
    expect(MONTH_CAP_MICROCENTS).toBe(1_000_000_000);
  });
});
