//! Every address, seed, size and discriminator the leash checks (contracts sec 1.4, 2.3, 2.6, 2.7). Pinned here, never read from input.
use pinocchio::Address;

/// The only key that may init or set the Config (contracts sec 2.1; his laptop key, R299).
pub const ADMIN: Address = Address::from_str_const("GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY");

pub const SUBSCRIPTIONS: Address = Address::from_str_const("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
pub const USDC: Address = Address::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const WSOL: Address = Address::from_str_const("So11111111111111111111111111111111111111112");
pub const SKR_MINT: Address = Address::from_str_const("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
pub const TOKEN: Address = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM: Address = Address::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SYSTEM: Address = Address::from_str_const("11111111111111111111111111111111");
pub const PYTH_RECEIVER: Address = Address::from_str_const("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
pub const SKR_STAKING: Address = Address::from_str_const("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ");
pub const STAKE_POOL_PROGRAM: Address = Address::from_str_const("SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY");
pub const KLEND: Address = Address::from_str_const("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const KLEND_MARKET: Address = Address::from_str_const("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
pub const JLEND: Address = Address::from_str_const("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
pub const ORE_STAKING: Address = Address::from_str_const("stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH");
pub const ORE_STAKE_AUTHORITY: Address = Address::from_str_const("GexGotZVLZdJ7N7w3BgHpKYmPs915pwZoZAqZVkCS8F7");

pub const CONFIG_SEED: &[u8] = b"config";
pub const LEASH_SEED: &[u8] = b"leash";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";

pub const IX_PULL: u8 = 0;
pub const IX_SETTLE: u8 = 1;
pub const IX_INIT_CONFIG: u8 = 2;
pub const IX_SET_CONFIG: u8 = 3;
pub const TRANSFER_RECURRING: u8 = 5;

pub const CONFIG_LEN: usize = 1504;
pub const BODY_LEN: usize = CONFIG_LEN - 16;
pub const LEGS_OFF: usize = 96;
pub const LEG_LEN: usize = 176;
pub const NUM_LEGS: usize = 8;
pub const MAGIC: [u8; 8] = *b"LEASHCFG";
pub const VERSION: u8 = 1;
pub const MAX_PULL_CEILING: u64 = 5_000_000;
pub const MAX_FEE_BPS: u16 = 100;
pub const MAX_FEE_PLUS_TOL_BPS: u16 = 150;
pub const MAX_CONF_CAP_BPS: u16 = 200;
pub const MAX_AGE_CEILING_S: u16 = 3600;

pub const LEG_SKR: usize = 0;
pub const LEG_STORE: usize = 1;
pub const LEG_USDC_KLEND: usize = 2;
pub const LEG_USDC_JLEND: usize = 3;
pub const LEG_SOL_KLEND: usize = 4;
pub const LEG_SOL_JLEND: usize = 5;
pub const LEG_HSOL: usize = 6;
pub const LEG_CBBTC: usize = 7;

pub const READER_TOKEN: u8 = 0;
pub const READER_SKR_STAKE: u8 = 1;
pub const READER_STAKE_POOL: u8 = 2;
pub const READER_KLEND: u8 = 3;
pub const READER_JLEND: u8 = 4;
pub const READER_STORE: u8 = 5;
/// Reader accounts each reader takes (indexed by reader id): contracts sec 2.4.
pub const READER_ACCOUNTS: [usize; 6] = [0, 1, 1, 1, 1, 2];
pub const READER_OF_LEG: [u8; NUM_LEGS] = [1, 5, 3, 4, 3, 4, 2, 0];
pub const DECIMALS_OF_LEG: [u8; NUM_LEGS] = [6, 11, 6, 6, 9, 9, 9, 8];

const fn nib(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("hex32: lowercase hex only"),
    }
}
/// 64 lowercase hex chars -> 32 bytes, at compile time.
pub const fn hex32(s: &str) -> [u8; 32] {
    let b = s.as_bytes();
    assert!(b.len() == 64, "hex32: 64 chars");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (nib(b[2 * i]) << 4) | nib(b[2 * i + 1]);
        i += 1;
    }
    out
}
pub const FEED_SOL: [u8; 32] = hex32("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d");
pub const FEED_CBBTC: [u8; 32] = hex32("2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97");
pub const FEED_ORE: [u8; 32] = hex32("142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504");
pub const FEED_SKR: [u8; 32] = hex32("38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9");
/// The pinned feed of each leg; zero = the leg is not priced (USDC lending, legs 2 and 3).
pub const FEED_OF_LEG: [[u8; 32]; NUM_LEGS] = [FEED_SKR, FEED_ORE, [0; 32], [0; 32], FEED_SOL, FEED_SOL, FEED_SOL, FEED_CBBTC];

pub const PRICE_UPDATE_DISC: [u8; 8] = [0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd];
pub const PRICE_UPDATE_LEN: usize = 134;
pub const KLEND_RESERVE_DISC: [u8; 8] = [0x2b, 0xf2, 0xcc, 0xca, 0x1a, 0xf7, 0x3b, 0x7f];
pub const KLEND_RESERVE_LEN: usize = 8624;
pub const JLEND_LENDING_DISC: [u8; 8] = [0x87, 0xc7, 0x52, 0x10, 0xf9, 0x83, 0xb6, 0xf1];
pub const JLEND_LENDING_LEN: usize = 196;
pub const STAKE_CONFIG_DISC: [u8; 8] = [0xee, 0x97, 0x2b, 0x03, 0x0b, 0x97, 0x3f, 0xb0];
pub const USER_STAKE_DISC: [u8; 8] = [0x66, 0x35, 0xa3, 0x6b, 0x09, 0x8a, 0x57, 0x99];
pub const ORE_STAKE_TYPE: u8 = 0x6c;

pub const fn is_unpriced(leg: usize) -> bool {
    leg == LEG_USDC_KLEND || leg == LEG_USDC_JLEND
}
/// The underlying mint a lending reader must see (USDC for legs 2/3, WSOL for legs 4/5).
pub const fn underlying_mint(leg: usize) -> [u8; 32] {
    match leg {
        LEG_USDC_KLEND | LEG_USDC_JLEND => *USDC.as_array(),
        LEG_SOL_KLEND | LEG_SOL_JLEND => *WSOL.as_array(),
        _ => [0; 32],
    }
}
