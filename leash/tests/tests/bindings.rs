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

/// Rewrites the leg's (pinned) price account in place: the pull reads only that address (final review I1).
fn with_price(f: &mut Fx, data: Vec<u8>) -> Leg {
    let g = f.g.clone();
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

/// Final review I1: the mainnet Config pins each priced leg's sponsored account, so a valid, fresh, Full update for the right
/// feed is refused (BadPriceAccount 6017) at any other address, on every priced leg (1, 4, 5, 6, 7), through leash.so.
/// The same bytes at the pinned address get past the price read (no readers are passed, so legs 1, 4, 5, 6 then stop at
/// BadReader 6020; leg 7 has no reader and stops at the floor, BelowFloor 6008): the address is the only difference.
#[test]
fn price_account_other_than_the_pinned_one_is_refused() {
    let mut w = world(ALL);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let cfg = decode_account(&w.svm.get_account(&w.config).unwrap().data).unwrap();
    let now = w.svm.get_sysvar::<Clock>().unix_timestamp;
    for (leg, feed, past_price) in [(1usize, c::FEED_ORE, 6020), (4, c::FEED_SOL, 6020), (5, c::FEED_SOL, 6020), (6, c::FEED_SOL, 6020), (7, c::FEED_CBBTC, 6008)] {
        let pinned = b58(FEED_ACCOUNT_OF_LEG[leg]);
        assert_eq!(cfg.legs[leg].feed_account, pinned.to_bytes(), "leg {leg}: the installed Config pins {pinned}");
        let mint = Pubkey::new_from_array(cfg.legs[leg].receipt_mint);
        let receipt = ata(&user, &mint);
        put(&mut w.svm, receipt, token_program(), token_data(&mint, &user, 0));
        let data = price_data(feed, 1_000_000_000, 0, -8, now - 1, true);
        let other = Pubkey::new_unique();
        put(&mut w.svm, other, pk(&c::PYTH_RECEIVER), data.clone());
        put(&mut w.svm, pinned, pk(&c::PYTH_RECEIVER), data);
        for (price, want) in [(other, 6017), (pinned, past_price)] {
            let g = Leg { leg: leg as u8, receipt, price, readers: vec![], stock: Pubkey::default() };
            let ixs = [pull_ix(&w, &l, &g, 1_000_000, 1), settle_ix(&w, &user, &g, 0, 1, 1_000_000)];
            let payer = w.puller;
            assert_eq!(send(&mut w.svm, &payer, &ixs), custom(0, want), "leg {leg}, price account {price}");
        }
    }
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
