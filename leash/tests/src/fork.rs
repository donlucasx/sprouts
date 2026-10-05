//! Mainnet fork in litesvm: every fixtures/accounts dump plus the venue programs, at the snapshot's slot, time and epoch.
use crate::*;

pub fn fork_svm() -> LiteSVM {
    let r = reference();
    let mut svm = LiteSVM::new().with_sigverify(false).with_transaction_history(0);
    let programs: [(Pubkey, &str); 6] = [
        (leash_id(), "target/deploy/leash.so"),
        (pk(&c::SUBSCRIPTIONS), "fixtures/subs.so"),
        (pk(&c::KLEND), "fixtures/klend.so"),
        (pk(&c::JLEND), "fixtures/jlend.so"),
        (b58(addr::JLEND_LIQUIDITY_PROGRAM), "fixtures/jlliq.so"),
        (pk(&c::SKR_STAKING), "fixtures/skr.so"),
    ];
    for (id, path) in programs {
        svm.add_program_from_file(id, root().join(path)).unwrap_or_else(|e| panic!("{path}: {e:?} (run fixtures/fetch.sh)"));
    }
    let mut clock: Clock = svm.get_sysvar();
    clock.slot = r["slot"].as_u64().unwrap();
    clock.unix_timestamp = r["unix_ts"].as_i64().unwrap();
    clock.epoch = r["epoch"].as_u64().unwrap();
    svm.set_sysvar(&clock);
    for entry in std::fs::read_dir(root().join("fixtures/accounts")).unwrap() {
        let path = entry.unwrap().path();
        let stem = path.file_stem().unwrap().to_str().unwrap().to_string();
        if stem == "reference" {
            continue;
        }
        svm.set_account(b58(&stem), must_fixture(&stem)).unwrap();
    }
    svm
}

/// `send` that prints the failed transaction's program logs (to tell a venue's environment failure from a leash defect).
pub fn send_logged(svm: &mut LiteSVM, payer: &Pubkey, ixs: &[Instruction]) -> Result<u64, String> {
    let mut msg = solana_message::Message::new(ixs, Some(payer));
    msg.recent_blockhash = svm.latest_blockhash();
    let r = svm.send_transaction(solana_transaction::Transaction::new_unsigned(msg));
    svm.expire_blockhash();
    match r {
        Ok(m) => Ok(m.compute_units_consumed),
        Err(e) => {
            for line in &e.meta.logs {
                println!("  log: {line}");
            }
            Err(format!("{:?}", e.err))
        }
    }
}

/// The leash's own reader over the accounts as they are in `svm` now (same code as the program).
pub fn rate_now(svm: &LiteSVM, leg: usize, accounts: &[Pubkey]) -> (u128, u128) {
    let cfg = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]);
    let accts: Vec<Account> = accounts.iter().map(|k| svm.get_account(k).expect("reader account")).collect();
    let keys: Vec<[u8; 32]> = accounts.iter().map(|k| k.to_bytes()).collect();
    let owners: Vec<[u8; 32]> = accts.iter().map(|a| a.owner.to_bytes()).collect();
    let views: Vec<Acct> = (0..accts.len()).map(|i| Acct { key: &keys[i], owner: &owners[i], data: &accts[i].data }).collect();
    readers::rate(leg, &cfg.legs[leg], &views, svm.get_sysvar::<Clock>().epoch).expect("reader on the snapshot")
}

/// What the API's post_update writes when the sponsored account is 60 s old or more: the dumped sponsored bytes
/// (same feed, price, conf, Full) at a fresh address with publish_time = now - 1.
pub fn posted_copy(svm: &mut LiteSVM, sponsored: &str) -> Pubkey {
    let mut a = must_fixture(sponsored);
    let now = svm.get_sysvar::<Clock>().unix_timestamp;
    a.data[93..101].copy_from_slice(&(now - 1).to_le_bytes());
    let at = Pubkey::new_unique();
    svm.set_account(at, a).unwrap();
    at
}
pub fn price_of(svm: &LiteSVM, at: &Pubkey) -> (i64, u64, i32) {
    let d = svm.get_account(at).unwrap().data;
    (i64_at(&d, 73), u64_at(&d, 81), i32_at(&d, 89))
}
/// Underlying raw that `amount` USDC raw buys at the mid price, minus a 0.5% swap cost (the stand-in swap's output).
pub fn fair_out(amount: u64, price: i64, expo: i32, decimals: u32) -> u128 {
    (amount as u128) * 10u128.pow(decimals) * 10u128.pow((-expo) as u32) / (price as u128 * 1_000_000) * 9_950 / 10_000
}
/// A WSOL token account holding `amount` lamports above rent (is_native = Some(rent)).
pub fn put_native_wsol(svm: &mut LiteSVM, at: Pubkey, owner: Pubkey, amount: u64) {
    let rent = svm.minimum_balance_for_rent_exemption(165);
    let mut d = token_data(&b58(addr::WSOL), &owner, amount);
    d[109..113].copy_from_slice(&1u32.to_le_bytes());
    d[113..121].copy_from_slice(&rent.to_le_bytes());
    svm.set_account(at, Account { lamports: rent + amount, data: d, owner: token_program(), executable: false, rent_epoch: 0 }).unwrap();
}

pub struct KlendReserve {
    pub reserve: &'static str,
    pub liq_mint: &'static str,
    pub supply_vault: &'static str,
    pub coll_mint: &'static str,
}
pub const KLEND_USDC: KlendReserve = KlendReserve { reserve: addr::RESERVE_USDC, liq_mint: addr::USDC, supply_vault: addr::SUPPLY_VAULT_USDC, coll_mint: addr::KUSDC };
pub const KLEND_SOL: KlendReserve = KlendReserve { reserve: addr::RESERVE_SOL, liq_mint: addr::WSOL, supply_vault: addr::SUPPLY_VAULT_SOL, coll_mint: addr::KSOL };

/// refresh_reserve: [reserve w, market, KLEND x3 (unused oracle slots), scope prices] (contracts sec 3.3).
pub fn klend_refresh_ix(reserve: Pubkey) -> Instruction {
    let k = pk(&c::KLEND);
    Instruction {
        program_id: k,
        accounts: vec![
            AccountMeta::new(reserve, false),
            AccountMeta::new_readonly(b58(addr::KLEND_MARKET), false),
            AccountMeta::new_readonly(k, false),
            AccountMeta::new_readonly(k, false),
            AccountMeta::new_readonly(k, false),
            AccountMeta::new_readonly(b58(addr::SCOPE_PRICES), false),
        ],
        data: unhex("02da8aeb4fc91966"),
    }
}
/// deposit_reserve_liquidity(amount): [owner s, reserve w, market, LMA, liquidity mint, supply vault w, collateral mint w,
/// source w, destination w, Tokenkeg, Tokenkeg, Sysvar1nstructions] (contracts sec 3.3).
pub fn klend_deposit_ix(owner: Pubkey, r: &KlendReserve, source: Pubkey, dest: Pubkey, amount: u64) -> Instruction {
    let mut data = unhex("a9c91e7e06cd6644");
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: pk(&c::KLEND),
        accounts: vec![
            AccountMeta::new(owner, true),
            AccountMeta::new(b58(r.reserve), false),
            AccountMeta::new_readonly(b58(addr::KLEND_MARKET), false),
            AccountMeta::new_readonly(b58(addr::KLEND_LMA), false),
            AccountMeta::new_readonly(b58(r.liq_mint), false),
            AccountMeta::new(b58(r.supply_vault), false),
            AccountMeta::new(b58(r.coll_mint), false),
            AccountMeta::new(source, false),
            AccountMeta::new(dest, false),
            AccountMeta::new_readonly(token_program(), false),
            AccountMeta::new_readonly(token_program(), false),
            AccountMeta::new_readonly(b58(addr::SYSVAR_INSTRUCTIONS), false),
        ],
        data,
    }
}

pub struct JlAsset {
    pub mint: &'static str,
    pub lending: &'static str,
    pub fmint: &'static str,
    pub strl: &'static str,
    pub lspol: &'static str,
    pub rate_model: &'static str,
    pub vault: &'static str,
    pub rewards: &'static str,
}
pub const JL_USDC: JlAsset = JlAsset {
    mint: addr::USDC,
    lending: addr::JL_LENDING_USDC,
    fmint: addr::JLUSDC,
    strl: addr::JL_STRL_USDC,
    lspol: addr::JL_LSPOL_USDC,
    rate_model: addr::JL_RATE_MODEL_USDC,
    vault: addr::JL_VAULT_USDC,
    rewards: addr::JL_REWARDS_USDC,
};
pub const JL_SOL: JlAsset = JlAsset {
    mint: addr::WSOL,
    lending: addr::JL_LENDING_SOL,
    fmint: addr::JLWSOL,
    strl: addr::JL_STRL_SOL,
    lspol: addr::JL_LSPOL_SOL,
    rate_model: addr::JL_RATE_MODEL_SOL,
    vault: addr::JL_VAULT_SOL,
    rewards: addr::JL_REWARDS_SOL,
};
/// mint_with_max_assets(shares, max_assets): 17 accounts (contracts sec 3.3).
pub fn jl_mint_ix(puller: Pubkey, source: Pubkey, puller_jl: Pubkey, j: &JlAsset, shares: u64, max_assets: u64) -> Instruction {
    let mut data = unhex("065e457a1eb392ab");
    data.extend_from_slice(&shares.to_le_bytes());
    data.extend_from_slice(&max_assets.to_le_bytes());
    Instruction {
        program_id: pk(&c::JLEND),
        accounts: vec![
            AccountMeta::new(puller, true),
            AccountMeta::new(source, false),
            AccountMeta::new(puller_jl, false),
            AccountMeta::new_readonly(b58(j.mint), false),
            AccountMeta::new_readonly(b58(addr::JL_LENDING_ADMIN), false),
            AccountMeta::new(b58(j.lending), false),
            AccountMeta::new(b58(j.fmint), false),
            AccountMeta::new(b58(j.strl), false),
            AccountMeta::new(b58(j.lspol), false),
            AccountMeta::new_readonly(b58(j.rate_model), false),
            AccountMeta::new(b58(j.vault), false),
            AccountMeta::new(b58(addr::JL_LIQUIDITY), false),
            AccountMeta::new_readonly(b58(addr::JLEND_LIQUIDITY_PROGRAM), false),
            AccountMeta::new_readonly(b58(j.rewards), false),
            AccountMeta::new_readonly(token_program(), false),
            AccountMeta::new_readonly(pk(&c::ATA_PROGRAM), false),
            AccountMeta::new_readonly(system_program(), false),
        ],
        data,
    }
}
/// SKR stake(amount): the puller pays, `user` is the beneficiary (api/src/lib/staking.ts buildStakeIx).
pub fn skr_stake_ix(puller: Pubkey, user: Pubkey, puller_skr: Pubkey, amount: u64) -> Instruction {
    let user_stake = Pubkey::new_from_array(readers::user_stake_address(&bytes(addr::STAKE_CONFIG), &user.to_bytes(), &bytes(addr::GUARDIAN_POOL)));
    let mut data = vec![206, 176, 202, 18, 200, 209, 179, 108];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: pk(&c::SKR_STAKING),
        accounts: vec![
            AccountMeta::new(user_stake, false),
            AccountMeta::new(b58(addr::STAKE_CONFIG), false),
            AccountMeta::new(b58(addr::GUARDIAN_POOL), false),
            AccountMeta::new(puller, true),
            AccountMeta::new_readonly(user, false),
            AccountMeta::new(puller_skr, false),
            AccountMeta::new(b58(addr::STAKE_VAULT), false),
            AccountMeta::new_readonly(b58(addr::SKR), false),
            AccountMeta::new_readonly(token_program(), false),
            AccountMeta::new_readonly(system_program(), false),
            AccountMeta::new_readonly(b58(addr::SKR_EVENT_AUTHORITY), false),
            AccountMeta::new_readonly(pk(&c::SKR_STAKING), false),
        ],
        data,
    }
}
