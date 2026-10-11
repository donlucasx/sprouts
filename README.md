# Sprouts

Round-ups into SKR that your Seeker keeps and a yield manager grows.

Acorns for the Solana Seeker. Link your self-custody wallets once; every swap they sign, in any Solana app, rounds up. Each morning the change is planted into SKR, stORE and lending, held by your Seeker's Seed Vault key. A Genesis Token gates sign-in, an optional AI Yield Manager tilts the split toward what pays more, and the garden lives in the app and on a home-screen widget. Built for CLOCK IN, the Solana Mobile hackathon.

## The safety story, stated plainly

Public line: even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else.

How that holds, on chain:

- **The leash program** `GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7` (pinocchio, in `leash/`). A linked wallet's delegation (Solana Foundation's Subscriptions program) is held by the leash's PDA, so the server cannot pull directly. `pull` must be followed in the same transaction by `settle`, which reverts unless the user's own savings receipt (SKR stake, a lending position or the coin account) grew by at least the leg's floor: 98.5% of the value at a live Pyth price, 99.9% for USDC lending.
- **The limit:** $5 a day per linked wallet, enforced on chain. The user can set it lower in the app.
- **What the server still chooses:** when to plant, which enabled coin, and how much up to the limit.
- **The admin key** lives on the owner's laptop, not the server. Only it can change the leash's config or replace the program; it cannot raise anyone's limit. A multisig is planned after the hackathon.
- **Verified build:** the deployed program matches this repo (solana-verify; OtterSec job VERIFIED, https://verify.osec.io/status/GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7). Gates and deploy evidence: `leash/GATES.md`.
- **Withdrawals** are signed by the user's Seed Vault. The app holds no key and no secret.
- Every Jupiter response is checked before the puller signs it (the aggregator program, an allowlist for helper programs, no signer but the puller, the fee and destination accounts present).

## What is here

- `api/`: the backend. Next.js 15 on Vercel: sign-in with your Seeker and the Genesis Token check, the trading-wallet link, the Helius webhook that books round-ups, the AI Yield Manager's daily run (Claude Haiku, numbers in, a split out, code picks the lender), and the daily cron that plants through the leash (pull, swap or deposit, settle in one transaction). Supabase Postgres holds the tables.
- `leash/`: the on-chain leash program, its tests, gates and deploy runbook.
- `api/spikes/`: throwaway scripts that proved the mechanism on mainnet with dust. Results in `api/spikes/RESULTS.md`.
- `app/`: the Seeker app. Expo SDK 57 from the `expo-kit-wallet` template: signs in with the Seed Vault through Mobile Wallet Adapter, reads everything from `api/`, holds no key and no secret. Builds are EAS cloud builds (`app/BUILDS.md`); Mobile Wallet Adapter needs a development build, never Expo Go.

## Run it

```bash
cd api
pnpm install
# create .env.local with the variables the code reads (grep -r process.env src)
pnpm test
pnpm dev
```

The app (`app/`) needs a development build, never Expo Go: Mobile Wallet Adapter is native. This Mac has no Android SDK, so builds are EAS cloud builds.

```bash
cd app
pnpm install
pnpm test                                             # the pure model, the format helpers, the offline state
eas build --platform android --profile development    # the dev client, once; the JavaScript then comes from `pnpm dev`
eas build --platform android --profile preview        # the APK the beta and the video use
```

Install the APK on the Seeker from the EAS build page (`app/BUILDS.md` lists every build). The app holds no key and no secret; `EXPO_PUBLIC_API_ORIGIN` in `eas.json` is the only setting and it is public.

## Spikes

See `api/spikes/RESULTS.md` for the three day-one proofs: staking into another user's position with only the payer's signature, Jupiter quote and swap-instructions with a free key, and one real ten-cent planting end to end.
