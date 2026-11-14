-- Board-game libraries. Paste into Supabase -> SQL Editor -> Run (safe to re-run).
-- Purely additive: the book tables are not touched, so the live book app keeps working as-is.
-- Each person keeps one profile (same slug) and gets a separate game library next to their books.

-- Your games: same JSON shape as edits (books / genres / assign / ratings), one row per person.
create table if not exists public.game_edits (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{"books":[],"genres":[],"assign":{},"ratings":{}}',
  updated_at timestamptz not null default now()
);
alter table public.game_edits enable row level security;
drop policy if exists "game edits read" on public.game_edits;
create policy "game edits read" on public.game_edits for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = user_id and p.is_public));
drop policy if exists "game edits write own" on public.game_edits;
create policy "game edits write own" on public.game_edits for insert with check (auth.uid() = user_id);
drop policy if exists "game edits update own" on public.game_edits;
create policy "game edits update own" on public.game_edits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Claude's game picks: written only by the picks routine with the secret key.
create table if not exists public.game_picks (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.game_picks enable row level security;
drop policy if exists "game picks read" on public.game_picks;
create policy "game picks read" on public.game_picks for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = user_id and p.is_public));

-- "Update my picks now" says which library it is for; existing requests count as books.
alter table public.refresh_requests add column if not exists kind text not null default 'books';
alter table public.refresh_requests drop constraint if exists refresh_requests_kind_check;
alter table public.refresh_requests add constraint refresh_requests_kind_check check (kind in ('books', 'games'));
-- one queued request per person *per library* (was: per person)
create unique index if not exists one_queued_per_user_kind on public.refresh_requests (user_id, kind) where status = 'queued';
drop index if exists public.one_queued_per_user;
