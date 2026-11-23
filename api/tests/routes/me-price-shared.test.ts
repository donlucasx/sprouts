import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// 11-23 (Kimi scope item 2): the two display routes read the SOL / coin price through the shared 120 s memo, not a fresh Jupiter call;
// the top-up (a money route) keeps reading fresh.
describe("display routes use the shared price read", () => {
  for (const f of ["src/app/api/me/usdc/route.ts", "src/app/api/me/preview/route.ts"]) {
    it(f, () => {
      const s = readFileSync(f, "utf8");
      expect(s).toMatch(/sharedPriceUsd\(/);
      expect(s).not.toMatch(/from "@\/lib\/jupiter"/);
    });
  }
  it("the top-up keeps a fresh price read", () => {
    const s = readFileSync("src/lib/topup.ts", "utf8");
    expect(s).toMatch(/await pricesUsd\(\[inputMint\]\)/);
    expect(s).not.toMatch(/shared-reads/);
  });
});
