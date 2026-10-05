//! The leash (spec 6, contracts sec 2): the puller may pull a user's daily USDC through Subscriptions only inside a
//! transaction whose later `settle` proves the user's own receipt grew by at least the on-chain floor.
#![no_std]

pub mod constants;
pub mod config;
pub mod errors;
pub mod price;
pub mod readers;

pub use pinocchio::Address;
use pinocchio::{
    cpi::{invoke_signed, Seed, Signer},
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    sysvars::{clock::Clock, instructions::Instructions, rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};

use crate::{
    config::{Config, LegConfig},
    constants::*,
    errors::LeashError,
    readers::Acct,
};

pinocchio::address::declare_id!("GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7"); // LEASH_PROGRAM_ID

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::nostd_panic_handler!();

fn stack_height() -> u64 {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_get_stack_height()
    }
    #[cfg(not(target_os = "solana"))]
    1
}

/// `deny(unreachable_patterns)`: a renamed tag constant would turn its arm into a catch-all binding; this makes that a
/// compile error instead of a silent dispatch change (Task 2b review).
#[deny(unreachable_patterns)]
pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if stack_height() != 1 { return Err(LeashError::NotTopLevel.into()); } // GUARD:TOP_LEVEL
    match data.first() {
        Some(&IX_PULL) => pull(program_id, accounts, data),
        Some(&IX_SETTLE) => settle(program_id, accounts, data),
        Some(&IX_INIT_CONFIG) => init_config(program_id, accounts, data),
        Some(&IX_SET_HEADER) => set_header(program_id, accounts, data),
        Some(&IX_SET_LEG) => set_leg(program_id, accounts, data),
        _ => Err(LeashError::BadData.into()), // tag 3 (the retired full-body set_config) lands here
    }
}

/// The Config account: owned by this program, at PDA(["config"]) with its stored bump, a valid layout.
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
pub fn load_config(program_id: &Address, a: &AccountView) -> Result<Config, ProgramError> {
    if !a.owned_by(program_id) { return Err(LeashError::BadConfig.into()); } // GUARD:CFG_OWNER
    let d = a.try_borrow()?;
    if d.len() < 16 {
        return Err(LeashError::BadConfig.into());
    }
    let bump = [d[9]];
    let expected = Address::create_program_address(&[CONFIG_SEED, &bump[..]], program_id).map_err(|_| ProgramError::from(LeashError::BadConfig))?;
    if a.address() != &expected { return Err(LeashError::BadConfig.into()); } // GUARD:CFG_ADDRESS
    Ok(config::decode_account(&d)?)
}

/// accounts: [admin s w (payer), config w, system_program]; data [2][Config bytes 16..96].
/// Creates the Config with the header only; bytes 96..1504 stay zero, so every leg is unset (disabled, fails validate_leg)
/// until its set_leg lands. Pre-funding the PDA cannot wedge it (contracts audit 7).
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn init_config(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, config, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() { return Err(LeashError::NotAdmin.into()); } // GUARD:INIT_SIGNER
    if admin.address() != &ADMIN { return Err(LeashError::NotAdmin.into()); } // GUARD:INIT_ADMIN
    if system.address() != &SYSTEM { return Err(LeashError::BadProgram.into()); } // GUARD:INIT_SYSTEM
    let (expected, bump) = Address::find_program_address(&[CONFIG_SEED], program_id);
    if config.address() != &expected { return Err(LeashError::BadPda.into()); } // GUARD:INIT_PDA
    if config.owned_by(program_id) || !config.is_data_empty() { return Err(LeashError::AlreadyInitialized.into()); } // GUARD:INIT_ONCE
    let h = config::decode_header(&data[1..])?;
    config::validate_header(&h)?; // GUARD:INIT_VALIDATE
    let needed = Rent::get()?.try_minimum_balance(CONFIG_LEN)?;
    let bump_b = [bump];
    let seeds = [Seed::from(CONFIG_SEED), Seed::from(&bump_b)];
    let signer = [Signer::from(&seeds)];
    let have = config.lamports();
    if have == 0 {
        CreateAccount { from: admin, to: config, lamports: needed, space: CONFIG_LEN as u64, owner: program_id }.invoke_signed(&signer)?;
    } else {
        if have < needed {
            Transfer { from: admin, to: config, lamports: needed - have }.invoke()?;
        }
        Allocate { account: config, space: CONFIG_LEN as u64 }.invoke_signed(&signer)?;
        Assign { account: config, owner: program_id }.invoke_signed(&signer)?;
    }
    let mut d = config.try_borrow_mut()?;
    d[0..8].copy_from_slice(&MAGIC);
    d[8] = VERSION;
    d[9] = bump;
    d[16..LEGS_OFF].copy_from_slice(&config::encode_header(&h)); // GUARD:INIT_REENCODE
    Ok(())
}

/// accounts: [admin s, config w]; data [4][Config bytes 16..96]. Full replace of the header (re-encoded, reserved zero)
/// after validate_header; the legs are not touched. Puller rotation (contracts 8.3) is this instruction.
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn set_header(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() { return Err(LeashError::NotAdmin.into()); } // GUARD:SETHDR_SIGNER
    if admin.address() != &ADMIN { return Err(LeashError::NotAdmin.into()); } // GUARD:SETHDR_ADMIN
    load_config(program_id, config)?;
    let h = config::decode_header(&data[1..])?;
    config::validate_header(&h)?; // GUARD:SETHDR_VALIDATE
    let mut d = config.try_borrow_mut()?;
    d[16..LEGS_OFF].copy_from_slice(&config::encode_header(&h)); // GUARD:SETHDR_REENCODE
    Ok(())
}

/// accounts: [admin s, config w]; data [5][leg u8][LegConfig 176 B]. Full replace of legs[leg] (re-encoded, pads zero)
/// after validate_leg, every per-leg rule of contracts 2.3 including the leg-fixed ones. Disabling a leg = enabled 0 here.
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn set_leg(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() { return Err(LeashError::NotAdmin.into()); } // GUARD:SETLEG_SIGNER
    if admin.address() != &ADMIN { return Err(LeashError::NotAdmin.into()); } // GUARD:SETLEG_ADMIN
    load_config(program_id, config)?;
    if data.len() != SET_LEG_DATA_LEN { return Err(LeashError::BadData.into()); } // GUARD:SETLEG_LEN
    let i = data[1] as usize;
    if i >= NUM_LEGS { return Err(LeashError::BadData.into()); } // GUARD:SETLEG_INDEX
    let l = config::decode_leg(&data[2..]);
    config::validate_leg(i, &l)?; // GUARD:SETLEG_VALIDATE
    let o = LEGS_OFF + LEG_LEN * i;
    let mut d = config.try_borrow_mut()?;
    d[o..o + LEG_LEN].copy_from_slice(&config::encode_leg(&l)); // GUARD:SETLEG_REENCODE
    Ok(())
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}
fn u128_at(d: &[u8], o: usize) -> u128 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[o..o + 16]);
    u128::from_le_bytes(b)
}
fn acct<'a>(a: &'a AccountView, data: &'a [u8]) -> Acct<'a> {
    Acct { key: a.address().as_array(), owner: a.owner().as_array(), data }
}

/// The receipt reading: UserStake shares for SKR, token amount otherwise (contracts sec 2.7).
fn read_receipt(leg: &LegConfig, user: &AccountView, r: &AccountView) -> Result<u128, ProgramError> {
    let d = r.try_borrow()?;
    let a = acct(r, &d);
    let v = if leg.reader == READER_SKR_STAKE {
        readers::skr_receipt(&a, user.address().as_array(), leg)?
    } else {
        readers::token_receipt(&a, user.address().as_array(), leg)?
    };
    Ok(v)
}

/// `None` for the unpriced legs 2 and 3, whose price slot must be the System Program id (contracts audit 9.4).
fn read_price_acct(leg_i: usize, leg: &LegConfig, p: &AccountView, now: i64) -> Result<Option<(u64, i32)>, ProgramError> {
    if is_unpriced(leg_i) {
        if p.address() != &SYSTEM { return Err(LeashError::BadPriceAccount.into()); } // GUARD:P_UNPRICED_SYSTEM
        return Ok(None);
    }
    let d = p.try_borrow()?;
    Ok(Some(price::read_price(p.address().as_array(), p.owner().as_array(), &d, leg, now)?))
}

fn read_rate(leg_i: usize, leg: &LegConfig, rs: &[AccountView], epoch: u64) -> Result<(u128, u128), ProgramError> {
    match rs.len() {
        0 => Ok(readers::rate(leg_i, leg, &[], epoch)?),
        1 => {
            let d0 = rs[0].try_borrow()?;
            Ok(readers::rate(leg_i, leg, &[acct(&rs[0], &d0)], epoch)?)
        }
        2 => {
            let d0 = rs[0].try_borrow()?;
            let d1 = rs[1].try_borrow()?;
            Ok(readers::rate(leg_i, leg, &[acct(&rs[0], &d0), acct(&rs[1], &d1)], epoch)?)
        }
        _ => Err(LeashError::BadReader.into()),
    }
}

fn check_receiver(r: &AccountView, puller: &AccountView, cfg: &Config) -> ProgramResult {
    if r.address().as_array() != &cfg.puller_usdc { return Err(LeashError::BadReceiver.into()); } // GUARD:RECV_ADDR
    if !r.owned_by(&TOKEN) { return Err(LeashError::BadReceiver.into()); } // GUARD:RECV_TOKEN_OWNED
    let d = r.try_borrow()?;
    if d.len() != 165 { return Err(LeashError::BadReceiver.into()); } // GUARD:RECV_LEN
    if d[0..32] != *USDC.as_array() { return Err(LeashError::BadReceiver.into()); } // GUARD:RECV_MINT
    if d[32..64] != *puller.address().as_array() { return Err(LeashError::BadReceiver.into()); } // GUARD:RECV_OWNER
    Ok(())
}

/// Exactly one other leash instruction in the tx, after this pull, a settle carrying exactly
/// [1][leg][pre][min_out][amount] over exactly [user, config, receipt, price, readers...] (contracts sec 2.5).
#[allow(clippy::too_many_arguments)]
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn check_one_settle(
    program_id: &Address,
    ixs: &AccountView,
    leg: u8,
    pre: u128,
    min_out: u64,
    amount: u64,
    fixed: [&AccountView; 4],
    rs: &[AccountView],
) -> ProgramResult {
    let sysvar = Instructions::try_from(ixs)?;
    let cur = sysvar.load_current_index() as usize;
    let mut later: Option<usize> = None;
    for i in 0..sysvar.num_instructions() {
        if i == cur {
            continue;
        }
        let ix = sysvar.load_instruction_at(i)?;
        if ix.get_program_id() != program_id {
            continue;
        }
        if i < cur { return Err(LeashError::ExtraLeashIx.into()); } // GUARD:IX_BEFORE
        if later.is_some() { return Err(LeashError::ExtraLeashIx.into()); } // GUARD:IX_COUNT
        later = Some(i);
    }
    if later.is_none() { return Err(LeashError::MissingSettle.into()); } // GUARD:IX_MISSING
    let ix = sysvar.load_instruction_at(later.unwrap_or(cur))?;
    let mut expect = [0u8; 34];
    expect[0] = IX_SETTLE;
    expect[1] = leg;
    expect[2..18].copy_from_slice(&pre.to_le_bytes());
    expect[18..26].copy_from_slice(&min_out.to_le_bytes());
    expect[26..34].copy_from_slice(&amount.to_le_bytes());
    if ix.get_instruction_data() != &expect[..] { return Err(LeashError::SettleMismatch.into()); } // GUARD:SETTLE_DATA
    if ix.num_account_metas() != 4 + rs.len() { return Err(LeashError::SettleMismatch.into()); } // GUARD:SETTLE_NACCTS
    for j in 0..ix.num_account_metas() {
        let want = if j < 4 { fixed[j].address() } else { rs[j - 4].address() };
        if &ix.get_instruction_account_at(j)?.key != want { return Err(LeashError::SettleMismatch.into()); } // GUARD:SETTLE_KEYS
    }
    Ok(())
}

/// data [0][leg][amount u64][min_out u64]; accounts per contracts sec 2.5.
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn pull(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if data.len() != 18 { return Err(LeashError::BadData.into()); } // GUARD:PULL_LEN
    let leg_i = data[1] as usize;
    if leg_i >= NUM_LEGS { return Err(LeashError::BadData.into()); } // GUARD:PULL_LEG
    let amount = u64_at(data, 2);
    let min_out = u64_at(data, 10);
    if accounts.len() < 16 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let (fixed, rs) = accounts.split_at(16);
    let [puller, config, delegator, user, leash_pda, _delegation, _sub_auth, _delegator_ata, receiver, usdc_mint, token_prog, _event_auth, subs, ixs, receipt, price_acct] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let cfg = load_config(program_id, config)?;
    if !puller.is_signer() { return Err(LeashError::NotPuller.into()); } // GUARD:PULLER_SIGNER
    if puller.address().as_array() != &cfg.puller { return Err(LeashError::NotPuller.into()); } // GUARD:PULLER_KEY
    let leg = &cfg.legs[leg_i];
    if leg.enabled != 1 { return Err(LeashError::LegDisabled.into()); } // GUARD:LEG_ENABLED
    if config::validate_leg(leg_i, leg).is_err() { return Err(LeashError::BadConfig.into()); } // GUARD:PULL_LEG_VALID
    let (expected_pda, pda_bump) = Address::find_program_address(&[LEASH_SEED, delegator.address().as_ref(), user.address().as_ref()], program_id);
    if leash_pda.address() != &expected_pda { return Err(LeashError::BadPda.into()); } // GUARD:LEASH_PDA
    if token_prog.address() != &TOKEN { return Err(LeashError::BadProgram.into()); } // GUARD:TOKEN_PROGRAM
    if subs.address() != &SUBSCRIPTIONS { return Err(LeashError::BadProgram.into()); } // GUARD:SUBS_PROGRAM
    if usdc_mint.address() != &USDC { return Err(LeashError::BadMint.into()); } // GUARD:USDC_MINT
    check_receiver(receiver, puller, &cfg)?;
    if amount == 0 { return Err(LeashError::OverCap.into()); } // GUARD:AMOUNT_ZERO
    if amount > cfg.max_pull_raw { return Err(LeashError::OverCap.into()); } // GUARD:AMOUNT_CAP

    let clock = Clock::get()?;
    let pre = read_receipt(leg, user, receipt)?;
    let px = read_price_acct(leg_i, leg, price_acct, clock.unix_timestamp)?;
    let (rn, rd) = read_rate(leg_i, leg, rs, clock.epoch)?;
    let floor = price::floor_raw(amount, rn, rd, px, leg.fee_bps, leg.tol_bps, leg.underlying_decimals)?;
    if min_out == 0 { return Err(LeashError::BelowFloor.into()); } // GUARD:MIN_OUT_ZERO
    if (min_out as u128) < floor { return Err(LeashError::BelowFloor.into()); } // GUARD:BELOW_FLOOR

    check_one_settle(program_id, ixs, leg_i as u8, pre, min_out, amount, [user, config, receipt, price_acct], rs)?;

    transfer_recurring(fixed, amount, pda_bump)
}

/// Subscriptions transferRecurring, the leash PDA signing as the delegatee (research 28 sec 1). Its own frame: inlined
/// into pull, the CPI buffers plus pull's Config copy exceed SBF's 4 KiB stack frame.
#[inline(never)]
fn transfer_recurring(fixed: &[AccountView], amount: u64, pda_bump: u8) -> ProgramResult {
    let [_, _, delegator, user, leash_pda, delegation, sub_auth, delegator_ata, receiver, usdc_mint, token_prog, event_auth, subs, ..] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let mut ix_data = [0u8; 73];
    ix_data[0] = TRANSFER_RECURRING;
    ix_data[1..9].copy_from_slice(&amount.to_le_bytes());
    ix_data[9..41].copy_from_slice(delegator.address().as_ref());
    ix_data[41..73].copy_from_slice(USDC.as_ref());
    let metas = [
        InstructionAccount::writable(delegation.address()),
        InstructionAccount::writable(sub_auth.address()),
        InstructionAccount::writable(delegator_ata.address()),
        InstructionAccount::writable(receiver.address()),
        InstructionAccount::readonly(usdc_mint.address()),
        InstructionAccount::readonly(token_prog.address()),
        InstructionAccount::readonly_signer(leash_pda.address()),
        InstructionAccount::readonly(event_auth.address()),
        InstructionAccount::readonly(subs.address()),
    ];
    let ix = InstructionView { program_id: &SUBSCRIPTIONS, data: &ix_data, accounts: &metas };
    let bump = [pda_bump];
    let seeds = [Seed::from(LEASH_SEED), Seed::from(delegator.address().as_ref()), Seed::from(user.address().as_ref()), Seed::from(&bump)];
    invoke_signed::<9, _>(&ix, &[delegation, sub_auth, delegator_ata, receiver, usdc_mint, token_prog, leash_pda, event_auth, subs], &[Signer::from(&seeds)])
}

/// data [1][leg][pre u128][min_out u64][amount u64]; accounts [user, config, receipt, price, readers...].
/// Re-reads everything; both the pull-time and the settle-time floor must hold. Alone, it changes nothing.
#[inline(never)] // SBF: each handler keeps its own frame under the 4 KiB limit
fn settle(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    if data.len() != 34 { return Err(LeashError::BadData.into()); } // GUARD:SETTLE_LEN
    let leg_i = data[1] as usize;
    if leg_i >= NUM_LEGS { return Err(LeashError::BadData.into()); } // GUARD:SETTLE_LEG
    let pre = u128_at(data, 2);
    let min_out = u64_at(data, 18);
    let amount = u64_at(data, 26);
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let (fixed, rs) = accounts.split_at(4);
    let [user, config, receipt, price_acct] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let cfg = load_config(program_id, config)?;
    let leg = &cfg.legs[leg_i];
    if leg.enabled != 1 { return Err(LeashError::LegDisabled.into()); } // GUARD:SETTLE_ENABLED
    if config::validate_leg(leg_i, leg).is_err() { return Err(LeashError::BadConfig.into()); } // GUARD:SETTLE_LEG_VALID
    let clock = Clock::get()?;
    let post = read_receipt(leg, user, receipt)?;
    // contracts 2.7: at settle the SKR UserStake must exist. skr_receipt reads an absent (System, empty) one as 0, which
    // pull needs on a first planting; settle refuses it explicitly instead of relying on min_out > 0 (Task 4 review).
    if leg.reader == READER_SKR_STAKE && !receipt.owned_by(&SKR_STAKING) { return Err(LeashError::BadReceipt.into()); } // GUARD:SETTLE_SKR_EXISTS
    let px = read_price_acct(leg_i, leg, price_acct, clock.unix_timestamp)?;
    let (rn, rd) = read_rate(leg_i, leg, rs, clock.epoch)?;
    let floor = price::floor_raw(amount, rn, rd, px, leg.fee_bps, leg.tol_bps, leg.underlying_decimals)?;
    if post < pre { return Err(LeashError::Underdelivered.into()); } // GUARD:SETTLE_NEGATIVE
    let delta = post.wrapping_sub(pre);
    if delta < min_out as u128 { return Err(LeashError::Underdelivered.into()); } // GUARD:SETTLE_MIN_OUT
    if delta < floor { return Err(LeashError::Underdelivered.into()); } // GUARD:SETTLE_FLOOR
    Ok(())
}
