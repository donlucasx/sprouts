//! The Config PDA ["config"] (contracts sec 2.3): CONFIG_LEN = 1504, header = bytes 16..96, LegConfig = 176 B at 96 + 176 * leg.
//! Pure: decode, encode, validate. init_config / set_header run validate_header; set_leg runs validate_leg; validate = both, whole Config.
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

/// Config bytes 16..96 (the init_config / set_header payload). Reserved bytes 72..80 are not kept (re-encoded zero).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub puller: [u8; 32],
    pub puller_usdc: [u8; 32],
    pub max_pull_raw: u64,
}

impl Config {
    pub fn header(&self) -> Header {
        Header { puller: self.puller, puller_usdc: self.puller_usdc, max_pull_raw: self.max_pull_raw }
    }
}

/// An unset leg: what init_config leaves. It fails validate_leg on every leg (decimals 0) and is disabled.
pub const EMPTY_LEG: LegConfig = LegConfig {
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

/// `h` = Config bytes 16..96, exactly HEADER_LEN bytes (one length guard for init_config and set_header).
pub fn decode_header(h: &[u8]) -> Result<Header, LeashError> {
    if h.len() != HEADER_LEN { return Err(LeashError::BadData); } // GUARD:HEADER_LEN
    Ok(Header { puller: arr32(h, 0), puller_usdc: arr32(h, 32), max_pull_raw: u64_at(h, 64) })
}

pub fn encode_header(h: &Header) -> [u8; HEADER_LEN] {
    let mut b = [0u8; HEADER_LEN];
    b[0..32].copy_from_slice(&h.puller);
    b[32..64].copy_from_slice(&h.puller_usdc);
    b[64..72].copy_from_slice(&h.max_pull_raw.to_le_bytes());
    b
}

/// One LegConfig from exactly LEG_LEN bytes (the caller has checked the length). Pads +3 and +12..16 are not kept.
pub fn decode_leg(l: &[u8]) -> LegConfig {
    LegConfig {
        enabled: l[0],
        reader: l[1],
        underlying_decimals: l[2],
        fee_bps: u16_at(l, 4),
        tol_bps: u16_at(l, 6),
        conf_cap_bps: u16_at(l, 8),
        max_age_s: u16_at(l, 10),
        receipt_mint: arr32(l, 16),
        rate_account: arr32(l, 48),
        extra: arr32(l, 80),
        feed_id: arr32(l, 112),
        feed_account: arr32(l, 144),
    }
}

pub fn encode_leg(l: &LegConfig) -> [u8; LEG_LEN] {
    let mut b = [0u8; LEG_LEN];
    b[0] = l.enabled;
    b[1] = l.reader;
    b[2] = l.underlying_decimals;
    b[4..6].copy_from_slice(&l.fee_bps.to_le_bytes());
    b[6..8].copy_from_slice(&l.tol_bps.to_le_bytes());
    b[8..10].copy_from_slice(&l.conf_cap_bps.to_le_bytes());
    b[10..12].copy_from_slice(&l.max_age_s.to_le_bytes());
    b[16..48].copy_from_slice(&l.receipt_mint);
    b[48..80].copy_from_slice(&l.rate_account);
    b[80..112].copy_from_slice(&l.extra);
    b[112..144].copy_from_slice(&l.feed_id);
    b[144..176].copy_from_slice(&l.feed_account);
    b
}

/// `body` = Config bytes 16..1504 (header then 8 legs). Same bytes as Task 1's version.
pub fn decode_body(body: &[u8]) -> Result<Config, LeashError> {
    if body.len() != BODY_LEN { return Err(LeashError::BadData); } // GUARD:BODY_LEN
    let h = decode_header(&body[..HEADER_LEN])?;
    let mut legs = [EMPTY_LEG; NUM_LEGS];
    for (i, leg) in legs.iter_mut().enumerate() {
        let o = HEADER_LEN + LEG_LEN * i;
        *leg = decode_leg(&body[o..o + LEG_LEN]);
    }
    Ok(Config { puller: h.puller, puller_usdc: h.puller_usdc, max_pull_raw: h.max_pull_raw, legs })
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
    b[..HEADER_LEN].copy_from_slice(&encode_header(&c.header()));
    for (i, l) in c.legs.iter().enumerate() {
        let o = HEADER_LEN + LEG_LEN * i;
        b[o..o + LEG_LEN].copy_from_slice(&encode_leg(l));
    }
    b
}

/// Contracts sec 2.3: the header rules (init_config, set_header).
pub fn validate_header(h: &Header) -> Result<(), LeashError> {
    const E: LeashError = LeashError::BadConfig;
    if h.puller == *ADMIN.as_array() { return Err(E); } // GUARD:V_PULLER_ADMIN
    if h.puller == ZERO { return Err(E); } // GUARD:V_PULLER_ZERO
    if h.puller_usdc == ZERO { return Err(E); } // GUARD:V_PULLER_USDC_ZERO
    if h.max_pull_raw == 0 { return Err(E); } // GUARD:V_MAX_PULL_ZERO
    if h.max_pull_raw > MAX_PULL_CEILING { return Err(E); } // GUARD:V_MAX_PULL_CEIL
    Ok(())
}

/// Contracts sec 2.3: every per-leg rule, including the leg-fixed ones, so no admin write can loosen the floor.
/// `i` < NUM_LEGS (set_leg checks it first). An unset (all-zero) leg fails here on every leg.
pub fn validate_leg(i: usize, l: &LegConfig) -> Result<(), LeashError> {
    const E: LeashError = LeashError::BadConfig;
    if l.enabled > 1 { return Err(E); } // GUARD:V_ENABLED
    if l.reader != READER_OF_LEG[i] { return Err(E); } // GUARD:V_READER
    if l.underlying_decimals != DECIMALS_OF_LEG[i] { return Err(E); } // GUARD:V_DECIMALS
    if l.fee_bps > MAX_FEE_BPS { return Err(E); } // GUARD:V_FEE
    if l.fee_bps as u32 + l.tol_bps as u32 > MAX_FEE_PLUS_TOL_BPS as u32 { return Err(E); } // GUARD:V_FEE_TOL
    if l.conf_cap_bps == 0 { return Err(E); } // GUARD:V_CONF_MIN
    if l.conf_cap_bps > MAX_CONF_CAP_BPS { return Err(E); } // GUARD:V_CONF_MAX
    if l.max_age_s == 0 { return Err(E); } // GUARD:V_AGE_MIN
    if l.max_age_s > MAX_AGE_CEILING_OF_LEG[i] { return Err(E); } // GUARD:V_AGE_MAX
    if l.receipt_mint == *USDC.as_array() { return Err(E); } // GUARD:V_RECEIPT_USDC
    if (l.receipt_mint == ZERO) != (i == LEG_SKR) { return Err(E); } // GUARD:V_RECEIPT_ZERO
    if (l.rate_account == ZERO) != (i == LEG_CBBTC) { return Err(E); } // GUARD:V_RATE_ZERO
    if l.feed_id != FEED_OF_LEG[i] { return Err(E); } // GUARD:V_FEED
    if (l.extra == ZERO) == (i == LEG_SKR || i == LEG_STORE) { return Err(E); } // GUARD:V_EXTRA_ZERO
    if i == LEG_STORE && l.extra != l.receipt_mint { return Err(E); } // GUARD:V_STORE_EXTRA
    Ok(())
}

/// The whole Config (header + all 8 legs set and valid): what the golden Config must pass.
pub fn validate(c: &Config) -> Result<(), LeashError> {
    validate_header(&c.header())?;
    for (i, l) in c.legs.iter().enumerate() {
        validate_leg(i, l)?;
    }
    Ok(())
}
