# CLAUDE.md — Batcave (my-life-app)

Martin's personal tracking app. Keep this file under ~120 lines: current
state and rules, not a changelog. The long history (every redesign and
bug story up to 2026-09-24) is in the vault at
`projects/batcave-history.md`; decisions are in `memory/decisions-log.md`;
details are in `git log`.

## Where things are

- Live: https://martin49388.github.io/my-life-app/ — GitHub Pages from
  `main`. Martin's iPhone uses this copy, so a change only reaches him
  once it's pushed. Local: `~/Documents/Projects/my-life-app`.
- Plain HTML/CSS/JS, no framework, no build step. Supabase for auth +
  sync (`sync.js`, see SUPABASE.md). Service worker for offline (`sw.js`).
- Sections: Overview, Habits, Goals, Blueprint, Review, Fitness, Fuel,
  Recovery, Reading, Notes, Briefing (News + Markets), Settings; Alfred
  (Gemini) via the Ask bar / phone centre button. Phone (<640px) uses
  `mobile-nav.js` (header, tab bar, More sheet) instead of the sidebar.

## How the code fits together

- Classic `<script>` tags share ONE global scope, loaded in index.html
  order. New files are one IIFE exporting only what others need on
  `window` (a same-named global silently replaced another once).
- `switchSection(id)` (script.js) shows a section and calls its render;
  aliases in `SECTION_ALIASES` (food/water -> fuel, news/markets ->
  briefing, mindset -> notes). `index.html#fuel` etc. deep-links
  (reminders.js), `#checkin` opens the check-in sheet.
- Every module keeps its data in localStorage (JSON per key) and writes
  through; sync.js mirrors all keys except `sb-*` to Supabase `app_state`.
  Main keys: habits, goals, food, water, weight, fitness, week-plan,
  plan-done-<date>, recovery, reviews, notes, books, checkin-log,
  reminders, week-plan-undo. API keys are `*-api-key` (Settings only).
- Shared rules — always call these, never re-derive:
  - `kcalStatus(kcal)` / `foodGoal()` (food.js): met/over by Bulk /
    Maintain / Cut band. Used by Fuel, Overview, Review, Alfred, and
    duplicated once in `scripts/send-reminders.mjs`.
  - `goalIsDone / goalPct / goalStatus / goalNeedText / activeGoals /
    goalsOnPaceAt` (goals.js). Goals can count DOWN (target < start),
    so never compare current >= target yourself. Linked goals
    (`goal.source`: books, pages, training, habit, weight) are refreshed
    by `refreshLinkedGoals()`; `adjustGoal` ignores them.
- Styles: `css/NN-*.css`, loaded in numeric order, later wins. Read
  `css/README.md` before touching CSS. Colours only via tokens; green/
  amber/red (`--good/--warn/--danger`) mean status and nothing else.
- Alfred: `window.callGemini(prompt, {json})` (alfred.js), key from
  Settings. `actions.js` = whitelisted, additive-only actions Alfred may
  apply. `planner.js` = "Plan the week" in Blueprint (diff, per-day
  apply, undo). "plan my week ..." typed to Alfred opens it.
- Reminders: reminders.js (Settings card, Web Push subscribe) + sw.js
  (push/click) + `supabase/reminders.sql` + `scripts/send-reminders.mjs`
  run by `.github/workflows/reminders.yml` every 15 min. See REMINDERS.md.

## Before you ship anything

1. `npm test` (tests/smoke.mjs: every section, desktop + phone, core
   rules, precache list) — GitHub runs it on every push too.
2. Bump `?v=` on every tag in index.html AND `CACHE_VERSION` in sw.js,
   in the same commit. A new file also goes into sw.js `SHELL`.
3. Big CSS changes: prove them. The 2026-09-24 split compared computed
   styles of every element in every section before/after (0 diffs).

## Lessons that cost a bug each

- An author `display:` beats the browser's `[hidden]` rule. Anything you
  toggle with `hidden` needs its own `[hidden]{display:none}`. Verify
  hide/show with `getComputedStyle` and `elementFromPoint`, not
  `el.hidden` or synthetic `click()`.
- Nothing reloads the page on its own (sync.js's reload loop, offline.js
  first-install reload). Only a user tap may reload.
- Postgres jsonb reorders keys: compare with `stableStringify()`.
- A per-device file (config.js) never reaches the phone. Keys live in
  Settings/localStorage; config.js is a local-dev fallback only.
- rss2json dates are UTC without a zone marker (`parseNewsDate`).
- `grid-template-columns: repeat(7, 1fr)` overflows with content; use
  `minmax(0, 1fr)`.
- Dead-class scans must allow names built as `` `is-${x}` `` / `"tone-" + x`.

## Current state (2026-10-06)

Everything through roadmap steps 3-8 is shipped and live (see git log
and the vault for detail).

2026-10-01: first real-world bugs from daily use, fixed same day —
- `type="number"` fields silently ate a typed "," (any locale whose
  decimal key is "," instead of "."): weight, goal target/current/step
  and sleep target are now `type="text"` + `inputmode="decimal"`,
  comma normalized to "." before every parse. Give any future decimal
  field the same treatment.
- Habits had no past-day editing (Fuel and Recovery already did via
  their own date pickers). The month view's day-detail panel now
  reuses the check-in sheet's `.ci-habit` chip rows to toggle any
  non-future day.
- Push notifications were never actually reaching Martin's phone:
  Settings' "On for this device" only checked the browser's own memory
  of subscribing, never the server, so a save to push_subscriptions
  that failed once left it reporting "On" with 0 server-side rows
  forever (confirmed via the Reminders workflow's test run: `0
  subscription(s)`, while "Show a sample" — a local, no-network
  notification — always worked and masked it). `render()` now calls
  `confirmSaved()` on every open to re-verify and silently re-save, so
  this drift self-heals. Martin re-subscribed to fix today's instance.

2026-10-04/06: Fitness got Habits' past-day editing (day arrows next
to the session title, `plan.log[<date>]` instead of always today) —
a late or forgotten workout no longer stays wrong forever in "This
week" and Overview's training dots. Shipped with the real `npm test`
clean (desktop + phone, Fuel specifically re-checked — an earlier
draft had briefly broken it). Full story: vault decisions-log.md.

2026-10-06: fixed sync silently erasing a morning's check-in/habits/
water entries. `pullFromSupabase` (sync.js) treated any mismatch
between local and the Supabase row as "another device synced
something newer" and overwrote local with it — but a mismatch also
happens when this device's own push from a few minutes ago just
never finished (debounce, then the installed PWA gets backgrounded
or killed before the fetch completes). A `_sync_confirmed_hash` in
localStorage now tells those apart: local unchanged since the last
confirmed sync -> take remote as before; local has moved on from it
-> push local instead of overwriting it. Also flushes a pending push
on `visibilitychange`/`pagehide` so fewer pushes miss their window in
the first place. Verified with a standalone Playwright harness against
a stubbed Supabase client (not covered by tests/smoke.mjs, which
never configures real sync). Full story: vault decisions-log.md.

Next big idea: the cross-section "patterns" layer (what actually moves
sleep, weight, training and habits). Deliberately not built yet: it
needs 60-90 days of dense daily data to say anything true rather than
noise, so revisit around December 2026. Until then the job is using the
app daily and noting friction in Notes #batcave.

Ideas parked (step 9 of the roadmap, "talk later"): no new sections;
anything new should fold into an existing one.

## Rules

- No token/API key ever pasted into chat or committed. Secrets live in
  `.env` (gitignored) and GitHub secrets.
- Update this file (current state, not history) at the end of every
  session, and add decisions to the vault's `memory/decisions-log.md`.
