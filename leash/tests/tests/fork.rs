//! Mainnet simulation gate (spec 6.5) for each leg: pull -> real venue instruction (or the stand-in swap) -> settle,
//! on the one-slot snapshot. Each test prints one FORK line for GATES.md.
use leash_tests::*;

fn fork(leg: usize) -> (World, Link, Pubkey) {
    let mut e = [false; 8];
    e[leg] = true;
    let mut w = world_on(fork_svm(), b58(addr::PULLER_MAINNET), e);
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    (w, l, sink)
}
fn report(leg: usize, cu: u64, delivered: u128, floor: u128) {
    println!("FORK leg {leg}: {cu} CU, delivered {delivered}, floor {floor}, margin {:.3}%", (delivered as f64 / floor as f64 - 1.0) * 100.0);
}
fn user_receipt(w: &mut World, user: &Pubkey, mint: &str) -> Pubkey {
    let m = b58(mint);
    let at = ata(user, &m);
    put(&mut w.svm, at, token_program(), token_data(&m, user, 0));
    at
}

#[test]
fn fork_leg2_usdc_klend_real_deposit() {
    let (mut w, l, _) = fork(2);
    let receipt = user_receipt(&mut w, &l.user, addr::KUSDC);
    let reserve = b58(addr::RESERVE_USDC);
    let (rn, rd) = rate_now(&w.svm, 2, &[reserve]);
    let amount = 2_000_000u64;
    let floor = price::floor_raw(amount, rn, rd, None, 0, 10, 6).unwrap();
    let expected = amount as u128 * rd / rn;
    let min_out = (expected * 9_998 / 10_000) as u64; // the API builder's 2 bp margin (contracts sec 3.2)
    assert!(min_out as u128 >= floor, "builder min_out {min_out} is under the leash floor {floor}");
    let g = Leg { leg: 2, receipt, price: system_program(), readers: vec![reserve], stock: Pubkey::default() };
    let ixs = vec![
        pull_ix(&w, &l, &g, amount, min_out),
        klend_refresh_ix(reserve),
        klend_deposit_ix(w.puller, &KLEND_USDC, w.puller_usdc, receipt, amount),
        settle_ix(&w, &l.user, &g, 0, min_out, amount),
    ];
    let cu = send_logged(&mut w.svm, &w.puller, &ixs).expect("leg 2 on the mainnet fork");
    let minted = token_amount(&w.svm, &receipt) as u128;
    report(2, cu, minted, floor);
    let err = (minted as f64 - expected as f64).abs() / expected as f64;
    println!("FORK K-Lend actual deposit (kUSDC): reader predicted {expected}, K-Lend minted {minted}, relative error {err:.3e}");
    assert!(err < 1e-5, "the K-Lend reader predicted {expected} kUSDC, K-Lend minted {minted} ({err:.2e})");
}

#[test]
fn fork_leg4_sol_klend_real_deposit() {
    let (mut w, l, sink) = fork(4);
    let receipt = user_receipt(&mut w, &l.user, addr::KSOL);
    let price = fresh_sponsored(&mut w.svm, addr::PYTH_SOL);
    let (p, conf, expo) = price_of(&w.svm, &price);
    let amount = 5_000_000u64;
    let lamports = fair_out(amount, p, expo, 9) as u64;
    let wsol = ata(&w.puller, &b58(addr::WSOL));
    let puller = w.puller;
    put_native_wsol(&mut w.svm, wsol, puller, lamports);
    let reserve = b58(addr::RESERVE_SOL);
    let (rn, rd) = rate_now(&w.svm, 4, &[reserve]);
    let floor = price::floor_raw(amount, rn, rd, Some(((p as u64) - conf, expo)), 0, 150, 9).unwrap();
    let expected = lamports as u128 * rd / rn;
    let min_out = (expected * 9_998 / 10_000) as u64;
    assert!(min_out as u128 >= floor, "builder min_out {min_out} is under the leash floor {floor}");
    let g = Leg { leg: 4, receipt, price, readers: vec![reserve], stock: Pubkey::default() };
    let ixs = vec![
        pull_ix(&w, &l, &g, amount, min_out),
        token_transfer(w.puller_usdc, sink, w.puller, amount),
        klend_refresh_ix(reserve),
        klend_deposit_ix(w.puller, &KLEND_SOL, wsol, receipt, lamports),
        settle_ix(&w, &l.user, &g, 0, min_out, amount),
    ];
    let cu = send_logged(&mut w.svm, &w.puller, &ixs).expect("leg 4 on the mainnet fork");
    let minted = token_amount(&w.svm, &receipt) as u128;
    report(4, cu, minted, floor);
    let err = (minted as f64 - expected as f64).abs() / expected as f64;
    println!("FORK K-Lend actual deposit (kSOL): reader predicted {expected}, K-Lend minted {minted}, relative error {err:.3e}");
    assert!(err < 1e-5, "the K-Lend reader predicted {expected} kSOL, K-Lend minted {minted} ({err:.2e})");
}

fn jl_leg(leg: usize, j: &JlAsset, amount: u64, priced: bool) {
    let (mut w, l, sink) = fork(leg);
    let receipt = user_receipt(&mut w, &l.user, j.fmint);
    let puller = w.puller;
    let puller_jl = ata(&puller, &b58(j.fmint));
    put(&mut w.svm, puller_jl, token_program(), token_data(&b58(j.fmint), &puller, 0));
    let lending = b58(j.lending);
    let (rn, rd) = rate_now(&w.svm, leg, &[lending]);
    let (price, px, assets, source, swap) = if priced {
        let price = fresh_sponsored(&mut w.svm, addr::PYTH_SOL);
        let (p, conf, expo) = price_of(&w.svm, &price);
        let lamports = fair_out(amount, p, expo, 9) as u64;
        let wsol = ata(&puller, &b58(addr::WSOL));
        put_native_wsol(&mut w.svm, wsol, puller, lamports);
        (price, Some(((p as u64) - conf, expo)), lamports, wsol, vec![token_transfer(w.puller_usdc, sink, puller, amount)])
    } else {
        (system_program(), None, amount, w.puller_usdc, vec![])
    };
    // the API builder's jlendShares (lending-api plan Task 7): shares worth 2 bp under the deposit. The brief's `- 2` shares
    // is too tight: the stored exchange price lags the one JL computes at mint (~5e-7), 17 lamports on a $5 SOL planting.
    let shares = (assets as u128 * 9_998 / 10_000 * rd / rn) as u64;
    let min_out = shares - 1; // contracts sec 3.2: JL min_out = shares - 1
    let (dec, tol) = if priced { (9, 150) } else { (6, 10) };
    let floor = price::floor_raw(amount, rn, rd, px, 0, tol, dec).unwrap();
    assert!(min_out as u128 >= floor, "builder min_out {min_out} is under the leash floor {floor}");
    let g = Leg { leg: leg as u8, receipt, price, readers: vec![lending], stock: Pubkey::default() };
    let before = token_amount(&w.svm, &source);
    let ixs = [
        vec![pull_ix(&w, &l, &g, amount, min_out)],
        swap,
        vec![jl_mint_ix(puller, source, puller_jl, j, shares, assets), token_transfer(puller_jl, receipt, puller, min_out), settle_ix(&w, &l.user, &g, 0, min_out, amount)],
    ]
    .concat();
    let cu = send_logged(&mut w.svm, &puller, &ixs).unwrap_or_else(|e| panic!("leg {leg} on the mainnet fork: {e}"));
    assert_eq!(token_amount(&w.svm, &receipt) as u128, min_out as u128);
    report(leg, cu, min_out as u128, floor);
    // the pulled USDC goes in (unpriced) or the WSOL the stand-in swap produced; what JL took for `shares` checks the reader
    let spent = (before + if priced { 0 } else { amount }) - token_amount(&w.svm, &source);
    let expected = shares as u128 * rn / rd;
    let err = (spent as f64 - expected as f64).abs() / expected as f64;
    println!("FORK leg {leg}: JL took {spent} for {shares} shares (reader says {expected}); puller jl ATA keeps {} shares", token_amount(&w.svm, &puller_jl));
    println!("FORK leg {leg}: JL actual mint relative error {err:.3e}");
    assert!(err < 1e-5, "the JL reader predicted {expected} assets for {shares} shares, JL took {spent} ({err:.2e})");
}

#[test]
fn fork_leg3_usdc_jlend_real_mint() {
    jl_leg(3, &JL_USDC, 2_000_000, false);
}

#[test]
fn fork_leg5_sol_jlend_real_mint() {
    jl_leg(5, &JL_SOL, 5_000_000, true);
}

#[test]
fn fork_leg0_skr_real_stake() {
    let (mut w, l, sink) = fork(0);
    let now = w.svm.get_sysvar::<Clock>().unix_timestamp;
    let price = Pubkey::new_unique();
    // SKR has no sponsored account: always posted (contracts sec 1.4); $0.01808 (live 10-04, contracts audit appendix)
    put(&mut w.svm, price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_SKR, 1_808_000, 0, -8, now - 1, true));
    let amount = 5_000_000u64;
    let skr = fair_out(amount, 1_808_000, -8, 6) as u64;
    let min_stake = u64_at(&w.svm.get_account(&b58(addr::STAKE_CONFIG)).unwrap().data, 105);
    assert!(skr >= min_stake, "{skr} raw SKR is under min_stake_amount {min_stake}");
    let puller = w.puller;
    let puller_skr = ata(&puller, &b58(addr::SKR));
    put(&mut w.svm, puller_skr, token_program(), token_data(&b58(addr::SKR), &puller, skr));
    let receipt = Pubkey::new_from_array(readers::user_stake_address(&bytes(addr::STAKE_CONFIG), &l.user.to_bytes(), &bytes(addr::GUARDIAN_POOL)));
    assert!(w.svm.get_account(&receipt).is_none_or(|a| a.data.is_empty()), "first SKR planting: no UserStake yet");
    let (rn, rd) = rate_now(&w.svm, 0, &[b58(addr::STAKE_CONFIG)]);
    let expected = skr as u128 * rd / rn;
    let min_out = (expected * 9_990 / 10_000) as u64;
    let floor = price::floor_raw(amount, rn, rd, Some((1_808_000, -8)), 50, 100, 6).unwrap();
    assert!(min_out as u128 >= floor, "min_out {min_out} is under the leash floor {floor}");
    let g = Leg { leg: 0, receipt, price, readers: vec![b58(addr::STAKE_CONFIG)], stock: Pubkey::default() };
    let ixs = vec![
        pull_ix(&w, &l, &g, amount, min_out),
        token_transfer(w.puller_usdc, sink, puller, amount),
        skr_stake_ix(puller, l.user, puller_skr, skr),
        settle_ix(&w, &l.user, &g, 0, min_out, amount),
    ];
    let cu = send_logged(&mut w.svm, &puller, &ixs).expect("leg 0 on the mainnet fork");
    let shares = u128_at(&w.svm.get_account(&receipt).unwrap().data, 105);
    println!("S2 SKR stake rounding: staked {skr} raw at share_price {rn} -> {shares} shares; floor(skr * 1e9 / share_price) = {expected}; diff {}", expected as i128 - shares as i128);
    report(0, cu, shares, floor);
    println!("FORK leg 0: SYNTHETIC price (fixture $0.01808; R324: SKR has no price source, leg 0 stays off in the mainnet-real Config); the stake itself is the real SKR program");
    assert!(shares >= min_out as u128 && shares <= expected + 1, "shares {shares} outside [{min_out}, {}]", expected + 1);
}

/// Swap legs (Kimi F2: the floor boundary through leash.so for leg 1 too): min_out = floor - 1 is refused at the pull (0, 6008),
/// floor - 1 delivered against min_out = floor is refused at the settle (3, 6009), and exactly the floor passes. The margin
/// printed is what the stand-in swap (oracle mid minus 0.5%) would deliver over the floor: arithmetic, not a route measurement.
fn swap_leg(leg: usize, mint: &str, sponsored: &str, readers_: Vec<Pubkey>, dec: u32, fee: u16, tol: u16) {
    let (mut w, l, sink) = fork(leg);
    let receipt = user_receipt(&mut w, &l.user, mint);
    let price = fresh_sponsored(&mut w.svm, sponsored);
    let (p, conf, expo) = price_of(&w.svm, &price);
    let (rn, rd) = rate_now(&w.svm, leg, &readers_);
    let amount = 5_000_000u64;
    let out = (fair_out(amount, p, expo, dec) * rd / rn) as u64;
    let floor = price::floor_raw(amount, rn, rd, Some(((p as u64) - conf, expo)), fee, tol, dec as u8).unwrap() as u64;
    assert!(out >= floor, "a 0.5%-cost swap ({out}) must clear the floor ({floor})");
    let puller = w.puller;
    let stock = new_token(&mut w.svm, b58(mint), puller, out);
    let g = Leg { leg: leg as u8, receipt, price, readers: readers_, stock };
    let plant = |w: &World, min_out: u64, give: u64| {
        [vec![pull_ix(w, &l, &g, amount, min_out)], fake_swap(w, &g, amount, give, sink), vec![settle_ix(w, &l.user, &g, 0, min_out, amount)]].concat()
    };
    let low = plant(&w, floor - 1, out);
    expect_custom(send(&mut w.svm, &puller, &low), 0, 6008);
    let under = plant(&w, floor, floor - 1);
    expect_custom(send(&mut w.svm, &puller, &under), 3, 6009);
    let exact = plant(&w, floor, floor);
    let cu = send(&mut w.svm, &puller, &exact).unwrap_or_else(|e| panic!("leg {leg}: exactly the floor must pass: {e}"));
    assert_eq!(token_amount(&w.svm, &receipt), floor);
    println!("FORK leg {leg} boundary (fee {fee} + tol {tol}): floor {floor}; floor-1 min_out refused (0, 6008); floor-1 delivered refused (3, 6009); floor passes ({cu} CU)");
    println!("FORK leg {leg}: {cu} CU, the 0.5%-cost swap would deliver {out}, floor {floor}, margin {:.3}%", (out as f64 / floor as f64 - 1.0) * 100.0);
}

#[test]
fn fork_leg6_hsol_real_pool() {
    swap_leg(6, addr::HSOL, addr::PYTH_SOL, vec![b58(addr::HSOL_POOL)], 9, 50, 100);
}

#[test]
fn fork_leg7_cbbtc_posted_price() {
    swap_leg(7, addr::CBBTC, addr::PYTH_CBBTC, vec![], 8, 50, 100);
}

#[test]
fn fork_leg1_store_real_vault() {
    swap_leg(1, addr::STORE_MINT, addr::PYTH_ORE, vec![b58(addr::ORE_STAKE), b58(addr::STORE_MINT)], 11, 50, 100);
}

#[test]
fn fork_awnkj9_real_reserve_refused() {
    let (mut w, l, _) = fork(2);
    let receipt = user_receipt(&mut w, &l.user, addr::KUSDC);
    let g = Leg { leg: 2, receipt, price: system_program(), readers: vec![b58(addr::RESERVE_DUST)], stock: Pubkey::default() };
    let ixs = [pull_ix(&w, &l, &g, 2_000_000, 1), settle_ix(&w, &l.user, &g, 0, 1, 2_000_000)];
    let puller = w.puller;
    expect_custom(send(&mut w.svm, &puller, &ixs), 0, 6020);
}

#[test]
fn fork_sponsored_sol_price_reads_then_goes_stale() {
    let a = must_fixture(addr::PYTH_SOL);
    let leg = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]).legs[4];
    let t = i64_at(&a.data, 93);
    let key = bytes(addr::PYTH_SOL);
    let owner = a.owner.to_bytes();
    assert!(price::read_price(&key, &owner, &a.data, &leg, t + 1).is_ok(), "the real sponsored SOL account passes when fresh");
    assert_eq!(price::read_price(&key, &owner, &a.data, &leg, t + 61), Err(LeashError::StalePrice));
}

#[test]
fn fork_sponsored_cbbtc_price_reads_within_600s() {
    // AMEND 10-04 s20 (R324): leg 7 reads the real sponsored cbBTC account (7oqYpv5...), max_age_s 600.
    let a = must_fixture(addr::PYTH_CBBTC);
    let leg = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]).legs[7];
    assert_eq!(leg.max_age_s, 600);
    let t = i64_at(&a.data, 93);
    let key = bytes(addr::PYTH_CBBTC);
    let owner = a.owner.to_bytes();
    assert!(price::read_price(&key, &owner, &a.data, &leg, t + 600).is_ok(), "the real sponsored cbBTC account passes at 600 s");
    assert_eq!(price::read_price(&key, &owner, &a.data, &leg, t + 601), Err(LeashError::StalePrice));
}

/// Carry-in (Task 6 review minor 4) + Kimi F2: the lending legs 3 (tol 10, unpriced, real Jupiter Lend USDC), 4 and 5 (tol 150)
/// through leash.so on the fork. The real venue mints into a puller-held receipt account, then exactly `give` moves to the
/// user's receipt: the pull refuses min_out = floor - 1 (ix 0, BelowFloor 6008), delivering floor - 1 against min_out = floor
/// is refused at the settle (Underdelivered 6009), and exactly the floor passes. `floor` is price::floor_raw over the
/// leash's own reader at the snapshot, with the installed Config's tol.
fn lend_floor_boundary(leg: usize) {
    let (mut w, l, sink) = fork(leg);
    let priced = leg != 3;
    let jl = match leg {
        3 => Some(&JL_USDC),
        4 => None,
        5 => Some(&JL_SOL),
        _ => unreachable!("lending legs 3, 4, 5"),
    };
    let fmint = jl.map_or(addr::KSOL, |j| j.fmint);
    let reader = b58(jl.map_or(addr::RESERVE_SOL, |j| j.lending));
    let receipt = user_receipt(&mut w, &l.user, fmint);
    let puller = w.puller;
    let wsol = ata(&puller, &b58(addr::WSOL));
    let (amount, tol, dec) = if priced { (5_000_000u64, 150u16, 9u8) } else { (2_000_000u64, 10u16, 6u8) };
    let (price, px, assets, source) = if priced {
        let price = fresh_sponsored(&mut w.svm, addr::PYTH_SOL);
        let (p, conf, expo) = price_of(&w.svm, &price);
        (price, Some(((p as u64) - conf, expo)), fair_out(amount, p, expo, 9) as u64, wsol)
    } else {
        (system_program(), None, amount, w.puller_usdc) // leg 3 deposits the pulled USDC itself
    };
    let (rn, rd) = rate_now(&w.svm, leg, &[reader]);
    let on_chain = decode_account(&w.svm.get_account(&w.config).unwrap().data).unwrap().legs[leg];
    assert_eq!((on_chain.tol_bps, on_chain.fee_bps), (tol, 0), "leg {leg}: tol/fee in the installed Config");
    let floor = price::floor_raw(amount, rn, rd, px, 0, tol, dec).unwrap() as u64;
    let held = Pubkey::new_unique(); // the puller's receipt-mint account the real venue mints into
    put(&mut w.svm, held, token_program(), token_data(&b58(fmint), &puller, 0));
    let g = Leg { leg: leg as u8, receipt, price, readers: vec![reader], stock: Pubkey::default() };
    let venue = |w: &World| -> Vec<Instruction> {
        let mut v = match jl {
            None => vec![klend_refresh_ix(reader), klend_deposit_ix(puller, &KLEND_SOL, wsol, held, assets)],
            Some(j) => vec![jl_mint_ix(puller, source, held, j, (assets as u128 * 9_998 / 10_000 * rd / rn) as u64, assets)],
        };
        if priced {
            v.push(token_transfer(w.puller_usdc, sink, puller, amount)); // the stand-in USDC->WSOL swap's USDC side
        }
        v
    };
    let plant = |w: &World, min_out: u64, give: u64| -> Vec<Instruction> {
        [vec![pull_ix(w, &l, &g, amount, min_out)], venue(w), vec![token_transfer(held, receipt, puller, give), settle_ix(w, &l.user, &g, 0, min_out, amount)]].concat()
    };
    let refill = |w: &mut World| {
        if priced {
            put_native_wsol(&mut w.svm, wsol, puller, assets);
        }
    };
    let settle_at = (plant(&w, floor, floor).len() - 1) as u8;
    refill(&mut w);
    let ixs = plant(&w, floor - 1, floor - 1);
    expect_custom(send(&mut w.svm, &puller, &ixs), 0, 6008);
    refill(&mut w);
    let ixs = plant(&w, floor, floor - 1);
    expect_custom(send(&mut w.svm, &puller, &ixs), settle_at, 6009);
    refill(&mut w);
    let ixs = plant(&w, floor, floor);
    let cu = send_logged(&mut w.svm, &puller, &ixs).unwrap_or_else(|e| panic!("leg {leg}: exactly the floor must pass: {e}"));
    assert_eq!(token_amount(&w.svm, &receipt), floor);
    let minted = token_amount(&w.svm, &held) as u128 + floor as u128;
    println!("FORK leg {leg} boundary (tol {tol}): floor {floor}; floor-1 min_out refused (0, 6008); floor-1 delivered refused ({settle_at}, 6009); floor passes ({cu} CU); the venue minted {minted} ({:.3}% over the floor)", (minted as f64 / floor as f64 - 1.0) * 100.0);
}

#[test]
fn fork_leg3_floor_boundary_through_leash() {
    lend_floor_boundary(3);
}

#[test]
fn fork_leg4_floor_boundary_through_leash() {
    lend_floor_boundary(4);
}

#[test]
fn fork_leg5_floor_boundary_through_leash() {
    lend_floor_boundary(5);
}
