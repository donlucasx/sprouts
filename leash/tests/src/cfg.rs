//! The mainnet Config (contracts sec 2.3 / 2.4 as amended 10-04) and one invalid variant per validation rule.
pub use leash::config::{decode_account, decode_body, encode_body, validate, Config, LegConfig, ZERO};

use crate::*;

/// Day 1 enables legs 2 (USDC K-Lend), 6 (hSOL) and 7 (cbBTC) (spec 6.5).
pub const DAY1: [bool; 8] = [false, false, true, false, false, false, true, true];

#[allow(clippy::too_many_arguments)]
fn leg(reader: u8, dec: u8, fee: u16, tol: u16, receipt: &str, rate: &str, extra: &str, feed: [u8; 32], on: bool) -> LegConfig {
    let k = |s: &str| if s.is_empty() { ZERO } else { bytes(s) };
    LegConfig {
        enabled: on as u8,
        reader,
        underlying_decimals: dec,
        fee_bps: fee,
        tol_bps: tol,
        conf_cap_bps: 100,
        max_age_s: 60,
        receipt_mint: k(receipt),
        rate_account: k(rate),
        extra: k(extra),
        feed_id: feed,
        feed_account: ZERO,
    }
}

pub fn mainnet_config(puller: &Pubkey, puller_usdc: &Pubkey, e: [bool; 8]) -> Config {
    let mut cfg = Config {
        puller: puller.to_bytes(),
        puller_usdc: puller_usdc.to_bytes(),
        max_pull_raw: 5_000_000,
        legs: [
            leg(1, 6, 50, 100, "", addr::STAKE_CONFIG, addr::GUARDIAN_POOL, c::FEED_SKR, e[0]),
            leg(5, 11, 50, 100, addr::STORE_MINT, addr::ORE_STAKE, addr::STORE_MINT, c::FEED_ORE, e[1]),
            leg(3, 6, 0, 10, addr::KUSDC, addr::RESERVE_USDC, "", ZERO, e[2]),
            leg(4, 6, 0, 10, addr::JLUSDC, addr::JL_LENDING_USDC, "", ZERO, e[3]),
            leg(3, 9, 0, 150, addr::KSOL, addr::RESERVE_SOL, "", c::FEED_SOL, e[4]),
            leg(4, 9, 0, 150, addr::JLWSOL, addr::JL_LENDING_SOL, "", c::FEED_SOL, e[5]),
            leg(2, 9, 50, 100, addr::HSOL, addr::HSOL_POOL, "", c::FEED_SOL, e[6]),
            leg(0, 8, 50, 100, addr::CBBTC, "", "", c::FEED_CBBTC, e[7]),
        ],
    };
    for (i, l) in cfg.legs.iter_mut().enumerate() {
        l.max_age_s = c::MAX_AGE_S_OF_LEG[i]; // R324: 60 s, 600 s on cbBTC
    }
    cfg
}

/// One invalid Config per validation rule (the name is the guard id in program/src/config.rs).
pub fn invalid_configs() -> Vec<(&'static str, Config)> {
    let edits: Vec<(&'static str, fn(&mut Config))> = vec![
        ("V_PULLER_ADMIN", |x| x.puller = *c::ADMIN.as_array()),
        ("V_PULLER_ZERO", |x| x.puller = ZERO),
        ("V_PULLER_USDC_ZERO", |x| x.puller_usdc = ZERO),
        ("V_MAX_PULL_ZERO", |x| x.max_pull_raw = 0),
        ("V_MAX_PULL_CEIL", |x| x.max_pull_raw = 5_000_001),
        ("V_ENABLED", |x| x.legs[7].enabled = 2),
        ("V_READER", |x| x.legs[6].reader = c::READER_TOKEN),
        ("V_DECIMALS", |x| x.legs[4].underlying_decimals = 6),
        ("V_FEE", |x| {
            x.legs[7].fee_bps = 101;
            x.legs[7].tol_bps = 0;
        }),
        ("V_FEE_TOL", |x| x.legs[7].tol_bps = 101),
        ("V_CONF_MIN", |x| x.legs[6].conf_cap_bps = 0),
        ("V_CONF_MAX", |x| x.legs[6].conf_cap_bps = 201),
        ("V_AGE_MIN", |x| x.legs[0].max_age_s = 0),
        ("V_AGE_MAX", |x| x.legs[0].max_age_s = 61),
        ("V_AGE_MAX", |x| x.legs[7].max_age_s = 3601),
        ("V_RECEIPT_USDC", |x| x.legs[7].receipt_mint = *c::USDC.as_array()),
        ("V_RECEIPT_ZERO", |x| x.legs[0].receipt_mint = bytes(addr::SKR)),
        ("V_RECEIPT_ZERO", |x| x.legs[7].receipt_mint = ZERO),
        ("V_RATE_ZERO", |x| x.legs[2].rate_account = ZERO),
        ("V_RATE_ZERO", |x| x.legs[7].rate_account = bytes(addr::HSOL_POOL)),
        ("V_FEED", |x| x.legs[0].feed_id = ZERO),
        ("V_FEED", |x| x.legs[2].feed_id = c::FEED_SOL),
        ("V_FEED", |x| x.legs[6].feed_id = c::FEED_CBBTC),
        ("V_EXTRA_ZERO", |x| x.legs[0].extra = ZERO),
        ("V_EXTRA_ZERO", |x| x.legs[6].extra = bytes(addr::HSOL)),
        ("V_STORE_EXTRA", |x| x.legs[1].extra = bytes(addr::ORE_MINT)),
    ];
    edits
        .into_iter()
        .map(|(name, edit)| {
            let mut x = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
            edit(&mut x);
            (name, x)
        })
        .collect()
}
