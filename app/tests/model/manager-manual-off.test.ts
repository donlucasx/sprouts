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

  it("setManualCoinOn switches a coin off and back on, keeps other pins, SKR too (11-15)", () => {
    expect(setManualCoinOn({ hSOL: 20 }, "stORE", false)).toEqual({ hSOL: 20, stORE: 0 });
    expect(setManualCoinOn({ hSOL: 20, stORE: 0 }, "stORE", true)).toEqual({ hSOL: 20 });
    expect(setManualCoinOn({ hSOL: 20 }, "hSOL", false)).toEqual({ hSOL: 0 });
    expect(setManualCoinOn({ hSOL: 20 }, "SKR", false)).toEqual({ hSOL: 20, SKR: 0 });
  });

  it("offCoins lists the 0 pins, SKR included (11-15)", () => {
    expect(offCoins({ stORE: 0, hSOL: 20, cbBTC: 0 })).toEqual(["stORE", "cbBTC"]);
    expect(offCoins({ SKR: 0 })).toEqual(["SKR"]);
    expect(offCoins({})).toEqual([]);
  });

  it("canStepUp counts stORE at its default only while it is on and unpinned", () => {
    const view = (pins: Record<string, number>) => ({ managed: false, stop: "balanced" as const, pins, allocation: split({ SKR: 100 }) });
    // on: 10 (default) + 75 + 15 + 5 = 105, refused (11-15: the cap is the total of 100, not SKR's quarter)
    expect(canStepUp(view({ hSOL: 75, cbBTC: 10 }), "cbBTC")).toBe(true);
    expect(canStepUp(view({ hSOL: 75, cbBTC: 15 }), "cbBTC")).toBe(false);
    // off: the default's 10 is free
    expect(canStepUp(view({ hSOL: 75, cbBTC: 15, stORE: 0 }), "cbBTC")).toBe(true);
  });

  it("copy: the floor line says the switch, the disclosure drops the recommendation line, How it works names the USDC", () => {
    expect(STORE_FLOOR_LINE.off).toBe("stORE starts at 10% until you change it.");   // 11-15: a default
    expect(ORE_DISCLOSURE).not.toMatch(/recommend/i);
    expect(ORE_DISCLOSURE).toMatch(/stORE starts at 10% of your split until you change it or switch it off in Rules\.$/);
    expect(HOW_IT_WORKS).not.toMatch(/coins you chose/);
    expect(HOW_IT_WORKS).toMatch(/paid from the USDC in your linked wallet/);
    for (const s of [ORE_DISCLOSURE, HOW_IT_WORKS, STORE_FLOOR_LINE.off]) expect(s).not.toMatch(/—/);
  });
});
