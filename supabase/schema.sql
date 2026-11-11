-- Baron's Library: Supabase schema. Paste into Supabase -> SQL Editor -> Run (safe to re-run).
-- One row of edits per person (same JSON shape the site keeps locally: books / genres / assign),
-- plus a small table of "update now" requests that the refresh routine works through.

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  slug         text unique not null,          -- e.g. 'baron', 'shahar' (used in the site URL)
  display_name text not null,
  is_public    boolean not null default true, -- public maps can be viewed without logging in
  created_at   timestamptz not null default now()
);

create table if not exists public.edits (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{"books":[],"genres":[],"assign":{}}',
  updated_at timestamptz not null default now()
);

create table if not exists public.refresh_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  requested_at timestamptz not null default now(),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  note         text
);

alter table public.profiles         enable row level security;
alter table public.edits            enable row level security;
alter table public.refresh_requests enable row level security;

-- profiles: anyone can see public ones, you can always see and edit your own
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (is_public or auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- edits: readable when the owner's map is public; only the owner can write
drop policy if exists "edits read" on public.edits;
create policy "edits read" on public.edits for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = user_id and p.is_public));
drop policy if exists "edits write own" on public.edits;
create policy "edits write own" on public.edits for insert with check (auth.uid() = user_id);
drop policy if exists "edits update own" on public.edits;
create policy "edits update own" on public.edits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- refresh requests: you can ask for (and see) your own; at most one queued at a time
drop policy if exists "refresh own" on public.refresh_requests;
create policy "refresh own" on public.refresh_requests for select using (auth.uid() = user_id);
drop policy if exists "refresh insert own" on public.refresh_requests;
create policy "refresh insert own" on public.refresh_requests for insert with check (auth.uid() = user_id);
create unique index if not exists one_queued_per_user on public.refresh_requests (user_id) where status = 'queued';

-- After creating each user under Authentication -> Users, give them a profile, e.g.:
-- insert into public.profiles (id, slug, display_name) values ('<user uuid>', 'baron', 'Baron');
-- insert into public.profiles (id, slug, display_name) values ('<user uuid>', 'shahar', 'Shahar');
