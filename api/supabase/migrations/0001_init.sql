-- Sprouts schema, v1. Money columns are integer cents unless named _raw (token base units).

create table users (
  seed_vault_pubkey text primary key,
  sgt_mint text unique not null,
  skr_name text,
  pro_until timestamptz,
  created_at timestamptz not null default now()
);

create table wallets (
  pubkey text primary key,
  user_pubkey text not null references users(seed_vault_pubkey),
  delegation_pda text not null,
  daily_cap_cents integer not null default 500,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  webhook_added boolean not null default false,
  ledger_skr_cents integer not null default 0,
  ledger_store_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table rules (
  user_pubkey text primary key references users(seed_vault_pubkey),
  roundup_on boolean not null default true,
  roundup_to_cents integer not null default 100,
  pct_on boolean not null default true,
  pct_bps integer not null default 100,
  pct_threshold_cents integer not null default 10000,
  plant_threshold_cents integer not null default 200,
  plant_max_days integer not null default 7,
  daily_cap_cents integer not null default 500,
  allocation jsonb not null default '{"SKR": 100, "stORE": 0}',
  updated_at timestamptz not null default now()
);

create table swaps (
  signature text primary key,
  wallet_pubkey text not null references wallets(pubkey),
  ts timestamptz not null,
  in_mint text not null,
  in_amount numeric not null,
  out_mint text not null,
  out_amount numeric not null,
  usd_size_cents integer,
  class text not null check (class in ('stable', 'major', 'LST', 'memecoin')),
  roundup_cents integer not null default 0,
  planting_id uuid,
  created_at timestamptz not null default now()
);
create index swaps_unplanted on swaps (wallet_pubkey, ts) where planting_id is null;

create table plantings (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null,
  wallet_pubkey text not null,
  ts timestamptz not null default now(),
  signature text unique,
  usdc_pulled_cents integer not null,
  network_fee_cents integer not null default 0,
  status text not null default 'sent' check (status in ('sent', 'confirmed', 'failed')),
  ai_line text
);

create table planting_legs (
  planting_id uuid not null references plantings(id),
  asset text not null check (asset in ('SKR', 'stORE')),
  usdc_in_cents integer not null,
  amount_out_raw bigint not null,
  staked boolean not null,
  fee_amount_raw bigint not null default 0,
  primary key (planting_id, asset)
);

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null,
  asset text not null default 'SKR',
  unstake_ts timestamptz not null,
  unstake_signature text,
  withdraw_signature text,
  amount_out_raw bigint,
  reward_delta_raw bigint
);

create table events (
  id bigserial primary key,
  user_pubkey text,
  wallet_pubkey text,
  ts timestamptz not null default now(),
  kind text not null,
  detail jsonb
);

create table nonces (
  nonce text primary key,
  pubkey text,
  expires_at timestamptz not null,
  used boolean not null default false
);

create table link_codes (
  code text primary key,
  user_pubkey text not null,
  expires_at timestamptz not null,
  nonce numeric not null,
  wallet_pubkey text,
  delegation_pda text,
  used boolean not null default false
);

create table recaps (
  user_pubkey text not null,
  week_start date not null,
  text text not null,
  primary key (user_pubkey, week_start)
);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null,
  ts timestamptz not null default now(),
  text text not null,
  new_rules jsonb not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed'))
);

-- Atomic nonce consumption for sign-in (one statement, no check-then-set).
create or replace function use_nonce(p_nonce text, p_pubkey text) returns boolean
language plpgsql as $$
declare hit integer;
begin
  update nonces set used = true, pubkey = p_pubkey
  where nonce = p_nonce and used = false and expires_at > now();
  get diagnostics hit = row_count;
  return hit = 1;
end;
$$;
