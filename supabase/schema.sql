-- PulseLab cloud schema (run in Supabase → SQL Editor → Run)
-- Project: https://zartihkavuijfhxiojzt.supabase.co

-- 1) Also enable: Authentication → Providers → Anonymous → ON

create table if not exists public.pulselab_meta (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sync_cursor bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_samples (
  user_id uuid not null references auth.users (id) on delete cascade,
  t bigint not null,
  bpm smallint not null,
  date_key text not null,
  rr_ms integer[] null,
  primary key (user_id, t)
);

create index if not exists hr_samples_user_date_idx
  on public.hr_samples (user_id, date_key);

create index if not exists hr_samples_user_t_idx
  on public.hr_samples (user_id, t desc);

create table if not exists public.day_summaries (
  user_id uuid not null references auth.users (id) on delete cascade,
  date_key text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date_key)
);

alter table public.pulselab_meta enable row level security;
alter table public.hr_samples enable row level security;
alter table public.day_summaries enable row level security;

drop policy if exists pulselab_meta_own on public.pulselab_meta;
create policy pulselab_meta_own on public.pulselab_meta
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists hr_samples_own on public.hr_samples;
create policy hr_samples_own on public.hr_samples
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists day_summaries_own on public.day_summaries;
create policy day_summaries_own on public.day_summaries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Revoke broad grants; RLS still applies for authenticated
revoke all on public.pulselab_meta from anon, public;
revoke all on public.hr_samples from anon, public;
revoke all on public.day_summaries from anon, public;
grant select, insert, update, delete on public.pulselab_meta to authenticated;
grant select, insert, update, delete on public.hr_samples to authenticated;
grant select, insert, update, delete on public.day_summaries to authenticated;
