use leash_tests::*;

const KEY: [u8; 32] = [7; 32];

fn sol_leg() -> LegConfig {
    mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]).legs[4]
}
fn read(owner: &[u8; 32], data: &[u8], leg: &LegConfig, now: i64) -> Result<(u64, i32), LeashError> {
    price::read_price(&KEY, owner, data, leg, now)
}

#[test]
fn fresh_full_update_reads_p_low() {
    // $150.00000000 with a $0.075 confidence: p_low = 15_000_000_000 - 7_500_000
    let d = price_data(c::FEED_SOL, 15_000_000_000, 7_500_000, -8, NOW - 5, true);
    assert_eq!(read(c::PYTH_RECEIVER.as_array(), &d, &sol_leg(), NOW), Ok((14_992_500_000, -8)));
}

#[test]
fn stale_boundary_is_60_seconds() {
    let at = |t: i64| price_data(c::FEED_SOL, 15_000_000_000, 0, -8, t, true);
    assert_eq!(read(c::PYTH_RECEIVER.as_array(), &at(NOW - 60), &sol_leg(), NOW), Ok((15_000_000_000, -8)));
    assert_eq!(read(c::PYTH_RECEIVER.as_array(), &at(NOW - 61), &sol_leg(), NOW), Err(LeashError::StalePrice));
}

#[test]
fn read_price_guards() {
    let recv = *c::PYTH_RECEIVER.as_array();
    let leg = sol_leg();
    let good = price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 5, true);
    let mut pinned = leg;
    pinned.feed_account = [9; 32];
    let mut wide = leg;
    wide.conf_cap_bps = 10_000;
    let mut short = good.clone();
    short.pop();
    let mut disc = good.clone();
    disc[0] ^= 1;
    use LeashError::*;
    let cases: Vec<(&str, [u8; 32], Vec<u8>, LegConfig, LeashError)> = vec![
        ("P_OWNER", *c::TOKEN.as_array(), good.clone(), leg, BadPriceAccount),
        ("P_LEN", recv, short, leg, BadPriceAccount),
        ("P_DISC", recv, disc, leg, BadPriceAccount),
        ("P_FEED_ACCOUNT", recv, good.clone(), pinned, BadPriceAccount),
        ("P_FULL", recv, price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 5, false), leg, BadPriceAccount),
        ("P_FEED_ID", recv, price_data(c::FEED_CBBTC, 15_000_000_000, 0, -8, NOW - 5, true), leg, BadPriceAccount),
        ("P_STALE", recv, price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 61, true), leg, StalePrice),
        ("P_POSITIVE", recv, price_data(c::FEED_SOL, -1, 0, -8, NOW - 5, true), leg, BadPriceAccount),
        ("P_EXPO_LO", recv, price_data(c::FEED_SOL, 15_000_000_000, 0, -13, NOW - 5, true), leg, BadPriceAccount),
        ("P_EXPO_HI", recv, price_data(c::FEED_SOL, 15_000_000_000, 0, 1, NOW - 5, true), leg, BadPriceAccount),
        // conf 1.01% of price against the 1% cap
        ("P_CONF", recv, price_data(c::FEED_SOL, 15_000_000_000, 151_500_000, -8, NOW - 5, true), leg, PriceConfidence),
        // conf == price under an (invalid, unvalidated here) 100% cap: p_low would be 0
        ("P_LOW", recv, price_data(c::FEED_SOL, 15_000_000_000, 15_000_000_000, -8, NOW - 5, true), wide, PriceConfidence),
    ];
    for (name, owner, data, l, err) in cases {
        assert_eq!(read(&owner, &data, &l, NOW), Err(err), "{name}");
    }
}
