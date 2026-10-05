import { describe, it, expect } from "vitest";
import type { Split, Stop, Pins } from "@/lib/coins";
import { managedPreview } from "@/model/manager";
import golden from "../fixtures/managed-preview-golden.json";

// R346: the Rules preview must show what the API will compute at save. The cases were produced by the API's own effectiveSplit
// (tests/fixtures/gen-managed-preview.mts); regenerate them whenever api/src/domain/split.ts changes.
type Case = { stopSplit: Split; pins: Pins; stop: Stop; want: Split };

describe("managedPreview agrees with the API's effectiveSplit (managed, 0 pins only)", () => {
  it("his screen: Balanced 65/10/15/10, every coin on, then hSOL off", () => {
    const [on, hsolOff] = golden as Case[];
    expect(managedPreview(on.stopSplit, on.pins, on.stop)).toEqual(on.want);
    expect(managedPreview(hsolOff.stopSplit, hsolOff.pins, hsolOff.stop)).toEqual(hsolOff.want);
    expect(hsolOff.want.hSOL).toBe(0);
  });
  it("every coin off leaves SKR at 100", () => {
    const c = (golden as Case[])[2];
    expect(managedPreview(c.stopSplit, c.pins, c.stop)).toEqual({ SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
  });
  it("all 403 cases", () => {
    (golden as Case[]).forEach((c, i) => expect(managedPreview(c.stopSplit, c.pins, c.stop), `case ${i}`).toEqual(c.want));
  });
});
