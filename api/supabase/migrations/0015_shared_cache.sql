-- 11-28 (Kimi Jupiter re-assessment fix 4, founder ruling "Go, all 4"): a small cross-instance cache, so Vercel's many function
-- instances share one answer instead of each asking Jupiter (memo.ts is per instance). Holds the shared display prices (~45 s) and
-- the top-up's per-mint probe and token info (1 h / 1 day; a no-route answer 10 min). Keys are `price:<mint>`, `topup-route:<mint>`,
-- `topup-token:<mint>`; values are small JSON. Nothing in it moves money or gates a send: a missing table, a failed read or a failed
-- write is a cache miss (the API reads fresh as before), so this may run before or after the API deploy.
-- Additive only: no existing table, column or row changes.
create table if not exists shared_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists shared_cache_expires_at on shared_cache (expires_at);
alter table shared_cache enable row level security;
