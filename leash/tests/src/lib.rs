//! litesvm harness for the leash (contracts sec 2.10). Every test file starts with `use leash_tests::*;`.
//! Signature verification is off: the hard-coded ADMIN and the mainnet puller cannot sign here, and signer FLAGS
//! (what the program checks) are unaffected.
use std::path::PathBuf;

use base64::Engine as _;
use solana_message::Message;
use solana_transaction::Transaction;

pub use leash::{constants as c, errors::LeashError};
pub use litesvm::LiteSVM;
pub use solana_account::Account;
pub use solana_clock::Clock;
pub use solana_instruction::{AccountMeta, Instruction};
pub use solana_pubkey::Pubkey;

pub mod admin;
pub use admin::*;
pub mod cfg;
pub use cfg::*;

/// 2026-10-05T00:00:00Z: the clock of every synthetic (non-fork) test.
pub const NOW: i64 = 1_791_158_400;
pub const EPOCH: u64 = 880;
pub const SLOT: u64 = 400_000_000;

/// Mainnet addresses (contracts sec 1.4) the tests and fixtures use.
pub mod addr {
    pub const PULLER_MAINNET: &str = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
    pub const PULLER_MAINNET_USDC: &str = "3581Qy3hmNHiy8gkRPqyvyWoZ4Lt6sXc3jfokDNW6Eap";
    pub const USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    pub const WSOL: &str = "So11111111111111111111111111111111111111112";
    pub const SKR: &str = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
    pub const STORE_MINT: &str = "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR";
    pub const ORE_MINT: &str = "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp";
    pub const HSOL: &str = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
    pub const CBBTC: &str = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
    pub const KUSDC: &str = "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D";
    pub const KSOL: &str = "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1";
    pub const KUSDC_DUST: &str = "8EFj1QBADsCs2D1DNWWTHjsoWmEPW8FGFgKdsAeqoQJi";
    pub const JLUSDC: &str = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";
    pub const JLWSOL: &str = "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU";
    pub const KLEND: &str = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
    pub const KLEND_MARKET: &str = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
    pub const KLEND_LMA: &str = "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo";
    pub const RESERVE_USDC: &str = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";
    pub const RESERVE_SOL: &str = "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q";
    pub const RESERVE_DUST: &str = "AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ";
    pub const SUPPLY_VAULT_USDC: &str = "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6";
    pub const SUPPLY_VAULT_SOL: &str = "GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U";
    pub const SCOPE_PRICES: &str = "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH";
    pub const JLEND: &str = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9";
    pub const JLEND_LIQUIDITY_PROGRAM: &str = "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC";
    pub const JL_LENDING_ADMIN: &str = "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6";
    pub const JL_LIQUIDITY: &str = "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z";
    pub const JL_LENDING_USDC: &str = "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ";
    pub const JL_LENDING_SOL: &str = "BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3";
    pub const JL_STRL_USDC: &str = "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu";
    pub const JL_STRL_SOL: &str = "4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy";
    pub const JL_LSPOL_USDC: &str = "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF";
    pub const JL_LSPOL_SOL: &str = "4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm";
    pub const JL_RATE_MODEL_USDC: &str = "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688";
    pub const JL_RATE_MODEL_SOL: &str = "Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo";
    pub const JL_VAULT_USDC: &str = "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB";
    pub const JL_VAULT_SOL: &str = "5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr";
    pub const JL_REWARDS_USDC: &str = "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd";
    pub const JL_REWARDS_SOL: &str = "CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR";
    pub const SKR_STAKING: &str = "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ";
    pub const STAKE_CONFIG: &str = "4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw";
    pub const GUARDIAN_POOL: &str = "DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr";
    pub const STAKE_VAULT: &str = "8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8";
    pub const SKR_EVENT_AUTHORITY: &str = "8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir";
    pub const ORE_STAKE: &str = "4apcWHDc5RF2mpu4MDj6aRQ91aH5rZqbmJviBc75jwi8";
    pub const HSOL_POOL: &str = "3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws";
    pub const PYTH_SOL: &str = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
    pub const PYTH_USDC: &str = "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX";
    pub const PYTH_CBBTC: &str = "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe";
    pub const PYTH_ORE: &str = "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ";
    pub const FEED_USDC_HEX: &str = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
    pub const SUBS_EVENT_AUTHORITY: &str = "3Hnj4BYoDgtpBuqXfiy7Y8cNa3jXaNd4oqgSXBzkMcH7";
    pub const TOKEN_2022: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    pub const SYSVAR_INSTRUCTIONS: &str = "Sysvar1nstructions1111111111111111111111111";
}

pub fn pk(a: &leash::Address) -> Pubkey {
    Pubkey::new_from_array(*a.as_array())
}
pub fn b58(s: &str) -> Pubkey {
    pk(&leash::Address::from_str_const(s))
}
pub fn bytes(s: &str) -> [u8; 32] {
    b58(s).to_bytes()
}
/// `leash/` (the workspace root).
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}
pub fn leash_id() -> Pubkey {
    pk(&leash::ID)
}
pub fn system_program() -> Pubkey {
    Pubkey::default()
}
pub fn token_program() -> Pubkey {
    pk(&c::TOKEN)
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), token_program().as_ref(), mint.as_ref()], &pk(&c::ATA_PROGRAM)).0
}

pub fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn u128_at(d: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(d[o..o + 16].try_into().unwrap())
}
pub fn i64_at(d: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
pub fn i32_at(d: &[u8], o: usize) -> i32 {
    i32::from_le_bytes(d[o..o + 4].try_into().unwrap())
}
pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

/// A mainnet account from `fixtures/accounts/<address>.json` (written by fixtures/fetch.py).
pub fn fixture(address: &str) -> Option<Account> {
    let text = std::fs::read_to_string(root().join("fixtures/accounts").join(format!("{address}.json"))).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    Some(Account {
        lamports: v["lamports"].as_u64().unwrap(),
        data: base64::engine::general_purpose::STANDARD.decode(v["data_b64"].as_str().unwrap()).unwrap(),
        owner: b58(v["owner"].as_str().unwrap()),
        executable: v["executable"].as_bool().unwrap(),
        rent_epoch: 0,
    })
}
pub fn must_fixture(address: &str) -> Account {
    fixture(address).unwrap_or_else(|| panic!("missing fixtures/accounts/{address}.json: run leash/fixtures/fetch.sh"))
}
/// The snapshot's slot, time, epoch and the independent reference values (fixtures/fetch.py).
pub fn reference() -> serde_json::Value {
    let text = std::fs::read_to_string(root().join("fixtures/accounts/reference.json")).expect("missing fixtures/accounts/reference.json: run leash/fixtures/fetch.sh");
    serde_json::from_str(&text).unwrap()
}

/// litesvm with the built leash.so and the mainnet Subscriptions dump, clock at NOW / EPOCH / SLOT.
pub fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new().with_sigverify(false).with_transaction_history(0);
    svm.add_program_from_file(leash_id(), root().join("target/deploy/leash.so")).expect("target/deploy/leash.so: run leash/scripts/test.sh, which builds it first");
    svm.add_program_from_file(pk(&c::SUBSCRIPTIONS), root().join("fixtures/subs.so")).expect("fixtures/subs.so: run leash/fixtures/fetch.sh");
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = NOW;
    clock.epoch = EPOCH;
    clock.slot = SLOT;
    svm.set_sysvar(&clock);
    svm
}

pub fn put(svm: &mut LiteSVM, at: Pubkey, owner: Pubkey, data: Vec<u8>) {
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(at, Account { lamports, data, owner, executable: false, rent_epoch: 0 }).unwrap();
}

/// Sends an unsigned legacy tx (sigverify is off); Ok = compute units, Err = the TransactionError's Debug text.
pub fn send(svm: &mut LiteSVM, payer: &Pubkey, ixs: &[Instruction]) -> Result<u64, String> {
    let mut msg = Message::new(ixs, Some(payer));
    msg.recent_blockhash = svm.latest_blockhash();
    let r = svm.send_transaction(Transaction::new_unsigned(msg)).map(|m| m.compute_units_consumed).map_err(|e| format!("{:?}", e.err));
    svm.expire_blockhash();
    r
}
/// What `send` returns when instruction `ix` fails with custom code `code`.
pub fn custom(ix: u8, code: u32) -> Result<u64, String> {
    Err(format!("InstructionError({ix}, Custom({code}))"))
}
pub fn expect_custom(r: Result<u64, String>, ix: u8, code: u32) {
    assert_eq!(r, custom(ix, code));
}
pub fn token_amount(svm: &LiteSVM, at: &Pubkey) -> u64 {
    u64_at(&svm.get_account(at).expect("token account").data, 64)
}
