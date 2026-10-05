//! The Config bodies the owner writes, as hex the API's encodeConfig must reproduce, and the check of the live account.
//! Also the golden-path admin instruction data for the Day-1 Config (tests/golden/): `init_config.hex` = [2][header],
//! `set_leg_<n>.hex` = [5][n][LegConfig], `config.hex` = the body the account then holds (== config/mainnet-day1.hex).
//! The API's encodeHeader / encodeLeg tests compare against these byte for byte.
use base64::Engine as _;
use leash_tests::*;

/// (file under config/, enabled legs). Only `mainnet-day1.hex` is an installable Config (via the golden path's set_legs);
/// `mainnet-init.hex` is the state after init_config + set_leg 0..7 with every leg OFF (`leash-admin.ts init`).
const VARIANTS: [(&str, &[usize]); 3] = [
    ("mainnet-init.hex", &[]),
    ("mainnet-day1.hex", &[2, 6, 7]),
    // TEST VECTOR ONLY, NEVER INSTALL: every leg ON, including leg 0 (SKR), which has no price source (R324) and must
    // stay off on chain. It exists so the API's encoder is checked with every `enabled` byte set.
    ("TEST-VECTOR-all-legs-NEVER-INSTALL.hex", &[0, 1, 2, 3, 4, 5, 6, 7]),
];

fn golden_config(puller: &Pubkey, legs: &[usize]) -> Config {
    let mut e = [false; 8];
    for &i in legs {
        e[i] = true;
    }
    mainnet_config(puller, &ata(puller, &pk(&c::USDC)), e)
}

fn body_hex(puller: &Pubkey, legs: &[usize]) -> String {
    hex(&encode_body(&golden_config(puller, legs)))
}

/// Writes `want` to `path` under LEASH_WRITE_GOLDEN, then requires the file to hold exactly `want`.
fn check_file(path: &std::path::Path, want: &str) {
    if std::env::var_os("LEASH_WRITE_GOLDEN").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, want).unwrap();
    }
    let have = std::fs::read_to_string(path).unwrap_or_else(|_| panic!("{} missing: run once with LEASH_WRITE_GOLDEN=1", path.display()));
    assert_eq!(have.trim(), want, "{}", path.display());
}

#[test]
fn puller_usdc_is_the_pullers_ata() {
    assert_eq!(ata(&b58(addr::PULLER_MAINNET), &pk(&c::USDC)), b58(addr::PULLER_MAINNET_USDC));
}

#[test]
fn golden_bodies_match_files() {
    for (name, legs) in VARIANTS {
        let path = root().join("config").join(name);
        let want = body_hex(&b58(addr::PULLER_MAINNET), legs);
        check_file(&path, &want);
        validate(&decode_body(&unhex(&want)).unwrap()).unwrap();
    }
}

/// The golden path's instruction data for the Day-1 Config, one file per admin tx, and proof the files compose: the
/// init header followed by set_leg 0..7's leg bytes IS the Day-1 body (bytes 16..1504 of the account).
#[test]
fn golden_path_payloads_match_files() {
    let cfg = golden_config(&b58(addr::PULLER_MAINNET), &[2, 6, 7]);
    let (pda, _) = config_pda();
    let ixs = install_txs(&pda, &cfg);
    assert_eq!(ixs.len(), 9, "init_config + set_leg 0..7");
    let dir = root().join("tests/golden");
    let mut composed = Vec::new();
    for (i, ix) in ixs.iter().enumerate() {
        let (file, tag_len) = if i == 0 { ("init_config.hex".to_string(), 1) } else { (format!("set_leg_{}.hex", i - 1), 2) };
        let want_len = if i == 0 { 81 } else { 178 };
        assert_eq!(ix.data.len(), want_len, "{file}");
        if i == 0 {
            assert_eq!(ix.data[0], c::IX_INIT_CONFIG);
        } else {
            assert_eq!((ix.data[0], ix.data[1]), (c::IX_SET_LEG, (i - 1) as u8));
        }
        check_file(&dir.join(&file), &hex(&ix.data));
        composed.extend_from_slice(&ix.data[tag_len..]);
    }
    let body = encode_body(&cfg);
    assert_eq!(hex(&composed), hex(&body), "header ++ legs 0..7 == the Day-1 body");
    check_file(&dir.join("config.hex"), &hex(&body));
    assert_eq!(std::fs::read_to_string(dir.join("config.hex")).unwrap().trim(), std::fs::read_to_string(root().join("config/mainnet-day1.hex")).unwrap().trim());
}

/// Final review I1: every golden Config pins the sponsored price account on the priced legs 1, 4, 5, 6, 7 and leaves legs
/// 0 (no price source), 2 and 3 (unpriced) zero. Read from the files, against the literal addresses.
#[test]
fn golden_feed_accounts_are_pinned() {
    let want = ["", addr::PYTH_ORE, "", "", addr::PYTH_SOL, addr::PYTH_SOL, addr::PYTH_SOL, addr::PYTH_CBBTC];
    for (name, _) in VARIANTS {
        let cfg = decode_body(&unhex(std::fs::read_to_string(root().join("config").join(name)).unwrap().trim())).unwrap();
        for (i, w) in want.iter().enumerate() {
            let pin = if w.is_empty() { ZERO } else { bytes(w) };
            assert_eq!(cfg.legs[i].feed_account, pin, "{name} leg {i}");
        }
    }
}

#[test]
#[ignore]
fn print_addresses() {
    let (cfg, bump) = config_pda();
    println!("LEASH_PROGRAM_ID={}\nCONFIG_PDA={cfg}\nCONFIG_BUMP={bump}\nADMIN={}", leash_id(), admin());
}

#[test]
#[ignore]
fn onchain_config_matches() {
    let path = std::env::var("LEASH_ONCHAIN_CONFIG").expect("LEASH_ONCHAIN_CONFIG=<file written by `solana account <CONFIG_PDA> --output json`>");
    let legs: Vec<usize> = std::env::var("LEASH_EXPECT_LEGS")
        .expect("LEASH_EXPECT_LEGS=2,6,7 (empty for none)")
        .split(',')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().parse().unwrap())
        .collect();
    let puller = b58(&std::env::var("LEASH_EXPECT_PULLER").unwrap_or_else(|_| addr::PULLER_MAINNET.to_string()));
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(v["pubkey"].as_str().unwrap(), config_pda().0.to_string(), "the account is the Config PDA");
    assert_eq!(v["account"]["owner"].as_str().unwrap(), leash_id().to_string(), "owned by the leash program");
    let data = base64::engine::general_purpose::STANDARD.decode(v["account"]["data"][0].as_str().unwrap()).unwrap();
    assert_eq!(data.len(), 1504);
    assert_eq!(&data[0..8], b"LEASHCFG");
    assert_eq!((data[8], data[9]), (1, config_pda().1));
    assert_eq!(hex(&data[16..]), body_hex(&puller, &legs), "on-chain body vs legs {legs:?}, puller {puller}");
    println!("on-chain Config OK: legs {legs:?} enabled, puller {puller}");
}
