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
