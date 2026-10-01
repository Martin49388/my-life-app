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

## Current state (2026-10-01)

Everything through roadmap steps 3-8 is shipped and live (see git log
and the vault for detail). Reminders backend verified end to end on
2026-09-24; old PAT revoked.

2026-10-01: first real-world bugs from daily use, fixed same day —
- Decimal number fields (`type="number"`) silently ate a typed ","
  (weight, goal target/current/step, sleep target): switched to
  `type="text"` + `inputmode="decimal"`, comma normalized to "." before
  every parse. If a future decimal field gets added, give it the same
  treatment or it'll have the same bug.
- Habits had no past-day editing (Fuel and Recovery already did, via
  their own date pickers). The month view's day-detail panel now reuses
  the check-in sheet's `.ci-habit` chip rows to toggle any non-future
  day's habits.
- Push notifications: no code bug found after reading the whole
  pipeline; last 25 scheduled Actions runs all succeeded. Waiting on
  Martin to run the real test (Actions -> Reminders -> Run workflow ->
  "Send a test notification") to see whether a device is actually
  subscribed — I can't read the run's console log without his GitHub
  login.

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
