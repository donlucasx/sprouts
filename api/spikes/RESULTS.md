# Spike results

Throwaway scripts, real chain, dust amounts. Every line here was run by hand on the date shown. Scripts run from `api/` with `pnpm tsx --env-file=.env.local spikes/<script>.ts`.

## Spike 1: staking into another user's position needs only the payer's signature (2026-09-25)

Mainnet, `simulateTransaction` with signature verification off and the blockhash replaced (no side effects). Payer = a real SKR holder that had just staked (`9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm`); existing user = another real staker (`4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1`); both found by `spikes/find-stakers.ts` from the program's last 150 signatures.

| Probe | Payer | User (beneficiary) | Source token account | Result |
| --- | --- | --- | --- | --- |
| 1 | the holder | the other staker | the holder's SKR account | OK, 29,962 compute units |
| 2 | the holder | a fresh random key | the holder's SKR account | OK, 32,262 compute units (the payer pays rent for the new position) |
| 3 | the holder | the other staker | the other staker's own SKR account, that staker not signing | FAIL, custom error 6007 `Unauthorized: only authority can perform this action` (on `user_token_account`) |

Reading: the program moves SKR out of the signer's token account and credits whichever `user` is named. Any payer can stake into any user's position; nobody can spend a token account they do not own. This is the fact the planting transaction stands on: the puller buys SKR into its own account and stakes it straight into the position keyed by the Seeker's Seed Vault key.

Matches `research/new/13` (2026-09-24) probe for probe, including the compute units for probes 2 and 3.

To re-run: `pnpm tsx --env-file=.env.local spikes/find-stakers.ts`, then `pnpm tsx --env-file=.env.local spikes/stake-sim.ts <payer> <existing staker>`. With the puller funded (2 SKR), `spikes/stake-sim.ts - <existing staker>` runs the same three probes with the puller as payer.

## Spike 2: Jupiter quote, swap-instructions and price with the free key (2026-09-25)

`spikes/jupiter-check.ts`, mainnet, read-only (no transaction sent). Ten cents of USDC (100,000 raw), 50 bps platform fee, `maxAccounts` 24.

| Probe | Result |
| --- | --- |
| USDC to SKR quote, direct routes only | 1 hop, out 4,905,350 raw SKR, minimum 4,856,297 (1% slippage) |
| Platform fee on the quote | `{"amount":"24650","feeBps":50}`; the no-fee quote returns 4,930,000, ratio 0.9950, so `outAmount` is net of the fee |
| USDC to stORE quote | 2 hops, out 122,495,137 raw; routable at dust size |
| `/swap-instructions` for the puller | 1 setup instruction, swap instruction with 27 accounts, 0 cleanup, 1 lookup table, 2 compute-budget instructions |
| Jupiter price v3, SOL | 121.10 USD |
| v2 `/order` | HTTP 200; returns a whole signed-ready `transaction` plus quote fields, no instruction list |
| v2 `/build` | HTTP 404 (no such endpoint) |

Readings: the fee comes out of the output (SKR), as the spec says. `/swap-instructions` with `platformFeeBps` refuses without `feeAccount` (`NOT_SUPPORTED: feeAccount is required for swap with platformFee`); `feeAccount` is the fee wallet's token account for the output mint, which `planting.ts` already derives. The spike stood in the puller's own SKR account until `FEE_WALLET` is set; Spike 3b exercises the real fee leg. v2 answers K15: it hands back a complete transaction, not instructions, so the pull and the stake could not sit beside it; v1 `/swap-instructions` stays.

## Spike 3a: a throwaway trading wallet approves the puller (2026-09-25)

`spikes/delegate-throwaway.ts`, mainnet, one transaction signed by the throwaway wallet `9ZKiQdmEvTKxt9e5yWRT1XbZW1b1D7n2AySLU5HyUZtZ` (funded with 1 USDC and 0.01 SOL).

| Step | Result |
| --- | --- |
| First attempt, `expectedSubscriptionAuthorityInitId: 0` | simulation FAILED, Subscriptions program custom error 136 `STALE_SUBSCRIPTION_AUTHORITY` on the create instruction (the init instruction before it passed) |
| Fix | the SDK's `UNKNOWN_INIT_ID` sentinel for one-transaction signup: the program accepts an authority whose init id equals the current slot. Pinned by a unit test that decodes the instruction data. |
| Second attempt | simulation OK, 12,997 compute units; sent `Cq8S2UFDZQxSicu1vbXNfMVMLFtqPerVAvDPFMALzuA4fnbe1FhkEujGUz2EH9gt1c9T4hBSU7ENsqQmJJTMbf4` |
| Delegation | `FjosLLd3GHzNPQ2NFqEX6onPwpfUwbHBp3hZSNFxXTDj`: exists, 5,000,000 raw USDC (5 USD) per 86,400 s period, no expiry, nonce `18072635197139616840` |

Also found on the way: kit refuses two signer instances for one address (error 5508000). The builders wrap the wallet in a placeholder signer for the wallet app to sign later, so a script holding the real key must sign the compiled transaction bytes (as a wallet does) rather than set the same key as a fee-payer signer. The same shape applied to the puller in the planting builder and was fixed there (the transfer instruction now takes the puller signer itself).

## Task 15 steps 2 and 3: deploy and webhook (2026-09-25)

| Step | Result |
| --- | --- |
| First production deploy | failed: `src/app/api/link/[code]/route.ts` exported a constant, which Next.js refuses from a route file; un-exported |
| Second deploy | Ready; stable alias `https://sprouts-api-gamma.vercel.app` (the team-scoped URL sits behind Vercel's deployment protection and redirects) |
| Env vars | twelve pushed into Vercel production from the env file by stdin (the project also carries the Supabase-Vercel integration's own set; the app reads only `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`) |
| Helius webhook | creation refused with an empty address list (400 "At least one account address is required"); now seeded with the first wallet (the throwaway); id `d9fd27e8-3f48-42b1-a50d-6281f9497f1b`, type enhanced, SWAP only, bearer auth |
| Probes after redeploy | `/api/cron/plant` 401, `POST /api/link/new` 401, `POST /api/webhooks/helius` 401 (all without credentials) |

## Spike 3b: one real ten-cent planting, end to end (dry run 2026-09-25, sent 2026-09-27)

`spikes/plant-once.ts <seed vault> SKR --send`, mainnet, one transaction signed by the puller only. Delegator = the throwaway wallet from Spike 3a; user = a real Seeker's Seed Vault key (Genesis Token verified by `spikes/resolve-seeker.ts`).

| Step | Result |
| --- | --- |
| Dry run (09-25) | built 1,215 bytes (limit 1,232), one lookup table, expected out 4,897,987 raw SKR, minimum 4,849,008; simulation OK, 92,493 compute units |
| Send (09-27) | built 1,087 bytes, expected out 5,309,279, minimum 5,256,187; simulation OK, 82,337 compute units; **PLANTED** `3Frz5iwELCJ6DhbL3YafrKjWxeG5reXzgEszjT1oUpWYbw3xQsV4aPreppuWGwYQ5vTFMXSroEz83u4YmK8GrGo7` |
| Position | 0 before, 5,256,186 raw SKR after (the quoted minimum, less one raw unit of rounding) |
| Delegator's USDC | 1.00 before, 0.90 after: exactly the ten-cent pull, nothing else moved |
| Who signed | the puller alone; the Seed Vault key never signed and the delegator's wallet signed nothing after its one-time approval |

Reading: `TransferRecurring` + Jupiter swap (with the 0.5% platform fee to the fee wallet's SKR account) + SKR `stake(user = Seed Vault key)` land atomically in one v0 transaction under the size limit, and only the Seed Vault key can ever unstake what landed. This is the demo's Solscan shot. Size varies with Jupiter's route (1,087 to 1,215 bytes seen); the 1,232 limit leaves little room, which is why the fee leg stays inside the swap and nothing else joins the transaction.


## Re-link path and the .skr fallback (2026-09-27 evening, read-only)

`spikes/read-authority.ts <wallet>` reads a wallet's USDC SubscriptionAuthority through the new `readSubscriptionAuthority`.

| Wallet | Result |
| --- | --- |
| The throwaway (delegated 09-25) | authority EXISTS, initId 450487017 (the init slot), so its next approve-once is the create alone, carrying that id |
| The puller (never delegated) | authority MISSING, so it would get the two-instruction approval (init, then create) |

`spikes/resolve-seeker.ts <the Seeker's name>.skr`: forward resolves to the Seed Vault key; the reverse now returns `<the Seeker's name>.skr` through the fallback (list the key's .skr names when no main domain is set; it returned null on 09-25); Genesis OK; position **5,260,937 raw** SKR.

Observation for the fruit audit: the position read 5,256,186 raw right after the planting earlier today and 5,260,937 raw this evening, +4,751 raw = +0.0904%, with no new planting. That is one reward step landing in the share price; 0.09% is what 16.4% APY pays over about two days, so rewards look like they land in discrete epoch-sized steps rather than per slot, and a fresh planting received a full step. Single observation, not yet a rule: watch the next step.

## Demo planting 1 of 2 (2026-09-28, R59: about $10 into his position this week)

`spikes/plant-once.ts <the Seeker's name>.skr SKR 4.90 --send`, run by Lucas in Terminal: delegation `Fjos…` had 0.10 pulled of its 5 USDC period; built 991 bytes, expected out 268,683,463, minimum 265,996,629; simulation OK, 80,987 CU; **PLANTED** `4SR57eMDRsRCsTCikXP9tA9A9oMEqwchCcKR2PcDyPQCDnnB3RxFczD8jN9KX4pPRskx5LxKwqi9xNfUzNvwjZCx`; position 5,260,937 -> 271,257,565 raw (+265,996,628, the quoted minimum less one raw unit again). The second $5 planting follows after the period rolls at 22:28Z.

## Day 4: the loop end to end, first planting from booked data (2026-09-28, Task 15 step 4)

Run by Lucas in Terminal (deploy 8xeyv4ww of HEAD 39bbe05 to https://sprouts-api-gamma.vercel.app, then the two spikes), booked and planted by the live system.

| Step | Result |
| --- | --- |
| Link (re-link path, production) | `link-throwaway.ts <the Seeker's name>.skr --send`: user row `<the Seeker's name>.skr`, code N9W2CW, approval = ONE instruction (the throwaway's authority existed), 353 bytes, 5,075 CU; sent `2dQBdk9rQfzQbDA1oq5kAwUtrEC9h1QdUQn6mkDGyDJRKQt9nEY3CSRPnEo5cTmqzjMK8yxHExPdHcsjhS1TvRBx`; second delegation `58TBSbJXXYyRv7SmKbsAZRWhpiVAZFqnCfQLdWEKDXon` (5 USDC/day); confirm 200 `{linked:true, skrName:"<the Seeker's name>.skr"}`; wallet row active. Bug found: the row's `webhook_added` stayed false while the event said true (fixed the same day, test-first: the add runs before the insert and the row carries the outcome). |
| Swap (real money) | `swap-once.ts 0.80 --send`: 0.80 USDC -> 227,946 BONK via Byreal + Whirlpool + Meteora DLMM, 192,138 CU; `57ZG6En3QqgpDgkt81Bxef3vzbiBB1QNvyFwsYZvXBPx42kbvMASdnHNttRARWr6HSMkdemgKiu1eKGShxpfXNJF` |
| Webhook | booked within seconds: `swaps` row size 80c, round-up 20c (the throwaway had been seeded on webhook `d9fd27e8…` at creation; the Helius read lists it) |
| Rules | `set-rules.ts <seeker> plantThresholdCents=10` (200 -> 10) so one round-up plants instead of waiting for the 7-day rule |
| Cron by hand | bearer from the env file inside node; answered **500 with an empty body**, but the run had already done its work: the planting below, the swap marked, the ledger +20c. Cause verified against the real database: the route's keepalive `getRules("keepalive")` violates the rules -> users foreign key (the in-memory repo never did). Fix in progress, test-first: a repo `keepalive()` that needs no user, and a JSON 500 with the reason. |
| **Planting from booked data** | `plantings` row confirmed, pulled 23c (20c round-up + 3c network fee), leg SKR 20c -> **12,484,479 raw**, signature `QXX6pKCYH9bnShUB1zDLMYtfLASCFjv4u6TeBWv1wJK9k6XGqrCHiD8LB3KN7HJwF8NVoyAvCtrtbNWQnRm7RYw`; position 271,257,565 -> **283,742,044 raw** SKR |

Reading: a real swap on a linked wallet became a round-up, a booked row, a daily pull through the delegation, a Jupiter swap with the fee leg, and a stake into the Seed Vault's position, with no signature from the Seeker and none from the trading wallet after its one approval. Plan 1's loop is complete.

## Over-cap rejection, seen by accident (2026-09-28, 12:30 PT)

A dry run of `plant-once.ts <seeker> SKR 0.10` against the 09-25 delegation, after the day's 0.10 + 4.90 had used its 5 USDC period allowance: the transaction built (the new Jupiter response check passed on a live response) and the simulation failed in the Subscriptions program with custom error 0x190 (400, the period limit). Nothing moved. This is the on-chain cap doing its job, and the beat the spec asks the demo to show; the period rolls at 22:28Z.

Row-level security enabled on all twelve tables (`0002_rls.sql`, pushed 2026-09-28): the anon key gets nothing; the server's service role is unaffected.

## Demo planting 2 of 2 (2026-09-28 evening, R59)

`spikes/plant-once.ts <the Seeker's name>.skr SKR 5 --send`, run by Lucas in Terminal after the delegation's period rolled (the 15:35 PT sleep job never fired: the Mac slept and `sleep` does not count sleep time; killed and run by hand): built 1,009 bytes, expected out 266,819,200, minimum 264,151,008; simulation OK, 125,317 CU; **PLANTED** `5n8PY1jLfYQ8en2Aea9Pw38Dd4kVcRMYf7chFei5kcrot6Kh3jP1tufoz6MpanmzahHtWgBgPpSZhdrLzntTMtLi` (00:29Z 09-29); position 283,742,044 -> **547,893,051 raw** SKR (+264,151,007, the quoted minimum less one raw unit, the third time).

## The ledger catches up with the spikes (2026-09-28, Plan 2 Task 2)

The spike plantings above never wrote `plantings` rows; the daily reconciliation (R61) compares the chain's share count with what the ledger says was minted, so they had to be booked. `spikes/book-planting.ts` books one as a confirmed row with its real signature, its time read from the chain, one SKR leg (change = pulled minus the 3c network fee, as the cron books) and the wallet's ledger bump; `spikes/set-joined.ts` then records the shares each confirmed planting minted (all but the newest estimated from the leg at today's share price 1,145,995,530; the newest takes the remainder) and the position at join (0 shares). Result: four confirmed plantings (10c, $4.90, the cron's 23c, $5), minted 4,586,567 + 232,109,655 + 10,898,151 + 230,499,160 = 478,093,533 shares = the chain, delta 0. The first reconciliation on production may now find nothing to adjust.

## 2026-10-05 S4 gate (lending + leash, Task 0)
- Hermes auth: `Authorization: Bearer` (x-api-key = 401). Entitlement: SOL, CBBTC, ORE, SKR each `403 Not entitled: feed ... (no grant accepts this feed ...)`; entitled 0/4.
- Sponsored ages (R324; 120 rounds, 15 s apart, run 2026-10-04 17:56 to 18:25 PDT):
  - SOL max age 55s; updates seen 35; gaps (s) min 50 max 55; not Full/missing 0
  - CBBTC max age 280s; updates seen 8; gaps (s) min 270 max 271; not Full/missing 0
  - ORE max age 55s; updates seen 35; gaps (s) min 50 max 55; not Full/missing 0
- Consequence (R324, nothing posts): cbBTC leg 7 keeps `max_age_s` 600 (yes: max age 280 s, plus 60 = 340, at or under 600); SKR leg 0 has no source (contracts 10 item 15); SOL/ORE legs use the sponsored account under 40 s old and wait up to 60 s otherwise (Task 8). Note: SOL/ORE max age 55 s with 50-55 s gaps, so the under-40 s rule will skip some runs and wait for the next update.

## Day-1 legs, unleashed simulation (Task 12, 2026-10-04 21:20 to 21:28 PDT by `date`)

The go-live gate `scripts/simulate-legs.ts`, run by Claude from the worktree, `--no-post` (the default): simulateTransaction only, NOTHING SENT. User = the Saga test user's Seed Vault `DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR`, wallet = its linked Phantom `887dEPR85vfSZ45zFrxttJ6cLomwvnYbh5HnyGbTAXVu`, delegation `GXcd5FZoxQKQm78CCzUzv7sfsL197CxCjt2eCD4ZRrgz` (today's puller link: 5 USDC per period, 1.03 pulled this period), pull 1 USDC. SPROUTS_ALT is NOT set (the owner creates the ALT, Task 22 D1), so these are Jupiter's tables only.

Run 21:23:17 PDT (the first run at 21:20:06 lost stORE and SKR to Jupiter 429s and crashed USDC Jupiter Lend in `simulatePlanting`, see the fix below; the script now waits 3 s between legs):

```
LEG SOL_LEND:jupiter_lend unleashed size=1484 build failed jlLeftover=0: SOL_LEND planting is 1484 bytes, over 1232
LEG SOL_LEND:jupiter_lend unleashed size=1530 build failed jlLeftover=1: SOL_LEND planting is 1530 bytes, over 1232
LEG SOL_LEND:kamino_klend unleashed size=1130 ok=true units=187434 guard=null leashError=null minOut=7129997 locks=32
LEG USDC_LEND:jupiter_lend unleashed size=1127 ok=true units=100274 guard=null leashError=null minOut=940592 jlLeftover=0 locks=26
LEG USDC_LEND:kamino_klend unleashed size=971 ok=true units=87043 guard=null leashError=null minOut=830478 locks=22
LEG cbBTC unleashed size=995 ok=true units=74750 guard=null leashError=null minOut=1150 locks=29
LEG hSOL unleashed size=1091 ok=true units=68409 guard=null leashError=null minOut=6892919 locks=37
LEG stORE unleashed size=838 ok=true units=116715 guard=null leashError=null minOut=748904232 locks=27
LEG SKR unleashed size=1026 ok=true units=98879 guard=null leashError=null minOut=53602046 locks=35
HEADROOM worst size SOL_LEND:jupiter_lend 1530/1232 B (-298 B left); worst locks hSOL 37/64 (27 left)
exit 1
```

Reading: 7 of 8 legs pass on mainnet today (composition, venue checks, delivery guards). USDC on Jupiter Lend passes with `jlLeftover=0`: `JL_EXPECTED_LEFTOVER` stays `0n`. SOL on Jupiter Lend does NOT fit without the Sprouts ALT even unleashed (1,349 to 1,530 B across runs: the route varies), so it cannot be simulated until the ALT exists.

FIX found by this run (`src/lib/planting.ts` `simulatePlanting`, test-first): an account the transaction CLOSES (the puller's jl account on every Jupiter Lend leg) comes back from mainnet `simulateTransaction` as lamports 0, System-owned, 0 data bytes, not null (probe 21:21 PDT). `tokenAmountOf` threw `not a token account (0 bytes)`, so every Jupiter Lend planting would have died in the simulation. It now reads as absent (null), which is what `jlendDeliveryShortfall` expects.

## Sizes with the Sprouts ALT, COMPUTED (Task 12, 2026-10-04 21:23 to 21:28 PDT)

The ALT is not on chain yet, so `--assume-alt` compresses with its address list (`lib/alt.ts`, 56 addresses) held in memory (`buildPlantingTx` `measureAlt`, measurement only). These sizes are COMPUTED from the real built routes, not measured on chain, and none of these transactions was simulated.

Unleashed, 21:23:55 PDT:

```
LEG SOL_LEND:jupiter_lend unleashed size=1012 locks=40 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=7869427 jlLeftover=0
LEG SOL_LEND:kamino_klend unleashed size=820 locks=34 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=7126385
LEG USDC_LEND:jupiter_lend unleashed size=727 locks=26 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=940591 jlLeftover=0
LEG USDC_LEND:kamino_klend unleashed size=633 locks=22 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=830478
LEG cbBTC unleashed size=822 locks=29 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=1150
LEG hSOL unleashed size=906 locks=35 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=6892026
LEG stORE unleashed size=748 locks=27 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=748904228
LEG SKR unleashed size=812 locks=35 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=53602046
HEADROOM worst size SOL_LEND:jupiter_lend 1012/1232 B (220 B left); worst locks SOL_LEND:jupiter_lend 40/64 (24 left)
```

Route variance, 4 more samples 21:27 to 21:28 PDT (unleashed, ALT in memory): SOL_LEND:jupiter_lend 949/949/913/949 B (36-38 locks); SOL_LEND:kamino_klend 959/820/820/854 B (32-40 locks); hSOL 907/906/1001/906 B (35-37 locks).

The leash's own cost on the SAME route (`spikes/leash-size-delta.ts --assume-alt`, 21:26:45 PDT: the unleashed build decompiled, transferRecurring swapped for the real pull + settle, recompressed; COMPUTED, not simulated):

```
DELTA SOL_LEND:jupiter_lend assume-alt unleashed=913 B/36 locks -> leashed(computed)=975 B/41 locks (+62 B, 257 B headroom)
DELTA SOL_LEND:kamino_klend assume-alt unleashed=854 B/32 locks -> leashed(computed)=916 B/37 locks (+62 B, 316 B headroom)
DELTA USDC_LEND:jupiter_lend assume-alt unleashed=727 B/26 locks -> leashed(computed)=789 B/31 locks (+62 B, 443 B headroom)
DELTA USDC_LEND:kamino_klend assume-alt unleashed=633 B/22 locks -> leashed(computed)=694 B/26 locks (+61 B, 538 B headroom)
DELTA cbBTC assume-alt unleashed=744 B/25 locks -> leashed(computed)=804 B/30 locks (+60 B, 428 B headroom)
DELTA hSOL assume-alt unleashed=906 B/35 locks -> leashed(computed)=969 B/41 locks (+63 B, 263 B headroom)
DELTA stORE assume-alt unleashed=748 B/27 locks -> leashed(computed)=814 B/34 locks (+66 B, 418 B headroom)
DELTA SKR assume-alt unleashed=777 B/32 locks -> leashed(computed)=871 B/38 locks (+94 B, 361 B headroom)
```

The leash adds 60 to 66 B and 4 to 7 locks per leg (94 B on SKR, whose price account would be a fresh posted account outside every table). Cross-check: the full leashed builds (`--leashed --assume-alt`, 21:24:23 PDT) gave USDC_LEND:jupiter_lend 789 B and USDC_LEND:kamino_klend 694 B, the same as the delta method. Worst projected leashed size = the worst sampled unleashed route (1,012 B, SOL on Jupiter Lend) + 66 B = about 1,078 B of 1,232 (about 154 B headroom); worst locks about 40 + 7 = 47 of 64. With NO ALT the leashed lending legs do not fit (`--leashed --size-only`, 21:24:57 PDT: SOL_LEND:jupiter_lend 1,504-1,519 B, SOL_LEND:kamino_klend 1,416 B, USDC_LEND:jupiter_lend 1,282-1,297 B; only USDC_LEND:kamino_klend fits at 1,094 B): SPROUTS_ALT is REQUIRED before go-live.

Leash floor at today's routes (the API's own pre-send check, `buildPlantingTx`, no send): the leashed builds refused cbBTC (min_out 1,148-1,149 vs floor 1,150), stORE (748,904,221-748,904,224 vs floor 752,838,360-754,264,666, about 0.5% under) and once hSOL (6,876,747 vs 6,880,723; it passed in the other run at 6,886,504). The quote's minimum is the route output less 100 bps of slippage (`getQuote` default), and the floor is the oracle value less fee 50 + tol 100 bps, so any price impact or market-vs-oracle spread puts a coin leg under the floor. These legs would print `build failed: ... under the leash floor` in the owner's leashed run; nothing fails on chain. SUPERSEDED by ruling A (below, 21:35 PDT): the swap minimum on a leashed coin leg is now the floor itself.

CU: unleashed `units=` max 187,434 (SOL_LEND:kamino_klend). Leashed units cannot be measured until the leash is deployed, so `PLANTING_CU_LIMIT` stays the 400,000 placeholder (Task 12 Step 4 sets it from the owner's leashed lines).

## OWNER RUNS (Oct 6)

After `feat/lend-api` is merged, from `build/sprouts/api` (until then the same lines run from `build/sprouts-lend-api/api`). Every line here is simulateTransaction only; none sends a planting. Exit code: 0 all passed, 1 a leg failed, 2 none failed but a leg was skipped (a skip is not a pass).

**AMEND 10-05 (final fix wave; C-I4, R337, R338, R339):** every line below uses the Saga's **Seed Vault wallet** (`--wallet` = the Seed Vault itself, linked in the app), never the web-linked Phantom `887d...`: before go-live a link-page code links to the puller again, so that wallet cannot be re-linked to the leash. Oct 6 re-links exactly ONE wallet (this one, through the app's re-link card, which shows because `RELINK_PILOT` names it); `LEASH_LIVE` is NOT set; every other wallet stays on the puller and keeps planting SKR, stORE and everything. `MOVES_ENABLED` stays unset (off). Day-1 legs are enabled first, then verified here (R343): the Config is set with 1,2,3,6,7 (stORE's step-5 ORE sample passed, read-only, can run before the enable) or else 2,3,6,7; leg 3 (USDC on Jupiter Lend) is always in. Every enabled leg's leashed line below must be `ok=true`; the owner's runbook C1 turns off any leg whose line is not (leg 3, leg 1, or both, exact lines there).

0. The Seed Vault wallet is linked (prints its wallet row; `wallet row: none` means link it in the app first):

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local spikes/db-peek.ts DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR | head -1
```

1. After Task 22 D1 (the ALT created, its `SPROUTS_ALT=` line in `.env.local`), check it is there (prints 1):

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && grep -c '^SPROUTS_ALT=' .env.local
```

2. BEFORE the re-link (D6), every leg unleashed against the Seed Vault wallet's current puller link (its delegation from step 0, `<OLD_PDA>`), now with the real ALT on chain. This is the first time SOL on Jupiter Lend can simulate:

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local scripts/simulate-legs.ts --user DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --wallet DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --delegation <OLD_PDA> --pull 1000000 SOL_LEND:jupiter_lend SOL_LEND:kamino_klend USDC_LEND:jupiter_lend USDC_LEND:kamino_klend cbBTC hSOL stORE SKR
```

3. After D5-D6 (Config initialised with `--enable 1,2,3,6,7` or `--enable 2,3,6,7`, the Saga's Seed Vault wallet re-linked to the leash in the app), read the NEW delegation PDA (the first line prints `delegation <pda>`; the script may then stop on a missing HELIUS_WEBHOOK_ID, which is fine):

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local spikes/db-peek.ts DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR | head -1
```

4. Leashed, every enabled leg (put the PDA from step 3 in place of `<NEW_PDA>`; list only the legs `leash-admin.ts` enabled: Day 1 = legs 2,3,6,7, plus 1 when stORE's sample passed; leg 3's line is `USDC_LEND:jupiter_lend`). Nothing posts: SKR stays off (no price source, R324) and the priced legs read the sponsored accounts:

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local scripts/simulate-legs.ts --user DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --wallet DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --delegation <NEW_PDA> --leashed --pull 1000000 USDC_LEND:kamino_klend USDC_LEND:jupiter_lend cbBTC hSOL stORE
```

Read each line: `ok=true` passes the leg; `leashError=StalePrice` rerun; `BelowFloor` stop and compare with Task 5's golden vectors; `LegDisabled` the flag is off; `build failed: ... route under floor` means the route's own expected output is under the leash floor (ruling A; see "Ruling A" below), rerun once, then leave that leg disabled. A `jlLeftover=1` on a Jupiter Lend line means set `JL_EXPECTED_LEFTOVER` to `1n` in `src/lib/venues/jlend.ts`. Paste the lines back to Claude: the highest leashed `units=` + 75,000 (the leash's measured 72.6k worst case at 3,000 users; ruling B, 10-04, supersedes the brief's +55k), rounded up to the next 10,000, becomes `PLANTING_CU_LIMIT` (Task 12 Step 4, `## CU limit`).

5. stORE's Day-1 gate (R339), the S4 price-age sample, read-only, 30 minutes. stORE (leg 1) stays enabled only if `ORE max age` is 55 s or less with `not Full/missing 0` AND its step-4 line is `ok=true`; otherwise turn it off with the exact lines in the leash runbook's C1 (the remaining list is 2,3,6,7 if leg 3 passed). Paste the SOL and ORE gap lines here (Claude's final review, T11 triage: gaps over 55 s skip legs 1, 4, 5, 6):

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local spikes/pyth-ages.ts
```

6. Posted-price run (SKR), ONLY once SKR has a price source (a crypto-entitled Pyth key and `SKR_PRICE_SOURCE` true; not before). This one SENDS puller-paid price transactions (VAA write, verify, rent reclaim; no user funds):

```
cd /Users/lucasgarzoli/Documents/claude/seekerhackathon/build/sprouts/api && pnpm tsx --env-file=.env.local scripts/simulate-legs.ts --user DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --wallet DjRpjufi1BNBaYXPu5ybGQu9cHhxgpPkHJb1UJbePcTR --delegation <NEW_PDA> --leashed --allow-post --pull 1000000 SKR
```

## Ruling A: the leashed coin-leg swap minimum is the leash floor (Task 12 follow-up, 2026-10-04 21:35 to 21:39 PDT by `date`)

Ruling A (controller, 10-04): the guarantee is unchanged (tolBps stays, "at least 98.5%").

A correction to it followed a security scan of the first draft (WIP 5caa060). That draft used the whole room above the floor, which could loosen the swap past 100 bps and open a sandwich window. Ruling A may only TIGHTEN the swap.

On LEASHED coin legs only, `buildPlantingTx` computes the leash floor before the swap and:
- skips with `route under floor` when the route's expected output is under it (no send);
- otherwise sets `leashSwapSlippageBps(expected, floor)` = min(100, floor((expected - floor - 1) x 10,000 / expected)). Jupiter's on-chain minimum is then max(expected less 100 bps, floor + 1 raw unit), and Jupiter is re-quoted only when that is tighter than 100 bps.

Jupiter's swap enforces the quote's own slippageBps, so the re-quote is the documented way; no instruction bytes are edited. SKR maps the share floor to SKR (ceil((floor + 1) x sharePrice / 1e9)). Unleashed legs and every lending leg keep one quote at 100 bps. Gate lines now print `floor=`.

Unleashed, simulated (read-only), 21:35:45 PDT, unchanged behaviour:

```
LEG cbBTC unleashed size=834 ok=true units=73887 guard=null leashError=null minOut=1152 locks=25
LEG hSOL unleashed size=1063 ok=true units=107457 guard=null leashError=null minOut=6888625 locks=37
LEG stORE unleashed size=838 ok=true units=114051 guard=null leashError=null minOut=748904154 locks=27
```

The lines below are from the first draft (uncapped, 21:35 to 21:39 PDT). They are kept for the record; the corrected run follows them.

Leashed builds, size-only. These are COMPUTED with the Sprouts ALT in memory, and the leash is not deployed, so nothing was simulated. The API's pre-send floor check runs inside each build, so a printed line means it passed. Runs at 21:35:56 and 21:36:27, then five samples from 21:37 to 21:39 PDT:

```
LEG cbBTC leashed size=804 locks=30 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=1156 floor=1154
LEG hSOL leashed size=1065 locks=44 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=6887658 floor=6887405
LEG stORE leashed build failed (computed with the Sprouts ALT in memory): stORE: route under floor (route 756468840 < floor 757206015); the leg skips today
LEG cbBTC leashed size=804 locks=30 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=1156 floor=1154
LEG hSOL leashed size=971 locks=44 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=6887996 floor=6887405
LEG stORE leashed size=814 locks=34 ok=n/a (computed with the Sprouts ALT in memory, not simulated) minOut=754577665 floor=754507965
samples (the ALT note trimmed):
LEG stORE leashed size=814 locks=34 ok=n/a minOut=754577663 floor=754507965
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1156 floor=1154
LEG hSOL leashed size=969 locks=41 ok=n/a minOut=6881919 floor=6881581
LEG stORE leashed size=814 locks=34 ok=n/a minOut=754577661 floor=754507965
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1155 floor=1153
LEG hSOL leashed size=1036 locks=43 ok=n/a minOut=6881670 floor=6881581
LEG stORE leashed build failed: stORE: route under floor (route 756468831 < floor 756687366); the leg skips today
LEG cbBTC leashed size=883 locks=35 ok=n/a minOut=1155 floor=1153
LEG hSOL leashed size=1036 locks=43 ok=n/a minOut=6880541 floor=6879871
LEG stORE leashed build failed: stORE: route under floor (route 756468827 < floor 756687366); the leg skips today
LEG cbBTC leashed size=883 locks=35 ok=n/a minOut=1155 floor=1153
LEG hSOL leashed size=1036 locks=43 ok=n/a minOut=6880522 floor=6879871
LEG stORE leashed size=814 locks=34 ok=n/a minOut=754804594 floor=754733219
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1155 floor=1153
LEG hSOL leashed size=969 locks=41 ok=n/a minOut=6884994 floor=6884850
```

Reading:
- **cbBTC:** 7 of 7 builds now pass the pre-send floor check. The minimum is 1,155-1,156 against a floor of 1,153-1,154; before the ruling it was 1,148-1,149 against 1,150.
- **hSOL:** 7 of 7 pass. The minimum sits 89 to 671 raw above the floor.
- **stORE:** 4 of 7 pass. The Jupiter route for $1 is steady at about 756.47M raw. The floor moves with each ORE price update, between 754.5M and 757.2M. When the floor is above the route, the route is about 0.03% to 0.10% under the 98.5% line and the leg skips with `route under floor`. stORE's market price sits right at the guarantee's edge.
- **Without the ALT:** hSOL leashed reached 1,310 B on one route (21:36:15). The ALT is required for coin legs too.

Corrected rule, min(100, roomBps), at 21:45:22 to 21:47:25 PDT. These are read-only: the unleashed legs were simulated, the leashed ones built size-only with the ALT computed in memory (the ALT note is trimmed):

```
LEG cbBTC unleashed size=834 ok=true units=74127 guard=null leashError=null minOut=1152 locks=25
LEG hSOL unleashed size=996 ok=true units=91549 guard=null leashError=null minOut=6885349 locks=35
LEG stORE unleashed size=838 ok=true units=114002 guard=null leashError=null minOut=748904092 locks=27
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1154 floor=1152
LEG hSOL leashed size=969 locks=41 ok=n/a minOut=6879409 floor=6873223
LEG stORE leashed size=814 locks=34 ok=n/a minOut=755334073 floor=755303533
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1154 floor=1152
LEG hSOL leashed size=971 locks=44 ok=n/a minOut=6873232 floor=6873223
LEG stORE leashed size=814 locks=34 ok=n/a minOut=752610783 floor=752569060
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1153 floor=1151
LEG hSOL leashed size=1065 locks=44 ok=n/a minOut=6873543 floor=6867060
LEG stORE leashed size=814 locks=34 ok=n/a minOut=752610780 floor=752569060
LEG cbBTC leashed size=871 locks=32 ok=n/a minOut=1153 floor=1151
LEG hSOL leashed size=971 locks=44 ok=n/a minOut=6872502 floor=6867060
LEG stORE leashed size=814 locks=34 ok=n/a minOut=752610777 floor=752570407
LEG cbBTC leashed size=804 locks=30 ok=n/a minOut=1153 floor=1151
LEG hSOL leashed size=969 locks=41 ok=n/a minOut=6870095 floor=6864853
LEG stORE leashed size=814 locks=34 ok=n/a minOut=753821124 floor=753777198
```

Reading (corrected rule): all 15 leashed builds passed the pre-send floor check; none was a `route under floor` skip in this window.
- **cbBTC:** minimum 1,153-1,154 against a floor of 1,151-1,152, two raw above it.
- **hSOL:** 9 to 6,186 raw above the floor. When the room was above 100 bps, the 100 bps quote stood unchanged (for example 6,879,409 against 6,873,223).
- **stORE:** 30k to 44k raw above the floor (about 0.005%). This window's ORE prices put the floor under the route; at 21:37-21:38 the floor was above the route twice, so stORE still skips when the ORE price ticks up.
