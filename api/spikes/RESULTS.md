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

## Spike 2: Jupiter quote, swap-instructions and price with the free key

Pending (Task 7).

## Spike 3a: a throwaway trading wallet approves the puller

Pending (Task 9).

## Spike 3b: one real ten-cent planting, end to end

Pending (Task 9).
