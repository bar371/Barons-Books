-- Video-game libraries. Paste into Supabase -> SQL Editor -> Run (safe to re-run).
-- Purely additive: the book and board-game tables are not touched, so the live app keeps working as-is.
-- Each person keeps one profile (same slug) and gets a video-game library next to their books and board games.

-- Your video games: same JSON shape as edits (books / genres / assign / ratings), one row per person.
create table if not exists public.videogame_edits (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{"books":[],"genres":[],"assign":{},"ratings":{}}',
  updated_at timestamptz not null default now()
);
alter table public.videogame_edits enable row level security;
drop policy if exists "videogame edits read" on public.videogame_edits;
create policy "videogame edits read" on public.videogame_edits for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = user_id and p.is_public));
drop policy if exists "videogame edits write own" on public.videogame_edits;
create policy "videogame edits write own" on public.videogame_edits for insert with check (auth.uid() = user_id);
drop policy if exists "videogame edits update own" on public.videogame_edits;
create policy "videogame edits update own" on public.videogame_edits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Claude's video-game picks: written only by the picks routine with the secret key.
create table if not exists public.videogame_picks (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.videogame_picks enable row level security;
drop policy if exists "videogame picks read" on public.videogame_picks;
create policy "videogame picks read" on public.videogame_picks for select
  using (auth.uid() = user_id or exists (select 1 from public.profiles p where p.id = user_id and p.is_public));

-- "Update my picks now" may now ask for the video-game library too.
alter table public.refresh_requests drop constraint if exists refresh_requests_kind_check;
alter table public.refresh_requests add constraint refresh_requests_kind_check check (kind in ('books', 'games', 'videogames'));
