import { describe, it, expect } from "vitest";
import type { Pins, Split } from "@/lib/coins";
import { managedPins, managedPreview, pinsForOff, pinsForOn, setCoinOn, saveSwitches } from "@/model/manager";

const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...p });

// Device bug 11-16 (task 12): manager on with USDC and SOL, SKR switched on, Save: SKR came back off. The managed save sent no SKR
// key and no `off`, so the API's 0.1.10 carry-over (A2) kept the old SKR 0. Controller ruling: the app always sends its full switch
// list, `off` included, with every save that carries pins.
describe("saveSwitches: the pins and switches a save sends", () => {
  it("manager on: the 0 pins and `off` listing every coin that is off (SKR included when off)", () => {
    expect(saveSwitches({ managed: true, pins: { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 } }, false, true)).toEqual({
      pins: { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 },
      off: ["SKR", "stORE", "hSOL", "cbBTC"],
    });
  });

  it("manager on, SKR switched on: no SKR key and `off` without SKR (the API's off-branch applies, not A2)", () => {
    const body = saveSwitches({ managed: true, pins: setCoinOn({ SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 }, "SKR", true) }, false, true);
    expect(body).toEqual({ pins: { stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["stORE", "hSOL", "cbBTC"] });
  });

  it("manager on, an old non-zero pin is not sent (R346) and is not in `off`", () => {
    expect(saveSwitches({ managed: true, pins: { SKR: 40, hSOL: 0 } }, false, true)).toEqual({ pins: { hSOL: 0 }, off: ["hSOL"] });
  });

  it("manager off, unchanged behaviour: explicit drafts go through pinsToSave, untouched splits send nothing", () => {
    expect(saveSwitches({ managed: false, pins: { USDC_LEND: 100, SKR: 0 } }, true, true)).toEqual({
      pins: { SKR: 0, stORE: 0, USDC_LEND: 100, SOL_LEND: 0, hSOL: 0, cbBTC: 0 },
      off: ["SKR", "stORE", "SOL_LEND", "hSOL", "cbBTC"],
    });
    expect(saveSwitches({ managed: false, pins: { hSOL: 20, stORE: 0 } }, false, true)).toEqual({ pins: { hSOL: 20, stORE: 0 }, off: ["stORE"] });
    expect(saveSwitches({ managed: false, pins: { hSOL: 20 } }, false, false)).toEqual({});
  });
});

// His sequence from the production rows (11-16 19:22 to 19:24), through the screen's own helpers in the order the screen calls them.
// The bodies are the literals api/tests/routes/rules-skr-on-managed.test.ts replays through the route.
describe("his sequence 11-16, app side", () => {
  const savedPins: Pins = { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 }; // manager on, only USDC and SOL lending on
  const savedAlloc = split({ SOL_LEND: 35, USDC_LEND: 65 });

  it("off, save; on, save; SKR on, save: SOL lending is never switched off and the last body turns SKR on", () => {
    // 19:23:15 the manager off with nothing else changed: the draft is the planted split (Task 11), saved explicit.
    const offDraft = pinsForOff(savedAlloc, managedPins(savedPins));
    const manualBody = saveSwitches({ managed: false, pins: offDraft }, true, true);
    expect(manualBody).toEqual({
      pins: { SKR: 0, stORE: 0, USDC_LEND: 65, SOL_LEND: 35, hSOL: 0, cbBTC: 0 },
      off: ["SKR", "stORE", "hSOL", "cbBTC"],
    });
    // The API saves those pins as they are (its off-branch); the screen reads them back.
    const afterManual = manualBody.pins!;
    // 19:23:20 the manager back on, saved.
    const onBody = saveSwitches({ managed: true, pins: pinsForOn(afterManual) }, false, true);
    expect(onBody).toEqual({ pins: { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["SKR", "stORE", "hSOL", "cbBTC"] });
    // 19:24:25 SKR switched on, saved.
    const skrOnBody = saveSwitches({ managed: true, pins: setCoinOn(onBody.pins!, "SKR", true) }, false, true);
    expect(skrOnBody).toEqual({ pins: { stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["stORE", "hSOL", "cbBTC"] });
    for (const body of [manualBody, onBody, skrOnBody]) expect(body.pins!.SOL_LEND).not.toBe(0);
    // The preview he saw (bold's default split as the stop split) is what the API plants for this body (its replay test).
    expect(managedPreview(split({ SKR: 25, stORE: 10, USDC_LEND: 20, SOL_LEND: 15, hSOL: 20, cbBTC: 10 }), skrOnBody.pins!, "bold")).toEqual(split({ SKR: 45, SOL_LEND: 35, USDC_LEND: 20 }));
  });

  it("the variants: off/on again without saving, SKR on in the manual draft, SKR on before the round trip: SOL lending stays on", () => {
    // Manager off (unsaved), SKR on in the manual draft, manager back on: the managed draft.
    const viaManual = pinsForOn({ ...pinsForOff(savedAlloc, managedPins(savedPins)), SKR: undefined } as Pins);
    // SKR on first, then off with the coins changed (planted = the preview; any split), then on again.
    const viaPreview = pinsForOn(pinsForOff(split({ SKR: 25, SOL_LEND: 35, USDC_LEND: 40 }), setCoinOn(savedPins, "SKR", true)));
    for (const pins of [viaManual, viaPreview]) {
      expect(pins.SOL_LEND).toBeUndefined();
      expect(saveSwitches({ managed: true, pins }, false, true)).toEqual({ pins: { stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["stORE", "hSOL", "cbBTC"] });
    }
  });
});
