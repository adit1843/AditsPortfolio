-- Neosis shared OpenAI key usage ledger
-- Run once in Supabase SQL Editor.

create table if not exists api_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'openai',
  operation text not null,
  model text not null,
  response_id text,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  web_search_calls integer not null default 0,
  tts_characters bigint not null default 0,
  billable_tts_characters bigint not null default 0,
  estimated_cost_usd numeric(14,8),
  created_at timestamptz not null default now()
);

alter table api_usage add column if not exists web_search_calls integer not null default 0;
alter table api_usage add column if not exists tts_characters bigint not null default 0;
alter table api_usage add column if not exists billable_tts_characters bigint not null default 0;

create index if not exists api_usage_user_created_idx on api_usage(user_id, created_at desc);
create index if not exists api_usage_created_idx on api_usage(created_at desc);

alter table api_usage enable row level security;

-- No browser policies: usage is accessed only through authenticated Vercel server functions.
-- BYOK is retired. Remove any previously stored per-user API credentials.
drop table if exists user_api_credentials;
