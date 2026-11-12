-- "Update my picks now" -> starts the Claude picks routine straight away (otherwise it waits for the
-- monthly run). Paste into Supabase -> SQL Editor -> Run (safe to re-run).
--
-- First store the routine's API trigger URL and token in Supabase Vault. Run these two lines ONCE,
-- with your own values (they stay in Supabase, never in this repo):
--   select vault.create_secret('https://api.anthropic.com/v1/claude_code/routines/trig_.../fire', 'routine_url');
--   select vault.create_secret('sk-ant-oat01-...', 'routine_token');
-- To replace one later: select vault.update_secret((select id from vault.secrets where name = 'routine_token'), 'NEW');

create extension if not exists pg_net;

create or replace function public.fire_routine() returns trigger
language plpgsql security definer set search_path = public as $$
declare url text; tok text;
begin
  -- one start per 10 minutes is plenty: a run also picks up requests that arrive while it works
  if exists (select 1 from public.refresh_requests where id <> new.id and requested_at > now() - interval '10 minutes') then
    return new;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'routine_url';
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'routine_token';
  -- pasted values often carry a stray space or line break, which makes the HTTP call fail
  url := btrim(url, E' \t\r\n"'''); tok := btrim(regexp_replace(tok, '^Bearer\s+', '', 'i'), E' \t\r\n"''');
  if url is null or tok is null or url = '' or tok = '' then return new; end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('text', 'Update requested from the app'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || tok, 'anthropic-version', '2026-10-21', 'Content-Type', 'application/json'));
  return new;
end $$;

drop trigger if exists on_refresh_requested on public.refresh_requests;
create trigger on_refresh_requested after insert on public.refresh_requests
  for each row execute function public.fire_routine();
