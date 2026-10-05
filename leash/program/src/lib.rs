//! The leash (spec 6, contracts sec 2): the puller may pull a user's daily USDC through Subscriptions only inside a
//! transaction whose later `settle` proves the user's own receipt grew by at least the on-chain floor.
#![no_std]

pub mod constants;
pub mod config;
pub mod errors;
pub mod price;

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
        Some(&IX_SET_CONFIG) => set_config(program_id, accounts, data),
        _ => Err(LeashError::BadData.into()),
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

/// accounts: [admin s w (payer), config w, system_program]. Pre-funding the PDA cannot wedge it (contracts audit 7).
/// The stored body is the RE-ENCODED validated struct, never the raw payload: pad bytes are always zero.
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
    let cfg = config::decode_body(&data[1..])?;
    config::validate(&cfg)?; // GUARD:INIT_VALIDATE
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
    d[16..].copy_from_slice(&config::encode_body(&cfg)); // GUARD:INIT_REENCODE
    Ok(())
}

/// accounts: [admin s, config w]. Full replace of bytes 16..1504 (re-encoded, pads zero) after the same validation as init.
fn set_config(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, config, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !admin.is_signer() { return Err(LeashError::NotAdmin.into()); } // GUARD:SET_SIGNER
    if admin.address() != &ADMIN { return Err(LeashError::NotAdmin.into()); } // GUARD:SET_ADMIN
    load_config(program_id, config)?;
    let cfg = config::decode_body(&data[1..])?;
    config::validate(&cfg)?; // GUARD:SET_VALIDATE
    let mut d = config.try_borrow_mut()?;
    d[16..].copy_from_slice(&config::encode_body(&cfg)); // GUARD:SET_REENCODE
    Ok(())
}
