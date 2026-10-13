-- Neosis adaptive global source registry.
-- The live project is pre-seeded with a broad cross-domain set of sources.
-- New topic/source relationships are added automatically by the source-planner when
-- a user's content plan introduces a topic that lacks enough relevant sources.

create table if not exists public.source_registry (
  domain text primary key,
  name text not null,
  source_type text not null default 'secondary',
  quality_score integer not null default 70 check (quality_score between 0 and 100),
  topic_weights jsonb not null default '{}'::jsonb,
  discovered_by text not null default 'seed',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_validated_at timestamptz
);

create index if not exists source_registry_active_idx
  on public.source_registry(active);

create index if not exists source_registry_topic_weights_gin
  on public.source_registry using gin(topic_weights);
