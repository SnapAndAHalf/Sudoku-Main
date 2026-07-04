-- ============================================================
-- Daily Sudoku — Supabase setup, part 2 (feedback + admin dashboard)
-- Run ONCE in Supabase Dashboard → SQL Editor → New query → Run.
-- (Run supabase-setup.sql first if you haven't already.)
-- ============================================================

-- ---------- 1. Admins ----------
-- Locked-down table: no API policies at all; only the security-definer
-- functions below may consult it.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;

-- ---------- 2. Feedback ----------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  email      text,
  message    text not null check (char_length(message) between 1 and 2000),
  page       text,
  status     text not null default 'new' check (status in ('new', 'read')),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

-- anyone (guest or logged in) may send feedback…
create policy "anyone can send feedback" on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- …but only admins can read / update / delete it
create policy "admins read feedback" on public.feedback
  for select using (public.is_admin());
create policy "admins update feedback" on public.feedback
  for update using (public.is_admin()) with check (public.is_admin());
create policy "admins delete feedback" on public.feedback
  for delete using (public.is_admin());

-- ---------- 3. Game sessions (telemetry) ----------
-- One row per game started. Result columns are filled in when the game
-- ends, via finish_session() keyed by the unguessable row id.
create table if not exists public.game_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  mode             text not null check (mode in ('single', 'daily', 'multi')),
  difficulty       text,
  won              boolean,
  duration_seconds integer,
  created_at       timestamptz not null default now()
);
create index if not exists game_sessions_created_at_idx on public.game_sessions (created_at);
alter table public.game_sessions enable row level security;

create policy "anyone can log a session" on public.game_sessions
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

create policy "admins read sessions" on public.game_sessions
  for select using (public.is_admin());

create or replace function public.finish_session(p_id uuid, p_won boolean, p_duration integer)
returns void
language sql security definer
set search_path = ''
as $$
  update public.game_sessions
     set won = p_won,
         duration_seconds = least(greatest(coalesce(p_duration, 0), 0), 86400)
   where id = p_id
     and won is null;  -- write-once
$$;
grant execute on function public.finish_session(uuid, boolean, integer) to anon, authenticated;

-- ---------- 4. Dashboard stats (admin only) ----------
create or replace function public.admin_stats()
returns json
language plpgsql stable security definer
set search_path = ''
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select json_build_object(
    'total_users',        (select count(*) from auth.users),
    'users_today',        (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    'users_7d',           (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'users_30d',          (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'total_sessions',     (select count(*) from public.game_sessions),
    'sessions_today',     (select count(*) from public.game_sessions where created_at >= date_trunc('day', now())),
    'sessions_7d',        (select count(*) from public.game_sessions where created_at >= now() - interval '7 days'),
    'sessions_30d',       (select count(*) from public.game_sessions where created_at >= now() - interval '30 days'),
    'finished_sessions',  (select count(*) from public.game_sessions where won is not null),
    'wins',               (select count(*) from public.game_sessions where won is true),
    'avg_duration',       (select coalesce(round(avg(duration_seconds)), 0) from public.game_sessions where won is not null),
    'active_players_7d',  (select count(distinct user_id) from public.game_sessions where user_id is not null and created_at >= now() - interval '7 days'),
    'feedback_total',     (select count(*) from public.feedback),
    'feedback_new',       (select count(*) from public.feedback where status = 'new'),
    'by_mode',            coalesce((select json_object_agg(mode, n) from (select mode, count(*) n from public.game_sessions group by mode) t), '{}'::json),
    'by_difficulty',      coalesce((select json_object_agg(coalesce(difficulty, '?'), n) from (select difficulty, count(*) n from public.game_sessions group by difficulty) t), '{}'::json)
  ) into result;

  return result;
end;
$$;
revoke execute on function public.admin_stats() from anon, public;
grant execute on function public.admin_stats() to authenticated;

-- Time series of sessions, bucketed for the dashboard chart.
-- p_period: 'daily' (last 30 days) | 'weekly' (last 12 weeks)
--           | 'monthly' (last 12 months) | 'yearly' (all time)
create or replace function public.admin_sessions_series(p_period text)
returns table (bucket text, sessions bigint, signed_in_players bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_trunc text;
  v_from  timestamptz;
  v_fmt   text;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_period = 'daily' then
    v_trunc := 'day';   v_from := date_trunc('day', now()) - interval '29 days'; v_fmt := 'YYYY-MM-DD';
  elsif p_period = 'weekly' then
    v_trunc := 'week';  v_from := date_trunc('week', now()) - interval '11 weeks'; v_fmt := 'YYYY-MM-DD';
  elsif p_period = 'monthly' then
    v_trunc := 'month'; v_from := date_trunc('month', now()) - interval '11 months'; v_fmt := 'YYYY-MM';
  else
    v_trunc := 'year';  v_from := '-infinity'; v_fmt := 'YYYY';
  end if;

  return query
    select to_char(date_trunc(v_trunc, gs.created_at), v_fmt),
           count(*)::bigint,
           count(distinct gs.user_id)::bigint
      from public.game_sessions gs
     where gs.created_at >= v_from
     group by 1
     order by 1;
end;
$$;
revoke execute on function public.admin_sessions_series(text) from anon, public;
grant execute on function public.admin_sessions_series(text) to authenticated;

-- ---------- 5. Make yourself an admin ----------
-- ⚠️ FIRST create your account normally in the game, THEN run this line
-- with your own signup email:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'YOUR-EMAIL-HERE'
-- on conflict do nothing;
