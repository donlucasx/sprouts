use leash_tests::*;
use leash::price::floor_raw;

#[test]
fn floor_vectors() {
    // cbBTC: $5 at $65,000.00000000 (expo -8), fee 50 + tol 100 -> 4,925,000 micro-dollars = 7576.92 sats -> 7577
    assert_eq!(floor_raw(5_000_000, 1, 1, Some((6_500_000_000_000, -8)), 50, 100, 8), Ok(7_577));
    // USDC K-Lend at 1.2 underlying per kUSDC, tol 10: 1,998,000 / 1.2 = 1,665,000 exactly (no round-up)
    assert_eq!(floor_raw(2_000_000, 1_200_000_000_000, 1_000_000_000_000, None, 0, 10, 6), Ok(1_665_000));
    // remainder rounds up: net 999,000; 999,000 * 1,000,000 / 1,200,001 = 832,499.31 -> 832,500
    assert_eq!(floor_raw(1_000_001, 1_200_001, 1_000_000, None, 0, 10, 6), Ok(832_500));
    // SOL K-Lend through the s >= 0 branch (expo -4, s = 2): 1155.1 lamports per kSOL raw, p_low $149.90, tol 150 -> 28,443.6 -> 28,444
    assert_eq!(floor_raw(5_000_000, 11_551, 10, Some((1_499_000, -4)), 0, 150, 9), Ok(28_444));
    // SKR stake: share price 1.149090094, p_low $0.0199 (expo -8), $1, fee 50 + tol 100 -> 43,075,376 shares
    assert_eq!(floor_raw(1_000_000, 1_149_090_094, 1_000_000_000, Some((1_990_000, -8)), 50, 100, 6), Ok(43_075_376));
    // hSOL: 1.25 SOL per hSOL at $150 -> 26,266,667 raw hSOL
    assert_eq!(floor_raw(5_000_000, 1_250_000_000, 1_000_000_000, Some((15_000_000_000, -8)), 50, 100, 9), Ok(26_266_667));
}

#[test]
fn floor_is_the_public_98_5_percent() {
    let f = floor_raw(5_000_000, 1, 1, Some((6_500_000_000_000, -8)), 50, 100, 8).unwrap();
    let value_e6 = |sats: u128| sats * 65_000 * 1_000_000 / 100_000_000;
    assert!(value_e6(f) >= 4_925_000, "the floor is worth at least 98.5% of $5");
    assert!(value_e6(f - 1) < 4_925_000, "one raw unit less is below 98.5%");
    let cfg = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]);
    for i in [0, 1, 6, 7] {
        assert_eq!(cfg.legs[i].fee_bps + cfg.legs[i].tol_bps, 150, "leg {i}: 98.5%");
    }
    for i in [4, 5] {
        assert_eq!(cfg.legs[i].fee_bps + cfg.legs[i].tol_bps, 150, "leg {i}: 98.5%");
    }
    for i in [2, 3] {
        assert_eq!(cfg.legs[i].fee_bps + cfg.legs[i].tol_bps, 10, "leg {i}: 99.9%");
    }
}

#[test]
fn floor_rate_zero_is_bad_reader() {
    assert_eq!(floor_raw(5_000_000, 0, 1_000_000, None, 0, 10, 6), Err(LeashError::BadReader));
    assert_eq!(floor_raw(5_000_000, 1_000_000, 0, None, 0, 10, 6), Err(LeashError::BadReader));
}

#[test]
fn floor_overflow_is_an_error_not_a_panic() {
    assert_eq!(floor_raw(u64::MAX, 1, u128::MAX / 2, Some((1, -12)), 0, 0, 11), Err(LeashError::Overflow));
}

#[test]
fn store_donation_halves_the_floor() {
    // contracts audit 3: doubling the ORE balance (a donation) halves the stORE floor; bounded by the vault's TVL
    let at = |rn: u128| floor_raw(5_000_000, rn, 1_000_000_000, Some((13_100_000_000, -8)), 50, 100, 11).unwrap();
    assert_eq!(at(1_051_100_000), 3_576_769_085);
    assert_eq!(at(2_102_200_000), 1_788_384_543);
}
