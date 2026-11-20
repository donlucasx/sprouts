import { describe, it, expect } from "vitest";
import { solLendSwapFloor, lendFeeRaw, leashSwapSlippageBps, SWAP_SLIPPAGE_BPS } from "@/lib/planting";
import { floorRaw, LEG_SPEC } from "@/lib/leash";
import { klendMinOut } from "@/lib/venues/klend";
import { jlendShares } from "@/lib/venues/jlend";
import type { AutoVenue } from "@/domain/venues";

/**
 * Task 15b (design memo sections 1-3): SOL lending takes 0.5% of the pull as a USDC transfer before the swap, then swaps the rest
 * with the coin legs' adaptive slippage aimed at the least swap output S whose venue min_out still reaches the leash floor F.
 * These are the pure parts: the venue inversion (Kimi: min_out(S) >= F > min_out(S - 1) on both venues), price.rs's two rounding
 * steps, and the floor sweep the budget arithmetic rests on.
 */
const SCALE = 1_000_000_000_000n;
type Rate = { rn: bigint; rd: bigint };
/** What each venue's leash min_out is for a deposit of `s` lamports, as planting.ts builds it. */
const venueMinOut = (venue: AutoVenue, s: bigint, r: Rate) => (venue === "kamino_klend" ? klendMinOut(s, r) : jlendShares(s, r.rn) - 1n);
const LEG: Record<AutoVenue, 4 | 5> = { kamino_klend: 4, jupiter_lend: 5 };
const floorOf = (venue: AutoVenue, pull: bigint, r: Rate, price: bigint, conf: bigint) => {
  const spec = LEG_SPEC[LEG[venue]];
  return floorRaw({ leg: LEG[venue], amountRaw: pull, rn: r.rn, rd: r.rd, priceLow: price - conf, exponent: -8, feeBps: spec.feeBps, tolBps: spec.tolBps, underlyingDecimals: 9 });
};
/** USDC raw -> lamports at a Pyth price (expo -8), less `lossBps` (the route's gap to Pyth): 1e-6 USD x 1e9 / (p x 1e-8) = raw x 1e11 / p. */
const quoteOut = (usdcRaw: bigint, price: bigint, lossBps: bigint) => (((usdcRaw * 100_000_000_000n) / price) * (10_000n - lossBps)) / 10_000n;

const PRICES = [2_000_000_000n, 15_000_000_000n, 100_000_000_000n];   // SOL $20, $150, $1,000 (expo -8)
const CONFS = (p: bigint) => [0n, (p * 50n) / 10_000n];   // conf 0 and 50 bps
const RATES: [AutoVenue, Rate][] = [
  ["kamino_klend", { rn: 10_000n, rd: 10_000n }], ["kamino_klend", { rn: 10_500n, rd: 10_000n }], ["kamino_klend", { rn: 13_000n, rd: 10_000n }],
  ["jupiter_lend", { rn: SCALE, rd: SCALE }], ["jupiter_lend", { rn: 1_070_000_000_000n, rd: SCALE }],
];
const BRIEF_PULLS = (() => { const p = [199n, 200n, 1_000_001n]; for (let x = 500_000n; x <= 5_000_000n; x += 250_000n) p.push(x); return p; })();
const CENT_PULLS = (() => { const p: bigint[] = []; for (let x = 10_000n; x <= 5_000_000n; x += 10_000n) p.push(x); return p; })();

describe("Task 15b: solLendSwapFloor, the least swap output whose venue min_out reaches the leash floor", () => {
  it("goldens on the fixture's numbers: Kamino 1.2038 and Jupiter Lend 1.05 at SOL $121.47 less conf $0.10, pull $2", () => {
    const pl = 12_147_000_000n - 10_000_000n;
    const k = { rn: 12_038n, rd: 10_000n }, j = { rn: 1_050_000_000_000n, rd: SCALE };
    const fk = floorRaw({ leg: 4, amountRaw: 2_000_000n, rn: k.rn, rd: k.rd, priceLow: pl, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 9 });
    const fj = floorRaw({ leg: 5, amountRaw: 2_000_000n, rn: j.rn, rd: j.rd, priceLow: pl, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 9 });
    expect([fk, fj]).toEqual([13_483_435n, 15_458_437n]);
    // Kamino: A = ceil(F x 10_000 / 9_998) = 13_486_133, S = ceil(A x 12_038 / 10_000) = 16_234_607.
    // Jupiter Lend: B = ceil((F + 1) x 1.05e12 / 1e12) = 16_231_360, S = ceil(B x 10_000 / 9_998) = 16_234_607.
    expect(solLendSwapFloor("kamino_klend", fk, k)).toBe(16_234_607n);
    expect(solLendSwapFloor("jupiter_lend", fj, j)).toBe(16_234_607n);
    expect([klendMinOut(16_234_607n, k), klendMinOut(16_234_606n, k)]).toEqual([13_483_435n, 13_483_434n]);
    expect([jlendShares(16_234_607n, j.rn) - 1n, jlendShares(16_234_606n, j.rn) - 1n]).toEqual([15_458_437n, 15_458_436n]);
  });

  it("inversion golden on both venues: min_out(S) >= F > min_out(S - 1), for every brief pull and whole-cent pull, price, conf and rate", () => {
    let n = 0;
    for (const pull of [...BRIEF_PULLS, ...CENT_PULLS]) for (const price of PRICES) for (const conf of CONFS(price)) for (const [venue, r] of RATES) {
      const f = floorOf(venue, pull, r, price, conf);
      expect(f > 0n, `${venue} pull ${pull} price ${price}`).toBe(true);
      const s = solLendSwapFloor(venue, f, r);
      const tag = `${venue} ${r.rn}/${r.rd} pull ${pull} price ${price} conf ${conf}: F ${f} S ${s}`;
      expect(venueMinOut(venue, s, r) >= f, tag).toBe(true);
      expect(venueMinOut(venue, s - 1n, r) < f, tag).toBe(true);
      n++;
    }
    expect(n).toBe((BRIEF_PULLS.length + CENT_PULLS.length) * 3 * 2 * 5);
  });

  it("refuses a non-positive rate and a negative floor", () => {
    expect(() => solLendSwapFloor("kamino_klend", 10n, { rn: 0n, rd: 1n })).toThrow(/rate/);
    expect(() => solLendSwapFloor("jupiter_lend", 10n, { rn: 0n, rd: SCALE })).toThrow(/rate/);
    expect(() => solLendSwapFloor("kamino_klend", -1n, { rn: 1n, rd: 1n })).toThrow(/floor/);
  });
});

describe("Task 15b: the floor sweep (fee 50 taken before the swap, adaptive slippage, legs 4/5 at fee 50 tol 100)", () => {
  it("price.rs's two rounding steps: net = floor(amount x keep / 10_000), floor = ceil(n / d); both bite somewhere in the sweep", () => {
    let netFloored = 0, ceiled = 0;
    for (const pull of [...BRIEF_PULLS, ...CENT_PULLS]) for (const price of PRICES) for (const conf of CONFS(price)) for (const [venue, r] of RATES) {
      const keep = 9_850n;
      const net = (pull * keep) / 10_000n;
      expect(net * 10_000n <= pull * keep && (net + 1n) * 10_000n > pull * keep).toBe(true);
      if (net * 10_000n !== pull * keep) netFloored++;
      // exponent -8: s = -8 + 6 = -2 < 0, so n = net x rd x 1e9 x 1e2 and d = rn x p_low (price.rs, as floorRaw ports it)
      const num = net * r.rd * 1_000_000_000n * 100n, den = r.rn * (price - conf);
      const f = floorOf(venue, pull, r, price, conf);
      expect((f - 1n) * den < num && f * den >= num, `${venue} pull ${pull}`).toBe(true);
      if (num % den !== 0n) { ceiled++; expect(f).toBe(num / den + 1n); }
      // and the floor is never under the exact (unrounded-net) value's ceiling less one: flooring net can only lower it
      const exact = (pull * keep * r.rd * 1_000_000_000n * 100n + 10_000n * den - 1n) / (10_000n * den);
      expect(f <= exact).toBe(true);
    }
    expect(netFloored).toBeGreaterThan(0);
    expect(ceiled).toBeGreaterThan(0);
  });

  it("legs 4 and 5: floorRaw is identical at fee 0 / tol 150 (before) and fee 50 / tol 100 (after), for every sweep point", () => {
    for (const pull of BRIEF_PULLS) for (const price of PRICES) for (const conf of CONFS(price)) for (const [venue, r] of RATES) {
      const at = (feeBps: number, tolBps: number) => floorRaw({ leg: LEG[venue], amountRaw: pull, rn: r.rn, rd: r.rd, priceLow: price - conf, exponent: -8, feeBps, tolBps, underlyingDecimals: 9 });
      expect(at(50, 100)).toBe(at(0, 150));
    }
  });

  it("a route at Pyth less 20 bp: the slippage is non-null, at most 100, and the deposit (the swap minimum) clears the floor, for every whole-cent pull from 1 cent to $5", () => {
    for (const pull of [...CENT_PULLS, 1_000_001n, ...BRIEF_PULLS.filter((p) => p >= 10_000n)]) for (const price of PRICES) for (const conf of CONFS(price)) for (const [venue, r] of RATES) {
      const f = floorOf(venue, pull, r, price, conf);
      const s = solLendSwapFloor(venue, f, r);
      const out = quoteOut(pull - lendFeeRaw(pull), price, 20n);
      const bps = leashSwapSlippageBps(out, s);
      const tag = `${venue} ${r.rn} pull ${pull} price ${price} conf ${conf}: out ${out} S ${s}`;
      expect(bps, tag).not.toBeNull();
      expect(bps! <= SWAP_SLIPPAGE_BPS, tag).toBe(true);
      const minimum = (out * BigInt(10_000 - bps!)) / 10_000n;   // Jupiter's otherAmountThreshold at that slippage
      expect(minimum >= s, tag).toBe(true);
      expect(venueMinOut(venue, minimum, r) >= f, tag).toBe(true);   // deposit = minimum + carry; carry 0 is the worst case
    }
  });

  it("sub-cent pulls 199 and 200 (never made: pulls are whole cents): the inversion holds; at $20 and $150 a route at Pyth less 20 bp still clears; any miss fails closed as 'route under floor'", () => {
    for (const pull of [199n, 200n]) for (const price of PRICES) for (const conf of CONFS(price)) for (const [venue, r] of RATES) {
      const f = floorOf(venue, pull, r, price, conf);
      const s = solLendSwapFloor(venue, f, r);
      const out = quoteOut(pull - lendFeeRaw(pull), price, 20n);
      const bps = leashSwapSlippageBps(out, s);
      if (price <= 15_000_000_000n) expect(bps, `${venue} pull ${pull} price ${price}`).not.toBeNull();
      if (bps !== null) expect(venueMinOut(venue, (out * BigInt(10_000 - bps)) / 10_000n, r) >= f).toBe(true);
      else expect(out < s).toBe(true);   // the builder throws "route under floor" before signing
    }
  });

  it("regression (Kimi HIGH-1): the fixed 100 bps swap after a 50 bps fee lands under the floor even at Pyth with conf 0, for every pull from $0.50", () => {
    for (const pull of BRIEF_PULLS.filter((p) => p >= 500_000n)) for (const price of PRICES) for (const [venue, r] of RATES) {
      const f = floorOf(venue, pull, r, price, 0n);
      const out = quoteOut(pull - lendFeeRaw(pull), price, 0n);
      const fixed = (out * BigInt(10_000 - SWAP_SLIPPAGE_BPS)) / 10_000n;
      expect(venueMinOut(venue, fixed, r) < f, `${venue} ${r.rn} pull ${pull} price ${price}`).toBe(true);
    }
  });
});
