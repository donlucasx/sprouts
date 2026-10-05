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

#[test]
fn header_and_leg_codecs_compose_the_body() {
    use leash::config::{decode_header, decode_leg, encode_header, encode_leg, EMPTY_LEG};
    let cfg = base();
    let body = encode_body(&cfg);
    assert_eq!(&body[..80], &encode_header(&cfg.header())[..]);
    for i in 0..8 {
        let o = 80 + 176 * i;
        assert_eq!(&body[o..o + 176], &encode_leg(&cfg.legs[i])[..], "leg {i}");
        assert_eq!(decode_leg(&body[o..o + 176]), cfg.legs[i]);
    }
    assert_eq!(decode_header(&body[..80]), Ok(cfg.header()));
    assert_eq!(decode_header(&body[..79]), Err(LeashError::BadData));
    assert_eq!(decode_header(&body[..81]), Err(LeashError::BadData));
    assert_eq!(encode_leg(&EMPTY_LEG), [0u8; 176]);
    // R324: the golden ages
    assert_eq!(cfg.legs.iter().map(|l| l.max_age_s).collect::<Vec<_>>(), vec![60, 60, 60, 60, 60, 60, 60, 600]);
}

#[test]
fn an_unset_leg_is_never_valid() {
    use leash::config::{validate_leg, EMPTY_LEG};
    for i in 0..8 {
        assert_eq!(validate_leg(i, &EMPTY_LEG), Err(LeashError::BadConfig), "leg {i}");
        validate_leg(i, &base().legs[i]).unwrap();
    }
}

#[test]
fn leg7_accepts_the_age_ceiling() {
    // R324 boundary: 3600 s is leg 7's ceiling and is accepted; 3601 is refused (V_AGE_MAX, invalid_configs); legs 0-6 stop at 60.
    use leash::config::validate_leg;
    let mut l = base().legs[7];
    l.max_age_s = 3600;
    validate_leg(7, &l).unwrap();
    l.max_age_s = 3601;
    assert_eq!(validate_leg(7, &l), Err(LeashError::BadConfig));
    let mut l0 = base().legs[0];
    l0.max_age_s = 60;
    validate_leg(0, &l0).unwrap();
}
