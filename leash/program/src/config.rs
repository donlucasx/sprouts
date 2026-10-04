//! The Config PDA ["config"] (contracts sec 2.3): CONFIG_LEN = 1504, LegConfig = 176 B at 96 + 176 * leg.
//! Pure: decode, encode, validate. The same `validate` runs in init_config and set_config.
use crate::{constants::*, errors::LeashError};

pub const ZERO: [u8; 32] = [0; 32];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LegConfig {
    pub enabled: u8,
    pub reader: u8,
    pub underlying_decimals: u8,
    pub fee_bps: u16,
    pub tol_bps: u16,
    pub conf_cap_bps: u16,
    pub max_age_s: u16,
    pub receipt_mint: [u8; 32],
    pub rate_account: [u8; 32],
    pub extra: [u8; 32],
    pub feed_id: [u8; 32],
    pub feed_account: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    pub puller: [u8; 32],
    pub puller_usdc: [u8; 32],
    pub max_pull_raw: u64,
    pub legs: [LegConfig; NUM_LEGS],
}

const EMPTY_LEG: LegConfig = LegConfig {
    enabled: 0,
    reader: 0,
    underlying_decimals: 0,
    fee_bps: 0,
    tol_bps: 0,
    conf_cap_bps: 0,
    max_age_s: 0,
    receipt_mint: ZERO,
    rate_account: ZERO,
    extra: ZERO,
    feed_id: ZERO,
    feed_account: ZERO,
};
/// Body offset of leg 0 (account offset 96 minus the 16-byte header).
const BODY_LEGS: usize = LEGS_OFF - 16;

fn arr32(d: &[u8], o: usize) -> [u8; 32] {
    let mut a = [0u8; 32];
    a.copy_from_slice(&d[o..o + 32]);
    a
}
fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([d[o], d[o + 1]])
}
fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}

/// `body` = Config bytes 16..1504, the init_config / set_config payload.
pub fn decode_body(body: &[u8]) -> Result<Config, LeashError> {
    if body.len() != BODY_LEN {
        return Err(LeashError::BadData);
    }
    let mut legs = [EMPTY_LEG; NUM_LEGS];
    for (i, leg) in legs.iter_mut().enumerate() {
        let o = BODY_LEGS + LEG_LEN * i;
        *leg = LegConfig {
            enabled: body[o],
            reader: body[o + 1],
            underlying_decimals: body[o + 2],
            fee_bps: u16_at(body, o + 4),
            tol_bps: u16_at(body, o + 6),
            conf_cap_bps: u16_at(body, o + 8),
            max_age_s: u16_at(body, o + 10),
            receipt_mint: arr32(body, o + 16),
            rate_account: arr32(body, o + 48),
            extra: arr32(body, o + 80),
            feed_id: arr32(body, o + 112),
            feed_account: arr32(body, o + 144),
        };
    }
    Ok(Config { puller: arr32(body, 0), puller_usdc: arr32(body, 32), max_pull_raw: u64_at(body, 64), legs })
}

/// The whole account: length, magic and version, then the body. The bump (byte 9) is checked by the caller.
pub fn decode_account(data: &[u8]) -> Result<Config, LeashError> {
    if data.len() != CONFIG_LEN { return Err(LeashError::BadConfig); } // GUARD:CFG_LEN
    if data[0..8] != MAGIC { return Err(LeashError::BadConfig); } // GUARD:CFG_MAGIC
    if data[8] != VERSION { return Err(LeashError::BadConfig); } // GUARD:CFG_VERSION
    decode_body(&data[16..])
}

pub fn encode_body(c: &Config) -> [u8; BODY_LEN] {
    let mut b = [0u8; BODY_LEN];
    b[0..32].copy_from_slice(&c.puller);
    b[32..64].copy_from_slice(&c.puller_usdc);
    b[64..72].copy_from_slice(&c.max_pull_raw.to_le_bytes());
    for (i, l) in c.legs.iter().enumerate() {
        let o = BODY_LEGS + LEG_LEN * i;
        b[o] = l.enabled;
        b[o + 1] = l.reader;
        b[o + 2] = l.underlying_decimals;
        b[o + 4..o + 6].copy_from_slice(&l.fee_bps.to_le_bytes());
        b[o + 6..o + 8].copy_from_slice(&l.tol_bps.to_le_bytes());
        b[o + 8..o + 10].copy_from_slice(&l.conf_cap_bps.to_le_bytes());
        b[o + 10..o + 12].copy_from_slice(&l.max_age_s.to_le_bytes());
        b[o + 16..o + 48].copy_from_slice(&l.receipt_mint);
        b[o + 48..o + 80].copy_from_slice(&l.rate_account);
        b[o + 80..o + 112].copy_from_slice(&l.extra);
        b[o + 112..o + 144].copy_from_slice(&l.feed_id);
        b[o + 144..o + 176].copy_from_slice(&l.feed_account);
    }
    b
}

/// Contracts sec 2.3 as amended 10-04: every leg-fixed field is enforced, so no admin write can loosen the floor.
pub fn validate(c: &Config) -> Result<(), LeashError> {
    const E: LeashError = LeashError::BadConfig;
    if c.puller == *ADMIN.as_array() { return Err(E); } // GUARD:V_PULLER_ADMIN
    if c.puller == ZERO { return Err(E); } // GUARD:V_PULLER_ZERO
    if c.puller_usdc == ZERO { return Err(E); } // GUARD:V_PULLER_USDC_ZERO
    if c.max_pull_raw == 0 { return Err(E); } // GUARD:V_MAX_PULL_ZERO
    if c.max_pull_raw > MAX_PULL_CEILING { return Err(E); } // GUARD:V_MAX_PULL_CEIL
    for (i, l) in c.legs.iter().enumerate() {
        if l.enabled > 1 { return Err(E); } // GUARD:V_ENABLED
        if l.reader != READER_OF_LEG[i] { return Err(E); } // GUARD:V_READER
        if l.underlying_decimals != DECIMALS_OF_LEG[i] { return Err(E); } // GUARD:V_DECIMALS
        if l.fee_bps > MAX_FEE_BPS { return Err(E); } // GUARD:V_FEE
        if l.fee_bps as u32 + l.tol_bps as u32 > MAX_FEE_PLUS_TOL_BPS as u32 { return Err(E); } // GUARD:V_FEE_TOL
        if l.conf_cap_bps == 0 { return Err(E); } // GUARD:V_CONF_MIN
        if l.conf_cap_bps > MAX_CONF_CAP_BPS { return Err(E); } // GUARD:V_CONF_MAX
        if l.max_age_s == 0 { return Err(E); } // GUARD:V_AGE_MIN
        if l.max_age_s > MAX_AGE_CEILING_S { return Err(E); } // GUARD:V_AGE_MAX
        if l.receipt_mint == *USDC.as_array() { return Err(E); } // GUARD:V_RECEIPT_USDC
        if (l.receipt_mint == ZERO) != (i == LEG_SKR) { return Err(E); } // GUARD:V_RECEIPT_ZERO
        if (l.rate_account == ZERO) != (i == LEG_CBBTC) { return Err(E); } // GUARD:V_RATE_ZERO
        if l.feed_id != FEED_OF_LEG[i] { return Err(E); } // GUARD:V_FEED
        if (l.extra == ZERO) == (i == LEG_SKR || i == LEG_STORE) { return Err(E); } // GUARD:V_EXTRA_ZERO
        if i == LEG_STORE && l.extra != l.receipt_mint { return Err(E); } // GUARD:V_STORE_EXTRA
    }
    Ok(())
}
