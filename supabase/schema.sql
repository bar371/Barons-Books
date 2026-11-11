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
-- people may rename themselves or hide their map, but never change their slug (the URL of a library)
revoke update on public.profiles from anon, authenticated;
grant update (display_name, is_public) on public.profiles to authenticated;

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

-- Who may ask Claude for picks (each run uses Baron's Claude subscription). No client can write this
-- table; approve people from the SQL editor, e.g.:
--   insert into public.approved_users (user_id) select id from auth.users where email = 'someone@example.com';
create table if not exists public.approved_users (
  user_id uuid primary key references auth.users on delete cascade,
  approved_at timestamptz not null default now()
);
alter table public.approved_users enable row level security;
drop policy if exists "approved read own" on public.approved_users;
create policy "approved read own" on public.approved_users for select using (auth.uid() = user_id);

drop policy if exists "refresh insert own" on public.refresh_requests;
create policy "refresh insert own" on public.refresh_requests for insert
  with check (auth.uid() = user_id and exists (select 1 from public.approved_users a where a.user_id = auth.uid()));

-- Everyone who signs up gets a library automatically. The slug comes from their name
-- ('Shahar' -> 'shahar', or 'shahar-2' if taken); display_name comes from the sign-up form.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  name text := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1));
  base text := coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'reader');
  s text := base;
  n int := 1;
begin
  while s = 'baron' or exists (select 1 from public.profiles where slug = s) loop  -- 'baron' is reserved
    n := n + 1; s := base || '-' || n;
  end loop;
  insert into public.profiles (id, slug, display_name) values (new.id, s, left(name, 40));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Users created before this script ran (e.g. from the dashboard) get a library too:
insert into public.profiles (id, slug, display_name)
select u.id, u.slug, u.name from (
  select id, coalesce(nullif(raw_user_meta_data->>'display_name', ''), split_part(email, '@', 1)) as name,
         regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9]+', '-', 'g') || '-' || left(id::text, 4) as slug
  from auth.users) u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Baron's library must use the slug 'baron' (it is the one built from the Goodreads export). Once you
-- have signed up, run (with your email):
--   update public.profiles set slug = 'baron', display_name = 'Baron' where id = (select id from auth.users where email = 'YOUR_EMAIL');
--   insert into public.approved_users (user_id) select id from auth.users where email in ('YOUR_EMAIL', 'SHAHAR_EMAIL');
