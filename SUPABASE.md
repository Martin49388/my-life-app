# Cross-device sync setup

Batcave syncs across devices through your own free Supabase project.
Settings -> **Cross-device sync** just asks for your email: Supabase
sends a 6-digit code, you type it in, and every device signed in with
that same email reads and writes the same row. No password, ever.

## 1. Create a Supabase project

Free tier is fine (or reuse an existing project if you already made one
for this app). Once it's created, grab two things from **Project
Settings -> API**:

- **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
- **anon / publishable key** (safe to use client-side — this is not the
  service_role/secret key, which should never go in this app)

Paste both into `sync.js`, replacing the two placeholder constants near
the top of the file:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

These are committed to the repo on purpose — every device (including
the live GitHub Pages copy your phone opens) needs them, and they're
meant to be public: the row-level-security policies below are what
actually keep one user's data private from another, not this key.

## 2. Create the table

Open the **SQL Editor** in your Supabase project and run:

```sql
drop table if exists app_state;

create table app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

drop policy if exists "users can read own row" on app_state;
create policy "users can read own row"
  on app_state for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can insert own row" on app_state;
create policy "users can insert own row"
  on app_state for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update own row" on app_state;
create policy "users can update own row"
  on app_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Unlike the old anon-key-only setup, this actually restricts each row to
the signed-in account it belongs to — only *your* logged-in devices can
read or write your row.

## 3. Turn on the emailed code (one dashboard edit)

By default Supabase's sign-in email only contains a clickable link,
which is what caused problems last time (it points at a "Site URL" that
has to be kept in sync with wherever the app is deployed). To get a
typed-in code instead — no link, no Site URL to misconfigure — add the
code to the email template:

1. In the Supabase dashboard: **Authentication -> Emails -> Magic Link**.
2. Add `{{ .Token }}` somewhere in the template body, e.g.:
   ```
   Your Batcave sign-in code is: {{ .Token }}
   ```
   (You can leave the existing link text in too; the app only uses the
   code.)
3. Save.

That's the only Supabase Auth setting that needs touching. Everything
else (email provider, confirmations) works out of the box for this
flow, since the code itself *is* the confirmation.

## 4. Deploy

```
git add sync.js
git commit -m "Add Supabase URL/key for cross-device sync"
git push origin main
```

Wait for GitHub Pages to rebuild (a minute or two), then open the live
link on your Mac.

## 5. Sign in on each device

In the app, open **Settings -> Cross-device sync**:

1. Enter your email, tap **Send code**.
2. Check that inbox, copy the 6-digit code, paste it in, tap **Verify**.

You're signed in — sync starts immediately, and you'll see "Synced
HH:MM:SS" appear. Do the exact same thing (same email) on every other
device, phone included. The **first** device you sign in on uploads its
existing data; every device after that pulls it down.

## Notes

- Signing out on a device just disconnects that device from sync — it
  doesn't touch its local data or anyone else's synced row.
- If the code email doesn't arrive: check spam first; Supabase's free
  tier also rate-limits outgoing auth emails, so wait a minute before
  requesting another one.
