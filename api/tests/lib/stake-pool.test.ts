import { describe, it, expect } from "vitest";
import { parseStakePool, solPerToken } from "@/lib/stake-pool";
import fixture from "../fixtures/stake-pool-jitosol.json";

const u8 = (n: number) => Buffer.from([n]);
const zeros = (n: number) => Buffer.alloc(n);
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

/** A stake pool account laid out by hand, with the variable-length tail fields set as asked. */
function pool(o: { nextEpochFee: boolean; depositAuth: boolean; totals: [bigint, bigint, bigint]; last: [bigint, bigint] }): Buffer {
  return Buffer.concat([
    u8(1), zeros(32 * 3), u8(255), zeros(32 * 5),                 // account_type, manager, staker, deposit authority, bump, 5 pubkeys
    u64(o.totals[0]), u64(o.totals[1]), u64(o.totals[2]),         // total_lamports, pool_token_supply, last_update_epoch
    zeros(48), zeros(16),                                         // lockup, epoch_fee
    o.nextEpochFee ? Buffer.concat([u8(1), zeros(16)]) : u8(0),   // next_epoch_fee: FutureEpoch<Fee>
    u8(0), u8(0),                                                 // preferred deposit / withdraw validator: Option<Pubkey> None
    zeros(16), zeros(16),                                         // stake_deposit_fee, stake_withdrawal_fee
    u8(0),                                                        // next_stake_withdrawal_fee None
    u8(0),                                                        // stake_referral_fee
    o.depositAuth ? Buffer.concat([u8(1), zeros(32)]) : u8(0),    // sol_deposit_authority: Option<Pubkey>
    zeros(16), u8(0), u8(0), zeros(16), u8(0),                    // sol_deposit_fee, sol_referral_fee, sol_withdraw_authority None, sol_withdrawal_fee, next_sol_withdrawal_fee None
    u64(o.last[0]), u64(o.last[1]),                               // last_epoch_pool_token_supply, last_epoch_total_lamports
  ]);
}

// Spec 5.2: the pools DO store the last-epoch pair, after variable-length Borsh fields; the tail is walked, never assumed.
describe("parseStakePool", () => {
  it("reads the totals and the last-epoch pair whatever the tail's optional fields hold", () => {
    for (const nextEpochFee of [false, true]) for (const depositAuth of [false, true]) {
      const t = parseStakePool(pool({ nextEpochFee, depositAuth, totals: [1_000n, 800n, 1046n], last: [790n, 985n] }));
      expect(t).toEqual({ totalLamports: 1_000n, poolTokenSupply: 800n, lastUpdateEpoch: 1046n, lastEpochPoolTokenSupply: 790n, lastEpochTotalLamports: 985n });
    }
  });

  it("parses the real JitoSOL pool captured from mainnet", () => {
    expect(fixture.owner).toBe("SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy");
    const t = parseStakePool(Buffer.from(fixture.data[0], "base64"));
    expect(t.poolTokenSupply).toBeGreaterThan(0n);
    const now = solPerToken(t.totalLamports, t.poolTokenSupply)!;
    const prev = solPerToken(t.lastEpochTotalLamports, t.lastEpochPoolTokenSupply)!;
    expect(now).toBeGreaterThan(1.2);
    expect(now).toBeLessThan(1.6);
    expect(prev).toBeLessThanOrEqual(now);
    expect(now / prev - 1).toBeLessThan(0.001); // one epoch's growth is a fraction of a percent
    expect(t.lastUpdateEpoch).toBeGreaterThanOrEqual(1046n);
  });

  it("refuses an account that is not a stake pool", () => {
    expect(() => parseStakePool(Buffer.alloc(611))).toThrow(/stake pool/);
  });
});
