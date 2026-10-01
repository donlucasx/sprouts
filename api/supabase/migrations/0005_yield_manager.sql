-- The Yield Manager (docs/superpowers/specs/2026-09-30-yield-manager-design.md, R107 to R126): six coins, one ledger map per
-- wallet, the manager's columns on rules, the daily snapshot and decision tables, and two amendments to the budget table (R125).
-- Service role only under RLS, like every table (0002). 0004 stays as committed; both go up in one push.

-- 1. The ledger per asset. bump_ledger used to send any asset but SKR into the stORE column.
alter table wallets add column ledger_cents jsonb not null default '{}';
update wallets set ledger_cents = jsonb_build_object('SKR', ledger_skr_cents, 'stORE', ledger_store_cents);
create or replace function bump_ledger(p_pubkey text, p_asset text, p_cents integer) returns void
language plpgsql as $$
begin
  update wallets
  set ledger_cents = jsonb_set(coalesce(ledger_cents, '{}'::jsonb), array[p_asset], to_jsonb(coalesce((ledger_cents ->> p_asset)::integer, 0) + p_cents), true)
  where pubkey = p_pubkey;
end;
$$;

-- 2. The manager's columns on rules; the allocation widens to six keys and keeps the fence's stORE share as a pin.
alter table rules
  add column managed boolean not null default false,
  add column stop text not null default 'balanced' check (stop in ('careful', 'balanced', 'bold')),
  add column pins jsonb not null default '{}',
  add column prev_allocation jsonb,
  add column allocation_day date;
update rules set pins = jsonb_build_object('stORE', (allocation ->> 'stORE')::integer) where coalesce((allocation ->> 'stORE')::integer, 0) > 0;
update rules set allocation = jsonb_build_object(
  'SKR', coalesce((allocation ->> 'SKR')::integer, 100), 'stORE', coalesce((allocation ->> 'stORE')::integer, 0),
  'hSOL', 0, 'JitoSOL', 0, 'JupSOL', 0, 'cbBTC', 0);
alter table rules alter column allocation set default '{"SKR": 100, "stORE": 0, "hSOL": 0, "JitoSOL": 0, "JupSOL": 0, "cbBTC": 0}';

-- 3. Legs for six coins; the fee in USDC on the input side (R105); the coin's rate on the day it was planted (earned per coin).
alter table planting_legs drop constraint planting_legs_asset_check;
alter table planting_legs add constraint planting_legs_asset_check check (asset in ('SKR', 'stORE', 'hSOL', 'JitoSOL', 'JupSOL', 'cbBTC'));
alter table planting_legs add column fee_cents integer not null default 0, add column rate_at_planting numeric;

-- 4. The daily snapshot (spec 5.2) and the daily decision per stop (spec 6.7).
create table coin_days (
  day date not null,
  asset text not null check (asset in ('SKR', 'stORE', 'hSOL', 'JitoSOL', 'JupSOL', 'cbBTC')),
  rate numeric,                 -- SOL per token (LSTs), SKR per share (SKR), ORE per stORE (stORE); null for cbBTC
  rate_prev numeric,            -- LSTs on day one only: the pool's last-epoch rate, so a measured number exists at once
  rate_prev_days numeric,
  price_usd numeric,
  liquidity_usd numeric,
  price_change_24h numeric,
  tradeable boolean not null default false,
  last_update_epoch bigint,
  ok boolean not null default false,
  primary key (day, asset)
);
create table split_days (
  day date not null,
  stop text not null check (stop in ('careful', 'balanced', 'bold')),
  split jsonb not null,
  model_answer jsonb,           -- the raw six numbers and the raw why, kept beside what was applied
  why text,
  fallback text,                -- null when the model's answer was applied; otherwise model | schema | bounds | budget | no data
  call_id bigint,
  primary key (day, stop)
);
alter table coin_days enable row level security;
alter table split_days enable row level security;

-- 5. The budget table: the manager's three daily calls have no user and a kind of their own.
alter table watcher_calls alter column user_pubkey drop not null;
alter table watcher_calls drop constraint watcher_calls_kind_check;
alter table watcher_calls add constraint watcher_calls_kind_check check (kind in ('compile', 'explain', 'propose', 'split'));
