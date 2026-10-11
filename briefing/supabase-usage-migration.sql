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
  estimated_cost_usd numeric(14,8),
  created_at timestamptz not null default now()
);

create index if not exists api_usage_user_created_idx on api_usage(user_id, created_at desc);
create index if not exists api_usage_created_idx on api_usage(created_at desc);

alter table api_usage enable row level security;

-- No browser policies are intentionally created.
-- Neosis writes/reads usage only through its Vercel server functions using SUPABASE_SECRET_KEY.
-- user_api_credentials from the earlier BYOK design may be left in place for now; it is no longer used.
