use leash_tests::*;

fn base() -> Config {
    mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8])
}

#[test]
fn mainnet_config_is_valid_in_every_variant() {
    for e in [[false; 8], DAY1, [true; 8]] {
        validate(&mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), e)).unwrap();
    }
}

#[test]
fn encode_decode_roundtrip_and_offsets() {
    let body = encode_body(&base());
    assert_eq!(body.len(), 1488);
    assert_eq!(decode_body(&body).unwrap(), base());
    // body offset = account offset - 16: puller @0, puller_usdc @32, max_pull_raw @64, legs @80 + 176 * leg
    assert_eq!(&body[0..32], &bytes(addr::PULLER_MAINNET));
    assert_eq!(u64_at(&body, 64), 5_000_000);
    assert_eq!((body[80], body[81], body[82]), (1, 1, 6), "leg 0: enabled, SKR_STAKE, 6 decimals");
    let l7 = 80 + 176 * 7;
    assert_eq!((body[l7 + 1], body[l7 + 2]), (0, 8), "leg 7: TOKEN, 8 decimals");
    assert_eq!(u16::from_le_bytes([body[l7 + 4], body[l7 + 5]]), 50, "leg 7 fee_bps @+4");
    assert_eq!(u16::from_le_bytes([body[l7 + 6], body[l7 + 7]]), 100, "leg 7 tol_bps @+6");
    assert_eq!(&body[l7 + 112..l7 + 144], &c::FEED_CBBTC, "leg 7 feed_id @+112");
    assert_eq!(decode_body(&body[..1487]), Err(LeashError::BadData));
}

#[test]
fn validate_guards() {
    for (name, bad) in invalid_configs() {
        assert_eq!(validate(&bad), Err(LeashError::BadConfig), "{name}");
    }
}

#[test]
fn decode_account_guards() {
    let mut good = vec![0u8; 1504];
    good[0..8].copy_from_slice(&c::MAGIC);
    good[8] = c::VERSION;
    good[9] = 254;
    good[16..].copy_from_slice(&encode_body(&base()));
    assert_eq!(decode_account(&good), Ok(base()));
    let mut long = good.clone();
    long.push(0);
    let mut magic = good.clone();
    magic[0] = b'X';
    let mut version = good.clone();
    version[8] = 2;
    for (name, d) in [("CFG_LEN", long), ("CFG_MAGIC", magic), ("CFG_VERSION", version)] {
        assert_eq!(decode_account(&d), Err(LeashError::BadConfig), "{name}");
    }
}
