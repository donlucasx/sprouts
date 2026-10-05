//! init_config / set_config instruction builders (contracts sec 2.5).
use crate::*;

pub fn admin() -> Pubkey {
    pk(&c::ADMIN)
}
pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[&b"config"[..]], &leash_id())
}
pub fn init_config_ix(config: &Pubkey, cfg: &Config) -> Instruction {
    let mut data = vec![c::IX_INIT_CONFIG];
    data.extend_from_slice(&encode_body(cfg));
    Instruction {
        program_id: leash_id(),
        accounts: vec![AccountMeta::new(admin(), true), AccountMeta::new(*config, false), AccountMeta::new_readonly(system_program(), false)],
        data,
    }
}
pub fn set_config_ix(config: &Pubkey, cfg: &Config) -> Instruction {
    let mut data = vec![c::IX_SET_CONFIG];
    data.extend_from_slice(&encode_body(cfg));
    Instruction { program_id: leash_id(), accounts: vec![AccountMeta::new(admin(), true), AccountMeta::new(*config, false)], data }
}
/// A whole Config account's bytes (for state injection in the config-account guard tests).
pub fn config_account_bytes(bump: u8, cfg: &Config) -> Vec<u8> {
    let mut d = vec![0u8; c::CONFIG_LEN];
    d[0..8].copy_from_slice(&c::MAGIC);
    d[8] = c::VERSION;
    d[9] = bump;
    d[16..].copy_from_slice(&encode_body(cfg));
    d
}
