-- Batcave reminders: run once in Supabase -> SQL Editor.
--
-- __PUSH_SECRET__ is replaced with a random value before running (see
-- REMINDERS.md). The same value is the GitHub secret PUSH_SECRET: it's
-- what lets the reminder job read subscriptions without the service-role
-- key. Never commit the filled-in copy (*.local.sql is gitignored).

-- One row: the shared secret. RLS on and no policies, so nobody can read
-- it through the API; only the security-definer functions below see it.
create table if not exists push_config (
  id int primary key default 1 check (id = 1),
  secret text not null
);
alter table push_config enable row level security;
insert into push_config (id, secret) values (1, '__PUSH_SECRET__')
  on conflict (id) do update set secret = excluded.secret;

-- One row per device that turned reminders on.
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  tz text not null default 'UTC',
  device text,
  sent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;

drop policy if exists "own subscriptions: read" on push_subscriptions;
create policy "own subscriptions: read" on push_subscriptions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own subscriptions: add" on push_subscriptions;
create policy "own subscriptions: add" on push_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own subscriptions: change" on push_subscriptions;
create policy "own subscriptions: change" on push_subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own subscriptions: remove" on push_subscriptions;
create policy "own subscriptions: remove" on push_subscriptions
  for delete to authenticated using (auth.uid() = user_id);

-- Everything the reminder job needs, in one call: each subscription plus
-- the handful of app_state keys that decide whether a reminder is still
-- worth sending (raw localStorage strings, parsed by the job).
create or replace function push_due(p_secret text)
returns table (
  endpoint text, user_id uuid, p256dh text, auth text, tz text, sent jsonb,
  prefs text, checkin text, recovery text, food text, reviews text, goals text
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_config c where c.secret = p_secret) then
    raise exception 'forbidden';
  end if;
  return query
    select s.endpoint, s.user_id, s.p256dh, s.auth, s.tz, s.sent,
           a.data->>'reminders', a.data->>'checkin-log', a.data->>'recovery',
           a.data->>'food', a.data->>'reviews', a.data->>'goals'
    from push_subscriptions s
    left join app_state a on a.user_id = s.user_id;
end $$;

-- Remember that `kind` was handled on local day `day` for every device of
-- that user, so it isn't sent twice.
create or replace function push_mark_sent(p_secret text, p_user uuid, p_kind text, p_day text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_config c where c.secret = p_secret) then
    raise exception 'forbidden';
  end if;
  update push_subscriptions
     set sent = sent || jsonb_build_object(p_kind, p_day)
   where user_id = p_user;
end $$;

-- A push service said this endpoint is gone (app deleted, permission
-- revoked): drop it.
create or replace function push_drop(p_secret text, p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_config c where c.secret = p_secret) then
    raise exception 'forbidden';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;

revoke all on function push_due(text) from public;
revoke all on function push_mark_sent(text, uuid, text, text) from public;
revoke all on function push_drop(text, text) from public;
grant execute on function push_due(text) to anon, authenticated;
grant execute on function push_mark_sent(text, uuid, text, text) to anon, authenticated;
grant execute on function push_drop(text, text) to anon, authenticated;

-- So the API picks up the new table and functions straight away.
notify pgrst, 'reload schema';
