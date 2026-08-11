-- ShaLom Defeat Watch: browser push notification migration
-- Run once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.defeat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  endpoint_hash text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  expiration_time bigint,
  manage_token_hash text not null unique,
  alerts_enabled boolean not null default true,
  repeat_interval_minutes integer not null default 0 check (repeat_interval_minutes in (0, 10, 15, 30, 60, 120, 180)),
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

create index if not exists defeat_push_characters_subscription_idx
  on public.defeat_push_characters (subscription_id);

alter table public.defeat_push_subscriptions enable row level security;
alter table public.defeat_push_characters enable row level security;

-- Safe to run on projects that already have the push tables.
alter table public.defeat_push_characters
  add column if not exists repeat_interval_minutes integer not null default 0;

-- Do not add anon/authenticated policies. Netlify Functions use the service role.
