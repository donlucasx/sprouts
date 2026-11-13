-- Cap carry round 2 (owner 11-13: an oversized round-up must not lose its excess; the rest carries to the next days).
-- A round-up bigger than a day's cap (minus the fee) is pulled in parts: each planting that pulls a part records it here and leaves
-- swaps.planting_id NULL, so the swap stays pending. What a swap still owes = roundup_cents - the parts of its sent or confirmed
-- plantings (a failed planting's part gives the cents back, as carry does in 0008). The planting that pulls the rest claims the swap.
-- Additive only: no existing column or row changes. Run BEFORE the API deploy: the new API reads this table for every unplanted
-- swap; the old API never touches it.
create table if not exists swap_parts (
  planting_id uuid not null references plantings(id),
  signature text not null references swaps(signature),
  cents integer not null check (cents > 0),
  primary key (planting_id, signature)
);
create index if not exists swap_parts_signature on swap_parts (signature);
alter table swap_parts enable row level security;
