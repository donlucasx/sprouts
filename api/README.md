# Sprouts API

The backend of Sprouts (see the repo root README for what Sprouts is and the safety story). Next.js 15, Node runtime, deployed on Vercel with one daily cron; Supabase Postgres; Helius (RPC and the swap webhook); Jupiter (quotes and swap instructions); the Solana Foundation Subscriptions program (the recurring USDC delegation); the SKR staking program (the position).

## Routes

| Route | Who calls it | What it does |
|---|---|---|
| `POST /api/auth/nonce`, `POST /api/auth/verify` | the app | Sign-In-With-Solana with a server nonce; Genesis Token check; session |
| `POST /api/link/new`, `GET /api/link/{code}`, `POST /api/link/confirm` | the app, then the web page or the phone's wallet | a six-character code, the unsigned approve-once transaction, the confirmation once the delegation is on chain |
| `POST /api/webhooks/helius` | Helius | books each swap of a linked wallet with its round-up |
| `GET /api/cron/plant` | Vercel cron (bearer) | plants the round-ups (pull, swap, stake in one transaction), cranks withdrawals |

## Run it

```bash
pnpm install
cp .env.example .env.local   # fill it in an editor, never by a command that echoes values
pnpm test                    # unit tests, no network
pnpm exec tsc --noEmit
pnpm dev
```

`spikes/` holds the throwaway scripts that proved the mechanism on mainnet with dust; `spikes/RESULTS.md` records every real transaction. Scripts that can move money simulate first and send only with `--send`.
