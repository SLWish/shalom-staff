-- ShaLom Defeat Watch migration
-- Run once in Supabase SQL Editor. All access is server-only through RLS.

create extension if not exists pgcrypto;

create table if not exists public.defeat_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_hash text not null unique,
  manage_token_hash text not null unique,
  verified_at timestamptz not null default now(),
  alerts_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.defeat_characters (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.defeat_subscribers(id) on delete cascade,
  guild_name text not null check (guild_name in ('ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4')),
  nickname text not null,
  nickname_key text not null,
  alerts_enabled boolean not null default true,
  last_wave bigint,
  last_api_date timestamptz,
  last_checked_at timestamptz,
  is_defeated boolean not null default false,
  defeated_at timestamptz,
  notified_for_api_date timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscriber_id, nickname_key)
);

create table if not exists public.defeat_pending_registrations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_hash text not null,
  guild_name text not null check (guild_name in ('ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4')),
  nickname text not null,
  nickname_key text not null,
  verification_token_hash text not null unique,
  manage_token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.defeat_member_status (
  id uuid primary key default gen_random_uuid(),
  guild_name text not null check (guild_name in ('ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4')),
  nickname text not null,
  nickname_key text not null,
  wave bigint,
  api_date timestamptz,
  inactive_minutes integer,
  is_defeated boolean not null default false,
  checked_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (guild_name, nickname_key)
);

create table if not exists public.defeat_monitor_state (
  id text primary key default 'global',
  source_status text not null default 'idle',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now()
);

create table if not exists public.defeat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  endpoint_hash text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  expiration_time bigint,
  manage_token_hash text not null unique,
  alerts_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.defeat_push_characters (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.defeat_push_subscriptions(id) on delete cascade,
  guild_name text not null check (guild_name in ('ShaLom', 'ShaLom2', 'ShaLom3', 'ShaLom4')),
  nickname text not null,
  nickname_key text not null,
  alerts_enabled boolean not null default true,
  repeat_interval_minutes integer not null default 0 check (repeat_interval_minutes in (0, 10, 15, 30, 60, 120, 180)),
  last_wave bigint,
  last_api_date timestamptz,
  last_checked_at timestamptz,
  is_defeated boolean not null default false,
  defeated_at timestamptz,
  notified_for_api_date timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, nickname_key)
);

create index if not exists defeat_characters_subscriber_idx
  on public.defeat_characters (subscriber_id);
create index if not exists defeat_pending_email_created_idx
  on public.defeat_pending_registrations (email_hash, created_at desc);
create index if not exists defeat_member_status_defeated_idx
  on public.defeat_member_status (is_defeated, guild_name);
create index if not exists defeat_push_characters_subscription_idx
  on public.defeat_push_characters (subscription_id);

alter table public.defeat_subscribers enable row level security;
alter table public.defeat_characters enable row level security;
alter table public.defeat_pending_registrations enable row level security;
alter table public.defeat_member_status enable row level security;
alter table public.defeat_monitor_state enable row level security;
alter table public.defeat_push_subscriptions enable row level security;
alter table public.defeat_push_characters enable row level security;

alter table public.defeat_push_characters
  add column if not exists repeat_interval_minutes integer not null default 0;

-- Do not create anon/authenticated policies for these tables.
-- Netlify Functions use SUPABASE_SERVICE_ROLE_KEY and return only safe fields.
