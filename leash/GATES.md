# Leash gates (spec 6.5)

A leg is enabled on chain only when every column left of "Enabled on chain" says PASS (date, commit). Day 1 legs: 2, 6, 7. Day 2: 0, 1, 3, 4, 5.

| Leg | Byte | Day | S2 offsets (T0) | Unit + svm tests (T1-T6) | Mutation sweep (T8) | Fork sim (T7) | Enabled on chain |
|---|---|---|---|---|---|---|---|
| SKR | 0 | 2 | PASS offsets; price feed UNVERIFIED (2026-10-04, slot 453408545; see note 2) | PASS 2026-10-04 2bdf821 (synthetic price) | | PASS venue only 2026-10-04 2bdf821 (61450 CU, margin 1.015%): real SKR `stake`, SYNTHETIC price fixture $0.01808 (R324: no SKR price source; leg stays OFF) | |
| stORE | 1 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | | PASS 2026-10-04 2bdf821 (29495 CU, margin 0.817%; real ORE vault reader, stand-in swap at mid - 0.5%) | |
| USDC K-Lend | 2 | 1 | FAIL: `assertion left == right failed: D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: collateral supply @2592 == the kToken mint's supply (same slot)` left 92149838469384, right 92149825708849 (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | | PASS 2026-10-04 2bdf821 (90323 CU, margin 0.100%); real K-Lend deposit minted exactly the reader's prediction (rel. error 0) | |
| USDC Jupiter Lend | 3 | 2 | PASS (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | | PASS 2026-10-04 2bdf821 (88487 CU, margin 0.080%); real JL mint vs reader rel. error 1.0e-6 | |
| SOL K-Lend | 4 | 2 | PASS(mint-supply) + pyth (2026-10-04, slot 453408545: `s2_klend_sol_reserve_matches_mint_supply_and_api`, collateral @2592 == kSOL mint supply, Kamino API lag 1.40e-4); the real gate is Task 7, see note 1 | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | | PASS 2026-10-04 2bdf821 (115574 CU, margin 1.004%); real K-Lend deposit vs reader rel. error 8.5e-8 | |
| SOL Jupiter Lend | 5 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | | PASS 2026-10-04 2bdf821 (102191 CU, margin 0.983%); real JL mint vs reader rel. error 5.1e-7 | |
| hSOL | 6 | 1 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | | PASS 2026-10-04 2bdf821 (42559 CU, margin 1.004%; real hSOL pool reader, stand-in swap) | |
| cbBTC | 7 | 1 | PASS (no reader) + pyth (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | | PASS 2026-10-04 2bdf821 (33003 CU, margin 0.930%; real sponsored price copy, stand-in swap) | |

Fork notes (Task 7, 2026-10-04, `./scripts/test.sh --test fork`, snapshot slot 453408545): CU varies by ~15k run to run (bump search). Legs 2-5 run the real venue
instruction; legs 1, 6, 7 and the SOL legs' USDC->WSOL step use the stand-in swap at the oracle mid minus 0.5% (their real routes are the API track's S1).
Legs 4, 5 (tol 150): `fork_leg{4,5}_floor_boundary_through_leash` plant through leash.so on the real venue: min_out = floor - 1 refused (0, 6008),
floor - 1 delivered refused at the settle (6009), exactly the floor passes. The fork clock is the snapshot's: K-Lend accrued 7 slots (USDC) and 180 slots
(SOL) at refresh, so these errors measure the reader, not a long un-refreshed reserve.
SKR stake rounding (S2): 0 share(s) below floor(skr * 1e9 / share_price) at 2026-10-04; the API builder's min_out = expected - 1 is safe.

Release (Task 8): leash.so sha256 = , size = B, rent = SOL, mutation rows RED = /

S2 notes (Task 0, 2026-10-04): "+ pyth" = `s2_pyth_accounts_layout` also PASS for that leg's feed account (SOL, cbBTC, ORE; USDC checked as a control).
1. K-Lend (legs 2 and 4): S2 alone does not gate these legs. The real K-Lend gate is Task 7's actual-deposit check: the leash's rate must be within 1e-5
   of what K-Lend actually mints on a real deposit. Both legs stay disabled until that check passes.
   RESULT (Task 7, 2bdf821): PASS for both. kUSDC minted 1,661,340 = the reader's prediction exactly; kSOL minted 35,436,161 vs 35,436,164 predicted (8.5e-8).
   Leg 2 S2 is FAIL (`s2_klend_usdc_reserve_matches_mint_supply_and_api`, text in the row). USDC reserve D6q6: the @2592 vs mint gap is the same 12,760,535
   at slots 453408545 and 453408728 (the dust reserve AWnKJ9 is off by 100,000), and its total-liquidity check (not reached by the test) is out too:
   lag 8.25e-3 vs 5e-4, while the Kamino API's totalSupply did not move across reads as the chain moved ~1.24M USDC and sits below the API's own totalBorrow.
   rn/rd = 1.20385 at both slots. Leg 4 S2 is PASS(mint-supply) from its own test (`s2_klend_sol_reserve_matches_mint_supply_and_api`).
2. FEED_SKR's PriceUpdateV2 account is not fetched by fetch.py, so no S2 test reads it; leg 0's price leg is unverified by T0.
