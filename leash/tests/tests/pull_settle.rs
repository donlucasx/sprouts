//! pull/settle against the mainnet Subscriptions binary: the spike's 11 cases (research 28) plus contracts sec 2.10.
use leash_tests::*;

const ALL: [bool; 8] = [true; 8];

fn setup() -> (World, Link, Leg, Pubkey) {
    let mut w = world(ALL);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let g = cbbtc_leg(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    (w, l, g, sink)
}
/// [pull, swap usdc out, swap receipt in, settle]: pull = ix 0, settle = ix 3.
fn planting(w: &World, l: &Link, g: &Leg, amount: u64, min_out: u64, out: u64, sink: Pubkey, pre: u128) -> Vec<Instruction> {
    [vec![pull_ix(w, l, g, amount, min_out)], fake_swap(w, g, amount, out, sink), vec![settle_ix(w, &l.user, g, pre, min_out, amount)]].concat()
}

#[test]
fn happy_path_cbbtc() {
    let (mut w, l, g, sink) = setup();
    let ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    let cu = send(&mut w.svm, &w.puller, &ixs).expect("happy path");
    println!("happy path: {cu} CU");
    assert_eq!(token_amount(&w.svm, &g.receipt), 7_577);
    assert_eq!(token_amount(&w.svm, &l.delegator_usdc), 95_000_000);
    assert_eq!(token_amount(&w.svm, &sink), 5_000_000);
}

#[test]
fn omit_settle_is_missing_settle() {
    let (mut w, l, g, sink) = setup();
    let ixs = [vec![pull_ix(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD)], fake_swap(&w, &g, 5_000_000, 0, sink)].concat();
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6005);
}

#[test]
fn under_delivery_against_min_out() {
    let (mut w, l, g, sink) = setup();
    // min_out 100 above the floor; 99 above the floor delivered: only settle's min_out check can catch it
    let ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD + 100, CBBTC_FLOOR_5USD + 99, sink, 0);
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 3, 6009);
}

#[test]
fn floor_boundary_synthetic_legs() {
    type Setup = fn(&mut World, &Pubkey) -> Leg;
    let legs: [(Setup, u64, u64); 3] = [(cbbtc_leg, 5_000_000, CBBTC_FLOOR_5USD), (hsol_leg, 5_000_000, HSOL_FLOOR_5USD), (usdc_klend_leg, 2_000_000, USDC_KLEND_FLOOR_2USD)];
    for (make, amount, floor) in legs {
        let mut w = world(ALL);
        let user = Pubkey::new_unique();
        let l = link(&mut w, user, user);
        let g = make(&mut w, &user);
        let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
        expect_custom(run(planting(&w, &l, &g, amount, floor, floor - 1, sink, 0), &mut w), 3, 6009);
        expect_custom(run(planting(&w, &l, &g, amount, floor - 1, floor - 1, sink, 0), &mut w), 0, 6008);
        run(planting(&w, &l, &g, amount, floor, floor, sink, 0), &mut w).unwrap_or_else(|e| panic!("leg {}: exactly the floor must pass: {e}", g.leg));
        assert_eq!(token_amount(&w.svm, &g.receipt), floor);
    }
}

#[test]
fn min_out_below_floor() {
    let (mut w, l, g, sink) = setup();
    let ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD - 1, CBBTC_FLOOR_5USD - 1, sink, 0);
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6008);
}

#[test]
fn zero_min_out_on_a_dust_pull() {
    let (mut w, l, g, sink) = setup();
    // amount 1: net 0, floor 0; min_out 0 must still be refused
    expect_custom(run(planting(&w, &l, &g, 1, 0, 0, sink, 0), &mut w), 0, 6008);
}

#[test]
fn receipt_owned_by_attacker() {
    let (mut w, l, _, sink) = setup();
    let attacker = Pubkey::new_unique();
    let g = cbbtc_leg(&mut w, &attacker);
    expect_custom(run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6004);
}

#[test]
fn two_pulls_one_settle() {
    let (mut w, l, g, sink) = setup();
    let p = pull_ix(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD);
    let ixs = [vec![p.clone(), p], fake_swap(&w, &g, 5_000_000, CBBTC_FLOOR_5USD, sink), vec![settle_ix(&w, &l.user, &g, 0, CBBTC_FLOOR_5USD, 5_000_000)]].concat();
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6006);
}

#[test]
fn puller_calls_subscriptions_directly() {
    let (mut w, l, _, _) = setup();
    let mut data = vec![5u8];
    data.extend_from_slice(&5_000_000u64.to_le_bytes());
    data.extend_from_slice(l.delegator.as_ref());
    data.extend_from_slice(pk(&c::USDC).as_ref());
    let direct = Instruction {
        program_id: pk(&c::SUBSCRIPTIONS),
        accounts: vec![
            AccountMeta::new(l.delegation, false),
            AccountMeta::new(l.sub_auth, false),
            AccountMeta::new(l.delegator_usdc, false),
            AccountMeta::new(w.puller_usdc, false),
            AccountMeta::new_readonly(pk(&c::USDC), false),
            AccountMeta::new_readonly(token_program(), false),
            AccountMeta::new_readonly(w.puller, true),
            AccountMeta::new_readonly(b58(addr::SUBS_EVENT_AUTHORITY), false),
            AccountMeta::new_readonly(pk(&c::SUBSCRIPTIONS), false),
        ],
        data,
    };
    expect_custom(send(&mut w.svm, &w.puller, &[direct]), 0, 130);
}

#[test]
fn cross_pair_attacker_user_pda() {
    // the delegation names PDA(delegator, victim); pulling for (delegator, attacker) signs a PDA the delegation never named
    let (mut w, l, _, sink) = setup();
    let attacker = Pubkey::new_unique();
    let mut la = l.clone();
    la.user = attacker;
    la.leash_pda = leash_pda(&l.delegator, &attacker);
    let ga = cbbtc_leg(&mut w, &attacker);
    expect_custom(run(planting(&w, &la, &ga, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 130);
}

#[test]
fn cross_pair_pda_mismatch() {
    // user = attacker but the victim's PDA account is passed: the program derives PDA(delegator, attacker) and refuses
    let (mut w, l, _, sink) = setup();
    let attacker = Pubkey::new_unique();
    let mut la = l.clone();
    la.user = attacker;
    let ga = cbbtc_leg(&mut w, &attacker);
    expect_custom(run(planting(&w, &la, &ga, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6001);
}

#[test]
fn settle_with_other_user_mismatches() {
    let (mut w, l, g, sink) = setup();
    let mut ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    ixs[3] = settle_ix(&w, &Pubkey::new_unique(), &g, 0, CBBTC_FLOOR_5USD, 5_000_000);
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6007);
}

#[test]
fn over_daily_cap_is_subscriptions_400() {
    let (mut w, l, g, sink) = setup();
    let f = price::floor_raw(3_000_000, 1, 1, Some((6_500_000_000_000, -8)), 50, 100, 8).unwrap() as u64;
    run(planting(&w, &l, &g, 3_000_000, f, f, sink, 0), &mut w).expect("first $3");
    expect_custom(run(planting(&w, &l, &g, 3_000_000, f, f, sink, f as u128), &mut w), 0, 400);
}

#[test]
fn stranger_cannot_pull() {
    let (mut w, l, g, _) = setup();
    let stranger = Pubkey::new_unique();
    w.svm.airdrop(&stranger, 1_000_000_000).unwrap();
    let mut p = pull_ix(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD);
    p.accounts[0] = AccountMeta::new(stranger, true);
    let s = settle_ix(&w, &l.user, &g, 0, CBBTC_FLOOR_5USD, 5_000_000);
    expect_custom(send(&mut w.svm, &stranger, &[p, s]), 0, 6011);
}

#[test]
fn puller_must_sign() {
    let (mut w, l, g, _) = setup();
    let payer = Pubkey::new_unique();
    w.svm.airdrop(&payer, 1_000_000_000).unwrap();
    let mut p = pull_ix(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD);
    p.accounts[0] = AccountMeta::new(w.puller, false);
    let s = settle_ix(&w, &l.user, &g, 0, CBBTC_FLOOR_5USD, 5_000_000);
    expect_custom(send(&mut w.svm, &payer, &[p, s]), 0, 6011);
}

#[test]
fn receiver_guards() {
    let usdc = pk(&c::USDC);
    // RECV_ADDR: the puller's own second USDC account, not the pinned one
    let (mut w, l, g, sink) = setup();
    let second = new_token(&mut w.svm, usdc, w.puller, 0);
    let mut p = pull_ix(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD);
    p.accounts[8] = AccountMeta::new(second, false);
    let ixs = [vec![p], vec![token_transfer(second, sink, w.puller, 5_000_000), token_transfer(g.stock, g.receipt, w.puller, CBBTC_FLOOR_5USD)], vec![settle_ix(&w, &l.user, &g, 0, CBBTC_FLOOR_5USD, 5_000_000)]].concat();
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6012);
    // the other four: the admin pins a bad puller_usdc, the pull names it
    let cases: [(&str, fn(&mut World) -> Pubkey); 4] = [
        ("RECV_TOKEN_OWNED", |w| {
            let x = Pubkey::new_unique();
            let p = w.puller;
            put(&mut w.svm, x, system_program(), token_data(&pk(&c::USDC), &p, 0));
            x
        }),
        ("RECV_LEN", |w| {
            let x = Pubkey::new_unique();
            let mut d = token_data(&pk(&c::USDC), &w.puller, 0);
            d.extend_from_slice(&[0u8; 5]);
            put(&mut w.svm, x, token_program(), d);
            x
        }),
        ("RECV_MINT", |w| {
            let p = w.puller;
            new_token(&mut w.svm, b58(addr::CBBTC), p, 0)
        }),
        ("RECV_OWNER", |w| new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0)),
    ];
    for (name, make) in cases {
        let (mut w, l, g, sink) = setup();
        let x = make(&mut w);
        let cfg = mainnet_config(&w.puller, &x, ALL);
        send(&mut w.svm, &admin(), &[set_header_ix(&w.config, &cfg)]).expect("set_header");
        w.puller_usdc = x;
        assert_eq!(run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), custom(0, 6012), "{name}");
    }
}

#[test]
fn web_linked_happy_path() {
    let mut w = world(ALL);
    let wallet = Pubkey::new_unique();
    let user = Pubkey::new_unique();
    let l = link(&mut w, wallet, user);
    let g = cbbtc_leg(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w).expect("delegator != user");
    assert_eq!(token_amount(&w.svm, &g.receipt), CBBTC_FLOOR_5USD);
    assert_eq!(token_amount(&w.svm, &l.delegator_usdc), 95_000_000);
}

#[test]
fn disabled_leg() {
    let mut w = world([true, true, true, true, true, true, true, false]);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let g = cbbtc_leg(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    expect_custom(run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6015);
}

/// R325: overwrite one leg's 176 bytes in the live Config account (what init_config leaves, or a corrupted leg).
fn patch_leg(w: &mut World, leg: usize, f: impl FnOnce(&mut [u8])) {
    let mut a = w.svm.get_account(&w.config).unwrap();
    f(&mut a.data[96 + 176 * leg..96 + 176 * (leg + 1)]);
    w.svm.set_account(w.config, a).unwrap();
}

#[test]
fn never_set_leg_is_refused() {
    // AMEND 10-04 s20 (R325): init_config leaves every leg zero; leg 7 here is as if its set_leg never landed.
    let (mut w, l, g, sink) = setup();
    patch_leg(&mut w, 7, |b| b.fill(0));
    expect_custom(run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6015);
    expect_custom(run(vec![settle_ix(&w, &l.user, &g, 0, 0, 0)], &mut w), 0, 6015);
}

#[test]
fn enabled_invalid_leg_is_refused() {
    // AMEND 10-04 s20 (R325): set_leg can never store this (validate_leg), so it is injected: enabled 1, decimals 6 on cbBTC.
    let (mut w, l, g, sink) = setup();
    patch_leg(&mut w, 7, |b| b[2] = 6);
    expect_custom(run(planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6013);
    expect_custom(run(vec![settle_ix(&w, &l.user, &g, 0, 0, 0)], &mut w), 0, 6013);
}

#[test]
fn amount_guards() {
    let (mut w, l, g, sink) = setup();
    expect_custom(run(planting(&w, &l, &g, 0, 1, 1, sink, 0), &mut w), 0, 6022);
    expect_custom(run(planting(&w, &l, &g, 5_000_001, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0), &mut w), 0, 6022);
}

#[test]
fn settle_mismatch_guards() {
    let (mut w, l, g, sink) = setup();
    let base = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    // SETTLE_DATA: settle carries another min_out
    let mut ixs = base.clone();
    ixs[3] = settle_ix(&w, &l.user, &g, 0, CBBTC_FLOOR_5USD + 1, 5_000_000);
    assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, 6007), "SETTLE_DATA");
    // SETTLE_NACCTS: one appended account
    let mut ixs = base.clone();
    ixs[3].accounts.push(AccountMeta::new_readonly(Pubkey::new_unique(), false));
    assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, 6007), "SETTLE_NACCTS appended");
    // SETTLE_KEYS: settle reads someone else's receipt
    let mut ixs = base.clone();
    ixs[3].accounts[2] = AccountMeta::new_readonly(new_token(&mut w.svm, b58(addr::CBBTC), Pubkey::new_unique(), 0), false);
    assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, 6007), "SETTLE_KEYS");
    // SETTLE_NACCTS: hSOL settle without its reader account
    let mut w2 = world(ALL);
    let u2 = Pubkey::new_unique();
    let l2 = link(&mut w2, u2, u2);
    let g2 = hsol_leg(&mut w2, &u2);
    let sink2 = new_token(&mut w2.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    let mut ixs = planting(&w2, &l2, &g2, 5_000_000, HSOL_FLOOR_5USD, HSOL_FLOOR_5USD, sink2, 0);
    ixs[3].accounts.pop();
    assert_eq!(send(&mut w2.svm, &w2.puller, &ixs), custom(0, 6007), "SETTLE_NACCTS truncated");
}

#[test]
fn settle_before_pull() {
    let (mut w, l, g, sink) = setup();
    // a valid no-op settle first: the pull at index 1 must refuse any leash ix before it
    let ixs = [vec![settle_ix(&w, &l.user, &g, 0, 0, 0)], planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0)].concat();
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 1, 6006);
    // the earlier settle is the ONLY other leash ix: IX_COUNT cannot catch this one, IX_BEFORE must (without it the pull
    // would compare against the earlier settle and answer 6007)
    let mut ixs = ixs;
    ixs.pop();
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 1, 6006);
}

#[test]
fn config_ix_inside_planting_tx() {
    let (mut w, l, g, sink) = setup();
    let mut ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    ixs.insert(1, set_leg_ix(&w.config, 7, &mainnet_config(&w.puller, &w.puller_usdc, ALL).legs[7])); // R325: any admin ix is another leash ix
    expect_custom(send(&mut w.svm, &w.puller, &ixs), 0, 6006);
}

#[test]
fn program_and_mint_guards() {
    let cases: [(&str, usize, Pubkey, u32); 3] = [
        ("TOKEN_PROGRAM", 10, b58(addr::TOKEN_2022), 6002),
        ("SUBS_PROGRAM", 12, Pubkey::new_unique(), 6002),
        ("USDC_MINT", 9, b58(addr::CBBTC), 6003),
    ];
    for (name, slot, key, code) in cases {
        let (mut w, l, g, sink) = setup();
        let mut ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
        ixs[0].accounts[slot] = AccountMeta::new_readonly(key, false);
        assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, code), "{name}");
    }
}

#[test]
fn pull_data_guards() {
    let (mut w, l, g, sink) = setup();
    let mut ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    ixs[0].data.pop();
    assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, 6010), "PULL_LEN");
    let mut ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    ixs[0].data[1] = 8;
    assert_eq!(send(&mut w.svm, &w.puller, &ixs), custom(0, 6010), "PULL_LEG");
}

#[test]
fn usdc_klend_needs_the_system_program_as_price() {
    let mut w = world(ALL);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let mut g = usdc_klend_leg(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    g.price = Pubkey::new_unique();
    put(&mut w.svm, g.price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_SOL, 15_000_000_000, 0, -8, NOW - 5, true));
    expect_custom(run(planting(&w, &l, &g, 2_000_000, USDC_KLEND_FLOOR_2USD, USDC_KLEND_FLOOR_2USD, sink, 0), &mut w), 0, 6017);
}

#[test]
fn rotation_refuses_the_old_puller() {
    let (mut w, l, g, sink) = setup();
    let old = w.puller;
    let new_puller = Pubkey::new_unique();
    w.svm.airdrop(&new_puller, 1_000_000_000).unwrap();
    let new_usdc = ata(&new_puller, &pk(&c::USDC));
    put(&mut w.svm, new_usdc, token_program(), token_data(&pk(&c::USDC), &new_puller, 0));
    send(&mut w.svm, &admin(), &[set_header_ix(&w.config, &mainnet_config(&new_puller, &new_usdc, ALL))]).expect("rotate"); // R325
    let ixs = planting(&w, &l, &g, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    expect_custom(send(&mut w.svm, &old, &ixs), 0, 6011);
    w.puller = new_puller;
    w.puller_usdc = new_usdc;
    let stock = new_token(&mut w.svm, b58(addr::CBBTC), new_puller, 1_000_000);
    let g2 = Leg { stock, ..g };
    let ixs = planting(&w, &l, &g2, 5_000_000, CBBTC_FLOOR_5USD, CBBTC_FLOOR_5USD, sink, 0);
    send(&mut w.svm, &new_puller, &ixs).expect("the new puller plants");
}

#[test]
fn settle_alone_is_a_no_op() {
    let (mut w, l, g, _) = setup();
    run(vec![settle_ix(&w, &l.user, &g, 0, 0, 0)], &mut w).expect("a settle with nothing to prove passes and moves nothing");
    assert_eq!(token_amount(&w.svm, &l.delegator_usdc), 100_000_000);
    assert_eq!(token_amount(&w.svm, &g.receipt), 0);
}

/// SKR (leg 0) with a FIXTURE price (R324: no SKR price source exists yet, so leg 0 stays disabled in any mainnet-real
/// world; this synthetic one enables it to prove settle's must-exist rule). The user's UserStake PDA, absent.
fn skr_leg(w: &mut World, user: &Pubkey) -> Leg {
    let stake_config = b58(addr::STAKE_CONFIG);
    put(&mut w.svm, stake_config, pk(&c::SKR_STAKING), stake_config_data(1_149_090_094));
    let receipt = Pubkey::new_from_array(readers::user_stake_address(&stake_config.to_bytes(), &user.to_bytes(), &bytes(addr::GUARDIAN_POOL)));
    let price = Pubkey::new_unique();
    put(&mut w.svm, price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_SKR, 2_000_000, 0, -8, NOW - 5, true));
    Leg { leg: 0, receipt, price, readers: vec![stake_config], stock: Pubkey::default() }
}

#[test]
fn settle_refuses_an_absent_user_stake() {
    // contracts 2.7 / Task 4 review: an absent UserStake (System-owned, empty) reads 0 at pull, but settle refuses it
    // explicitly, not via min_out > 0. Floor forced to 0 (amount 0, min_out 0, pre 0): only SETTLE_SKR_EXISTS refuses.
    let mut w = world(ALL);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let g = skr_leg(&mut w, &user);
    assert!(w.svm.get_account(&g.receipt).is_none_or(|a| a.data.is_empty() && a.owner == system_program()), "UserStake absent");
    expect_custom(run(vec![settle_ix(&w, &user, &g, 0, 0, 0)], &mut w), 0, 6016);
    // a first SKR planting: pull accepts the absent account (pre = 0); settle refuses it (6016, not 6009) when nothing created it
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    let f = price::floor_raw(5_000_000, 1_149_090_094, 1_000_000_000, Some((2_000_000, -8)), 50, 100, 6).unwrap() as u64;
    let ixs = vec![pull_ix(&w, &l, &g, 5_000_000, f), token_transfer(w.puller_usdc, sink, w.puller, 5_000_000), settle_ix(&w, &user, &g, 0, f, 5_000_000)];
    expect_custom(run(ixs, &mut w), 2, 6016);
    // control: once the UserStake exists the same floor-0 settle passes
    put(&mut w.svm, g.receipt, pk(&c::SKR_STAKING), user_stake_data(&bytes(addr::STAKE_CONFIG), &user.to_bytes(), &bytes(addr::GUARDIAN_POOL), 0));
    run(vec![settle_ix(&w, &user, &g, 0, 0, 0)], &mut w).expect("an existing UserStake settles");
}

/// Compute units per top-level instruction, from the runtime's "consumed" log lines (pull includes its Subscriptions CPI).
fn cu_per_ix(w: &mut World, ixs: &[Instruction]) -> Vec<(String, u64)> {
    let mut msg = solana_message::Message::new(ixs, Some(&w.puller));
    msg.recent_blockhash = w.svm.latest_blockhash();
    let meta = w.svm.send_transaction(solana_transaction::Transaction::new_unsigned(msg)).expect("planting");
    w.svm.expire_blockhash();
    let mut depth = 0usize;
    let mut out = vec![];
    for line in &meta.logs {
        if line.contains(" invoke [") {
            depth += 1;
        } else if line.contains(" consumed ") {
            let id = line.split_whitespace().nth(1).unwrap().to_string();
            let n: u64 = line.split(" consumed ").nth(1).unwrap().split_whitespace().next().unwrap().parse().unwrap();
            let name = if id == leash_id().to_string() { "leash" } else if id == pk(&c::SUBSCRIPTIONS).to_string() { "subscriptions" } else { "other" };
            out.push((format!("{}{name}", "  ".repeat(depth - 1)), n));
        } else if line.ends_with(" success") || line.contains(" failed") {
            depth -= 1;
        }
    }
    out.push(("total".into(), meta.compute_units_consumed));
    out
}

#[test]
fn compute_units_per_leg() {
    type Setup = fn(&mut World, &Pubkey) -> Leg;
    let legs: [(&str, Setup, u64, u64); 3] = [("cbBTC", cbbtc_leg, 5_000_000, CBBTC_FLOOR_5USD), ("hSOL", hsol_leg, 5_000_000, HSOL_FLOOR_5USD), ("USDC K-Lend", usdc_klend_leg, 2_000_000, USDC_KLEND_FLOOR_2USD)];
    // find_program_address's bump search (the leash PDA, the canonical ATA) varies per key, so CU varies per user: 16 users each
    for (name, make, amount, floor) in legs {
        let mut rows: Vec<[u64; 4]> = vec![];
        for _ in 0..16 {
            let mut w = world(ALL);
            let user = Pubkey::new_unique();
            let l = link(&mut w, user, user);
            let g = make(&mut w, &user);
            let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
            let ixs = planting(&w, &l, &g, amount, floor, floor, sink, 0);
            let cus = cu_per_ix(&mut w, &ixs);
            let leash: Vec<u64> = cus.iter().filter(|(n, _)| n == "leash").map(|(_, v)| *v).collect();
            let subs = cus.iter().find(|(n, _)| n == "  subscriptions").map(|(_, v)| *v).unwrap();
            assert_eq!(leash.len(), 2, "pull and settle each log one top-level consumption");
            rows.push([leash[0], subs, leash[1], cus.last().unwrap().1]);
        }
        let col = |i: usize| {
            let mut v: Vec<u64> = rows.iter().map(|r| r[i]).collect();
            v.sort();
            (v[0], v[v.len() / 2], v[v.len() - 1])
        };
        println!("CU {name} (min, median, max of 16 users): pull incl. CPI {:?}, of which Subscriptions {:?}; settle {:?}; tx total {:?}", col(0), col(1), col(2), col(3));
        assert!(col(3).2 < 200_000, "a planting fits the default 200k budget");
    }
}
