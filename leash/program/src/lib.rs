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
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    AccountView, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};

use crate::{config::Config, constants::*, errors::LeashError};

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

pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if stack_height() != 1 { return Err(LeashError::NotTopLevel.into()); } // GUARD:TOP_LEVEL
    match data.first() {
        Some(&IX_INIT_CONFIG) => init_config(program_id, accounts, data),
        Some(&IX_SET_HEADER) => set_header(program_id, accounts, data),
        Some(&IX_SET_LEG) => set_leg(program_id, accounts, data),
        _ => Err(LeashError::BadData.into()), // tag 3 (the retired full-body set_config) lands here
    }
}

/// The Config account: owned by this program, at PDA(["config"]) with its stored bump, a valid layout.
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
