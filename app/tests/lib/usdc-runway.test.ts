import { describe, it, expect } from "vitest";

describe("lowUsdcLine at zero (10-27)", async () => {
  const { lowUsdcLine } = await import("@/lib/usdc-runway");
  it("says nothing plants at $0, even with no average yet", () => {
    expect(lowUsdcLine(0, null)).toMatch(/no USDC, so nothing plants/);
    expect(lowUsdcLine(500, null)).toBeNull();
  });
});
