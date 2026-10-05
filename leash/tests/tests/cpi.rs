//! NotTopLevel (contracts sec 2.5 row 0): pull refuses to run under CPI. leash_cpi_wrapper (tests/cpi-wrapper) forwards
//! [times][leash data] and its accounts[1..] to the leash `times` times inside one top-level instruction.
use leash_tests::*;

struct Cpi {
    w: World,
    l: Link,
    g: Leg,
    sink: Pubkey,
    wrapper: Pubkey,
}
fn setup() -> Cpi {
    let mut w = world([true; 8]);
    let wrapper = Pubkey::new_unique();
    w.svm.add_program_from_file(wrapper, root().join("target/deploy/leash_cpi_wrapper.so")).expect("leash_cpi_wrapper.so: scripts/test.sh builds it");
    let user = Pubkey::new_unique();
    let l = link(&mut w, user, user);
    let g = cbbtc_leg(&mut w, &user);
    let sink = new_token(&mut w.svm, pk(&c::USDC), Pubkey::new_unique(), 0);
    Cpi { w, l, g, sink, wrapper }
}
/// The wrapper instruction: `times` CPI pulls of `p`.
fn via(x: &Cpi, p: &Instruction, times: u8) -> Instruction {
    let mut accounts = vec![AccountMeta::new_readonly(leash_id(), false)];
    accounts.extend(p.accounts.iter().cloned());
    Instruction { program_id: x.wrapper, accounts, data: [vec![times], p.data.clone()].concat() }
}

#[test]
fn cpi_into_pull_is_refused() {
    let mut x = setup();
    let p = pull_ix(&x.w, &x.l, &x.g, 5_000_000, CBBTC_FLOOR_5USD);
    let ixs = [vec![via(&x, &p, 1)], fake_swap(&x.w, &x.g, 5_000_000, CBBTC_FLOOR_5USD, x.sink), vec![settle_ix(&x.w, &x.l.user, &x.g, 0, CBBTC_FLOOR_5USD, 5_000_000)]].concat();
    let payer = x.w.puller;
    expect_custom(send(&mut x.w.svm, &payer, &ixs), 0, 6000);
}

/// Attack #16 (Task 5 review): two CPI pulls of $2.50 inside one wrapper instruction (one daily cap of $5), one later
/// top-level settle that proves only ONE pull's floor. Without TOP_LEVEL both pulls see the wrapper's index as current,
/// find the same single settle, and the tx succeeds: $5 leaves the user, $2.50's worth arrives.
#[test]
fn cpi_double_pull_one_settle_is_refused() {
    let mut x = setup();
    let leg = mainnet_config(&x.w.puller, &x.w.puller_usdc, [true; 8]).legs[7];
    let half = 2_500_000u64;
    let f = price::floor_raw(half, 1, 1, Some((6_500_000_000_000, -8)), leg.fee_bps, leg.tol_bps, leg.underlying_decimals).unwrap() as u64;
    assert_eq!(f, 3_789, "the $2.50 cbBTC floor");
    let p = pull_ix(&x.w, &x.l, &x.g, half, f);
    let ixs = [
        vec![via(&x, &p, 2), token_transfer(x.w.puller_usdc, x.sink, x.w.puller, 2 * half), token_transfer(x.g.stock, x.g.receipt, x.w.puller, f)],
        vec![settle_ix(&x.w, &x.l.user, &x.g, 0, f, half)],
    ]
    .concat();
    let payer = x.w.puller;
    let r = send(&mut x.w.svm, &payer, &ixs);
    assert_eq!(r, custom(0, 6000), "Ok here = two CPI pulls ($5) settled against one $2.50 floor");
    assert_eq!(token_amount(&x.w.svm, &x.l.delegator_usdc), 100_000_000, "nothing left the user");
}
