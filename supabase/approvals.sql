-- Access requests: when someone confirms a new account, Baron gets an email with Approve / Deny links.
-- Approving adds them to approved_users (Claude picks for all their libraries). Safe to re-run.
--
-- The email goes out through Resend (https://resend.com, free). Store its API key in Vault ONCE, yourself,
-- in Supabase -> SQL Editor (it stays in Supabase, never in this repo or a chat):
--   select vault.create_secret('re_...', 'resend_key');
-- Until the key is there, requests are still recorded; nothing is emailed. The email goes to the address
-- of the account whose library slug is 'baron'.

create extension if not exists pg_net;

create table if not exists public.access_requests (
  user_id      uuid primary key references auth.users on delete cascade,
  token        uuid not null unique default gen_random_uuid(), -- only ever sent to Baron's inbox
  requested_at timestamptz not null default now(),
  emailed_at   timestamptz,
  decided_at   timestamptz,
  decision     text check (decision in ('approved', 'denied'))
);
alter table public.access_requests enable row level security;
-- you can see your own request's state; nobody can read tokens or write directly
drop policy if exists "access read own" on public.access_requests;
create policy "access read own" on public.access_requests for select using (auth.uid() = user_id);
revoke select on public.access_requests from anon, authenticated;
grant select (user_id, requested_at, decided_at, decision) on public.access_requests to authenticated;

create or replace function public.email_access_request(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  key text; owner text; r record; site text := 'https://bar371.github.io/Barons-Books/approve.html?t=';
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'resend_key';
  key := btrim(key, E' \t\r\n"''');
  select u.email into owner from auth.users u join public.profiles p on p.id = u.id where p.slug = 'baron';
  if key is null or key = '' or owner is null then return; end if;
  select a.token, u.email, coalesce(p.display_name, u.email) as name into r
    from public.access_requests a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id
    where a.user_id = uid and a.decided_at is null;
  if not found then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Baron''s Library <onboarding@resend.dev>', 'to', jsonb_build_array(owner),
      'subject', r.name || ' wants access to Baron''s Library',
      'html', format('<div style="font-family:sans-serif;font-size:15px"><p><b>%s</b> (%s) signed up and is asking for full access: their own libraries plus picks from Claude.</p>'
        || '<p><a href="%s%s" style="background:#2f9e44;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve</a></p>'
        || '<p style="color:#888;font-size:13px">The link opens a page where you approve or deny with one click. Do nothing and they keep a library without Claude picks.</p></div>',
        replace(replace(r.name, '<', '&lt;'), '>', '&gt;'), r.email, site, r.token)));
  update public.access_requests set emailed_at = now() where user_id = uid;
end $$;
revoke execute on function public.email_access_request(uuid) from public, anon, authenticated;

-- new confirmed account -> record a request and email Baron (never blocks the sign-up itself)
create or replace function public.on_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null)
     and not exists (select 1 from public.approved_users where user_id = new.id) then
    begin
      insert into public.access_requests (user_id) values (new.id) on conflict (user_id) do nothing;
      perform public.email_access_request(new.id);
    exception when others then raise warning 'access request for % not sent: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after insert or update of email_confirmed_at on auth.users
  for each row execute function public.on_user_confirmed();

-- "Ask for access" from the app (accounts made before this, or a nudge): at most one email a day
create or replace function public.request_access() returns text
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.approved_users where user_id = auth.uid()) then return 'approved'; end if;
  insert into public.access_requests (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select * into a from public.access_requests where user_id = auth.uid();
  if a.decision = 'denied' then return 'denied'; end if;
  if a.emailed_at is null or a.emailed_at < now() - interval '1 day' then perform public.email_access_request(auth.uid()); end if;
  return 'pending';
end $$;
revoke execute on function public.request_access() from public, anon;
grant execute on function public.request_access() to authenticated;

-- the approve page: who is asking (only with the emailed token), then the decision
create or replace function public.access_request_info(t uuid) returns json
language sql security definer set search_path = public as $$
  select json_build_object('name', coalesce(p.display_name, u.email), 'email', u.email, 'slug', p.slug,
                           'requested', a.requested_at, 'decision', a.decision)
  from public.access_requests a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id
  where a.token = t and a.requested_at > now() - interval '60 days';
$$;
create or replace function public.decide_access(t uuid, approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from public.access_requests where token = t and requested_at > now() - interval '60 days';
  if uid is null then raise exception 'This link is not valid any more'; end if;
  update public.access_requests set decision = case when approve then 'approved' else 'denied' end, decided_at = now() where user_id = uid;
  if approve then insert into public.approved_users (user_id) values (uid) on conflict do nothing;
  else delete from public.approved_users where user_id = uid; end if;
  return case when approve then 'approved' else 'denied' end;
end $$;
revoke execute on function public.access_request_info(uuid) from public;
revoke execute on function public.decide_access(uuid, boolean) from public;
grant execute on function public.access_request_info(uuid) to anon, authenticated;
grant execute on function public.decide_access(uuid, boolean) to anon, authenticated;

-- No email service? Baron approves inside the app: his account menu lists waiting requests.
create or replace function public.pending_access() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and slug = 'baron') then return '[]'::json; end if;
  return coalesce((select json_agg(json_build_object('token', a.token, 'name', coalesce(p.display_name, u.email), 'email', u.email, 'requested', a.requested_at) order by a.requested_at)
    from public.access_requests a join auth.users u on u.id = a.user_id left join public.profiles p on p.id = a.user_id
    where a.decided_at is null), '[]'::json);
end $$;
revoke execute on function public.pending_access() from public, anon;
grant execute on function public.pending_access() to authenticated;
