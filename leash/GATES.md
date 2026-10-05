# Leash gates (spec 6.5)

A leg is enabled on chain only when every column left of "Enabled on chain" says PASS (date, commit). Day 1 legs: 2, 6, 7, plus 1 after its S4 sample and 3 after its D7 leashed simulation (conditional, R339, R343). Day 2: 4, 5. Leg 0 (SKR) stays off until it has a price source (R324).

| Leg | Byte | Day | S2 offsets (T0) | Unit + svm tests (T1-T6) | Mutation sweep (T8) | Fork sim (T7) | Enabled on chain |
|---|---|---|---|---|---|---|---|
| SKR | 0 | 2 | PASS offsets; price feed UNVERIFIED (2026-10-04, slot 453408545; see note 2) | PASS 2026-10-04 2bdf821 (synthetic price) | PASS 2026-10-04 38ea620 (152/152 rows RED) | VENUE-ONLY (synthetic price) 2026-10-04 2bdf821 (61450 CU, margin 1.015%): real SKR `stake`, SYNTHETIC price fixture $0.01808 (R324: no SKR price source; leg stays OFF) | |
| stORE | 1 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (29495 CU, margin 0.817% vs an assumed 0.5% swap cost, not a route measurement; real ORE vault reader, stand-in swap at mid - 0.5%); floor/floor-1 boundary through leash.so PASS 2026-10-04 (final fix wave, `fork_leg1_store_real_vault`) | |
| USDC K-Lend | 2 | 1 | FAIL (mint-supply check; superseded by the Task 7 actual-deposit PASS 2bdf821, note 1): `assertion left == right failed: D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: collateral supply @2592 == the kToken mint's supply (same slot)` left 92149838469384, right 92149825708849 (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (90323 CU, margin 0.100%); real K-Lend deposit minted exactly the reader's prediction (rel. error 0) | |
| USDC Jupiter Lend | 3 | 1 (conditional: its D7 leashed simulation `ok=true`, R343) | PASS (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (88487 CU, margin 0.080%); real JL mint vs reader rel. error 1.0e-6; floor/floor-1 boundary through leash.so on the real JL USDC mint PASS 2026-10-04 (final fix wave, `fork_leg3_floor_boundary_through_leash`) | |
| SOL K-Lend | 4 | 2 | PASS(mint-supply) + pyth (2026-10-04, slot 453408545: `s2_klend_sol_reserve_matches_mint_supply_and_api`, collateral @2592 == kSOL mint supply, Kamino API lag 1.40e-4); the real gate is Task 7, see note 1 | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (115574 CU, margin 1.004%); real K-Lend deposit vs reader rel. error 8.5e-8 | |
| SOL Jupiter Lend | 5 | 2 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 (tol 150 floor/floor-1 on the fork) | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (102191 CU, margin 0.983%); real JL mint vs reader rel. error 5.1e-7 | |
| hSOL | 6 | 1 | PASS (2026-10-04, slot 453408545) + pyth | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (42559 CU, margin 1.004% vs an assumed 0.5% swap cost, not a route measurement; real hSOL pool reader, stand-in swap) | |
| cbBTC | 7 | 1 | PASS (no reader) + pyth (2026-10-04, slot 453408545) | PASS 2026-10-04 2bdf821 | PASS 2026-10-04 38ea620 (152/152 rows RED) | PASS 2026-10-04 2bdf821 (33003 CU, margin 0.930% vs an assumed 0.5% swap cost, not a route measurement; real sponsored price copy, stand-in swap) | |

Fork notes (Task 7, 2026-10-04, `./scripts/test.sh --test fork`, snapshot slot 453408545): CU varies by ~15k run to run (bump search). Legs 2-5 run the real venue
instruction; legs 1, 6, 7 and the SOL legs' USDC->WSOL step use the stand-in swap at the oracle mid minus 0.5% (their real routes are the API track's S1).
Legs 3 (tol 10), 4, 5 (tol 150): `fork_leg{3,4,5}_floor_boundary_through_leash` plant through leash.so on the real venue: min_out = floor - 1
refused (0, 6008), floor - 1 delivered refused at the settle (6009), exactly the floor passes. Legs 1, 6, 7 (`swap_leg`): the same three cases with the
stand-in swap (final fix wave, Kimi F2). Leg 2's boundary is synthetic (`floor_boundary_synthetic_legs`, with 6 and 7). The fork clock is the snapshot's: K-Lend accrued 7 slots (USDC) and 180 slots
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
- Leg 0 (SKR): stays off until it has a price source (R324, owner decision open). Installer side (Kimi F4, verified 2026-10-04 in
  feat/lend-api 9bad7a5 and feat/lend-api-t13 386ba9a): `api/scripts/leash-admin.ts` refuses leg 0 unless the SKR_OVERRIDE_FLAG
  is passed (lines 24-25 and 57), and `scripts/check-config.sh legs` refuses any list with 0. B5's byte check is the last gate.
- Every priced leg (1, 4, 5, 6, 7): the Config pins its sponsored Pyth account (`feed_account`, final review I1): leg 1
  GYYQ8gbX... (ORE), legs 4, 5, 6 7UVimffx... (SOL), leg 7 7oqYpv5y... (cbBTC). Any other price account is refused (6017,
  `bindings::price_account_other_than_the_pinned_one_is_refused`). Legs 0, 2, 3 keep zero.

Enable preconditions, recorded status (Kimi F2). A leg turns on only when every cell in its row is PASS. PENDING = no PASS recorded anywhere yet.

| Leg | Floor boundary through leash.so | Real-route mainnet sim (inv. 3, API D7) | S1 (legs 4, 5) | S4 age sample (legs 1, 7) | Price account pinned (I1) |
|---|---|---|---|---|---|
| 0 SKR | n/a: stays off (R324) | n/a | n/a | n/a: no source | n/a |
| 1 stORE | PASS 2026-10-04 fork (`swap_leg`) | PENDING | n/a | PASS 2026-10-04 (API RESULTS.md "S4 gate", 3ed0375: ORE max age 55 s) | PASS (golden Config) |
| 2 USDC K-Lend | PASS synthetic (`floor_boundary_synthetic_legs`) + fork actual deposit | PENDING (Day 1: C1 D7) | n/a | n/a | n/a: unpriced |
| 3 USDC JL | PASS 2026-10-04 fork (real JL mint) | PENDING | n/a | n/a | n/a: unpriced |
| 4 SOL K-Lend | PASS fork (real K-Lend deposit) | PENDING | PENDING | n/a | PASS (golden Config) |
| 5 SOL JL | PASS fork (real JL mint) | PENDING | PENDING | n/a | PASS (golden Config) |
| 6 hSOL | PASS fork (`swap_leg`) + synthetic | PENDING (Day 1: C1 D7) | n/a | n/a | PASS (golden Config) |
| 7 cbBTC | PASS fork (`swap_leg`) + synthetic | PENDING (Day 1: C1 D7) | n/a | PASS 2026-10-04 (API RESULTS.md "S4 gate", 3ed0375: max age 280 s, under 600) | PASS (golden Config) |

SKR stake rounding (S2): 0 share(s) below floor(skr * 1e9 / share_price) at 2026-10-04; the API builder's min_out = expected - 1 is safe.

Release (R334 verifiable build, 2026-10-04, program/src unchanged since 38ea620, built by scripts/sbf.sh `verify_build`: solana-verify 0.5.2 `build --library-name leash`, image solanafoundation/solana-verifiable-build:3.1.11 @sha256:4687aba06e83923eb01b550451335fcf452c9feb9c70f309ba75a8e683a482c2 = Agave 3.1.11, platform-tools v1.52): leash.so sha256 = 04f7ac04ddd3327842fe36412097e06a4b8151b0027c3c57a953af5b78d1ffb9, size = 65928 B, executable hash (what `solana-verify verify-from-repo` compares with the chain) = b124e7bfbef68713339c694c957dde1582414517ac3fd25f6332d77aabadecf1, rent = 0.33579308 SOL (`solana rent 65973`, size unchanged). Reproducible: two fresh clones and the worktree gave the same bytes. Against these bytes: `scripts/test.sh` 114 passed, 0 failed, 3 ignored (fork gate included: K-Lend actual deposit kUSDC rel. error 0, kSOL 8.466e-8); `scripts/mutate.sh` 152 / 152 RED (mutants built in the same image); `verify-from-repo` rehearsed on a local test validator holding the .so at the program id: `Program hash matches`; and again (fix round 1) on a local `solana program deploy --max-len 70000` of the same .so (Data Length 70000, the mainnet padding): on-chain hash b124e7bf...ecf1, `Program hash matches` (solana-verify 0.5.2 `get_binary_hash` strips trailing zeros, main.rs:768). NOT deployed (Task 9 runbook).
Superseded, never deployed: Task 8's local build (scripts/sbf.sh `sbf_build`, this Mac's cargo-build-sbf, 38ea620), 3b80a294...65e5, 65928 B; same source, other bytes. Every gate above was re-run on the verifiable build.
Mainnet deploy record (DEPLOY-RUNBOOK.md; filled by the owner or the next session; empty = not done):
- A4 deploy signature: 
- A5 `solana program show` (Authority GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY, Data Length 70000): 
- B1 init signatures (init_config, set_leg 0..7): 
- B5 `check-config.sh day1` line: 
- C4 `solana-verify verify-from-repo` (deployed commit, the two hash lines, `Program hash matches`): 
NEVER INSTALL config/TEST-VECTOR-all-legs-NEVER-INSTALL.hex (leg 0 SKR ON, no price source, R324): config/mainnet-day1.hex is the only installable Config.
Final fix wave (2026-10-04, tests/config/docs only; program/src unchanged since 38ea620): feed_account pinned on legs 1, 4-7 (I1), floor boundaries
for legs 1, 3, 6, 7 through leash.so (F2). `scripts/test.sh` 114 passed, 0 failed, 3 ignored; `scripts/mutate.sh` 152 / 152 RED; leash.so rebuilt = 3b80a294...65e5 (local build, superseded by the R334 verifiable build above).
Mutation sweep cells: the sweep is program-wide (every guard, every leg), so the same PASS goes in each row; it never enables a leg on its own (see ENABLE PRECONDITIONS above).

S2 notes (Task 0, 2026-10-04): "+ pyth" = `s2_pyth_accounts_layout` also PASS for that leg's feed account (SOL, cbBTC, ORE; USDC checked as a control).
1. K-Lend (legs 2 and 4): S2 alone does not gate these legs. The real K-Lend gate is Task 7's actual-deposit check: the leash's rate must be within 1e-5
   of what K-Lend actually mints on a real deposit. Both legs stay disabled until that check passes.
   RESULT (Task 7, 2bdf821): PASS for both. kUSDC minted 1,661,340 = the reader's prediction exactly; kSOL minted 35,436,161 vs 35,436,164 predicted (8.5e-8).
   Any K-Lend program upgrade: re-run this actual-deposit check before legs 2 or 4 stay on (Kimi F6; the @2592 vs mint gap below is unexplained).
   Leg 2 S2 is FAIL (`s2_klend_usdc_reserve_matches_mint_supply_and_api`, text in the row). USDC reserve D6q6: the @2592 vs mint gap is the same 12,760,535
   at slots 453408545 and 453408728 (the dust reserve AWnKJ9 is off by 100,000), and its total-liquidity check (not reached by the test) is out too:
   lag 8.25e-3 vs 5e-4, while the Kamino API's totalSupply did not move across reads as the chain moved ~1.24M USDC and sits below the API's own totalBorrow.
   rn/rd = 1.20385 at both slots. Leg 4 S2 is PASS(mint-supply) from its own test (`s2_klend_sol_reserve_matches_mint_supply_and_api`).
2. FEED_SKR's PriceUpdateV2 account is not fetched by fetch.py, so no S2 test reads it; leg 0's price leg is unverified by T0.
