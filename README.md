# Sprouts

Every swap rounds up. The change buys SKR and stakes it, into a garden only your Seeker can open.

Acorns for the Solana Seeker. You approve once, on each trading wallet, and never sign again until you withdraw. The savings position is owned by your Seeker's Seed Vault key; a Genesis Token gates registration; the app is one screen plus a home-screen widget. Built for CLOCK IN, the Solana Mobile hackathon (Sept 8 to Oct 8, 2026).

## The safety story, stated plainly

The puller key is hot. Its authority is at most the daily limit, revocable on chain in one tap, and custody lasts one transaction. The recurring track of the Subscriptions program has no destination binding, so the limit and the revoke are the safety, plus the key in a Vercel secret and this open-source repo. A wallet holds one delegation to the puller: re-approving revokes the previous one in the same transaction, so the limit is per wallet, not per approval. Every Jupiter response is checked before the puller signs it (the aggregator program, an allowlist for helper programs, no signer but the puller, the fee and destination accounts present).

## What is here

- `api/`: the backend. Next.js 15 on Vercel: sign-in with your Seeker and the Genesis Token check, the trading-wallet delegation, the Helius swap webhook that books round-ups, and the daily cron that plants them (pull, swap, stake in one transaction). Supabase Postgres holds the tables.
- `api/spikes/`: throwaway scripts that proved the mechanism on mainnet with dust. Results in `api/spikes/RESULTS.md`.
- `app/`: the Seeker app. Expo SDK 57 from the `expo-kit-wallet` template: signs in with the Seed Vault through Mobile Wallet Adapter, reads everything from `api/`, holds no key and no secret. Builds are EAS cloud builds (`app/BUILDS.md`); Mobile Wallet Adapter needs a development build, never Expo Go.

## Run it

```bash
cd api
pnpm install
cp .env.example .env.local   # then fill it in an editor
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
