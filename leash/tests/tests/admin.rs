use leash_tests::*;

fn fresh() -> (LiteSVM, Pubkey) {
    let mut svm = new_svm();
    svm.airdrop(&admin(), 10_000_000_000).unwrap();
    (svm, config_pda().0)
}
fn body() -> Config {
    mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), DAY1)
}

#[test]
fn init_by_admin_writes_magic_version_bump_body() {
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
    assert_eq!(&a.data[16..], &encode_body(&body())[..]);
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
    assert_eq!(&a.data[16..], &encode_body(&body())[..]);
}

#[test]
fn init_guards() {
    let stranger = Pubkey::new_unique();
    // BODY_LEN (decode_body, the one length check for init and set): one byte short
    let (mut svm, cfg) = fresh();
    let mut ix = init_config_ix(&cfg, &body());
    ix.data.pop();
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
    // INIT_ONCE: a second init
    let (mut svm, cfg) = fresh();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
    expect_custom(send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]), 0, 6023);
}

#[test]
fn init_and_set_refuse_every_invalid_config() {
    for (name, bad) in invalid_configs() {
        let (mut svm, cfg) = fresh();
        assert_eq!(send(&mut svm, &admin(), &[init_config_ix(&cfg, &bad)]), custom(0, 6013), "init {name}");
        send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
        assert_eq!(send(&mut svm, &admin(), &[set_config_ix(&cfg, &bad)]), custom(0, 6013), "set {name}");
    }
}

#[test]
fn set_config_replaces_the_body() {
    let (mut svm, cfg) = fresh();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
    let next = mainnet_config(&Pubkey::new_unique(), &Pubkey::new_unique(), [true; 8]);
    send(&mut svm, &admin(), &[set_config_ix(&cfg, &next)]).expect("set_config");
    let a = svm.get_account(&cfg).unwrap();
    assert_eq!(&a.data[16..], &encode_body(&next)[..]);
    assert_eq!(&a.data[0..10], &config_account_bytes(config_pda().1, &next)[0..10], "header untouched");
}

#[test]
fn set_config_guards() {
    let stranger = Pubkey::new_unique();
    let (mut svm, cfg) = fresh();
    svm.airdrop(&stranger, 10_000_000_000).unwrap();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
    let next = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
    // BODY_LEN again, through set_config: one byte long
    let mut ix = set_config_ix(&cfg, &next);
    ix.data.push(0);
    expect_custom(send(&mut svm, &admin(), &[ix]), 0, 6010);
    // SET_SIGNER: ADMIN's account without its signature
    let mut ix = set_config_ix(&cfg, &next);
    ix.accounts[0] = AccountMeta::new(admin(), false);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    // SET_ADMIN: a stranger signs
    let mut ix = set_config_ix(&cfg, &next);
    ix.accounts[0] = AccountMeta::new(stranger, true);
    expect_custom(send(&mut svm, &stranger, &[ix]), 0, 6014);
    assert_eq!(&svm.get_account(&cfg).unwrap().data[16..], &encode_body(&body())[..], "nothing changed");
}

#[test]
fn config_account_guards() {
    let next = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
    let (cfg, bump) = config_pda();
    // CFG_OWNER: a valid Config's bytes at the PDA, owned by the Token program
    let (mut svm, _) = fresh();
    put(&mut svm, cfg, token_program(), config_account_bytes(bump, &body()));
    expect_custom(send(&mut svm, &admin(), &[set_config_ix(&cfg, &next)]), 0, 6013);
    // CFG_ADDRESS: a valid Config owned by the leash at an address that is not the PDA
    let (mut svm, _) = fresh();
    let fake = Pubkey::new_unique();
    put(&mut svm, fake, leash_id(), config_account_bytes(bump, &body()));
    expect_custom(send(&mut svm, &admin(), &[set_config_ix(&fake, &next)]), 0, 6013);
}

/// Controller ruling: pad bytes in the payload are NOT refused; the stored body is the re-encoded validated struct,
/// so the account's pad bytes are always zero. Pads: body 72..80, and per leg bytes +3 and +12..+16.
fn dirty(cfg: &Config) -> Vec<u8> {
    let mut d = vec![c::IX_INIT_CONFIG];
    d.extend_from_slice(&encode_body(cfg));
    let b = 1; // payload offset of body byte 0
    for o in 72..80 {
        d[b + o] = 0xAA;
    }
    for i in 0..8 {
        let l = b + 80 + 176 * i;
        d[l + 3] = 0xBB;
        for o in 12..16 {
            d[l + o] = 0xCC;
        }
    }
    d
}

#[test]
fn nonzero_pad_bytes_init_stores_zeros() {
    let (mut svm, cfg) = fresh();
    let mut ix = init_config_ix(&cfg, &body());
    ix.data = dirty(&body());
    send(&mut svm, &admin(), &[ix]).unwrap();
    assert_eq!(&svm.get_account(&cfg).unwrap().data[16..], &encode_body(&body())[..]);
}

#[test]
fn nonzero_pad_bytes_set_stores_zeros() {
    let (mut svm, cfg) = fresh();
    send(&mut svm, &admin(), &[init_config_ix(&cfg, &body())]).unwrap();
    let next = mainnet_config(&b58(addr::PULLER_MAINNET), &b58(addr::PULLER_MAINNET_USDC), [true; 8]);
    let mut ix = set_config_ix(&cfg, &next);
    ix.data = dirty(&next);
    ix.data[0] = c::IX_SET_CONFIG;
    send(&mut svm, &admin(), &[ix]).unwrap();
    assert_eq!(&svm.get_account(&cfg).unwrap().data[16..], &encode_body(&next)[..]);
}
