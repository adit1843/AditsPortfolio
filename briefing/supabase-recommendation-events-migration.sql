-- Neosis behavioral recommendation learning
create table if not exists public.recommendation_events (
  id bigserial primary key,
  user_id uuid not null,
  event_key text not null,
  event_type text not null,
  brief_id bigint,
  story_id text,
  weight numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,event_key)
);

create index if not exists recommendation_events_user_created_idx
  on public.recommendation_events(user_id,created_at desc);

create index if not exists recommendation_events_story_idx
  on public.recommendation_events(user_id,story_id);
