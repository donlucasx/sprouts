-- Row-level security on every table, with no policies: the anon and authenticated roles get nothing through PostgREST,
-- and the service role (the only key the server uses) bypasses RLS and keeps everything. Review I6 (2026-09-28).
alter table users enable row level security;
alter table wallets enable row level security;
alter table rules enable row level security;
alter table swaps enable row level security;
alter table plantings enable row level security;
alter table planting_legs enable row level security;
alter table withdrawals enable row level security;
alter table events enable row level security;
alter table nonces enable row level security;
alter table link_codes enable row level security;
alter table recaps enable row level security;
alter table proposals enable row level security;
