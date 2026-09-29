import { describe, it, expect } from "vitest";
import { computePot, sharesToRaw } from "@/lib/pot";

const SP = 1_146_000_000n; // share price, 1e9 scale: 1 share = 1.146 SKR
/** The position after a fruit-only pick of 46 SKR at SP: the pick burns 40,139,616 of 1,000,000,000 shares (46e6 x 1e9 / 1.146e9, floored). */
const AFTER_PICK = 959_860_384n;

describe("computePot", () => {
  it("earned is value minus what is still put in, at the program's share price", () => {
    const pot = computePot({
      position: { shares: 1_000_000_000n, stakedRaw: sharesToRaw(1_000_000_000n, SP), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: SP, joined: { shares: 0n, sharePrice: 0n },
      legsRaw: [1_100_000_000n], adjustments: [], picks: [],
    });
    expect(pot.skrPutInRaw).toBe(1_100_000_000n);
    expect(pot.skrEarnedRaw).toBe(46_000_000n);
  });

  // [A15] A fruit-only pick takes the fruit and leaves the plant: earned starts again from zero.
  it("a fruit-only pick leaves earned 0 and fruit 0", () => {
    const pot = computePot({
      position: { shares: AFTER_PICK, stakedRaw: sharesToRaw(AFTER_PICK, SP), unstakingRaw: 46_000_000n, unstakeTs: 1n },
      sharePrice: SP, joined: { shares: 0n, sharePrice: 0n }, legsRaw: [1_100_000_000n], adjustments: [],
      picks: [{ amountRaw: 46_000_000n, principalRaw: 0n }],
    });
    expect(pot.skrEarnedRaw).toBe(0n);
    expect(pot.fruit).toBe(0);
    expect(pot.skrPickedRaw).toBe(46_000_000n);
  });

  it("after a pick, two reward steps count from zero", () => {
    // the same position, two 0.0905% steps later
    const price = 1_148_074_000n;
    const pot = computePot({
      position: { shares: AFTER_PICK, stakedRaw: sharesToRaw(AFTER_PICK, price), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: price, joined: { shares: 0n, sharePrice: 0n }, legsRaw: [1_100_000_000n], adjustments: [],
      picks: [{ amountRaw: 46_000_000n, principalRaw: 0n }],
    });
    expect(pot.skrEarnedRaw).toBeGreaterThan(1_900_000n);
    expect(pot.skrEarnedRaw).toBeLessThan(2_100_000n);
  });

  it("a principal pick lowers what is put in, so earned is not re-offered", () => {
    const pot = computePot({
      position: { shares: 500_000_000n, stakedRaw: sharesToRaw(500_000_000n, SP), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: SP, joined: { shares: 0n, sharePrice: 0n }, legsRaw: [1_100_000_000n], adjustments: [],
      picks: [{ amountRaw: 619_000_000n, principalRaw: 573_000_000n }],
    });
    expect(pot.skrPutInRaw).toBe(527_000_000n);
    expect(pot.skrEarnedRaw).toBe(46_000_000n);
    expect(pot.skrPrincipalPickedRaw).toBe(573_000_000n);
  });

  // Review Focus 1 / R61: a Seeker that already staked from its wallet brings put in, not fruit.
  it("a pre-existing position is put in, not earned", () => {
    const pot = computePot({
      position: { shares: 1_000_000_000n, stakedRaw: sharesToRaw(1_000_000_000n, SP), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: SP, joined: { shares: 1_000_000_000n, sharePrice: SP }, legsRaw: [], adjustments: [], picks: [],
    });
    expect(pot.skrPutInRaw).toBe(1_146_000_000n);
    expect(pot.skrEarnedRaw).toBe(0n);
  });

  it("an own stake found by the reconciliation counts as put in; an own unstake as picked", () => {
    const pot = computePot({
      position: { shares: 2_000_000_000n, stakedRaw: sharesToRaw(2_000_000_000n, SP), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: SP, joined: { shares: 0n, sharePrice: 0n }, legsRaw: [1_100_000_000n],
      adjustments: [{ kind: "own_stake", sharesDelta: 1_000_000_000n, amountRaw: 1_140_000_000n }],
      picks: [],
    });
    expect(pot.skrPutInRaw).toBe(2_240_000_000n);
    expect(pot.skrEarnedRaw).toBe(52_000_000n);
  });

  it("never reports negative earned (a read the chain cannot back shows zero fruit)", () => {
    const pot = computePot({
      position: { shares: 900_000_000n, stakedRaw: sharesToRaw(900_000_000n, SP), unstakingRaw: 0n, unstakeTs: null },
      sharePrice: SP, joined: { shares: 0n, sharePrice: 0n }, legsRaw: [1_100_000_000n], adjustments: [], picks: [],
    });
    expect(pot.skrEarnedRaw).toBe(0n);
  });

  it("fruit: first at 0.25% of put in, then one per further 1%, capped at 12 (R59)", () => {
    const putIn = 100_000_000_000n; // 100,000 SKR
    expect(computePot.fruitCount(putIn, 249_000_000n)).toBe(0);
    expect(computePot.fruitCount(putIn, 250_000_000n)).toBe(1);
    expect(computePot.fruitCount(putIn, 1_249_000_000n)).toBe(1);
    expect(computePot.fruitCount(putIn, 1_250_000_000n)).toBe(2);
    expect(computePot.fruitCount(putIn, 50_000_000_000n)).toBe(12);
    expect(computePot.fruitCount(0n, 5n)).toBe(0);
  });
});
