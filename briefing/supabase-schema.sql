create table if not exists briefs (
  id bigint generated always as identity primary key,
  brief_date text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists explainers (
  id bigint generated always as identity primary key,
  story_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists preferences (
  id bigint generated always as identity primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists knowledge (
  id bigint generated always as identity primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists coverage (
  id bigint generated always as identity primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists surveys (
  id bigint generated always as identity primary key,
  brief_date text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table briefs enable row level security;
alter table explainers enable row level security;
alter table preferences enable row level security;
alter table knowledge enable row level security;
alter table coverage enable row level security;
alter table surveys enable row level security;
