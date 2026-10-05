# Leash gates (spec 6.5)

A leg is enabled on chain only when every column left of "Enabled on chain" says PASS (date, commit). Day 1 legs: 2, 6, 7. Day 2: 0, 1, 3, 4, 5.

| Leg | Byte | Day | S2 offsets (T0) | Unit + svm tests (T1-T6) | Mutation sweep (T8) | Fork sim (T7) | Enabled on chain |
|---|---|---|---|---|---|---|---|
| SKR | 0 | 2 | PASS offsets; price feed UNVERIFIED (2026-10-04, slot 453408545; see note 2) | PASS 2026-10-04 2bdf821 (synthetic price) | PASS 2026-10-04 38ea620 (152/152 rows RED) | VENUE-ONLY (synthetic price) 2026-10-04 2bdf821 (61450 CU, margin 1.015%): real SKR `stake`, SYNTHETIC price fixture $0.01808 (R324: no SKR price source; leg stays OFF) | |
| stORE | 1 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (29495 CU, margin 0.817% vs an assumed 0.5% swap cost, not a route measurement; real ORE vault reader, stand-in swap at mid - 0.5%) | |
| USDC K-Lend | 2 | 1 | FAIL (mint-supply check; superseded by the Task 7 actual-deposit PASS 2bdf821, note 1): `assertion left == right failed: D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: collateral supply @2592 == the kToken mint's supply (same slot)` left 92149838469384, right 92149825708849 (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (90323 CU, margin 0.100%); real K-Lend deposit minted exactly the reader's prediction (rel. error 0) | |
| USDC Jupiter Lend | 3 | 2 | PASS (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (88487 CU, margin 0.080%); real JL mint vs reader rel. error 1.0e-6 | |
| SOL K-Lend | 4 | 2 | PASS(mint-supply) + pyth (2026-10-04, slot 453408545: `s2_klend_sol_reserve_matches_mint_supply_and_api`, collateral @2592 == kSOL mint supply, Kamino API lag 1.40e-4); the real gate is Task 7, see note 1 | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (115574 CU, margin 1.004%); real K-Lend deposit vs reader rel. error 8.5e-8 | |
| SOL Jupiter Lend | 5 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (102191 CU, margin 0.983%); real JL mint vs reader rel. error 5.1e-7 | |
| hSOL | 6 | 1 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (42559 CU, margin 1.004% vs an assumed 0.5% swap cost, not a route measurement; real hSOL pool reader, stand-in swap) | |
| cbBTC | 7 | 1 | PASS (no reader) + pyth (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (33003 CU, margin 0.930% vs an assumed 0.5% swap cost, not a route measurement; real sponsored price copy, stand-in swap) | |

Fork notes (Task 7, 2026-10-04, `./scripts/test.sh --test fork`, snapshot slot 453408545): CU varies by ~15k run to run (bump search). Legs 2-5 run the real venue
instruction; legs 1, 6, 7 and the SOL legs' USDC->WSOL step use the stand-in swap at the oracle mid minus 0.5% (their real routes are the API track's S1).
Legs 4, 5 (tol 150): `fork_leg{4,5}_floor_boundary_through_leash` plant through leash.so on the real venue: min_out = floor - 1 refused (0, 6008),
floor - 1 delivered refused at the settle (6009), exactly the floor passes. The fork clock is the snapshot's: K-Lend accrued 7 slots (USDC) and 180 slots
(SOL) at refresh, so these errors measure the reader, not a long un-refreshed reserve.
Legs 1 and 6 on the fork: the stand-in swap's output is computed from the reader's own rate, so their rate is self-consistent there; Task 0's S2
(reader vs the venue APIs) is the independent check of that rate.
K-Lend liveness (Task 7 review, question 5): the API builder's min_out is 2 bp under the pre-refresh prediction, so a reserve left un-refreshed for
more than ~4-5 h (~4.7e-10/slot measured on the SOL reserve, USDC similar) makes the planting revert at the settle. Fail closed, no loss; busy reserves
are refreshed within minutes.

ENABLE PRECONDITIONS BEYOND THIS TABLE (Task 7 review, Important 1). Task 8's mutation column alone never enables a leg:
- EVERY leg: contracts sec 8 inv. 3, a simulated leashed planting for that leg on mainnet (the real route), PASS before any user is relinked to it.
- Legs 4, 5: also contracts sec 9 S1 PASS (the real pull + USDC->WSOL swap + deposit + settle fits 1,232 B with the ALT and simulates err null on
  mainnet); until then SOL_LEND stays 0%. The fork used a legacy tx with no Jupiter route and no ALT, so it says nothing about S1.
- Leg 1 (stORE): also the S4 ORE sponsored-price age sample. Leg 7 (cbBTC): also the S4 age sample (R324, 600 s).
- Leg 0 (SKR): stays off until it has a price source (R324, owner decision open).

SKR stake rounding (S2): 0 share(s) below floor(skr * 1e9 / share_price) at 2026-10-04; the API builder's min_out = expected - 1 is safe.

Release (Task 8, 2026-10-04, program/src as of 38ea620, built by scripts/sbf.sh `sbf_build`, Agave 3.1.11): leash.so sha256 = 3b80a2942c10089880574b857eeffa25a58489f88688197f411ed7e86dbe65e5, size = 65928 B, rent = 0.33579308 SOL (`solana rent 65973`), mutation rows RED = 152 / 152 (140 guard markers, each exactly once, every one with a row; no MUTATED string in the .so; two builds gave the same hash). NOT deployed (Task 9 runbook).
Mainnet deploy record (DEPLOY-RUNBOOK.md; filled by the owner or the next session; empty = not done):
- A4 deploy signature: 
- A5 `solana program show` (Authority GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY, Data Length 70000): 
- B1 init signatures (init_config, set_leg 0..7): 
- B5 `check-config.sh day1` line: 
NEVER INSTALL config/TEST-VECTOR-all-legs-NEVER-INSTALL.hex (leg 0 SKR ON, no price source, R324): config/mainnet-day1.hex is the only installable Config.
Mutation sweep cells: the sweep is program-wide (every guard, every leg), so the same PASS goes in each row; it never enables a leg on its own (see ENABLE PRECONDITIONS above).

S2 notes (Task 0, 2026-10-04): "+ pyth" = `s2_pyth_accounts_layout` also PASS for that leg's feed account (SOL, cbBTC, ORE; USDC checked as a control).
1. K-Lend (legs 2 and 4): S2 alone does not gate these legs. The real K-Lend gate is Task 7's actual-deposit check: the leash's rate must be within 1e-5
   of what K-Lend actually mints on a real deposit. Both legs stay disabled until that check passes.
   RESULT (Task 7, 2bdf821): PASS for both. kUSDC minted 1,661,340 = the reader's prediction exactly; kSOL minted 35,436,161 vs 35,436,164 predicted (8.5e-8).
   Leg 2 S2 is FAIL (`s2_klend_usdc_reserve_matches_mint_supply_and_api`, text in the row). USDC reserve D6q6: the @2592 vs mint gap is the same 12,760,535
   at slots 453408545 and 453408728 (the dust reserve AWnKJ9 is off by 100,000), and its total-liquidity check (not reached by the test) is out too:
   lag 8.25e-3 vs 5e-4, while the Kamino API's totalSupply did not move across reads as the chain moved ~1.24M USDC and sits below the API's own totalBorrow.
   rn/rd = 1.20385 at both slots. Leg 4 S2 is PASS(mint-supply) from its own test (`s2_klend_sol_reserve_matches_mint_supply_and_api`).
2. FEED_SKR's PriceUpdateV2 account is not fetched by fetch.py, so no S2 test reads it; leg 0's price leg is unverified by T0.
