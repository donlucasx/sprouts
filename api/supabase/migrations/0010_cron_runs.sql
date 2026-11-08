-- 11-07 (his "all four, start now"): one row per daily run. Two jobs:
-- 1. The run lock (R2-2, open since 10-09): a run claims its day's row before it touches anything; a second run while the first
--    is still going (a manual trigger during the 7 AM run, a Vercel retry) gets no claim and stops. A row whose run finished, or
--    that started more than `stale` ago (the route's limit is 300 s, so it died), can be claimed again.
-- 2. The run record: Vercel's free plan keeps no logs past an hour, so each run writes what it did (ok, summary) here.
-- Push BEFORE the API deploy: the route calls claim_cron_run on every run, and without the function every run would stop at the claim.
create table if not exists cron_runs (
  day date primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean,
  summary jsonb
);
alter table cron_runs enable row level security;

create or replace function claim_cron_run(p_day date, p_now timestamptz, p_stale_before timestamptz) returns boolean
language plpgsql as $$
declare hit integer;
begin
  insert into cron_runs (day, started_at) values (p_day, p_now)
  on conflict (day) do update set started_at = excluded.started_at, finished_at = null, ok = null, summary = null
  where cron_runs.finished_at is not null or cron_runs.started_at < p_stale_before;
  get diagnostics hit = row_count;
  return hit = 1;
end;
$$;
