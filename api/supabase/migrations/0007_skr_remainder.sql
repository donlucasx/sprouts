-- Security audit R207 #2 (2026-10-03): the SKR slippage remainder. The stake takes the quote's minimum; what the swap delivered
-- above it stays in the puller's SKR account for one planting and is added to the SAME user's next SKR stake (spec 3.2 step 4).
-- Per planting: what it drew from the user's remainder (reserved while sent, spent when confirmed, given back when failed) and
-- what it left (read once from the confirmed transaction, null until then). Additive and idempotent; push BEFORE the deploy.
alter table plantings add column if not exists skr_carry_in_raw numeric not null default 0;
alter table plantings add column if not exists skr_surplus_raw numeric;

-- One user's remainder in one statement: confirmed surplus minus sent-or-confirmed carry. Security invoker, so under RLS (0002)
-- only the service role sees rows; execution is revoked from the PostgREST roles anyway.
create or replace function skr_credit(p_user text) returns numeric
language sql stable as $$
  select coalesce(sum(case when status = 'confirmed' then coalesce(skr_surplus_raw, 0) else 0 end), 0)
       - coalesce(sum(skr_carry_in_raw), 0)
  from plantings
  where user_pubkey = p_user and status in ('sent', 'confirmed');
$$;
revoke execute on function skr_credit(text) from public, anon, authenticated;
