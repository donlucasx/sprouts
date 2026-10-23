import { describe, it, expect } from "vitest";
import type { Split } from "@/lib/coins";
import { manualSplit, splitRows, setManualCoinOn, offCoins, canStepUp, STORE_FLOOR_LINE } from "@/model/manager";
import { ORE_DISCLOSURE } from "@/lib/ore-copy";
import { HOW_IT_WORKS } from "@/lib/settings-copy";

const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...p });

// His ruling 10-23: with the manager off every coin but SKR has an off switch (a 0 pin). The want values are the API's
// effectiveSplit answers for the same pins (api/tests/domain/split-manual-off.test.ts).
describe("manual off switches (10-23)", () => {
  it("manualSplit matches the API: stORE off has no floor, its share is SKR's", () => {
    expect(manualSplit({ stORE: 0 })).toEqual(split({ SKR: 100 }));
    expect(manualSplit({ stORE: 0, hSOL: 30 })).toEqual(split({ SKR: 70, hSOL: 30 }));
    expect(manualSplit({ stORE: 0, hSOL: 40, cbBTC: 35 })).toEqual(split({ SKR: 25, hSOL: 40, cbBTC: 35 }));
    expect(manualSplit({ hSOL: 40, cbBTC: 35 })).toEqual(split({ SKR: 25, stORE: 10, hSOL: 30, cbBTC: 35 }));
    expect(manualSplit({ cbBTC: 0, stORE: 20, hSOL: 15 })).toEqual(split({ SKR: 65, stORE: 20, hSOL: 15 }));
  });

  it("splitRows reads a 0 pin as off; SKR is always the rest", () => {
    const rows = splitRows({ managed: false, stop: "balanced", pins: { stORE: 0, hSOL: 20 }, allocation: split({ SKR: 100 }) });
    expect(rows.find((r) => r.asset === "stORE")).toMatchObject({ mode: "off", pct: 0 });
    expect(rows.find((r) => r.asset === "hSOL")).toMatchObject({ mode: "pinned", pct: 20 });
    expect(rows.find((r) => r.asset === "SKR")).toMatchObject({ mode: "the rest", pct: 80 });
    expect(rows.find((r) => r.asset === "cbBTC")!.mode).toBe("pinned");
  });

  it("setManualCoinOn switches a coin off and back on, keeps other pins, and never touches SKR", () => {
    expect(setManualCoinOn({ hSOL: 20 }, "stORE", false)).toEqual({ hSOL: 20, stORE: 0 });
    expect(setManualCoinOn({ hSOL: 20, stORE: 0 }, "stORE", true)).toEqual({ hSOL: 20 });
    expect(setManualCoinOn({ hSOL: 20 }, "hSOL", false)).toEqual({ hSOL: 0 });
    expect(setManualCoinOn({ hSOL: 20 }, "SKR", false)).toEqual({ hSOL: 20 });
  });

  it("offCoins lists the 0 pins, never SKR", () => {
    expect(offCoins({ stORE: 0, hSOL: 20, cbBTC: 0 })).toEqual(["stORE", "cbBTC"]);
    expect(offCoins({ SKR: 0 } as never)).toEqual([]);
    expect(offCoins({})).toEqual([]);
  });

  it("canStepUp counts stORE at its floor only while it is on", () => {
    const view = (pins: Record<string, number>) => ({ managed: false, stop: "balanced" as const, pins, allocation: split({ SKR: 100 }) });
    // on: 10 (floor) + 60 + 5 = 75 = 100 - 25, allowed; from 65 it would crowd SKR's quarter
    expect(canStepUp(view({ hSOL: 60 }), "hSOL")).toBe(true);
    expect(canStepUp(view({ hSOL: 65 }), "hSOL")).toBe(false);
    // off: the floor's 10 is free
    expect(canStepUp(view({ hSOL: 65, stORE: 0 }), "hSOL")).toBe(true);
  });

  it("copy: the floor line says the switch, the disclosure drops the recommendation line, How it works names the USDC", () => {
    expect(STORE_FLOOR_LINE.off).toBe("stORE stays at 10% or more while it's on.");
    expect(ORE_DISCLOSURE).not.toMatch(/recommend/i);
    expect(ORE_DISCLOSURE).toMatch(/Sprouts keeps 10% of every split in stORE unless you switch it off in Rules\.$/);
    expect(HOW_IT_WORKS).not.toMatch(/coins you chose/);
    expect(HOW_IT_WORKS).toMatch(/paid from the USDC in your linked wallet/);
    for (const s of [ORE_DISCLOSURE, HOW_IT_WORKS, STORE_FLOOR_LINE.off]) expect(s).not.toMatch(/—/);
  });
});
