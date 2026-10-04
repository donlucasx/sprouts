//! The leash (spec 6, contracts sec 2): the puller may pull a user's daily USDC through Subscriptions only inside a
//! transaction whose later `settle` proves the user's own receipt grew by at least the on-chain floor.
#![no_std]

pub mod constants;
pub mod config;
pub mod errors;

pub use pinocchio::Address;
use pinocchio::{AccountView, ProgramResult};

use crate::errors::LeashError;

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
    let _ = (program_id, accounts);
    match data.first() {
        _ => Err(LeashError::BadData.into()),
    }
}
