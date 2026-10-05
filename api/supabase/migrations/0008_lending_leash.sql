-- Lending + leash (docs/superpowers/specs/2026-10-04-lending-leash-design.md, contracts section 4). Additive except the noted
-- rewrites (allocations to six live keys, the 0008 ramp seed). Push BEFORE the API deploy. Service role only under RLS (0002).
-- 1. Assets: two lending legs; JitoSOL/JupSOL rows stay readable (retired, never written again).
alter table planting_legs drop constraint planting_legs_asset_check;
alter table planting_legs add constraint planting_legs_asset_check
  check (asset in ('SKR','stORE','USDC_LEND','SOL_LEND','hSOL','cbBTC','JitoSOL','JupSOL'));
alter table coin_days drop constraint coin_days_asset_check;      -- auto-named inline check from 0005
alter table coin_days add constraint coin_days_asset_check
  check (asset in ('SKR','stORE','USDC_LEND','SOL_LEND','hSOL','cbBTC','JitoSOL','JupSOL'));

-- 2. The venue of a lending leg (null for coin legs). For a lending leg amount_out_raw = receipt raw delivered and
--    rate_at_planting = the venue's exchange rate (underlying raw per receipt raw) at planting.
alter table planting_legs add column venue text check (venue in ('kamino_klend','jupiter_lend'));
alter table planting_legs add constraint planting_legs_venue_iff_lend check ((asset in ('USDC_LEND','SOL_LEND')) = (venue is not null));

-- 3. One row per venue per lending asset per day: the numbers served to the model, code eligibility, the AI's verdict.
create table venue_days (
  day date not null,
  venue text not null check (venue in ('kamino_klend','jupiter_lend','kamino_sm_vault','marginfi','lulo_protected')),
  asset text not null check (asset in ('USDC_LEND','SOL_LEND')),
  supply_pct numeric,            -- actual (base) supply rate, % a year
  rewards_pct numeric,           -- incentive part, % a year
  utilization_pct numeric,
  withdrawable_usd numeric,
  tvl_usd numeric,
  exchange_rate numeric,         -- underlying raw per receipt raw (auto venues only); value = receipt x rate
  avg7_pct numeric,              -- mean of supply_pct over our own rows of the last 7 days; spot while fewer than 2 rows
  days_measured integer not null default 0,
  eligible boolean not null default false,   -- code: 0 <= supply_pct <= 15, utilization <= 95, tvl >= 10M (spec 3)
  verdict text check (verdict in ('ok','avoid')),
  reason text check (reason in ('incentive_spike','near_full','deposits_fleeing','data_suspect')),
  served jsonb,                  -- exactly what get_venue_rates returned (checkWhy facts)
  ok boolean not null default false,
  primary key (day, venue, asset),
  check ((verdict = 'avoid') = (reason is not null))
);
alter table venue_days enable row level security;

-- 4. Venues the scout found (display only, never routed to).
create table found_venues (
  day date not null,
  pool_id text not null,         -- DefiLlama pool id
  project text not null,
  symbol text not null,
  asset text not null check (asset in ('USDC','SOL')),
  apy_base_pct numeric,
  tvl_usd numeric,
  note text,                     -- the model's line, checkWhy'd
  primary key (day, pool_id)
);
alter table found_venues enable row level security;

-- 5. Move proposals: lending-to-lending, same asset, Kamino <-> Jupiter only (spec 7); at most one open per user.
create table move_proposals (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references users(seed_vault_pubkey),
  ts timestamptz not null default now(),
  asset text not null check (asset in ('USDC_LEND','SOL_LEND')),
  from_venue text not null check (from_venue in ('kamino_klend','jupiter_lend')),
  to_venue text not null check (to_venue in ('kamino_klend','jupiter_lend')),
  receipt_raw numeric not null,
  value_usd numeric not null,
  from_avg7_pct numeric not null,
  to_avg7_pct numeric not null,
  gain_30d_usd numeric not null,
  cost_usd numeric not null,
  status text not null default 'open' check (status in ('open','dismissed','expired','done','failed')),
  redeem_signature text,
  deposit_signature text,
  closed_at timestamptz,
  check (from_venue <> to_venue),
  check (gain_30d_usd > 3 * cost_usd)
);
create unique index move_proposals_one_open on move_proposals (user_pubkey) where status = 'open';
alter table move_proposals enable row level security;

-- 6. Carry per user per kind, generalising 0007. SKR stays on plantings.skr_carry_in_raw / skr_surplus_raw (0007, unchanged);
--    the new kinds live here. carry_credit answers every kind in one place.
create table carry (
  planting_id uuid not null references plantings(id),
  user_pubkey text not null references users(seed_vault_pubkey),
  kind text not null check (kind in ('WSOL','USDC')),
  carry_in_raw numeric not null default 0,   -- reserved while sent, spent when confirmed, given back when failed
  surplus_raw numeric,                       -- left with the puller by this planting, read once after confirmation
  primary key (planting_id, kind)
);
alter table carry enable row level security;
create or replace function carry_credit(p_user text, p_kind text) returns numeric
language sql stable as $$
  select case when p_kind = 'SKR' then skr_credit(p_user) else (
    select coalesce(sum(case when p.status = 'confirmed' then coalesce(c.surplus_raw, 0) else 0 end), 0) - coalesce(sum(c.carry_in_raw), 0)
    from carry c join plantings p on p.id = c.planting_id
    where c.user_pubkey = p_user and c.kind = p_kind and p.status in ('sent', 'confirmed')) end;
$$;
revoke execute on function carry_credit(text, text) from public, anon, authenticated;

-- 7. Link model per delegation (wallets is the links table: one live delegation per wallet, wallets.delegation_pda).
alter table wallets add column link_model text not null default 'puller' check (link_model in ('puller','leash'));

-- 8. Terms + Privacy acceptance (R283).
alter table users add column terms_version text, add column terms_accepted_at timestamptz;

-- 9. The day's venue pick per stop (code's pick before the per-user 60% cap), for the why line and the sign.
alter table split_days add column venue_pick jsonb;   -- {"USDC_LEND": "kamino_klend" | null, "SOL_LEND": ...}

-- 10. Allocations to six live keys. Managed users: JitoSOL -> USDC_LEND, JupSOL -> SOL_LEND (the next cron re-derives).
--     Unmanaged users: retired shares fold into SKR (their pins on retired coins are dropped). Undo is not offered across this.
--     AMEND 10-04 s20 (T3 review I1): idempotent and sum-preserving on every re-run. Existing USDC_LEND/SOL_LEND shares are
--     KEPT for every user (live keys a user may pin) and the retired share is ADDED on top; only rows still holding a retired
--     key (in allocation or prev_allocation) are touched, so a second run changes nothing.
update rules set pins = pins - 'JitoSOL' - 'JupSOL'
  where pins ?| array['JitoSOL','JupSOL'];
update rules set allocation = jsonb_build_object(
  'SKR', coalesce((allocation->>'SKR')::int, 0) + case when managed then 0 else coalesce((allocation->>'JitoSOL')::int, 0) + coalesce((allocation->>'JupSOL')::int, 0) end,
  'stORE', coalesce((allocation->>'stORE')::int, 0),
  'USDC_LEND', coalesce((allocation->>'USDC_LEND')::int, 0) + case when managed then coalesce((allocation->>'JitoSOL')::int, 0) else 0 end,
  'SOL_LEND', coalesce((allocation->>'SOL_LEND')::int, 0) + case when managed then coalesce((allocation->>'JupSOL')::int, 0) else 0 end,
  'hSOL', coalesce((allocation->>'hSOL')::int, 0),
  'cbBTC', coalesce((allocation->>'cbBTC')::int, 0)),
  prev_allocation = null, allocation_day = null
  where allocation ?| array['JitoSOL','JupSOL'] or prev_allocation ?| array['JitoSOL','JupSOL'];
alter table rules alter column allocation set default '{"SKR": 100, "stORE": 0, "USDC_LEND": 0, "SOL_LEND": 0, "hSOL": 0, "cbBTC": 0}';

-- 11. Ramp (spec 4): yesterday's split per stop = the new stop defaults (sec 1.2), so the move limit starts lending at its default;
--     the replaced row is kept inside model_answer; today's rows (if the cron already ran) are dropped so the next run decides.
insert into split_days (day, stop, split, model_answer, why, fallback, call_id) values
  ((now() at time zone 'utc')::date - 1, 'careful',  '{"SKR":60,"stORE":0,"USDC_LEND":10,"SOL_LEND":0,"hSOL":10,"cbBTC":20}', null, null, 'seed_0008', null),
  ((now() at time zone 'utc')::date - 1, 'balanced', '{"SKR":45,"stORE":0,"USDC_LEND":15,"SOL_LEND":10,"hSOL":20,"cbBTC":10}', null, null, 'seed_0008', null),
  ((now() at time zone 'utc')::date - 1, 'bold',     '{"SKR":30,"stORE":0,"USDC_LEND":20,"SOL_LEND":15,"hSOL":25,"cbBTC":10}', null, null, 'seed_0008', null)
on conflict (day, stop) do update set
  model_answer = jsonb_build_object('pre_0008', jsonb_build_object('split', split_days.split, 'model_answer', split_days.model_answer, 'why', split_days.why, 'fallback', split_days.fallback)),
  split = excluded.split, why = null, fallback = 'seed_0008', call_id = null;
delete from split_days where day >= (now() at time zone 'utc')::date;
