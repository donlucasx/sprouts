-- 11-27 (Kimi swap-check scope item 1, his ruling "check EVERY wallet daily"): the missed-swap check moves out of the plant run into
-- its own daily route (/api/cron/swap-check, 13:00 UTC). Kimi's plan keyed its lock in cron_runs as `day + "-swapcheck"`, but
-- cron_runs.day is a DATE (0010), so that key cannot be written; and the ops dashboard reads cron_runs' newest row as "the daily job"
-- (Daily-job light), which a swap-check row would replace. So the check gets this twin table: the same lock (claim_swap_check_run,
-- same rules as claim_cron_run) and the same record (summary.swapCheck, the shape the plant run wrote).
-- Additive only: no existing table, column or row changes. Run BEFORE the API deploy: the new route claims here on every run (without
-- it the route answers 500 and alerts; the plant run is untouched), and the ops "Every swap counted" light reads this table.
create table if not exists swap_check_runs (
  day date primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean,
  summary jsonb
);
alter table swap_check_runs enable row level security;

create or replace function claim_swap_check_run(p_day date, p_now timestamptz, p_stale_before timestamptz) returns boolean
language plpgsql as $$
declare hit integer;
begin
  insert into swap_check_runs (day, started_at) values (p_day, p_now)
  on conflict (day) do update set started_at = excluded.started_at, finished_at = null, ok = null, summary = null
  where swap_check_runs.finished_at is not null or swap_check_runs.started_at < p_stale_before;
  get diagnostics hit = row_count;
  return hit = 1;
end;
$$;
