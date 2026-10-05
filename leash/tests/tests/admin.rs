use leash::config::{encode_leg, validate_leg};
use leash_tests::*;

fn fresh() -> (LiteSVM, Pubkey) {
    let mut svm = new_svm();
    svm.airdrop(&admin(), 10_000_000_000).unwrap();
    (svm, config_pda().0)
}
fn body() -> Config {
    mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), DAY1)
}
fn installed() -> (LiteSVM, Pubkey) {
    let (mut svm, cfg) = fresh();
    install_config(&mut svm, &cfg, &body());
    (svm, cfg)
}
fn data(svm: &LiteSVM, cfg: &Pubkey) -> Vec<u8> {
    svm.get_account(cfg).unwrap().data
}
fn leg_range(i: usize) -> std::ops::Range<usize> {
    96 + 176 * i..96 + 176 * (i + 1)
}

#[test]
fn init_writes_the_header_and_leaves_every_leg_unset() {
    let (mut svm, cfg) = fresh();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).expect("init_config");
    let a = svm.get_account(&cfg).unwrap();
    assert_eq!(a.owner, leash_id());
    assert_eq!(a.data.len(), 1504);
    assert_eq!(a.lamports, svm.minimum_balance_for_rent_exemption(1504));
    assert_eq!(&a.data[0..8], b"LEASHCFG");
    assert_eq!(a.data[8], 1);
    assert_eq!(a.data[9], config_pda().1);
    assert_eq!(&a.data[10..16], &[0u8; 6]);
    assert_eq!(&a.data[16..96], &encode_body(&body())[..80], "header");
    assert!(a.data[96..].iter().all(|&b| b == 0), "legs unset");
    let stored = decode_account(&a.data).unwrap();
    for i in 0..8 {
        assert!(validate_leg(i, &stored.legs[i]).is_err(), "leg {i} must be unusable until set_leg");
    }
}

#[test]
fn init_succeeds_when_pda_prefunded() {
    let (mut svm, cfg) = fresh();
    // anyone can send lamports to the PDA once the program id is public (contracts audit 7)
    svm.set_account(cfg, Account { lamports: 1_000_000, data: vec![], owner: system_program(), executable: false, rent_epoch: 0 }).unwrap();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).expect("init after pre-funding");
    let a = svm.get_account(&cfg).unwrap();
    assert_eq!(a.owner, leash_id());
    assert_eq!(a.data.len(), 1504);
    assert_eq!(a.lamports, svm.minimum_balance_for_rent_exemption(1504));
    assert_eq!(&a.data[16..96], &encode_body(&body())[..80]);
    assert!(a.data[96..].iter().all(|&b| b == 0));
}

#[test]
fn init_guards() {
    let stranger = Pubkey::new_unique();
    // HEADER_LEN: one byte short, and the retired full-body payload under tag 2
    let (mut svm, cfg) = fresh();
    let mut ix = init_config_ix(&cfg, &body());
    ix.data.pop();
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    let mut ix = init_config_ix(&cfg, &body());
    ix.data = [vec![c::IX_INIT_CONFIG], encode_body(&body()).to_vec()].concat();
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    // INIT_SIGNER: ADMIN's account without its signature, a stranger pays
    let (mut svm, cfg) = fresh();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    let mut ix = init_config_ix(&cfg, &body());
    ix.accounts[0] = AccountMeta::new(admin(), false);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    // INIT_ADMIN: a stranger signs as the admin
    let (mut svm, cfg) = fresh();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    let mut ix = init_config_ix(&cfg, &body());
    ix.accounts[0] = AccountMeta::new(stranger, true);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    // INIT_SYSTEM: another program in the System Program slot
    let (mut svm, cfg) = fresh();
    let mut ix = init_config_ix(&cfg, &body());
    ix.accounts[2] = AccountMeta::new_readonly(token_program(), false);
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6002);
    // INIT_PDA: a config address that is not PDA(["config"])
    let (mut svm, _) = fresh();
    expect_custom(send(&mut svm, &admin(), &[init_config_ix(&Pubkey::new_unique(), &body())]), 0, 6001);
    // INIT_ONCE: a second init (after the golden path, and right after a bare init)
    let (mut svm, cfg) = installed();
    expect_custom(send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]), 0, 6023);
    let (mut svm, cfg) = fresh();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
    expect_custom(send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]), 0, 6023);
}

#[test]
fn golden_path_installs_the_whole_config() {
    let (svm, cfg) = installed();
    assert_eq!(&data(&svm, &cfg)[16..], &encode_body(&body())[..], "init + set_leg 0..7 == the full body");
    let (mut svm, cfg) = installed();
    let next = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]);
    send_each(&mut svm, replace_txs(&cfg, &next)).expect("set_header + set_leg 0..7");
    assert_eq!(&data(&svm, &cfg)[16..], &encode_body(&next)[..]);
}

/// Each invalid Config goes through the instruction that writes the field it breaks: header rules through init_config
/// AND set_header, per-leg rules through set_leg. Nothing changes on a refusal.
#[test]
fn each_invalid_config_is_refused_by_its_instruction() {
    let good = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
    for (name, bad) in invalid_configs() {
        if bad.header() != good.header() {
            let (mut svm, cfg) = fresh();
            assert_eq!(send(&mut svm, &admin(), &[init_config_ix(&cfg, &bad)]), custom(0, 6013), "init {name}");
            let (mut svm, cfg) = installed();
            let before = data(&svm, &cfg);
            assert_eq!(send(&mut svm, &admin(), &[set_header_ix(&cfg, &bad)]), custom(0, 6013), "set_header {name}");
            assert_eq!(data(&svm, &cfg), before, "{name}: nothing changed");
        } else {
            let i = (0..8).find(|&i| bad.legs[i] != good.legs[i]).expect("a leg differs");
            let (mut svm, cfg) = installed();
            let before = data(&svm, &cfg);
            assert_eq!(send(&mut svm, &admin(), &[set_leg_ix(&cfg, i as u8, &bad.legs[i])]), custom(0, 6013), "set_leg {i} {name}");
            assert_eq!(data(&svm, &cfg), before, "{name}: nothing changed");
        }
    }
}

#[test]
fn set_leg_replaces_one_leg_only() {
    let (mut svm, cfg) = installed();
    let before = data(&svm, &cfg);
    let mut l = body().legs[0];
    l.enabled = 1;
    send(&mut svm, &admin(), &[set_leg_ix(&cfg, 0, &l)]).expect("enable leg 0");
    let after = data(&svm, &cfg);
    assert_eq!(&after[leg_range(0)], &encode_leg(&l)[..]);
    assert_eq!(&after[..96], &before[..96], "header untouched");
    assert_eq!(&after[leg_range(1).start..], &before[leg_range(1).start..], "legs 1..7 untouched");
}

#[test]
fn set_header_keeps_every_leg() {
    let (mut svm, cfg) = installed();
    let before = data(&svm, &cfg);
    let next = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), DAY1);
    send(&mut svm, &admin(), &[set_header_ix(&cfg, &next)]).expect("rotate");
    let after = data(&svm, &cfg);
    assert_eq!(&after[16..96], &encode_body(&next)[..80]);
    assert_eq!(&after[..16], &before[..16], "magic, version, bump untouched");
    assert_eq!(&after[96..], &before[96..], "legs untouched");
}

#[test]
fn set_header_guards() {
    let stranger = Pubkey::new_unique();
    let (mut svm, cfg) = installed();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    let before = data(&svm, &cfg);
    let next = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), DAY1);
    // HEADER_LEN through set_header: one byte long
    let mut ix = set_header_ix(&cfg, &next);
    ix.data.push(0);
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    // SETHDR_SIGNER: ADMIN's account without its signature
    let mut ix = set_header_ix(&cfg, &next);
    ix.accounts[0] = AccountMeta::new(admin(), false);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    // SETHDR_ADMIN: a stranger signs
    let mut ix = set_header_ix(&cfg, &next);
    ix.accounts[0] = AccountMeta::new(stranger, true);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    assert_eq!(data(&svm, &cfg), before, "nothing changed");
}

#[test]
fn set_leg_guards() {
    let stranger = Pubkey::new_unique();
    let (mut svm, cfg) = installed();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    let before = data(&svm, &cfg);
    let l = body().legs[7];
    // SETLEG_LEN: one byte short, one byte long
    let mut ix = set_leg_ix(&cfg, 7, &l);
    ix.data.pop();
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    let mut ix = set_leg_ix(&cfg, 7, &l);
    ix.data.push(0);
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    // SETLEG_INDEX: leg 8
    expect_custom(send(&mut svm, &admin(), &[set_leg_ix(&cfg, 8, &l)]), 0, 6010);
    // SETLEG_SIGNER: ADMIN's account without its signature
    let mut ix = set_leg_ix(&cfg, 7, &l);
    ix.accounts[0] = AccountMeta::new(admin(), false);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    // SETLEG_ADMIN: a stranger signs
    let mut ix = set_leg_ix(&cfg, 7, &l);
    ix.accounts[0] = AccountMeta::new(stranger, true);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    assert_eq!(data(&svm, &cfg), before, "nothing changed");
}

#[test]
fn config_account_guards() {
    let l = body().legs[7];
    let (cfg, bump) = config_pda();
    // CFG_OWNER: a valid Config's bytes at the PDA, owned by the Token program (set_leg and set_header)
    let (mut svm, _) = fresh();
    put(&mut svm, cfg, token_program(), config_account_bytes(bump, &body()));
    expect_custom(send(&mut svm, &admin(), &[set_leg_ix(&cfg, 7, &l)]), 0, 6013);
    expect_custom(send(&mut svm, &admin(), &[set_header_ix(&cfg, &body())]), 0, 6013);
    // set_leg before any init: the PDA does not exist (System-owned, empty): CFG_OWNER again
    let (mut svm, _) = fresh();
    expect_custom(send(&mut svm, &admin(), &[set_leg_ix(&cfg, 7, &l)]), 0, 6013);
    // CFG_ADDRESS: a valid Config owned by the leash at an address that is not the PDA
    let (mut svm, _) = fresh();
    let fake = Pubkey::new_unique();
    put(&mut svm, fake, leash_id(), config_account_bytes(bump, &body()));
    expect_custom(send(&mut svm, &admin(), &[set_leg_ix(&fake, 7, &l)]), 0, 6013);
    expect_custom(send(&mut svm, &admin(), &[set_header_ix(&fake, &body())]), 0, 6013);
}

#[test]
fn retired_set_config_tag_is_refused() {
    let (mut svm, cfg) = installed();
    let before = data(&svm, &cfg);
    let ix = Instruction {
        program_id: leash_id(),
        accounts: vec![AccountMeta::new(admin(), true), AccountMeta::new(cfg, false)],
        data: [vec![3u8], encode_body(&body()).to_vec()].concat(),
    };
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    assert_eq!(data(&svm, &cfg), before);
}

/// Pad and reserved bytes in a payload are not refused; the stored bytes are the re-encoded struct, so they are zero.
#[test]
fn nonzero_pad_bytes_are_stored_as_zeros() {
    let (mut svm, cfg) = fresh();
    let mut ix = init_config_ix(&cfg, &body());
    for o in 1 + 72..1 + 80 {
        ix.data[o] = 0xAA; // header reserved bytes 72..80
    }
    send(&mut svm, &admin(), &[ix]).unwrap();
    assert_eq!(&data(&svm, &cfg)[16..96], &encode_body(&body())[..80]);
    let mut ix = set_header_ix(&cfg, &body());
    ix.data[1 + 75] = 0xAA;
    send(&mut svm, &admin(), &[ix]).unwrap();
    assert_eq!(&data(&svm, &cfg)[16..96], &encode_body(&body())[..80]);
    let l = body().legs[7];
    let mut ix = set_leg_ix(&cfg, 7, &l);
    ix.data[2 + 3] = 0xBB;
    for o in 12..16 {
        ix.data[2 + o] = 0xCC;
    }
    send(&mut svm, &admin(), &[ix]).unwrap();
    assert_eq!(&data(&svm, &cfg)[leg_range(7)], &encode_leg(&l)[..]);
}

/// Contracts 2.5 / 2.10 test 22: mainnet refuses a tx over 1,232 B and litesvm does not, so this measures every admin tx
/// the golden path builds. Exact bare sizes pin the contracts' arithmetic; the retired payload is the negative control.
#[test]
fn admin_txs_fit_in_1232_bytes() {
    let cfg = config_pda().0;
    let all = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
    let a = admin();
    assert_eq!(tx_size(&a, &[init_config_ix(&cfg, &all)]), 317, "init_config bare");
    assert_eq!(tx_size(&a, &[set_header_ix(&cfg, &all)]), 284, "set_header bare");
    assert_eq!(tx_size(&a, &[set_leg_ix(&cfg, 7, &all.legs[7])]), 382, "set_leg bare");
    let mut every = install_txs(&cfg, &all);
    every.extend(replace_txs(&cfg, &all));
    assert_eq!(every.len(), 18);
    for ix in &every {
        let with_cu = [compute_budget_pair(), vec![ix.clone()]].concat();
        let n = tx_size(&a, &with_cu);
        assert!(n <= MAX_TX_BYTES, "tag {} is {n} B with the CU pair", ix.data[0]);
        assert!(n == 369 || n == 336 || n == 434, "tag {} with the CU pair: {n} B, contracts 2.5 says 369 / 336 / 434", ix.data[0]);
    }
    // negative control: the retired full-body instruction (1 + 1488 B) does not fit, so this check can go red
    let old = Instruction { program_id: leash_id(), accounts: vec![AccountMeta::new(a, true), AccountMeta::new(cfg, false)], data: [vec![3u8], encode_body(&all).to_vec()].concat() };
    let n = tx_size(&a, &[old]);
    assert_eq!(n, 1693);
    assert!(n > MAX_TX_BYTES);
}
