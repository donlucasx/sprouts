-- The watcher's budget (spec 6, design notes section 5): every model call recorded with its cost, so the $10-a-month cap and the
-- per-user daily cap are read from the table, never guessed. Under RLS with no policies, like every table (0002).
create table watcher_calls (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_pubkey text not null references users(seed_vault_pubkey),
  kind text not null check (kind in ('compile', 'explain', 'propose')),
  input_tokens integer not null,
  output_tokens integer not null,
  cost_microcents bigint not null           -- a millionth of a cent: Haiku 4.5 is 100 per token in, 500 per token out
);
create index watcher_calls_ts on watcher_calls (ts);
create index watcher_calls_user_ts on watcher_calls (user_pubkey, ts);
alter table watcher_calls enable row level security;
