-- ShaLom Info shared storage schema
-- Paste this file into Supabase SQL Editor and run it once.

create extension if not exists pgcrypto;

create table if not exists public.guild_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  season_key text not null,
  guild_name text not null,
  cut_score integer not null default 0,
  member_count integer not null default 0,
  max_members integer not null default 20,
  total_score bigint not null default 0,
  average_score integer not null default 0,
  achieved_count integer not null default 0,
  failed_count integer not null default 0,
  inactive_count integer not null default 0,
  move_candidate_count integer not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.member_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  season_key text not null,
  guild_name text not null,
  nickname text not null,
  score integer not null default 0,
  wave bigint,
  api_date timestamptz,
  cut_score integer not null default 0,
  shortage integer not null default 0,
  achieved boolean not null default false,
  inactive_over_six_hours boolean not null default false,
  inactive_minutes integer,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.season_archives (
  id uuid primary key default gen_random_uuid(),
  season_key text not null unique,
  season_start_at timestamptz,
  season_end_at timestamptz,
  archive_target_at timestamptz,
  saved_at timestamptz not null default now(),
  save_type text not null default 'auto',
  total_failed_count integer not null default 0,
  archive_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guild_snapshots_captured_at_idx
  on public.guild_snapshots (captured_at desc);

create index if not exists guild_snapshots_season_guild_idx
  on public.guild_snapshots (season_key, guild_name);

create index if not exists member_snapshots_captured_at_idx
  on public.member_snapshots (captured_at desc);

create index if not exists member_snapshots_member_idx
  on public.member_snapshots (season_key, guild_name, nickname);

create index if not exists season_archives_saved_at_idx
  on public.season_archives (saved_at desc);

alter table public.guild_snapshots enable row level security;
alter table public.member_snapshots enable row level security;
alter table public.season_archives enable row level security;

drop policy if exists "Allow public read guild snapshots" on public.guild_snapshots;
drop policy if exists "Allow public read member snapshots" on public.member_snapshots;
drop policy if exists "Allow public read season archives" on public.season_archives;

create policy "Allow public read guild snapshots"
  on public.guild_snapshots
  for select
  using (true);

create policy "Allow public read member snapshots"
  on public.member_snapshots
  for select
  using (true);

create policy "Allow public read season archives"
  on public.season_archives
  for select
  using (true);

-- Writes should be done only from serverless functions using the service role key.
-- Do not add public insert/update/delete policies for anon users.
