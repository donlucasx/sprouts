//! Spike S2 (contracts sec 9): every reader offset, read on a one-slot mainnet snapshot and checked against a source that
//! does not share our offsets: mint accounts in the same slot, the Kamino and Jupiter APIs, the SKR IDL, Jupiter's ORE price.
use leash_tests::*;

fn num(v: &serde_json::Value) -> f64 {
    v.as_str().map(|s| s.parse::<f64>().unwrap()).or_else(|| v.as_f64()).unwrap_or_else(|| panic!("not a number: {v}"))
}

fn klend_reserve_matches_mint_supply_and_api(reserve: &str, liq: &str, coll: &str, dec: i32) {
    let r = reference();
    let a = must_fixture(reserve);
    assert_eq!(a.owner, b58(addr::KLEND), "{reserve} owner");
    assert_eq!(a.data.len(), 8624, "{reserve} length");
    assert_eq!(&a.data[0..8], &c::KLEND_RESERVE_DISC, "{reserve} discriminator");
    assert_eq!(&a.data[32..64], &bytes(addr::KLEND_MARKET), "{reserve} lending_market @32");
    assert_eq!(&a.data[128..160], &bytes(liq), "{reserve} liquidity mint @128");
    assert_eq!(&a.data[2560..2592], &bytes(coll), "{reserve} collateral mint @2560");
    let mint = must_fixture(coll);
    let rd = u64_at(&a.data, 2592);
    assert_eq!(rd, u64_at(&mint.data, 36), "{reserve}: collateral supply @2592 == the kToken mint's supply (same slot)");
    let fees = u128_at(&a.data, 344) + u128_at(&a.data, 360) + u128_at(&a.data, 376);
    let rn = u64_at(&a.data, 224) as u128 + ((u128_at(&a.data, 232) - fees) >> 60);
    let api = num(&r["kamino_total_supply"][reserve]) * 10f64.powi(dec);
    let lag = (rn as f64 - api).abs() / api;
    println!("S2 KLEND {reserve}: rn {rn} rd {rd} rate {:.6} (Kamino API lag {lag:.2e})", rn as f64 / rd as f64);
    assert!(lag < 5e-4, "{reserve}: total liquidity {rn} vs Kamino API {api}");
}

#[test]
fn s2_klend_usdc_reserve_matches_mint_supply_and_api() {
    klend_reserve_matches_mint_supply_and_api(addr::RESERVE_USDC, addr::USDC, addr::KUSDC, 6);
}

#[test]
fn s2_klend_sol_reserve_matches_mint_supply_and_api() {
    klend_reserve_matches_mint_supply_and_api(addr::RESERVE_SOL, addr::WSOL, addr::KSOL, 9);
}

#[test]
fn s2_klend_dust_reserve_is_a_separate_reserve() {
    let dust = must_fixture(addr::RESERVE_DUST);
    assert_eq!(dust.owner, b58(addr::KLEND));
    assert_eq!(&dust.data[32..64], &bytes(addr::KLEND_MARKET), "AWnKJ9 is in the same market");
    assert_eq!(&dust.data[2560..2592], &bytes(addr::KUSDC_DUST), "AWnKJ9 has its own collateral mint");
}


#[test]
fn s2_jlend_rate_matches_api() {
    let r = reference();
    for (lending, mint, fmint, dec) in [(addr::JL_LENDING_USDC, addr::USDC, addr::JLUSDC, 6), (addr::JL_LENDING_SOL, addr::WSOL, addr::JLWSOL, 9)] {
        let a = must_fixture(lending);
        assert_eq!(a.owner, b58(addr::JLEND), "{lending} owner");
        assert_eq!(a.data.len(), 196, "{lending} length");
        assert_eq!(&a.data[0..8], &c::JLEND_LENDING_DISC, "{lending} discriminator");
        assert_eq!(&a.data[8..40], &bytes(mint), "{lending} mint @8");
        assert_eq!(&a.data[40..72], &bytes(fmint), "{lending} f_token_mint @40");
        let ours = u64_at(&a.data, 115) as f64 / 1e12;
        let api = num(&r["jlend_convert_to_assets"][fmint]) / 10f64.powi(dec);
        let diff = (ours - api).abs() / api;
        println!("S2 JLEND {lending}: rate {ours:.9} vs API {api:.9} ({diff:.2e})");
        assert!(diff < 3e-6, "{lending}: token_exchange_price @115 / 1e12 = {ours} vs API convertToAssets {api}");
    }
}

#[test]
fn s2_hsol_stake_pool() {
    let r = reference();
    let p = must_fixture(addr::HSOL_POOL);
    assert_eq!(p.owner, pk(&c::STAKE_POOL_PROGRAM), "hSOL pool owner");
    assert_eq!(p.data[0], 1, "account_type StakePool");
    assert_eq!(&p.data[162..194], &bytes(addr::HSOL), "pool_mint @162");
    let mint = must_fixture(addr::HSOL);
    assert_eq!(u64_at(&p.data, 266), u64_at(&mint.data, 36), "pool_token_supply @266 == hSOL mint supply (same slot)");
    let rate = u64_at(&p.data, 258) as f64 / u64_at(&p.data, 266) as f64;
    let last = u64_at(&p.data, 274);
    let epoch = r["epoch"].as_u64().unwrap();
    println!("S2 STAKE_POOL hSOL: rate {rate:.9}, last_update_epoch {last}, epoch {epoch}");
    assert!(rate > 1.0 && rate < 1.5, "total_lamports @258 / supply @266 = {rate}");
    assert!(last <= epoch && epoch - last < 2, "last_update_epoch @274 = {last}, epoch {epoch}");
}

fn idl_offsets(type_name: &str) -> Vec<(String, usize)> {
    let text = std::fs::read_to_string(root().join("../api/program/skr-staking-idl.json")).unwrap();
    let idl: serde_json::Value = serde_json::from_str(&text).unwrap();
    let t = idl["types"].as_array().unwrap().iter().find(|t| t["name"] == type_name).unwrap().clone();
    let mut o = 8;
    let mut out = vec![];
    for f in t["type"]["fields"].as_array().unwrap() {
        out.push((f["name"].as_str().unwrap().to_string(), o));
        o += match f["type"].as_str().unwrap() {
            "u8" => 1,
            "pubkey" => 32,
            "u64" | "i64" => 8,
            "u128" => 16,
            other => panic!("unexpected IDL type {other}"),
        };
    }
    out
}
fn off(v: &[(String, usize)], name: &str) -> usize {
    v.iter().find(|(n, _)| n == name).unwrap().1
}

#[test]
fn s2_skr_offsets_from_the_idl_and_a_live_user_stake() {
    let sc = idl_offsets("StakeConfig");
    assert_eq!((off(&sc, "mint"), off(&sc, "share_price")), (41, 137), "StakeConfig offsets from the IDL");
    let us = idl_offsets("UserStake");
    assert_eq!((off(&us, "stake_config"), off(&us, "user"), off(&us, "guardian_pool"), off(&us, "shares")), (9, 41, 73, 105), "UserStake offsets from the IDL");
    let a = must_fixture(addr::STAKE_CONFIG);
    assert_eq!(a.owner, b58(addr::SKR_STAKING));
    assert_eq!(&a.data[0..8], &c::STAKE_CONFIG_DISC);
    assert_eq!(&a.data[41..73], &bytes(addr::SKR), "StakeConfig.mint @41");
    let share_price = u128_at(&a.data, 137);
    println!("S2 SKR share_price {share_price} (min_stake_amount {})", u64_at(&a.data, 105));
    assert!(share_price >= 1_000_000_000 && share_price < 2_000_000_000, "share_price @137 = {share_price}");
    let r = reference();
    let addr_str = r["user_stake"].as_str().expect("fetch.py found no live UserStake: rerun fetch.sh");
    let u = must_fixture(addr_str);
    assert_eq!(u.owner, b58(addr::SKR_STAKING));
    assert_eq!(&u.data[0..8], &c::USER_STAKE_DISC);
    let derived = Pubkey::find_program_address(&[&b"user_stake"[..], &u.data[9..41], &u.data[41..73], &u.data[73..105]], &b58(addr::SKR_STAKING)).0;
    assert_eq!(derived, b58(addr_str), "UserStake address == PDA(user_stake, stake_config @9, user @41, guardian_pool @73)");
    assert_eq!(&u.data[9..41], &bytes(addr::STAKE_CONFIG), "stake_config @9 is the pinned StakeConfig");
    println!("S2 SKR live UserStake {addr_str}: shares @105 = {}, guardian @73 is ours: {}", u128_at(&u.data, 105), u.data[73..105] == bytes(addr::GUARDIAN_POOL));
}

#[test]
fn s2_store_rate_and_ore_feed_match() {
    let r = reference();
    let s = must_fixture(addr::ORE_STAKE);
    assert_eq!(s.owner, pk(&c::ORE_STAKING), "ORE stake account owner");
    assert_eq!(s.data[0], c::ORE_STAKE_TYPE, "ORE stake account type byte");
    assert_eq!(&s.data[8..40], c::ORE_STAKE_AUTHORITY.as_array(), "authority @8");
    let m = must_fixture(addr::STORE_MINT);
    assert_eq!(m.owner, token_program());
    assert_eq!(m.data.len(), 82);
    assert_eq!(m.data[44], 11, "stORE decimals");
    assert_eq!(must_fixture(addr::ORE_MINT).data[44], 11, "ORE decimals");
    let rate = u64_at(&s.data, 40) as f64 / u64_at(&m.data, 36) as f64;
    println!("S2 STORE: ORE per stORE {rate:.6}");
    assert!(rate > 0.9 && rate < 2.0, "balance @40 / supply @36 = {rate}");
    let p = must_fixture(addr::PYTH_ORE);
    let pyth = i64_at(&p.data, 73) as f64 * 10f64.powi(i32_at(&p.data, 89));
    let jup = r["jup_ore_usd"].as_f64().expect("Jupiter price of the vault's ORE mint oreoU2P8...");
    println!("S2 ORE feed {pyth:.4} vs Jupiter(oreoU2P8) {jup:.4}");
    assert!((pyth - jup).abs() / jup < 0.03, "the ORE feed does not price the vault's ORE mint: {pyth} vs {jup}");
}

#[test]
fn s2_pyth_accounts_layout() {
    let r = reference();
    let now = r["unix_ts"].as_i64().unwrap();
    let usdc = c::hex32(addr::FEED_USDC_HEX);
    for (acct, feed) in [(addr::PYTH_SOL, c::FEED_SOL), (addr::PYTH_CBBTC, c::FEED_CBBTC), (addr::PYTH_ORE, c::FEED_ORE), (addr::PYTH_USDC, usdc)] {
        let a = must_fixture(acct);
        assert_eq!(a.owner, pk(&c::PYTH_RECEIVER), "{acct} owner");
        assert_eq!(a.data.len(), c::PRICE_UPDATE_LEN, "{acct} length");
        assert_eq!(&a.data[0..8], &c::PRICE_UPDATE_DISC, "{acct} discriminator");
        assert_eq!(a.data[40], 1, "{acct} Full verification");
        assert_eq!(&a.data[41..73], &feed, "{acct} feed id");
        let expo = i32_at(&a.data, 89);
        assert!((-12..=0).contains(&expo) && i64_at(&a.data, 73) > 0, "{acct} price/exponent");
        let age = now - i64_at(&a.data, 93);
        println!("S2 PYTH {acct}: price {} e{expo} conf {} age {age} s", i64_at(&a.data, 73), u64_at(&a.data, 81));
        assert!(age.abs() <= 600, "{acct}: publish_time @93 is {age} s from the snapshot's time (layout sanity bound 600 s)");
    }
}
