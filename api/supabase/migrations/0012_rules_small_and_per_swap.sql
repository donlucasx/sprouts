-- 11-12 (his rulings): two opt-in round-up rules, both off by default, and the 1% threshold becomes a choice ($1, $10, $100).
-- Run BEFORE the API deploy (Kimi 11-12): the API READS these with defaults when missing, but SAVING a new rule needs the columns
-- (the save answers 503 until then).
alter table rules add column if not exists small_on boolean not null default false;
alter table rules add column if not exists per_swap_on boolean not null default false;
alter table rules add column if not exists per_swap_cents integer not null default 10 check (per_swap_cents in (5, 10, 25));
-- Kimi 11-12: the 1% threshold's range also enforced in the database (the API allows 100 to 100000 since this release).
alter table rules drop constraint if exists rules_pct_threshold_cents_check;
alter table rules add constraint rules_pct_threshold_cents_check check (pct_threshold_cents between 100 and 100000);
