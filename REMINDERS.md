# Reminders (push notifications)

Batcave can remind you even when it's closed — and only when something
is still undone:

| Reminder | Default | Skipped when |
|---|---|---|
| Morning check-in | 08:00 daily | you've already checked in (check-in sheet or Recovery) |
| Log your food | 20:30 daily | calories are on target for your Bulk / Maintain / Cut goal |
| Weekly review | Sunday 19:00 | this week's review has a rating or an answer |
| Goals slipping | Monday 09:00 | no goal is behind pace or overdue |

Times and on/off are in **Settings → Reminders** and sync across devices.

## How it works

```
iPhone / Mac (reminders.js)          Supabase                         GitHub Actions (every 15 min)
  permission + Web Push subscribe --> push_subscriptions (RLS: own)
  prefs in localStorage "reminders" --> app_state (synced as usual)
                                      push_due(secret) ------------->  scripts/send-reminders.mjs
                                                                      decides per user, in their time zone
  sw.js shows it, tap opens section <-------------- Web Push (VAPID) --
                                      push_mark_sent(secret) <------  never twice a day
```

- `reminders.js` — Settings card, subscribe/unsubscribe, deep links
  (`index.html#checkin`, `#fuel`, `#review`, `#goals`).
- `sw.js` — `push` and `notificationclick` handlers.
- `supabase/reminders.sql` — table, RLS and three `security definer`
  functions guarded by a shared secret, so the job never needs the
  service-role key.
- `scripts/send-reminders.mjs` + `.github/workflows/reminders.yml` — the
  sender. Same calorie and goal rules as the app.

## One-time setup (already done on 2026-09-24 — here for a rebuild)

1. VAPID keys: `npx web-push generate-vapid-keys --json`. Public key goes
   into `VAPID_PUBLIC_KEY` at the top of `reminders.js`. Both go into
   GitHub secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
2. A random secret (`openssl rand -hex 32`) into the GitHub secret
   `PUSH_SECRET`, and into a copy of `supabase/reminders.sql` with
   `__PUSH_SECRET__` replaced. Save that copy as `*.local.sql` (gitignored)
   and run it in Supabase → SQL Editor.
3. On the iPhone: Safari → Share → **Add to Home Screen**, open Batcave
   from the Home Screen, sign in under Cross-device sync, then
   Settings → Reminders → **Turn on reminders**.

## Checking it works

- GitHub → Actions → Reminders → **Run workflow** with "Send a test
  notification" ticked sends a test to every subscribed device.
- The run log says what it decided: `food: sent to 1/1 device(s)` or
  `checkin: due but already done — skipped`.
- GitHub pauses scheduled workflows in a repo with no commits for 60
  days; any push (or the "Enable workflow" button) turns it back on.
