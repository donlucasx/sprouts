import { describe, it, expect } from "vitest";
import { zeroSplit, type Split } from "@/domain/coins";
import { STOP_DEFAULTS, MANUAL_FLOOR, validatePins, effectiveSplit, withStoreFloor } from "@/domain/split";

const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const BAL = STOP_DEFAULTS.balanced;

// His ruling 10-23: "in full manual mode a user should be able to turn off any token" (then "maybe keep SKR on, for now"). A 0 pin
// with the manager off is a coin switched off; its share folds into SKR (the rest), and stORE switched off keeps no floor.
describe("manual off switches (10-23)", () => {
  it("stORE switched off: no floor, its share is SKR's", () => {
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 0 }, stopSplit: BAL })).toEqual(split({ SKR: 100 }));
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 0, hSOL: 30 }, stopSplit: BAL })).toEqual(split({ SKR: 70, hSOL: 30 }));
  });

  it("stORE on (no pin, or a pin) keeps its floor beside another coin switched off", () => {
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { cbBTC: 0 }, stopSplit: BAL })).toEqual(split({ SKR: 90, stORE: 10 }));
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { cbBTC: 0, stORE: 20, hSOL: 15 }, stopSplit: BAL })).toEqual(split({ SKR: 65, stORE: 20, hSOL: 15 }));
  });

  it("pins that fill up to SKR's quarter with stORE off take nothing for stORE", () => {
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 0, hSOL: 40, cbBTC: 35 }, stopSplit: BAL })).toEqual(split({ SKR: 25, hSOL: 40, cbBTC: 35 }));
    // the same pins with stORE on: the floor comes from the largest pin, SKR keeps its quarter
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { hSOL: 40, cbBTC: 35 }, stopSplit: BAL })).toEqual(split({ SKR: 25, stORE: 10, hSOL: 30, cbBTC: 35 }));
  });

  it("a disabled leg still hands its share on with stORE switched off", () => {
    const s = effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 0, hSOL: 30 }, stopSplit: BAL, disabled: ["hSOL"] });
    expect(s.stORE).toBe(0);
    expect(s.hSOL).toBe(0);
  });

  it("validatePins accepts 0 pins (the switches) without counting them", () => {
    expect(validatePins({ stORE: 0, USDC_LEND: 0, hSOL: 75 }, MANUAL_FLOOR)).toBeNull();
  });

  it("the planting net honours a switched-off stORE and still floors a split saved without one", () => {
    expect(withStoreFloor(split({ SKR: 100 }), { skrFloor: MANUAL_FLOOR, off: true })).toEqual(split({ SKR: 100 }));
    expect(withStoreFloor(split({ SKR: 100 }), { skrFloor: MANUAL_FLOOR, off: false })).toEqual(split({ SKR: 90, stORE: 10 }));
  });
});
