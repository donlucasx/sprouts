-- 11-12 (his rulings): two opt-in round-up rules, both off by default, and the 1% threshold becomes a choice ($1, $10, $100).
-- Safe to run before or after the API deploy: the API reads these with the same defaults when the columns are missing.
alter table rules add column if not exists small_on boolean not null default false;
alter table rules add column if not exists per_swap_on boolean not null default false;
alter table rules add column if not exists per_swap_cents integer not null default 10 check (per_swap_cents in (5, 10, 25));
