import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { zeroSplit, type Split } from "@/domain/coins";
import { STOP_DEFAULTS } from "@/domain/split";
import { PUT as putRules } from "@/app/api/rules/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
let repo: MemoryRepo;
let auth: Record<string, string>;
const put = (body: unknown) => putRules(new Request("http://x/api/rules", { method: "PUT", headers: auth, body: JSON.stringify(body) }));
type Answer = { allocation: Split; pins: Record<string, number>; managed: boolean; error?: string };
const json = async (r: Response) => (await r.json()) as Answer;

beforeAll(() => { process.env.APP_ORIGIN ??= "https://sprouts.money"; });
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  auth = { authorization: `Bearer ${await issueSession(U, "M")}` };
  // Bold's split: with only SOL and USDC lending on it plants SOL 35 (bold's SOL max) / USDC 65, as his rows show.
  await repo.putSplitDay({ day: "2026-11-16", stop: "bold", split: STOP_DEFAULTS.bold, modelAnswer: null, why: "w", fallback: null, callId: 1, venuePick: null });
});

// Device bug 11-16 (task 12), his rows 19:22 to 19:24 replayed with the bodies app/tests/model/manager-skr-on-save.test.ts pins.
describe("PUT /api/rules: the manager on, SKR switched on (device bug 11-16)", () => {
  const start = async () => {
    const b = await json(await put({ managed: true, stop: "bold", pins: { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["SKR", "stORE", "hSOL", "cbBTC"] }));
    expect(b.allocation).toEqual(split({ SOL_LEND: 35, USDC_LEND: 65 })); // 19:22:24
  };

  it("his sequence with the fixed app's bodies: SKR comes on with a share, SOL lending stays on", async () => {
    await start();
    // 19:23:15 the manager off: the planted split as explicit pins (pinsForOff, pinsToSave).
    const manual = await json(await put({ managed: false, pins: { SKR: 0, stORE: 0, USDC_LEND: 65, SOL_LEND: 35, hSOL: 0, cbBTC: 0 }, off: ["SKR", "stORE", "hSOL", "cbBTC"] }));
    expect(manual.allocation).toEqual(split({ SOL_LEND: 35, USDC_LEND: 65 }));
    // 19:23:20 back on.
    const on = await json(await put({ managed: true, pins: { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["SKR", "stORE", "hSOL", "cbBTC"] }));
    expect(on.pins).toEqual({ SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 });
    expect(on.allocation).toEqual(split({ SOL_LEND: 35, USDC_LEND: 65 }));
    // 19:24:25 SKR switched on: no SKR key, `off` without SKR.
    const res = await put({ pins: { stORE: 0, hSOL: 0, cbBTC: 0 }, off: ["stORE", "hSOL", "cbBTC"] });
    expect(res.status).toBe(200);
    const skrOn = await json(res);
    expect(skrOn.pins).toEqual({ stORE: 0, hSOL: 0, cbBTC: 0 });
    expect("SKR" in skrOn.pins).toBe(false);
    expect("SOL_LEND" in skrOn.pins).toBe(false);
    // The manager's stop split over SKR, SOL and USDC lending: SKR at least bold's 25, every free coin with a share.
    expect(skrOn.allocation.SKR).toBeGreaterThanOrEqual(25);
    expect(skrOn.allocation.SOL_LEND).toBeGreaterThan(0);
    expect(skrOn.allocation.USDC_LEND).toBeGreaterThan(0);
    expect(skrOn.allocation.SKR + skrOn.allocation.SOL_LEND + skrOn.allocation.USDC_LEND).toBe(100);
    expect(skrOn.allocation).toEqual(split({ SKR: 45, SOL_LEND: 35, USDC_LEND: 20 }));
  });

  it("the same save as the app sent it before the fix (no `off`): A2 keeps SKR off, the bug as he saw it", async () => {
    await start();
    const b = await json(await put({ pins: { stORE: 0, hSOL: 0, cbBTC: 0 } }));
    expect(b.pins.SKR).toBe(0);
    expect(b.allocation.SKR).toBe(0);
  });

  it("0.1.10's managed save (pins only, no `off`) still keeps an off SKR off", async () => {
    await start();
    const b = await json(await put({ managed: true, pins: { stORE: 0 } }));
    expect(b.pins.SKR).toBe(0);
    expect(b.allocation.SKR).toBe(0);
  });
});
