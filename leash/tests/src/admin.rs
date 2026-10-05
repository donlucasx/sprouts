//! Config admin builders (contracts sec 2.5 as amended R325): init_config (header only), set_header, set_leg; the owner's
//! golden path; and the serialized size mainnet enforces (1,232 B), which litesvm does not.
use crate::*;
use leash::config::{encode_header, encode_leg, LegConfig};
use solana_message::Message;

pub const MAX_TX_BYTES: usize = 1232;

pub fn admin() -> Pubkey {
    pk(&c::ADMIN)
}
pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[&b"config"[..]], &leash_id())
}
fn admin_and_config(config: &Pubkey) -> Vec<AccountMeta> {
    vec![AccountMeta::new(admin(), true), AccountMeta::new(*config, false)]
}
/// [2][header]: only `cfg`'s puller, puller_usdc and max_pull_raw are sent; the legs stay unset.
pub fn init_config_ix(config: &Pubkey, cfg: &Config) -> Instruction {
    let mut data = vec![c::IX_INIT_CONFIG];
    data.extend_from_slice(&encode_header(&cfg.header()));
    let mut accounts = admin_and_config(config);
    accounts.push(AccountMeta::new_readonly(system_program(), false));
    Instruction { program_id: leash_id(), accounts, data }
}
pub fn set_header_ix(config: &Pubkey, cfg: &Config) -> Instruction {
    let mut data = vec![c::IX_SET_HEADER];
    data.extend_from_slice(&encode_header(&cfg.header()));
    Instruction { program_id: leash_id(), accounts: admin_and_config(config), data }
}
pub fn set_leg_ix(config: &Pubkey, leg: u8, l: &LegConfig) -> Instruction {
    let mut data = vec![c::IX_SET_LEG, leg];
    data.extend_from_slice(&encode_leg(l));
    Instruction { program_id: leash_id(), accounts: admin_and_config(config), data }
}
/// The owner's golden path (leash plan Task 9): init_config, then set_leg for legs 0..7 in order, one instruction per tx.
pub fn install_txs(config: &Pubkey, cfg: &Config) -> Vec<Instruction> {
    let mut v = vec![init_config_ix(config, cfg)];
    v.extend(cfg.legs.iter().enumerate().map(|(i, l)| set_leg_ix(config, i as u8, l)));
    v
}
/// A full replace of an existing Config: set_header, then set_leg 0..7.
pub fn replace_txs(config: &Pubkey, cfg: &Config) -> Vec<Instruction> {
    let mut v = vec![set_header_ix(config, cfg)];
    v.extend(cfg.legs.iter().enumerate().map(|(i, l)| set_leg_ix(config, i as u8, l)));
    v
}
/// Each instruction in its own tx, ADMIN paying; stops at the first failure.
pub fn send_each(svm: &mut LiteSVM, ixs: Vec<Instruction>) -> Result<(), String> {
    for ix in ixs {
        send(svm, &admin(), &[ix])?;
    }
    Ok(())
}
pub fn install_config(svm: &mut LiteSVM, config: &Pubkey, cfg: &Config) {
    send_each(svm, install_txs(config, cfg)).expect("init_config + set_leg 0..7");
}
/// What the owner's script prepends to every admin tx: SetComputeUnitLimit [2][u32] and SetComputeUnitPrice [3][u64].
pub fn compute_budget_pair() -> Vec<Instruction> {
    let cb = b58("ComputeBudget111111111111111111111111111111");
    let mut limit = vec![2u8];
    limit.extend_from_slice(&100_000u32.to_le_bytes());
    let mut price = vec![3u8];
    price.extend_from_slice(&20_000u64.to_le_bytes());
    vec![Instruction { program_id: cb, accounts: vec![], data: limit }, Instruction { program_id: cb, accounts: vec![], data: price }]
}
/// The wire size of a legacy tx paid by `payer`: compact signature count (1 B under 128) + 64 B per required signature +
/// the bincode-serialized message (the same bytes a validator receives). Mainnet refuses more than MAX_TX_BYTES.
pub fn tx_size(payer: &Pubkey, ixs: &[Instruction]) -> usize {
    let msg = Message::new(ixs, Some(payer));
    1 + 64 * msg.header.num_required_signatures as usize + msg.serialize().len()
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
