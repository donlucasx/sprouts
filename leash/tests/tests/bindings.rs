//! Contracts sec 2.10's per-binding cases, through leash.so (the pure-function tables in unit_* cover each guard on the host).
use leash_tests::*;

const ALL: [bool; 8] = [true; 8];

struct Fx {
    w: World,
    l: Link,
    g: Leg,
    sink: Pubkey,
}
fn fx(make: fn(&mut World, &Pubkey) -> Leg) -> Fx {
    let mut w = world(ALL);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let g = make(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    Fx { w, l, g, sink }
}
fn planting(f: &Fx, g: &Leg, amount: u64, min_out: u64, out: u64) -> Vec<Instruction> {
    [vec![pull_ix(&f.w, &f.l, g, amount, min_out)], fake_swap(&f.w, g, amount, out, f.sink), vec![settle_ix(&f.w, &f.l.user, g, 0, min_out, amount)]].concat()
}
fn run_f(ixs: Vec<Instruction>, f: &mut Fx) -> Result<u64, String> {
    let payer = f.w.puller;
    send(&mut f.w.svm, &payer, &ixs)
}

/// SKR (leg 0) with a synthetic StakeConfig at the pinned address and a posted SKR price; receipt = the user's UserStake PDA.
/// The price is a FIXTURE (R324: no SKR price source exists yet; leg 0 stays off in any mainnet-real Config, DAY1).
fn skr_leg(w: &mut World, user: &Pubkey) -> Leg {
    put(&mut w.svm, b58(addr::STAKE_CONFIG), pk(&c::SKR_STAKING), stake_config_data(1_149_090_094));
    let price = Pubkey::new_unique();
    put(&mut w.svm, price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_SKR, 2_000_000, 0, -8, NOW - 5, true));
    let receipt = Pubkey::new_from_array(readers::user_stake_address(&bytes(addr::STAKE_CONFIG), &user.to_bytes(), &bytes(addr::GUARDIAN_POOL)));
    Leg { leg: 0, receipt, price, readers: vec![b58(addr::STAKE_CONFIG)], stock: Pubkey::default() }
}

#[test]
fn attacker_user_stake() {
    let mut f = fx(skr_leg);
    let attacker = [4u8; 32];
    let mut g = f.g.clone();
    g.receipt = Pubkey::new_from_array(readers::user_stake_address(&bytes(addr::STAKE_CONFIG), &attacker, &bytes(addr::GUARDIAN_POOL)));
    let ixs = [vec![pull_ix(&f.w, &f.l, &g, 1_000_000, 50_000_000)], vec![settle_ix(&f.w, &f.l.user, &g, 0, 50_000_000, 1_000_000)]].concat();
    expect_custom(run_f(ixs.to_vec(), &mut f), 0, 6016);
}

#[test]
fn user_stake_owned_by_another_program() {
    let mut f = fx(skr_leg);
    let user = f.l.user.to_bytes();
    put(&mut f.w.svm, f.g.receipt, token_program(), user_stake_data(&bytes(addr::STAKE_CONFIG), &user, &bytes(addr::GUARDIAN_POOL), 0));
    let g = f.g.clone();
    let ixs = [vec![pull_ix(&f.w, &f.l, &g, 1_000_000, 50_000_000)], vec![settle_ix(&f.w, &f.l.user, &g, 0, 50_000_000, 1_000_000)]].concat();
    expect_custom(run_f(ixs.to_vec(), &mut f), 0, 6016);
}

#[test]
fn awnkj9_reserve_as_rate_account() {
    let mut f = fx(usdc_klend_leg);
    // the 8.6%-on-$104 reserve of the same market, laid out like the pinned one
    put(&mut f.w.svm, b58(addr::RESERVE_DUST), pk(&c::KLEND), klend_reserve_data(c::USDC.as_array(), &bytes(addr::KUSDC), 1_000_000, 0, [0; 3], 10));
    let mut g = f.g.clone();
    g.readers = vec![b58(addr::RESERVE_DUST)];
    expect_custom(run_f(planting(&f, &g, 2_000_000, 200_000, 200_000), &mut f), 0, 6020);
}

#[test]
fn alias_ata() {
    let mut f = fx(cbbtc_leg);
    let user = f.l.user;
    let mut g = f.g.clone();
    g.receipt = new_token(&mut f.w.svm, b58(addr::CBBTC), user, 0);
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6016);
}

#[test]
fn token_2022_receipt() {
    let mut f = fx(cbbtc_leg);
    let user = f.l.user;
    put(&mut f.w.svm, f.g.receipt, b58(addr::TOKEN_2022), token_data(&b58(addr::CBBTC), &user, 0));
    let g = f.g.clone();
    let ixs = [vec![pull_ix(&f.w, &f.l, &g, 5_000_000, CBBTC_FLOOR_5USD)], vec![settle_ix(&f.w, &f.l.user, &g, 0, CBBTC_FLOOR_5USD, 5_000_000)]].concat();
    expect_custom(run_f(ixs.to_vec(), &mut f), 0, 6016);
}

fn with_price(f: &mut Fx, data: Vec<u8>) -> Leg {
    let mut g = f.g.clone();
    g.price = Pubkey::new_unique();
    put(&mut f.w.svm, g.price, pk(&c::PYTH_RECEIVER), data);
    g
}

#[test]
fn wrong_price_feed() {
    let mut f = fx(cbbtc_leg);
    let g = with_price(&mut f, price_data(c::FEED_SOL, 6_500_000_000_000, 0, -8, NOW - 5, true));
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6017);
}

#[test]
fn partial_price() {
    let mut f = fx(cbbtc_leg);
    let g = with_price(&mut f, price_data(c::FEED_CBBTC, 6_500_000_000_000, 0, -8, NOW - 5, false));
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6017);
}

#[test]
fn stale_price_past_max_age() {
    // AMEND 10-04 s20 (R324): cbBTC (leg 7) allows 600 s (the slow sponsored account), every other priced leg 60 s.
    let mut f = fx(cbbtc_leg);
    let g = with_price(&mut f, price_data(c::FEED_CBBTC, 6_500_000_000_000, 0, -8, NOW - 601, true));
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6018);
    let g600 = with_price(&mut f, price_data(c::FEED_CBBTC, 6_500_000_000_000, 0, -8, NOW - 600, true));
    run_f(planting(&f, &g600, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f).expect("cbBTC exactly 600 s old passes");
    let mut f = fx(hsol_leg);
    let g = with_price(&mut f, price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 61, true));
    expect_custom(run_f(planting(&f, &g, 5_000_000, HSOL_FLOOR_5USD, HSOL_FLOOR_5USD), &mut f), 0, 6018);
    let g60 = with_price(&mut f, price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 60, true));
    run_f(planting(&f, &g60, 5_000_000, HSOL_FLOOR_5USD, HSOL_FLOOR_5USD), &mut f).expect("hSOL exactly 60 s old passes");
}

#[test]
fn price_conf_too_wide() {
    let mut f = fx(cbbtc_leg);
    // conf 1.01% of price against the 1% cap
    let g = with_price(&mut f, price_data(c::FEED_CBBTC, 6_500_000_000_000, 65_650_000_000, -8, NOW - 5, true));
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6019);
}

#[test]
fn posted_price_at_any_address_passes() {
    // cbbtc_leg already posts at a fresh address; the sponsored account 7oqYpv5... is never required (feed_account zero)
    let mut f = fx(cbbtc_leg);
    assert_ne!(f.g.price, b58(addr::PYTH_CBBTC));
    let g = f.g.clone();
    run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f).expect("a posted account at a non-sponsored address");
}

#[test]
fn feed_account_pin() {
    let mut f = fx(cbbtc_leg);
    let mut cfg = mainnet_config(&f.w.puller, &f.w.puller_usdc, ALL);
    cfg.legs[7].feed_account = Pubkey::new_unique().to_bytes();
    send(&mut f.w.svm, &admin(), &[set_leg_ix(&f.w.config, 7, &cfg.legs[7])]).expect("pin a feed account"); // R325
    let g = f.g.clone();
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6017);
}

#[test]
fn reader_count_through_pull() {
    let mut f = fx(cbbtc_leg);
    let mut g = f.g.clone();
    g.readers = vec![b58(addr::HSOL_POOL)];
    expect_custom(run_f(planting(&f, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD), &mut f), 0, 6020);
    let mut h = fx(hsol_leg);
    let mut g = h.g.clone();
    g.readers.clear();
    expect_custom(run_f(planting(&h, &g, 5_000_000, HSOL_FLOOR_5USD, HSOL_FLOOR_5USD), &mut h), 0, 6020);
}

#[test]
fn standalone_settle_guards() {
    let mut f = fx(cbbtc_leg);
    let g = f.g.clone();
    let user = f.l.user;
    // SETTLE_LEN
    let mut s = settle_ix(&f.w, &user, &g, 0, 0, 0);
    s.data.pop();
    assert_eq!(run_f(vec![s], &mut f), custom(0, 6010), "SETTLE_LEN");
    // SETTLE_LEG
    let mut s = settle_ix(&f.w, &user, &g, 0, 0, 0);
    s.data[1] = 8;
    assert_eq!(run_f(vec![s], &mut f), custom(0, 6010), "SETTLE_LEG");
    // SETTLE_NEGATIVE: pre above the balance
    assert_eq!(run_f(vec![settle_ix(&f.w, &user, &g, 1, 0, 0)], &mut f), custom(0, 6009), "SETTLE_NEGATIVE");
    // SETTLE_FLOOR: nothing delivered, min_out 0, but $5 claimed: the settle-time floor (7577) catches it
    assert_eq!(run_f(vec![settle_ix(&f.w, &user, &g, 0, 0, 5_000_000)], &mut f), custom(0, 6009), "SETTLE_FLOOR");
}

/// SETTLE_LEN on behaviour (Task 6 review minor 1): a 35-byte settle (the 34 valid bytes + one trailing 0) claiming $5 with
/// nothing delivered. With the guard: BadData 6010. Without it the first 34 bytes parse cleanly and the settle-time floor
/// answers Underdelivered 6009, so the mutation row is red on a different answer, not on an out-of-bounds panic.
#[test]
fn settle_len_extra_byte() {
    let mut f = fx(cbbtc_leg);
    let g = f.g.clone();
    let user = f.l.user;
    let mut s = settle_ix(&f.w, &user, &g, 0, 0, 5_000_000);
    s.data.push(0);
    assert_eq!(s.data.len(), 35);
    assert_eq!(run_f(vec![s], &mut f), custom(0, 6010), "SETTLE_LEN: 35 bytes");
}
