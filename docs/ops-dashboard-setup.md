# Ops dashboard setup

## What it is

A private, read-only health page at sprouts.money/ops, plus the same data as JSON at /api/ops/health. It shows 9 status lights (daily run, first planting, swaps, prices, gas, program, support and so on) and a small numbers section. It never writes anything except the hourly first-planting heartbeat event.

## Environment variables

Set these in Vercel, production, on the sprouts-api project. Generate each value with `openssl rand -base64 32`, except the wallet list.

| Variable | What it does |
|---|---|
| `OPS_PASSWORD` | The login password for /ops. Changing it logs out every session. |
| `OPS_SECRET` | Signs the login cookie. Rotating it also logs everyone out. |
| `OPS_TOKEN` | Bearer token for /api/ops/health. |
| `OPS_EXCLUDE_WALLETS` | Comma-separated wallet keys to leave out of the numbers. For each test device, list BOTH its seed-vault key AND its linked wallet keys, because swaps only carry the wallet key. |

If the variable a route needs is unset, that route answers 404.

Sessions last 7 days. Login is limited to 5 tries per hour per IP (counted per server instance).

## Deploy order

1. Set the env vars in Vercel first.
2. Deploy the API from the owner's Terminal:
   `cd build/sprouts/api && env -u VERCEL_TOKEN vercel --prod`

The first-planting heartbeat starts with that deploy. The First planting light reads red or unknown until the hourly job has run once after deploy.

## Claude's access

The token is stored locally at `~/.config/sprouts/ops-token` (chmod 600, outside every repo). It is read from the file and never put in a shell variable or on a command line.

## Checks after the first deploy

1. `curl -sI https://sprouts.money/ops` shows no-store caching.
2. /ops shows the login form.
3. /api/ops/health without a token answers 404.
4. /api/ops/health with the token returns 9 lights.
5. First-run smoke of the joined queries: the numbers section renders instead of "Numbers unavailable".

## Optional later: dashboard.sprouts.money

1. Add the domain to the sprouts-api project.
2. Add the DNS record.
3. Add a middleware host rewrite to /ops.
4. Decide the cookie Domain (host-only today).

## Known blind spots

- Helius registered but not delivering (caught only by Swaps arriving after 24-72 h)
- one wallet's swaps dropped while others arrive
- the Discord alert pipeline itself failing
- plantings that succeed with a wrong amount
