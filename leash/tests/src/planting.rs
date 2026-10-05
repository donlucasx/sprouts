//! A Sprouts planting in litesvm: Config, a Subscriptions delegation to the leash PDA, a leg's accounts, pull/settle,
//! and a stand-in for the swap or venue deposit (the puller moves receipt tokens it holds into the user's receipt).
use crate::*;

pub struct World {
    pub svm: LiteSVM,
    pub puller: Pubkey,
    pub puller_usdc: Pubkey,
    pub config: Pubkey,
}
#[derive(Clone)]
pub struct Link {
    pub delegator: Pubkey,
    pub user: Pubkey,
    pub leash_pda: Pubkey,
    pub delegation: Pubkey,
    pub sub_auth: Pubkey,
    pub delegator_usdc: Pubkey,
}
#[derive(Clone)]
pub struct Leg {
    pub leg: u8,
    pub receipt: Pubkey,
    pub price: Pubkey,
    pub readers: Vec<Pubkey>,
    /// a puller-owned account of the receipt mint: the stand-in swap/deposit pays out of it
    pub stock: Pubkey,
}

pub const CBBTC_FLOOR_5USD: u64 = 7_577;
pub const HSOL_FLOOR_5USD: u64 = 26_266_667;
pub const USDC_KLEND_FLOOR_2USD: u64 = 1_665_000;

/// Puller and admin funded, the USDC mint present, the puller's USDC ATA, Config initialised with `enabled`.
pub fn world_on(mut svm: LiteSVM, puller: Pubkey, enabled: [bool; 8]) -> World {
    svm.airdrop(&puller, 10_000_000_000).unwrap();
    svm.airdrop(&admin(), 10_000_000_000).unwrap();
    let usdc = pk(&c::USDC);
    if svm.get_account(&usdc).is_none() {
        put(&mut svm, usdc, token_program(), mint_data(1_000_000_000_000_000, 6));
    }
    let puller_usdc = ata(&puller, &usdc);
    put(&mut svm, puller_usdc, token_program(), token_data(&usdc, &puller, 0));
    let config = config_pda().0;
    install_config(&mut svm, &config, &mainnet_config(&puller, &puller_usdc, enabled)); // R325: init_config + set_leg 0..7, one tx each
    World { svm, puller, puller_usdc, config }
}
pub fn world(enabled: [bool; 8]) -> World {
    world_on(new_svm(), Pubkey::new_unique(), enabled)
}

pub fn leash_pda(delegator: &Pubkey, user: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[&b"leash"[..], delegator.as_ref(), user.as_ref()], &leash_id()).0
}

/// The link the app signs: InitSubscriptionAuthority + CreateRecurringDelegation(delegatee = PDA(delegator, user),
/// 5_000_000 per 86_400 s, no expiry). The delegator holds 100 USDC.
pub fn link(w: &mut World, delegator: Pubkey, user: Pubkey) -> Link {
    let subs = pk(&c::SUBSCRIPTIONS);
    let usdc = pk(&c::USDC);
    w.svm.airdrop(&delegator, 1_000_000_000).unwrap();
    let delegator_usdc = ata(&delegator, &usdc);
    put(&mut w.svm, delegator_usdc, token_program(), token_data(&usdc, &delegator, 100_000_000));
    let sub_auth = Pubkey::find_program_address(&[&b"SubscriptionAuthority"[..], delegator.as_ref(), usdc.as_ref()], &subs).0;
    let init = Instruction {
        program_id: subs,
        accounts: vec![
            AccountMeta::new(delegator, true),
            AccountMeta::new(sub_auth, false),
            AccountMeta::new_readonly(usdc, false),
            AccountMeta::new(delegator_usdc, false),
            AccountMeta::new_readonly(system_program(), false),
            AccountMeta::new_readonly(token_program(), false),
        ],
        data: vec![0],
    };
    send(&mut w.svm, &delegator, &[init]).expect("InitSubscriptionAuthority");
    let init_id = i64_at(&w.svm.get_account(&sub_auth).unwrap().data, 98);
    let pda = leash_pda(&delegator, &user);
    let nonce = 0u64;
    let delegation = Pubkey::find_program_address(&[&b"delegation"[..], sub_auth.as_ref(), delegator.as_ref(), pda.as_ref(), &nonce.to_le_bytes()[..]], &subs).0;
    let now = w.svm.get_sysvar::<Clock>().unix_timestamp;
    let mut data = vec![2u8];
    for v in [nonce, 5_000_000u64, 86_400u64] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    for v in [now - 60, 0i64, init_id] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    let create = Instruction {
        program_id: subs,
        accounts: vec![
            AccountMeta::new(delegator, true),
            AccountMeta::new(sub_auth, false),
            AccountMeta::new(delegation, false),
            AccountMeta::new_readonly(pda, false),
            AccountMeta::new_readonly(system_program(), false),
        ],
        data,
    };
    send(&mut w.svm, &delegator, &[create]).expect("CreateRecurringDelegation");
    Link { delegator, user, leash_pda: pda, delegation, sub_auth, delegator_usdc }
}

pub fn pull_ix(w: &World, l: &Link, g: &Leg, amount: u64, min_out: u64) -> Instruction {
    let mut data = vec![c::IX_PULL, g.leg];
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    let mut accounts = vec![
        AccountMeta::new(w.puller, true),
        AccountMeta::new_readonly(w.config, false),
        AccountMeta::new_readonly(l.delegator, false),
        AccountMeta::new_readonly(l.user, false),
        AccountMeta::new_readonly(l.leash_pda, false),
        AccountMeta::new(l.delegation, false),
        AccountMeta::new(l.sub_auth, false),
        AccountMeta::new(l.delegator_usdc, false),
        AccountMeta::new(w.puller_usdc, false),
        AccountMeta::new_readonly(pk(&c::USDC), false),
        AccountMeta::new_readonly(token_program(), false),
        AccountMeta::new_readonly(b58(addr::SUBS_EVENT_AUTHORITY), false),
        AccountMeta::new_readonly(pk(&c::SUBSCRIPTIONS), false),
        AccountMeta::new_readonly(b58(addr::SYSVAR_INSTRUCTIONS), false),
        AccountMeta::new_readonly(g.receipt, false),
        AccountMeta::new_readonly(g.price, false),
    ];
    accounts.extend(g.readers.iter().map(|r| AccountMeta::new_readonly(*r, false)));
    Instruction { program_id: leash_id(), accounts, data }
}

pub fn settle_ix(w: &World, user: &Pubkey, g: &Leg, pre: u128, min_out: u64, amount: u64) -> Instruction {
    let mut data = vec![c::IX_SETTLE, g.leg];
    data.extend_from_slice(&pre.to_le_bytes());
    data.extend_from_slice(&min_out.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    let mut accounts = vec![
        AccountMeta::new_readonly(*user, false),
        AccountMeta::new_readonly(w.config, false),
        AccountMeta::new_readonly(g.receipt, false),
        AccountMeta::new_readonly(g.price, false),
    ];
    accounts.extend(g.readers.iter().map(|r| AccountMeta::new_readonly(*r, false)));
    Instruction { program_id: leash_id(), accounts, data }
}

/// SPL Token Transfer (tag 3).
pub fn token_transfer(src: Pubkey, dst: Pubkey, authority: Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: token_program(),
        accounts: vec![AccountMeta::new(src, false), AccountMeta::new(dst, false), AccountMeta::new_readonly(authority, true)],
        data,
    }
}
/// Stand-in for Jupiter / the venue: the pulled USDC leaves for `sink`, `out` receipt units arrive in the user's receipt.
pub fn fake_swap(w: &World, g: &Leg, usdc_in: u64, out: u64, sink: Pubkey) -> Vec<Instruction> {
    vec![token_transfer(w.puller_usdc, sink, w.puller, usdc_in), token_transfer(g.stock, g.receipt, w.puller, out)]
}

/// Sends `ixs` with the puller as fee payer. Instructions come first so `run(planting(&w, ..), &mut w)` borrows cleanly
/// (`send(&mut w.svm, .., &planting(&w, ..))` would hold `&mut w.svm` while `planting` borrows `w`).
pub fn run(ixs: Vec<Instruction>, w: &mut World) -> Result<u64, String> {
    let payer = w.puller;
    send(&mut w.svm, &payer, &ixs)
}

/// cbBTC (leg 7): $65,000.00000000 posted at a fresh address, conf 0; the user's canonical cbBTC ATA.
pub fn cbbtc_leg(w: &mut World, user: &Pubkey) -> Leg {
    let mint = b58(addr::CBBTC);
    let receipt = ata(user, &mint);
    put(&mut w.svm, receipt, token_program(), token_data(&mint, user, 0));
    let price = Pubkey::new_unique();
    let t = w.svm.get_sysvar::<Clock>().unix_timestamp;
    put(&mut w.svm, price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_CBBTC, 6_500_000_000_000, 0, -8, t - 5, true));
    let puller = w.puller;
    let stock = new_token(&mut w.svm, mint, puller, 1_000_000_000_000);
    Leg { leg: 7, receipt, price, readers: vec![], stock }
}
/// hSOL (leg 6): a 1.25 SOL/hSOL pool at the pinned pool address, SOL $150 conf 0.
pub fn hsol_leg(w: &mut World, user: &Pubkey) -> Leg {
    let mint = b58(addr::HSOL);
    let receipt = ata(user, &mint);
    put(&mut w.svm, receipt, token_program(), token_data(&mint, user, 0));
    let epoch = w.svm.get_sysvar::<Clock>().epoch;
    put(&mut w.svm, b58(addr::HSOL_POOL), pk(&c::STAKE_POOL_PROGRAM), stake_pool_data(&mint.to_bytes(), 1_250_000_000, 1_000_000_000, epoch));
    let price = Pubkey::new_unique();
    let t = w.svm.get_sysvar::<Clock>().unix_timestamp;
    put(&mut w.svm, price, pk(&c::PYTH_RECEIVER), price_data(c::FEED_SOL, 15_000_000_000, 0, -8, t - 5, true));
    let puller = w.puller;
    let stock = new_token(&mut w.svm, mint, puller, 1_000_000_000_000);
    Leg { leg: 6, receipt, price, readers: vec![b58(addr::HSOL_POOL)], stock }
}
/// USDC K-Lend (leg 2): a 1.2 USDC/kUSDC reserve at the pinned reserve address; no price (System Program id).
pub fn usdc_klend_leg(w: &mut World, user: &Pubkey) -> Leg {
    let kusdc = b58(addr::KUSDC);
    let receipt = ata(user, &kusdc);
    put(&mut w.svm, receipt, token_program(), token_data(&kusdc, user, 0));
    put(
        &mut w.svm,
        b58(addr::RESERVE_USDC),
        pk(&c::KLEND),
        klend_reserve_data(c::USDC.as_array(), &kusdc.to_bytes(), 1_000_000_000_000, 200_000_000_000u128 << 60, [0; 3], 1_000_000_000_000),
    );
    let puller = w.puller;
    let stock = new_token(&mut w.svm, kusdc, puller, 1_000_000_000_000);
    Leg { leg: 2, receipt, price: system_program(), readers: vec![b58(addr::RESERVE_USDC)], stock }
}
