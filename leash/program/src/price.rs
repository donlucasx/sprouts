//! Pyth PriceUpdateV2 (contracts sec 2.6) and the floor (sec 2.8). Pure.
use crate::{config::{LegConfig, ZERO}, constants::*, errors::LeashError};

fn i64_at(d: &[u8], o: usize) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    i64::from_le_bytes(b)
}
fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}
fn i32_at(d: &[u8], o: usize) -> i32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&d[o..o + 4]);
    i32::from_le_bytes(b)
}

/// Returns `(p_low, exponent)` with `p_low = price - conf`. Sponsored and posted accounts read the same way.
pub fn read_price(key: &[u8; 32], owner: &[u8; 32], data: &[u8], leg: &LegConfig, now: i64) -> Result<(u64, i32), LeashError> {
    use LeashError::{BadPriceAccount, PriceConfidence, StalePrice};
    if owner != PYTH_RECEIVER.as_array() { return Err(BadPriceAccount); } // GUARD:P_OWNER
    if data.len() != PRICE_UPDATE_LEN { return Err(BadPriceAccount); } // GUARD:P_LEN
    if data[0..8] != PRICE_UPDATE_DISC { return Err(BadPriceAccount); } // GUARD:P_DISC
    if leg.feed_account != ZERO && *key != leg.feed_account { return Err(BadPriceAccount); } // GUARD:P_FEED_ACCOUNT
    if data[40] != 1 { return Err(BadPriceAccount); } // GUARD:P_FULL
    if data[41..73] != leg.feed_id { return Err(BadPriceAccount); } // GUARD:P_FEED_ID
    let price = i64_at(data, 73);
    let conf = u64_at(data, 81);
    let expo = i32_at(data, 89);
    let publish_time = i64_at(data, 93);
    if publish_time < now.saturating_sub(leg.max_age_s as i64) { return Err(StalePrice); } // GUARD:P_STALE
    if price <= 0 { return Err(BadPriceAccount); } // GUARD:P_POSITIVE
    if expo < -12 { return Err(BadPriceAccount); } // GUARD:P_EXPO_LO
    if expo > 0 { return Err(BadPriceAccount); } // GUARD:P_EXPO_HI
    if (conf as u128) * 10_000 > (price as u128) * (leg.conf_cap_bps as u128) { return Err(PriceConfidence); } // GUARD:P_CONF
    let p_low = (price as u64).checked_sub(conf).unwrap_or(0);
    if p_low == 0 { return Err(PriceConfidence); } // GUARD:P_LOW
    Ok((p_low, expo))
}

fn pow10(e: u32) -> Result<u128, LeashError> {
    10u128.checked_pow(e).ok_or(LeashError::Overflow)
}

/// Minimum receipt raw for `amount` USDC raw (USDC = $1). `price = None` for the unpriced legs 2 and 3.
pub fn floor_raw(amount: u64, rn: u128, rd: u128, price: Option<(u64, i32)>, fee_bps: u16, tol_bps: u16, decimals: u8) -> Result<u128, LeashError> {
    use LeashError::Overflow;
    if rn == 0 || rd == 0 { return Err(LeashError::BadReader); } // GUARD:F_RATE_ZERO
    let keep = 10_000u128.checked_sub(fee_bps as u128 + tol_bps as u128).ok_or(Overflow)?;
    let net = (amount as u128).checked_mul(keep).ok_or(Overflow)? / 10_000;
    let (n, d) = match price {
        None => (net.checked_mul(rd).ok_or(Overflow)?, rn),
        Some((p_low, expo)) => {
            let s = expo + 6;
            let mut n = net.checked_mul(rd).ok_or(Overflow)?.checked_mul(pow10(decimals as u32)?).ok_or(Overflow)?;
            let mut d = rn.checked_mul(p_low as u128).ok_or(Overflow)?;
            if s < 0 {
                n = n.checked_mul(pow10((-s) as u32)?).ok_or(Overflow)?;
            } else {
                d = d.checked_mul(pow10(s as u32)?).ok_or(Overflow)?;
            }
            (n, d)
        }
    };
    if d == 0 {
        return Err(LeashError::PriceConfidence);
    }
    Ok(n / d + if n % d == 0 { 0 } else { 1 })
}
