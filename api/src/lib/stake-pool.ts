export type StakePoolTotals = { totalLamports: bigint; poolTokenSupply: bigint; lastUpdateEpoch: bigint; lastEpochPoolTokenSupply: bigint; lastEpochTotalLamports: bigint };

/**
 * The SPL stake pool account (Borsh). The totals sit at fixed offsets after the header; the last-epoch pair sits after three
 * FutureEpoch<Fee> and four Option<Pubkey> fields of variable length, so the tail is walked field by field (a fixed-offset read
 * misses it: Kimi's design audit, finding 1, overturned on chain 2026-09-30). Verified against hSOL, JitoSOL and JupSOL.
 */
export function parseStakePool(data: Uint8Array): StakePoolTotals {
  const b = Buffer.from(data);
  if (b.length < 300 || b[0] !== 1) throw new Error(`not a stake pool account (${b.length} bytes, account_type ${b[0] ?? "none"})`);
  let o = 1 + 32 * 3 + 1 + 32 * 5; // account_type; manager, staker, stake_deposit_authority; bump; validator_list, reserve_stake, pool_mint, manager_fee_account, token_program_id
  const totalLamports = b.readBigUInt64LE(o);
  const poolTokenSupply = b.readBigUInt64LE(o + 8);
  const lastUpdateEpoch = b.readBigUInt64LE(o + 16);
  o += 24;
  o += 48; // lockup
  o += 16; // epoch_fee
  const future = () => { o += b[o] === 0 ? 1 : 17; };   // FutureEpoch<Fee>: None | One(Fee) | Two(Fee)
  const option = () => { o += b[o] === 0 ? 1 : 33; };   // Option<Pubkey>
  future();  // next_epoch_fee
  option();  // preferred_deposit_validator_vote_address
  option();  // preferred_withdraw_validator_vote_address
  o += 16;   // stake_deposit_fee
  o += 16;   // stake_withdrawal_fee
  future();  // next_stake_withdrawal_fee
  o += 1;    // stake_referral_fee
  option();  // sol_deposit_authority
  o += 16;   // sol_deposit_fee
  o += 1;    // sol_referral_fee
  option();  // sol_withdraw_authority
  o += 16;   // sol_withdrawal_fee
  future();  // next_sol_withdrawal_fee
  if (b.length < o + 16) throw new Error(`stake pool account too short: ${b.length} bytes, tail at ${o}`);
  return { totalLamports, poolTokenSupply, lastUpdateEpoch, lastEpochPoolTokenSupply: b.readBigUInt64LE(o), lastEpochTotalLamports: b.readBigUInt64LE(o + 8) };
}

/** SOL per pool token, the LST's growth measure; null for an empty pool. */
export const solPerToken = (lamports: bigint, supply: bigint): number | null => (supply === 0n ? null : Number(lamports) / Number(supply));
