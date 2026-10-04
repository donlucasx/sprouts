# Leash gates (spec 6.5)

A leg is enabled on chain only when every column left of "Enabled on chain" says PASS (date, commit). Day 1 legs: 2, 6, 7. Day 2: 0, 1, 3, 4, 5.

| Leg | Byte | Day | S2 offsets (T0) | Unit + svm tests (T1-T6) | Mutation sweep (T8) | Fork sim (T7) | Enabled on chain |
|---|---|---|---|---|---|---|---|
| SKR | 0 | 2 | PASS (2026-10-04, slot 453408545); its Pyth feed account is not in the S2 snapshot, see note 2 | | | | |
| stORE | 1 | 2 | PASS (2026-10-04, slot 453408545) + pyth | | | | |
| USDC K-Lend | 2 | 1 | FAIL: `assertion left == right failed: D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: collateral supply @2592 == the kToken mint's supply (same slot)` left 92149838469384, right 92149825708849 (2026-10-04, slot 453408545) | | | | |
| USDC Jupiter Lend | 3 | 2 | PASS (2026-10-04, slot 453408545) | | | | |
| SOL K-Lend | 4 | 2 | FAIL: `assertion left == right failed: D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: collateral supply @2592 == the kToken mint's supply (same slot)` left 92149838469384, right 92149825708849 (2026-10-04, slot 453408545); the test stops on the USDC reserve, see note 1 | | | | |
| SOL Jupiter Lend | 5 | 2 | PASS (2026-10-04, slot 453408545) + pyth | | | | |
| hSOL | 6 | 1 | PASS (2026-10-04, slot 453408545) + pyth | | | | |
| cbBTC | 7 | 1 | PASS (no reader) + pyth (2026-10-04, slot 453408545) | | | | |

Release (Task 8): leash.so sha256 = , size = B, rent = SOL, mutation rows RED = /

S2 notes (Task 0, 2026-10-04): "+ pyth" = `s2_pyth_accounts_layout` also PASS for that leg's feed account (SOL, cbBTC, ORE; USDC checked as a control).
1. `s2_klend_reserves_match_mint_supply_and_api` (legs 2 and 4) is RED; legs 2 and 4 stay disabled until a new S2 pass.
   Out-of-harness diagnostics on the same snapshot (not a PASS): SOL reserve d4A2 collateral @2592 == mint supply exactly, Kamino API lag 1.40e-4 (< 5e-4).
   USDC reserve D6q6: the @2592 vs mint gap is the same 12,760,535 at slots 453408545 and 453408728 (the dust reserve AWnKJ9 is off by 100,000),
   and its total-liquidity check fails too (lag 8.25e-3 vs 5e-4): the Kamino API's totalSupply did not move across reads while the chain moved ~1.24M USDC,
   and it sits below the API's own totalBorrow, so the reference looks stale rather than the offset. rn/rd = 1.20385 at both slots.
2. FEED_SKR's PriceUpdateV2 account is not fetched by fetch.py, so no S2 test reads it; leg 0's price leg is unverified by T0.
