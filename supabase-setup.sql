-- ============================================================
-- Daily Sudoku — Supabase setup
-- Run this ONCE in your Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- 1. Player data table (one row per user: streak, highscores, consent record)
create table if not exists public.player_data (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  scores          jsonb not null default '{}'::jsonb,   -- highscores per difficulty
  streak          integer not null default 0,
  last_done       text,                                  -- YYYY-MM-DD of last daily completion
  daily_best      integer not null default 0,
  consent_version text,                                  -- DPDP consent record
  consent_at      timestamptz,
  age_confirmed   boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- 2. Row Level Security: users can only see and edit their OWN row
alter table public.player_data enable row level security;

create policy "own row select" on public.player_data
  for select using (auth.uid() = user_id);

create policy "own row insert" on public.player_data
  for insert with check (auth.uid() = user_id);

create policy "own row update" on public.player_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Account self-deletion (DPDP right to erasure).
--    Runs with elevated rights but can ONLY delete the caller's own user.
--    player_data is removed automatically via "on delete cascade".
create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_account() from anon, public;
grant execute on function public.delete_account() to authenticated;
