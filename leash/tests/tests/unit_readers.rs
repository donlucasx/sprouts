use leash_tests::*;
use leash::readers::{canonical_ata, rate, skr_receipt, token_receipt, user_stake_address};

const USER: [u8; 32] = [3; 32];
const ATTACKER: [u8; 32] = [4; 32];

fn cfg() -> Config {
    mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8])
}
fn a<'x>(key: &'x [u8; 32], owner: &'x [u8; 32], data: &'x [u8]) -> Acct<'x> {
    Acct { key, owner, data }
}
fn p(b: &[u8; 32]) -> Pubkey {
    Pubkey::new_from_array(*b)
}

#[test]
fn token_receipt_reads_the_canonical_ata() {
    let leg = cfg().legs[7];
    let at = canonical_ata(&USER, &leg.receipt_mint);
    assert_eq!(p(&at), ata(&p(&USER), &p(&leg.receipt_mint)), "same derivation as the SPL ATA program");
    let d = token_data(&p(&leg.receipt_mint), &p(&USER), 7_577);
    assert_eq!(token_receipt(&a(&at, c::TOKEN.as_array(), &d), &USER, &leg), Ok(7_577));
}

#[test]
fn token_receipt_guards() {
    let leg = cfg().legs[7];
    let mint = p(&leg.receipt_mint);
    let at = canonical_ata(&USER, &leg.receipt_mint);
    let good = token_data(&mint, &p(&USER), 5);
    let mut long = good.clone();
    long.push(0);
    let t22 = bytes(addr::TOKEN_2022);
    let tk = *c::TOKEN.as_array();
    let alias = [5u8; 32];
    use LeashError::*;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>, LeashError)> = vec![
        ("T_OWNER", at, t22, good.clone(), BadReceipt),
        ("T_LEN", at, tk, long, BadReceipt),
        ("T_MINT", at, tk, token_data(&b58(addr::HSOL), &p(&USER), 5), BadReceipt),
        ("T_USER", at, tk, token_data(&mint, &p(&ATTACKER), 5), ReceiptNotUsers),
        ("T_ATA", alias, tk, good.clone(), BadReceipt),
    ];
    for (name, key, owner, data, err) in cases {
        assert_eq!(token_receipt(&a(&key, &owner, &data), &USER, &leg), Err(err), "{name}");
    }
}

#[test]
fn skr_receipt_absent_reads_zero_present_reads_shares() {
    let leg = cfg().legs[0];
    let at = user_stake_address(&leg.rate_account, &USER, &leg.extra);
    let api = Pubkey::find_program_address(&[&b"user_stake"[..], &leg.rate_account[..], &USER[..], &leg.extra[..]], &pk(&c::SKR_STAKING)).0;
    assert_eq!(p(&at), api, "same seeds as api/src/lib/staking.ts userStakePda");
    assert_eq!(skr_receipt(&a(&at, c::SYSTEM.as_array(), &[]), &USER, &leg), Ok(0));
    let d = user_stake_data(&leg.rate_account, &USER, &leg.extra, 43_075_376);
    assert_eq!(skr_receipt(&a(&at, c::SKR_STAKING.as_array(), &d), &USER, &leg), Ok(43_075_376));
}

#[test]
fn skr_receipt_guards() {
    let leg = cfg().legs[0];
    let at = user_stake_address(&leg.rate_account, &USER, &leg.extra);
    let theirs = user_stake_address(&leg.rate_account, &ATTACKER, &leg.extra);
    let skr = *c::SKR_STAKING.as_array();
    let good = user_stake_data(&leg.rate_account, &USER, &leg.extra, 9);
    let mut short = good.clone();
    short.truncate(120);
    let mut disc = good.clone();
    disc[0] ^= 1;
    use LeashError::*;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>, LeashError)> = vec![
        ("S_ADDR", theirs, skr, user_stake_data(&leg.rate_account, &ATTACKER, &leg.extra, 9), BadReceipt),
        ("S_OWNER", at, *c::TOKEN.as_array(), good.clone(), BadReceipt),
        ("S_LEN", at, skr, short, BadReceipt),
        ("S_DISC", at, skr, disc, BadReceipt),
        ("S_CONFIG", at, skr, user_stake_data(&[8; 32], &USER, &leg.extra, 9), BadReceipt),
        ("S_USER", at, skr, user_stake_data(&leg.rate_account, &ATTACKER, &leg.extra, 9), ReceiptNotUsers),
        ("S_GUARDIAN", at, skr, user_stake_data(&leg.rate_account, &USER, &[8; 32], 9), BadReceipt),
    ];
    for (name, key, owner, data, err) in cases {
        assert_eq!(skr_receipt(&a(&key, &owner, &data), &USER, &leg), Err(err), "{name}");
    }
}

#[test]
fn reader_count_and_zero_guards() {
    let c0 = cfg();
    let pool = c0.legs[6].rate_account;
    let d = stake_pool_data(&c0.legs[6].receipt_mint, 1_250_000_000, 1_000_000_000, EPOCH);
    let acct = a(&pool, c::STAKE_POOL_PROGRAM.as_array(), &d);
    assert_eq!(rate(6, &c0.legs[6], &[acct, acct], EPOCH), Err(LeashError::BadReader), "R_COUNT: one reader too many");
    let empty = stake_pool_data(&c0.legs[6].receipt_mint, 0, 0, EPOCH);
    assert_eq!(rate(6, &c0.legs[6], &[a(&pool, c::STAKE_POOL_PROGRAM.as_array(), &empty)], EPOCH), Err(LeashError::BadReader), "R_ZERO: empty pool");
    let no_rn = stake_pool_data(&c0.legs[6].receipt_mint, 0, 1_000_000_000, EPOCH);
    assert_eq!(rate(6, &c0.legs[6], &[a(&pool, c::STAKE_POOL_PROGRAM.as_array(), &no_rn)], EPOCH), Err(LeashError::BadReader), "R_ZERO: rn == 0 alone");
    let no_rd = stake_pool_data(&c0.legs[6].receipt_mint, 1_250_000_000, 0, EPOCH);
    assert_eq!(rate(6, &c0.legs[6], &[a(&pool, c::STAKE_POOL_PROGRAM.as_array(), &no_rd)], EPOCH), Err(LeashError::BadReader), "R_ZERO: rd == 0 alone");
    assert_eq!(rate(7, &c0.legs[7], &[], EPOCH), Ok((1, 1)), "TOKEN reader");
}

#[test]
fn skr_stake_reader_guards() {
    let leg = cfg().legs[0];
    let key = leg.rate_account;
    let skr = *c::SKR_STAKING.as_array();
    let good = stake_config_data(1_149_090_094);
    assert_eq!(rate(0, &leg, &[a(&key, &skr, &good)], EPOCH), Ok((1_149_090_094, 1_000_000_000)));
    let mut short = good.clone();
    short.truncate(152);
    let mut disc = good.clone();
    disc[0] ^= 1;
    let mut mint = good.clone();
    mint[41] ^= 1;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>)> = vec![
        ("SC_ADDR", [8; 32], skr, good.clone()),
        ("SC_OWNER", key, *c::TOKEN.as_array(), good.clone()),
        ("SC_LEN", key, skr, short),
        ("SC_DISC", key, skr, disc),
        ("SC_MINT", key, skr, mint),
    ];
    for (name, k, o, d) in cases {
        assert_eq!(rate(0, &leg, &[a(&k, &o, &d)], EPOCH), Err(LeashError::BadReader), "{name}");
    }
}

#[test]
fn stake_pool_reader_guards() {
    let leg = cfg().legs[6];
    let key = leg.rate_account;
    let sp = *c::STAKE_POOL_PROGRAM.as_array();
    let good = stake_pool_data(&leg.receipt_mint, 1_250_000_000, 1_000_000_000, EPOCH);
    assert_eq!(rate(6, &leg, &[a(&key, &sp, &good)], EPOCH), Ok((1_250_000_000, 1_000_000_000)));
    assert_eq!(rate(6, &leg, &[a(&key, &sp, &good)], EPOCH + 1), Ok((1_250_000_000, 1_000_000_000)), "one epoch behind is fine");
    let mut short = good.clone();
    short.truncate(281);
    let mut kind = good.clone();
    kind[0] = 2;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>, u64)> = vec![
        ("SP_ADDR", [8; 32], sp, good.clone(), EPOCH),
        ("SP_OWNER", key, *c::TOKEN.as_array(), good.clone(), EPOCH),
        ("SP_LEN", key, sp, short, EPOCH),
        ("SP_TYPE", key, sp, kind, EPOCH),
        ("SP_MINT", key, sp, stake_pool_data(&bytes(addr::CBBTC), 1_250_000_000, 1_000_000_000, EPOCH), EPOCH),
        ("SP_EPOCH", key, sp, good.clone(), EPOCH + 2),
        ("SP_AHEAD", key, sp, stake_pool_data(&leg.receipt_mint, 1_250_000_000, 1_000_000_000, EPOCH + 1), EPOCH),
    ];
    for (name, k, o, d, epoch) in cases {
        assert_eq!(rate(6, &leg, &[a(&k, &o, &d)], epoch), Err(LeashError::BadReader), "{name}");
    }
}

#[test]
fn klend_reader_guards() {
    let leg = cfg().legs[2];
    let key = leg.rate_account;
    let kl = *c::KLEND.as_array();
    let usdc = *c::USDC.as_array();
    // available 1e12 + borrowed (2e11 + 5) with 5 of fees (3 + 1 + 1), all << 60 -> rn 1.2e12, rd 1e12
    let good = klend_reserve_data(&usdc, &leg.receipt_mint, 1_000_000_000_000, (200_000_000_005u128) << 60, [3u128 << 60, 1u128 << 60, 1u128 << 60], 1_000_000_000_000);
    assert_eq!(rate(2, &leg, &[a(&key, &kl, &good)], EPOCH), Ok((1_200_000_000_000, 1_000_000_000_000)));
    let mut short = good.clone();
    short.pop();
    let mut disc = good.clone();
    disc[0] ^= 1;
    let mut market = good.clone();
    market[32] ^= 1;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>)> = vec![
        ("K_ADDR", bytes(addr::RESERVE_DUST), kl, good.clone()),
        ("K_OWNER", key, *c::TOKEN.as_array(), good.clone()),
        ("K_LEN", key, kl, short),
        ("K_DISC", key, kl, disc),
        ("K_MARKET", key, kl, market),
        ("K_LIQ_MINT", key, kl, klend_reserve_data(c::WSOL.as_array(), &leg.receipt_mint, 1, 0, [0; 3], 1)),
        ("K_COLL_MINT", key, kl, klend_reserve_data(&usdc, &bytes(addr::KUSDC_DUST), 1, 0, [0; 3], 1)),
        ("K_FEES", key, kl, klend_reserve_data(&usdc, &leg.receipt_mint, 1, 1u128 << 60, [2u128 << 60, 0, 0], 1)),
    ];
    for (name, k, o, d) in cases {
        assert_eq!(rate(2, &leg, &[a(&k, &o, &d)], EPOCH), Err(LeashError::BadReader), "{name}");
    }
}

#[test]
fn jlend_reader_guards() {
    let leg = cfg().legs[3];
    let key = leg.rate_account;
    let jl = *c::JLEND.as_array();
    let usdc = *c::USDC.as_array();
    let good = jlend_data(&usdc, &leg.receipt_mint, 1_062_915_000_000);
    assert_eq!(rate(3, &leg, &[a(&key, &jl, &good)], EPOCH), Ok((1_062_915_000_000, 1_000_000_000_000)));
    let mut long = good.clone();
    long.push(0);
    let mut disc = good.clone();
    disc[0] ^= 1;
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>)> = vec![
        ("J_ADDR", bytes(addr::JL_LENDING_SOL), jl, good.clone()),
        ("J_OWNER", key, *c::TOKEN.as_array(), good.clone()),
        ("J_LEN", key, jl, long),
        ("J_DISC", key, jl, disc),
        ("J_MINT", key, jl, jlend_data(c::WSOL.as_array(), &leg.receipt_mint, 1_062_915_000_000)),
        ("J_FMINT", key, jl, jlend_data(&usdc, &bytes(addr::JLWSOL), 1_062_915_000_000)),
    ];
    for (name, k, o, d) in cases {
        assert_eq!(rate(3, &leg, &[a(&k, &o, &d)], EPOCH), Err(LeashError::BadReader), "{name}");
    }
}

#[test]
fn store_reader_guards() {
    let leg = cfg().legs[1];
    let ok = leg.rate_account;
    let mk = leg.extra;
    let ore = *c::ORE_STAKING.as_array();
    let tk = *c::TOKEN.as_array();
    let stake = ore_stake_data(4_535_090_000_000_000);
    let mint = mint_data(4_315_370_000_000_000, 11);
    assert_eq!(rate(1, &leg, &[a(&ok, &ore, &stake), a(&mk, &tk, &mint)], EPOCH), Ok((4_535_090_000_000_000, 4_315_370_000_000_000)));
    let mut short = stake.clone();
    short.truncate(47);
    let mut kind = stake.clone();
    kind[0] = 0x6b;
    let mut auth = stake.clone();
    auth[8] ^= 1;
    let mut mlong = mint.clone();
    mlong.push(0);
    let cases: Vec<(&str, [u8; 32], [u8; 32], Vec<u8>, [u8; 32], [u8; 32], Vec<u8>)> = vec![
        ("O_ADDR", [8; 32], ore, stake.clone(), mk, tk, mint.clone()),
        ("O_OWNER", ok, tk, stake.clone(), mk, tk, mint.clone()),
        ("O_LEN", ok, ore, short, mk, tk, mint.clone()),
        ("O_TYPE", ok, ore, kind, mk, tk, mint.clone()),
        ("O_AUTH", ok, ore, auth, mk, tk, mint.clone()),
        ("M_ADDR", ok, ore, stake.clone(), [8; 32], tk, mint.clone()),
        ("M_OWNER", ok, ore, stake.clone(), mk, ore, mint.clone()),
        ("M_LEN", ok, ore, stake.clone(), mk, tk, mlong),
    ];
    for (name, k0, o0, d0, k1, o1, d1) in cases {
        assert_eq!(rate(1, &leg, &[a(&k0, &o0, &d0), a(&k1, &o1, &d1)], EPOCH), Err(LeashError::BadReader), "{name}");
    }
}
