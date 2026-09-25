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

## Spike 3a: a throwaway trading wallet approves the puller

Pending (Task 9).

## Spike 3b: one real ten-cent planting, end to end

Pending (Task 9).
