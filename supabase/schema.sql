-- Applied via Supabase MCP (pulselab_cloud_history)
-- Device-scoped history with owner_key (no login)

create table if not exists public.pulselab_meta (
  owner_key text primary key,
  sync_cursor bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_samples (
  owner_key text not null,
  t bigint not null,
  bpm smallint not null,
  date_key text not null,
  rr_ms integer[] null,
  primary key (owner_key, t)
);

create index if not exists hr_samples_owner_date_idx
  on public.hr_samples (owner_key, date_key);

create index if not exists hr_samples_owner_t_idx
  on public.hr_samples (owner_key, t desc);

create table if not exists public.day_summaries (
  owner_key text not null,
  date_key text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_key, date_key)
);

alter table public.pulselab_meta enable row level security;
alter table public.hr_samples enable row level security;
alter table public.day_summaries enable row level security;
