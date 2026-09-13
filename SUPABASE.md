# Cross-device sync setup

Batcave syncs across devices through your own free Supabase project.
There's no login — every device just pastes the same three values into
**Settings → Cross-device sync**, and they all read/write one shared row.

## 1. Create a Supabase project

Free tier is fine. Once it's created, grab two things from
**Project Settings → API**:

- **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
- **anon / publishable key** (safe to use client-side — this is not the
  service_role/secret key, which should never go in this app)

## 2. Create the table

Open the **SQL Editor** in your Supabase project and run:

```sql
drop table if exists app_state;

create table app_state (
  sync_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

drop policy if exists "anyone with the anon key can read" on app_state;
create policy "anyone with the anon key can read"
  on app_state for select
  to anon
  using (true);

drop policy if exists "anyone with the anon key can write" on app_state;
create policy "anyone with the anon key can write"
  on app_state for insert
  to anon
  with check (true);

drop policy if exists "anyone with the anon key can update" on app_state;
create policy "anyone with the anon key can update"
  on app_state for update
  to anon
  using (true)
  with check (true);
```

**Security note**: this table has no real per-user access control — it
relies on your Sync ID being hard to guess (it's a random UUID) rather
than actual auth. Anyone who has both your anon key and your exact Sync
ID could read or write that row. That's an accepted tradeoff for a
personal app syncing your own devices — don't post your Sync ID
anywhere public, and if it ever leaked, just click "Generate" again on
one device and re-paste the new ID everywhere.

(This replaces an earlier email/password version of sync that kept
running into unconfirmed-email and password-reset issues — this version
has no accounts to get stuck.)

## 3. Connect your first device

In the app, open **Settings**, and under "Cross-device sync":

1. Paste your **Supabase project URL**.
2. Paste your **anon/publishable key**.
3. Click **Generate** — this fills in a random Sync ID.
4. Click **Sync now**.

You should see "Synced HH:MM:SS" appear.

## 4. Connect every other device

On each other device (phone, another browser, etc.), open the same live
app link, go to **Settings**, and paste the exact same three values —
URL, key, and the Sync ID you generated in step 3 (don't click Generate
again; a new ID would just point at an empty row). Click **Sync now**.

That device will pull down whatever's already synced. From then on,
any change on any connected device pushes automatically a couple
seconds after you make it, and each device checks for updates whenever
you open it.
