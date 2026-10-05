use leash_tests::*;

#[test]
fn unknown_instruction_is_bad_data() {
    let mut svm = new_svm();
    let payer = Pubkey::new_unique();
    svm.airdrop(&payer, 1_000_000_000).unwrap();
    for data in [vec![], vec![9u8]] {
        let ix = Instruction { program_id: leash_id(), accounts: vec![AccountMeta::new_readonly(payer, false)], data };
        expect_custom(send(&mut svm, &payer, &[ix]), 0, 6010);
    }
}
