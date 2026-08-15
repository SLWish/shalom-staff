-- ShaLom warning settings shared by the staff web app and private Android app.
-- Run once in the Supabase SQL Editor.

create table if not exists public.guild_warning_settings (
  id text primary key default 'global' check (id = 'global'),
  warnings_enabled boolean not null default true,
  guild_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.guild_warning_settings enable row level security;

insert into public.guild_warning_settings (id, warnings_enabled, guild_settings)
values ('global', true, '{"ShaLom":{"enabled":true,"cutScore":40000},"ShaLom2":{"enabled":true,"cutScore":15000},"ShaLom3":{"enabled":true,"cutScore":7000},"ShaLom4":{"enabled":true,"cutScore":3000}}'::jsonb)
on conflict (id) do nothing;

-- No anon/authenticated policies. Netlify Functions use the service role.
