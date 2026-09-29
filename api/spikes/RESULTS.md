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
