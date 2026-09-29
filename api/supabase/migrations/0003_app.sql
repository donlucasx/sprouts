-- The app's needs (Plan 2). Every table stays under RLS with no policies (0002).
alter table users add column watered_at timestamptz;
alter table users add column joined_shares numeric not null default 0;        -- the position's shares at sign-up (R61: put in, not earned)
alter table users add column joined_share_price numeric not null default 0;   -- StakeConfig.share_price at sign-up (1e9 scale)
alter table plantings add column shares_before numeric;                       -- the position's shares right before the send
alter table plantings add column shares_after numeric;                        -- and right after confirmation
alter table plantings add column shares_minted numeric;                       -- after minus before: what this planting added [A16]
alter table withdrawals add column cancel_signature text;                     -- set when the user put the fruit back (cancel_unstake)
alter table withdrawals add column shares_unstaked numeric;
alter table withdrawals add column amount_raw numeric;                        -- the SKR fixed at unstake time (amount_out_raw stays: what was delivered) [A14]
alter table withdrawals add column principal_raw numeric not null default 0;  -- the part above what was earned at sign time [A15]
alter table withdrawals add column source text not null default 'sprouts' check (source in ('sprouts', 'wallet'));  -- a wallet-side unstake found by the reconciliation carries no fake signature [A2]
alter table withdrawals add column skipped_at timestamptz;                    -- closed by the crank: nothing was unstaking on chain for it (a cancel the app did not see, or taken from the wallet) [A11]

-- Sessions the app can end (review M3, ruling R84): one opaque random token per sign-in, only its hash stored, seven days fixed,
-- one live session per user per device (the Seeker Genesis Token mint the sign-in proved); sign-out revokes one, sign-out-all every one.
create table sessions (
  token_hash text primary key,
  user_pubkey text not null references users(seed_vault_pubkey),
  device text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions (user_pubkey);
alter table sessions enable row level security;

-- Stakes and unstakes the Seed Vault made from its own wallet, found by the daily reconciliation (R61).
create table stake_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references users(seed_vault_pubkey),
  ts timestamptz not null default now(),
  kind text not null check (kind in ('own_stake', 'own_unstake')),
  shares_delta numeric not null,          -- signed: positive for a stake, negative for an unstake
  amount_raw numeric not null,            -- the SKR value of the delta at detection (shares x share_price / 1e9), always positive
  share_price numeric not null            -- the share price used
);
alter table stake_adjustments enable row level security;

-- Review M15: the foreign keys that carry invariants.
alter table plantings add constraint plantings_user_fkey foreign key (user_pubkey) references users(seed_vault_pubkey);
alter table plantings add constraint plantings_wallet_fkey foreign key (wallet_pubkey) references wallets(pubkey);
alter table swaps add constraint swaps_planting_fkey foreign key (planting_id) references plantings(id);

-- Review M10: nonces, link codes and dead sessions older than a day are gone; called by the cron.
create or replace function cleanup_expired() returns void language sql as $$
  delete from nonces where expires_at < now() - interval '1 day';
  delete from link_codes where expires_at < now() - interval '1 day';
  delete from sessions where expires_at < now() - interval '1 day' or revoked_at < now() - interval '1 day';
$$;
