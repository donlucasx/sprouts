//! Synthetic account bytes laid out exactly as the readers expect (contracts sec 2.6, 2.7).
pub use leash::price;

use crate::*;

/// A Pyth PriceUpdateV2 (134 B). `full == false` writes verification byte 0 (Partial) and keeps the rest.
pub fn price_data(feed_id: [u8; 32], price: i64, conf: u64, expo: i32, publish_time: i64, full: bool) -> Vec<u8> {
    let mut d = vec![0u8; c::PRICE_UPDATE_LEN];
    d[0..8].copy_from_slice(&c::PRICE_UPDATE_DISC);
    d[40] = full as u8;
    d[41..73].copy_from_slice(&feed_id);
    d[73..81].copy_from_slice(&price.to_le_bytes());
    d[81..89].copy_from_slice(&conf.to_le_bytes());
    d[89..93].copy_from_slice(&expo.to_le_bytes());
    d[93..101].copy_from_slice(&publish_time.to_le_bytes());
    d[101..109].copy_from_slice(&publish_time.to_le_bytes());
    d
}
/// An SPL mint (82 B): no authorities, initialized.
pub fn mint_data(supply: u64, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[36..44].copy_from_slice(&supply.to_le_bytes());
    d[44] = decimals;
    d[45] = 1;
    d
}
/// An SPL token account (165 B), state Initialized.
pub fn token_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1;
    d
}
/// A classic token account at a fresh address.
pub fn new_token(svm: &mut LiteSVM, mint: Pubkey, owner: Pubkey, amount: u64) -> Pubkey {
    let at = Pubkey::new_unique();
    put(svm, at, token_program(), token_data(&mint, &owner, amount));
    at
}

pub use leash::readers::{self, Acct};

/// StakeConfig (193 B): disc, mint @41 = SKR, share_price u128 @137.
pub fn stake_config_data(share_price: u128) -> Vec<u8> {
    let mut d = vec![0u8; 193];
    d[0..8].copy_from_slice(&c::STAKE_CONFIG_DISC);
    d[41..73].copy_from_slice(c::SKR_MINT.as_array());
    d[137..153].copy_from_slice(&share_price.to_le_bytes());
    d
}
/// UserStake (169 B): disc, stake_config @9, user @41, guardian_pool @73, shares u128 @105.
pub fn user_stake_data(stake_config: &[u8; 32], user: &[u8; 32], guardian: &[u8; 32], shares: u128) -> Vec<u8> {
    let mut d = vec![0u8; 169];
    d[0..8].copy_from_slice(&c::USER_STAKE_DISC);
    d[9..41].copy_from_slice(stake_config);
    d[41..73].copy_from_slice(user);
    d[73..105].copy_from_slice(guardian);
    d[105..121].copy_from_slice(&shares.to_le_bytes());
    d
}
/// SPL stake pool (400 B): type 1, pool_mint @162, total_lamports @258, pool_token_supply @266, last_update_epoch @274.
pub fn stake_pool_data(pool_mint: &[u8; 32], total: u64, supply: u64, last_epoch: u64) -> Vec<u8> {
    let mut d = vec![0u8; 400];
    d[0] = 1;
    d[162..194].copy_from_slice(pool_mint);
    d[258..266].copy_from_slice(&total.to_le_bytes());
    d[266..274].copy_from_slice(&supply.to_le_bytes());
    d[274..282].copy_from_slice(&last_epoch.to_le_bytes());
    d
}
/// K-Lend Reserve (8624 B): disc, market @32, liquidity mint @128, available @224, borrowed_sf @232, fee sfs @344/@360/@376,
/// collateral mint @2560, collateral supply @2592.
pub fn klend_reserve_data(liq_mint: &[u8; 32], coll_mint: &[u8; 32], available: u64, borrowed_sf: u128, fees_sf: [u128; 3], coll_supply: u64) -> Vec<u8> {
    let mut d = vec![0u8; c::KLEND_RESERVE_LEN];
    d[0..8].copy_from_slice(&c::KLEND_RESERVE_DISC);
    d[32..64].copy_from_slice(c::KLEND_MARKET.as_array());
    d[128..160].copy_from_slice(liq_mint);
    d[224..232].copy_from_slice(&available.to_le_bytes());
    d[232..248].copy_from_slice(&borrowed_sf.to_le_bytes());
    d[344..360].copy_from_slice(&fees_sf[0].to_le_bytes());
    d[360..376].copy_from_slice(&fees_sf[1].to_le_bytes());
    d[376..392].copy_from_slice(&fees_sf[2].to_le_bytes());
    d[2560..2592].copy_from_slice(coll_mint);
    d[2592..2600].copy_from_slice(&coll_supply.to_le_bytes());
    d
}
/// Jupiter Lend Lending (196 B): disc, mint @8, f_token_mint @40, token_exchange_price u64 @115 (1e12 scale).
pub fn jlend_data(mint: &[u8; 32], fmint: &[u8; 32], token_exchange_price: u64) -> Vec<u8> {
    let mut d = vec![0u8; c::JLEND_LENDING_LEN];
    d[0..8].copy_from_slice(&c::JLEND_LENDING_DISC);
    d[8..40].copy_from_slice(mint);
    d[40..72].copy_from_slice(fmint);
    d[115..123].copy_from_slice(&token_exchange_price.to_le_bytes());
    d
}
/// ORE stake account (120 B): type 0x6c, authority @8, ORE balance @40.
pub fn ore_stake_data(balance: u64) -> Vec<u8> {
    let mut d = vec![0u8; 120];
    d[0] = c::ORE_STAKE_TYPE;
    d[8..40].copy_from_slice(c::ORE_STAKE_AUTHORITY.as_array());
    d[40..48].copy_from_slice(&balance.to_le_bytes());
    d
}
