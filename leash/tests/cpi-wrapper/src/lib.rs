//! Test-only program: CPIs into the leash with accounts[1..], to prove `pull` refuses CPI (NotTopLevel).
//! data = [times u8] ++ the leash instruction data: the same CPI is made `times` times inside this one instruction
//! (times 2 = attack #16 of the Task 5 review: two CPI pulls against one later top-level settle).
//! accounts[0] = the leash program; accounts[1..17] = the 16 accounts of a leg-7 pull.
#![cfg_attr(target_os = "solana", no_std)]

use pinocchio::{
    cpi::invoke,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
    AccountView, Address, ProgramResult,
};

#[cfg(target_os = "solana")]
pinocchio::entrypoint!(process_instruction);
#[cfg(target_os = "solana")]
pinocchio::nostd_panic_handler!();

const N: usize = 16;

pub fn process_instruction(_program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() != N + 1 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let Some((&times, leash_data)) = data.split_first() else {
        return Err(ProgramError::InvalidInstructionData);
    };
    let leash = &accounts[0];
    let rest = &accounts[1..];
    let metas: [InstructionAccount; N] = core::array::from_fn(|i| InstructionAccount::new(rest[i].address(), rest[i].is_writable(), rest[i].is_signer()));
    let views: [&AccountView; N] = core::array::from_fn(|i| &rest[i]);
    for _ in 0..times {
        invoke::<N, _>(&InstructionView { program_id: leash.address(), data: leash_data, accounts: &metas }, &views)?;
    }
    Ok(())
}
