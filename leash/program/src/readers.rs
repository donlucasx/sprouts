//! Receipt and rate readers (contracts sec 2.7). Pure functions over (address, owner, data): the program passes
//! AccountView borrows, the tests pass synthetic bytes and mainnet dumps. One guard per line.
use pinocchio::Address;

use crate::{config::LegConfig, constants::*, errors::LeashError};

#[derive(Clone, Copy)]
pub struct Acct<'a> {
    pub key: &'a [u8; 32],
    pub owner: &'a [u8; 32],
    pub data: &'a [u8],
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}
fn u128_at(d: &[u8], o: usize) -> u128 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[o..o + 16]);
    u128::from_le_bytes(b)
}
fn pda(seeds: &[&[u8]], program: &Address) -> [u8; 32] {
    *Address::find_program_address(seeds, program).0.as_array()
}

pub fn canonical_ata(user: &[u8; 32], mint: &[u8; 32]) -> [u8; 32] {
    pda(&[&user[..], &TOKEN.as_array()[..], &mint[..]], &ATA_PROGRAM)
}
pub fn user_stake_address(stake_config: &[u8; 32], user: &[u8; 32], guardian_pool: &[u8; 32]) -> [u8; 32] {
    pda(&[USER_STAKE_SEED, &stake_config[..], &user[..], &guardian_pool[..]], &SKR_STAKING)
}

/// Readers TOKEN, STAKE_POOL, KLEND, JLEND, STORE: the user's canonical classic-SPL ATA of `receipt_mint`.
pub fn token_receipt(r: &Acct, user: &[u8; 32], leg: &LegConfig) -> Result<u128, LeashError> {
    use LeashError::{BadReceipt, ReceiptNotUsers};
    if r.owner != TOKEN.as_array() { return Err(BadReceipt); } // GUARD:T_OWNER
    if r.data.len() != 165 { return Err(BadReceipt); } // GUARD:T_LEN
    if r.data[0..32] != leg.receipt_mint { return Err(BadReceipt); } // GUARD:T_MINT
    if r.data[32..64] != *user { return Err(ReceiptNotUsers); } // GUARD:T_USER
    if *r.key != canonical_ata(user, &leg.receipt_mint) { return Err(BadReceipt); } // GUARD:T_ATA
    Ok(u64_at(r.data, 64) as u128)
}

/// SKR: the user's UserStake PDA. Absent (first planting) reads 0; settle then needs delta >= min_out > 0, so it must exist.
pub fn skr_receipt(r: &Acct, user: &[u8; 32], leg: &LegConfig) -> Result<u128, LeashError> {
    use LeashError::{BadReceipt, ReceiptNotUsers};
    if *r.key != user_stake_address(&leg.rate_account, user, &leg.extra) { return Err(BadReceipt); } // GUARD:S_ADDR
    if r.owner == SYSTEM.as_array() && r.data.is_empty() {
        return Ok(0);
    }
    if r.owner != SKR_STAKING.as_array() { return Err(BadReceipt); } // GUARD:S_OWNER
    if r.data.len() < 121 { return Err(BadReceipt); } // GUARD:S_LEN
    if r.data[0..8] != USER_STAKE_DISC { return Err(BadReceipt); } // GUARD:S_DISC
    if r.data[9..41] != leg.rate_account { return Err(BadReceipt); } // GUARD:S_CONFIG
    if r.data[41..73] != *user { return Err(ReceiptNotUsers); } // GUARD:S_USER
    if r.data[73..105] != leg.extra { return Err(BadReceipt); } // GUARD:S_GUARDIAN
    Ok(u128_at(r.data, 105))
}

/// `(rn, rd)`: underlying raw per receipt raw. `readers` must be exactly the leg's reader accounts (contracts sec 2.4).
pub fn rate(leg_index: usize, leg: &LegConfig, readers: &[Acct], epoch: u64) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    let reader = leg.reader as usize;
    if reader >= READER_ACCOUNTS.len() {
        return Err(B);
    }
    if readers.len() != READER_ACCOUNTS[reader] { return Err(B); } // GUARD:R_COUNT
    let (rn, rd) = match leg.reader {
        READER_TOKEN => (1, 1),
        READER_SKR_STAKE => skr_stake_rate(&readers[0], leg)?,
        READER_STAKE_POOL => stake_pool_rate(&readers[0], leg, epoch)?,
        READER_KLEND => klend_rate(&readers[0], leg, leg_index)?,
        READER_JLEND => jlend_rate(&readers[0], leg, leg_index)?,
        READER_STORE => store_rate(&readers[0], &readers[1], leg)?,
        _ => return Err(B),
    };
    if rn == 0 || rd == 0 { return Err(B); } // GUARD:R_ZERO
    Ok((rn, rd))
}

fn skr_stake_rate(a: &Acct, leg: &LegConfig) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    if *a.key != leg.rate_account { return Err(B); } // GUARD:SC_ADDR
    if a.owner != SKR_STAKING.as_array() { return Err(B); } // GUARD:SC_OWNER
    if a.data.len() < 153 { return Err(B); } // GUARD:SC_LEN
    if a.data[0..8] != STAKE_CONFIG_DISC { return Err(B); } // GUARD:SC_DISC
    if a.data[41..73] != *SKR_MINT.as_array() { return Err(B); } // GUARD:SC_MINT
    Ok((u128_at(a.data, 137), 1_000_000_000))
}

fn stake_pool_rate(a: &Acct, leg: &LegConfig, epoch: u64) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    if *a.key != leg.rate_account { return Err(B); } // GUARD:SP_ADDR
    if a.owner != STAKE_POOL_PROGRAM.as_array() { return Err(B); } // GUARD:SP_OWNER
    if a.data.len() < 282 { return Err(B); } // GUARD:SP_LEN
    if a.data[0] != 1 { return Err(B); } // GUARD:SP_TYPE
    if a.data[162..194] != leg.receipt_mint { return Err(B); } // GUARD:SP_MINT
    let last = u64_at(a.data, 274);
    if last > epoch { return Err(B); } // GUARD:SP_AHEAD
    // saturating: with SP_AHEAD deleted an ahead pool reads 0 here and the test sees Ok, not an underflow panic
    if epoch.saturating_sub(last) >= 2 { return Err(B); } // GUARD:SP_EPOCH
    Ok((u64_at(a.data, 258) as u128, u64_at(a.data, 266) as u128))
}

fn klend_rate(a: &Acct, leg: &LegConfig, leg_index: usize) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    if *a.key != leg.rate_account { return Err(B); } // GUARD:K_ADDR
    if a.owner != KLEND.as_array() { return Err(B); } // GUARD:K_OWNER
    if a.data.len() != KLEND_RESERVE_LEN { return Err(B); } // GUARD:K_LEN
    if a.data[0..8] != KLEND_RESERVE_DISC { return Err(B); } // GUARD:K_DISC
    if a.data[32..64] != *KLEND_MARKET.as_array() { return Err(B); } // GUARD:K_MARKET
    if a.data[128..160] != underlying_mint(leg_index) { return Err(B); } // GUARD:K_LIQ_MINT
    if a.data[2560..2592] != leg.receipt_mint { return Err(B); } // GUARD:K_COLL_MINT
    let fees = u128_at(a.data, 344).checked_add(u128_at(a.data, 360)).and_then(|f| f.checked_add(u128_at(a.data, 376))).ok_or(B)?;
    let borrowed = u128_at(a.data, 232);
    if fees > borrowed { return Err(B); } // GUARD:K_FEES
    // saturating: unreachable below K_FEES; with K_FEES deleted the test sees Ok, not an underflow panic
    Ok((u64_at(a.data, 224) as u128 + (borrowed.saturating_sub(fees) >> 60), u64_at(a.data, 2592) as u128))
}

fn jlend_rate(a: &Acct, leg: &LegConfig, leg_index: usize) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    if *a.key != leg.rate_account { return Err(B); } // GUARD:J_ADDR
    if a.owner != JLEND.as_array() { return Err(B); } // GUARD:J_OWNER
    if a.data.len() != JLEND_LENDING_LEN { return Err(B); } // GUARD:J_LEN
    if a.data[0..8] != JLEND_LENDING_DISC { return Err(B); } // GUARD:J_DISC
    if a.data[8..40] != underlying_mint(leg_index) { return Err(B); } // GUARD:J_MINT
    if a.data[40..72] != leg.receipt_mint { return Err(B); } // GUARD:J_FMINT
    Ok((u64_at(a.data, 115) as u128, 1_000_000_000_000))
}

fn store_rate(o: &Acct, m: &Acct, leg: &LegConfig) -> Result<(u128, u128), LeashError> {
    const B: LeashError = LeashError::BadReader;
    if *o.key != leg.rate_account { return Err(B); } // GUARD:O_ADDR
    if o.owner != ORE_STAKING.as_array() { return Err(B); } // GUARD:O_OWNER
    if o.data.len() < 48 { return Err(B); } // GUARD:O_LEN
    if o.data[0] != ORE_STAKE_TYPE { return Err(B); } // GUARD:O_TYPE
    if o.data[8..40] != *ORE_STAKE_AUTHORITY.as_array() { return Err(B); } // GUARD:O_AUTH
    if *m.key != leg.extra { return Err(B); } // GUARD:M_ADDR
    if m.owner != TOKEN.as_array() { return Err(B); } // GUARD:M_OWNER
    if m.data.len() != 82 { return Err(B); } // GUARD:M_LEN
    Ok((u64_at(o.data, 40) as u128, u64_at(m.data, 36) as u128))
}
