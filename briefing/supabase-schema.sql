-- Neosis multi-user schema. Run once in Supabase SQL Editor before deployment.
create table if not exists profiles (user_id uuid primary key references auth.users(id) on delete cascade,email text not null,display_name text,timezone text not null default 'UTC',email_enabled boolean not null default true,audio_enabled boolean not null default true,onboarding_complete boolean not null default false,last_brief_local_date text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists user_api_credentials (user_id uuid primary key references auth.users(id) on delete cascade,openai_api_key_ciphertext text,openai_api_key_last4 text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table briefs add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table explainers add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table preferences add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table knowledge add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table coverage add column if not exists user_id uuid references auth.users(id) on delete cascade;alter table surveys add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists briefs_user_created_idx on briefs(user_id,created_at desc);create index if not exists explainers_user_created_idx on explainers(user_id,created_at desc);create index if not exists preferences_user_created_idx on preferences(user_id,created_at desc);create index if not exists knowledge_user_created_idx on knowledge(user_id,created_at desc);create index if not exists coverage_user_created_idx on coverage(user_id,created_at desc);create index if not exists surveys_user_created_idx on surveys(user_id,created_at desc);
alter table profiles enable row level security;alter table user_api_credentials enable row level security;
drop policy if exists "users read own profile" on profiles;create policy "users read own profile" on profiles for select using(auth.uid()=user_id);drop policy if exists "users update own profile" on profiles;create policy "users update own profile" on profiles for update using(auth.uid()=user_id);
-- Legacy single-user rows stay user_id=null and are therefore hidden from new accounts until explicitly migrated.

-- Shared-key usage accounting

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
