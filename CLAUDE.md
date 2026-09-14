# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1, live at https://martin49388.github.io/my-life-app/ (that copy
has no API keys — Alfred/food lookup show "no key configured" there,
intentional; the real experience is local with config.js). Martin needs to
`git push origin main` and wait for GitHub Pages to rebuild before this
session's commits show up there.

Settings is now a full content section (`#settings-section`), same
scale as Habits/Fitness/etc., not a small dropdown pinned inside the
240px sidebar column. `#settings-nav-btn` is a real `.section-btn` with
`data-section="settings"` now, so it's driven entirely by `switchSection()`
like every other nav item — the old settings.js (which owned open/close
toggle state, outside-click, and Escape handling for the dropdown) was
deleted outright since none of that applies anymore. The Account panel
(sign-in form, signed-in state, sync status) lives inside it unchanged.

Just finished the "FINAL STRUCTURAL REBUILD" brief — all 4 ordered steps
done, each its own commit:

1. **Sidebar restructure + kill top tabs** — the old top tab bar and
   `.brand-header` (logo/gear icon) are gone. All navigation and branding
   now live in one place: `.sidebar` (pure nav — brand name/tag, grouped
   links). Settings is a normal nav item now, opening a full section
   like any other, not an inline panel. Under 640px the sidebar becomes a
   horizontal scrollable bar instead of disappearing, since it's the only
   nav now.
2. **Typography pass** — font weights across the app dropped from a flat
   600-800 to mostly 400-500, with a few intentional exceptions
   (`.nav-link.active`, `.news-col-title`, `.horizon-node.active
   .horizon-label` stay at 700). Manrope 300/400 weights added to the font
   import for the thinner hero numbers. Letter-spacing normalized to
   `0.03em` on labels/eyebrows app-wide.
3. **Strip boxes → hairline rows** — `.stat-tile`, `.habit-row`,
   `.goal-row`, `.exercise-row`, `.news-column` no longer have
   background/border/radius/shadow. Rows are separated by a 1px
   `border-top` on adjacent siblings (same pattern `.food-row` already
   used). State indicators that lived on the box border (habit color,
   goal-complete) moved to a left accent stripe instead. `.day-chip` (week
   day selector) kept a border but flattened to a bottom-border-only
   indicator. `.sidebar` and the new input bar (below) are the only two
   real bordered boxes left in the app.
4. **Persistent global input bar** — a fixed bottom bar ("Log, ask, or
   restructure…") visible across every section, not just Alfred.
   Submitting it switches to the Alfred section and calls the same
   `handleAlfredQuestion()` the in-section form uses — one log, one code
   path, not a parallel Alfred. `script.js`'s section-switch logic is now
   a named `switchSection()` on `window` so both the sidebar nav and this
   bar can call it.

Design system: pure black/grey, no shadows/gradients. Font stack unchanged
(IBM Plex Mono + Manrope).

Layout: edge-to-edge, matching a reference screenshot Martin sent of a
similar app (his friend's). No more centered max-width card with gutters
on either side. Above 640px: a full-height sidebar (260px, sticky, its own
scroll) flush against the left edge, divided from content by a single
right-hand hairline; content fills the rest of the width with its own
padding. Under 640px: sidebar collapses to a horizontal scrollable nav
strip at the top, content full-width below it.

Sidebar now has 13 sections in 4 groups: Habits/Goals/Alfred/Blueprint/
Review, Body (Fitness/Food/Water/Recovery), Mind (Mindset/Reading),
System (News/Markets/Notes/Settings — Settings opens a full section).
   The 7 new ones (Blueprint, Review,
Recovery, Mindset, Reading, Markets, Notes) are all the same simple
pattern for now — a one-line note form + timestamped log, own localStorage
key each (journal.js) — since none of them have real tracked structure
specified yet, unlike Fitness/Food/Goals.

Motion: tab switches fade/slide in (0.22s). Checking a habit pulses the
row before it re-renders. `budget-number` and the water total tween to
their new value instead of jumping (`animateNumber()` in script.js,
reusable, handles decimals). Everything respects `prefers-reduced-motion`.

Sections (Overview is now the sidebar's default landing page, not Habits):
- Overview — landing page. Hero 'X/4 banked' ring (how many of
  Habits/Water/Food/Training-this-week are on target right now) plus Best
  streak next to it, a status line naming what's open, a hairline
  standards list, two quick actions (+250ml water, jump to Alfred), and a
  'Today's Plan' list pulling from Blueprint's week plan (see below) with
  its own per-date done checkboxes. Lives in overview.js, hooks into the
  same window.renderX() chain the dead renderGlance() used so it stays
  live. A condensed version (#mini-overview: banked count + best streak
  only) shows as a slim header above every OTHER section, toggled in
  switchSection() — so those two numbers are visible everywhere, not just
  on Overview itself.
- Blueprint — its free-text notes journal is unchanged, plus a new Week
  Plan editor (blueprint.js): pick a weekday tab, add time-blocked entries
  (start/end/title). This is the 'week plan for every day' Martin plans to
  fill in — Overview reads whichever day matches today automatically.
- Habits — streaks, ten-day history, monthly calendar, hero completion
  ring/count as the section's primary number. No per-habit emoji/color
  anymore (removed for looking unprofessional) — checkbox/history/calendar
  dots all use the single app accent color; habits are told apart by
  name only
- News — live RSS headlines, no API key needed
- Goals — short/long-term horizon rail
- Fitness — "This week" stat is real completions vs the actual 5x/week
  target, not just how many template days have a plan
- Food — 3500 kcal default target, FoodData Central lookup wired in,
  `budget-number` (64px) is the flagship hero number
- Water — 4L target, daily tally, lives at the top of Food
- Alfred — Gemini-backed, blunt tone, reads real daily data, reachable
  either from its own section or the persistent bottom bar. CONFIRMED
  WORKING live (tested for real, not from the sandboxed dev shell).
  Uses gemini-3.6-flash — gemini-2.0-flash was retired by Google and
  404ing on every request; swapped to the model Google's own error
  named as the replacement. FoodData Central lookup is still untested.
- Markets (markets.js) — still has its free-text journal underneath, plus:
  a "Open Yahoo Finance ↗" link in the header; a stock search (Finnhub
  free tier, `FINNHUB_API_KEY` in config.js — Martin has a real key set
  locally now); and a "Portfolio" watchlist below it, just symbol+name in
  localStorage (`markets-portfolio`), with live price always re-fetched
  fresh on render (never cached, never stale) and each row linking out to
  its own Yahoo Finance page.
  Search auto-adds straight to the portfolio, no separate pick-a-result
  step — went through one redesign after Martin tried it live: the first
  version showed a list of matches with individual "+ Add" buttons, and
  separately searching "GM general motors" (ticker + name combined)
  silently did nothing. Root cause on that one was upstream, not a bug in
  this app — confirmed by curling Finnhub's `/search` directly: it
  genuinely returns zero results for a combined ticker+name query, even
  though "GM" alone or "general motors" alone each resolve correctly to
  the same stock. Fixed by taking Finnhub's top match automatically
  (reliable for either a plain ticker or a plain company name) and always
  showing an explicit status line — "Added X", "X is already in your
  portfolio", or "No match found for '...' — try just the ticker or
  company name" — instead of ever going quiet. Verified live against the
  real Finnhub API (not mocked) for all of: a plain ticker, the exact
  failing combined query, and a repeat search to confirm no duplicate
  entries.

Overview additionally shows Food's protein next to kcal, and a
'Logged today' feed merging every timestamped entry from every
journal-backed section (Blueprint/Review/Recovery/Mindset/Reading/
Markets/Notes) plus Alfred check-ins, filtered to today.

Quote of the day (quotes.js, new 2026-09-14): Martin originally asked for
286 pre-written quotes+authors seeded in up front; talked him out of that
(hand-curating 286 real quotes from memory risks misattribution at that
scale, and it's a dead end once day 287 arrives) in favor of generating one
real quote a day automatically, no button — same Gemini call pattern as
Alfred (config.js key, gemini-3.6-flash), asked for a real quote+author+a
short context blurb as strict JSON, told not to repeat anything in the
existing log. Runs once per day the app is opened (checks localStorage
`quotes-log` for today's date key first, no-ops if already there — skipped
days just don't get an entry, not backfilled). Shows as a clickable card on
Overview; every quote ever generated is kept permanently and listed in
Mindset, newest first; clicking either opens the same modal (`#quote-modal-
overlay`, new generic component, first modal in the app) with the full
quote/author/info. Shipped with a real bug, caught by Martin right after: the modal was stuck
open (empty, blocking every click) on first load. Root cause — CSS
specificity, not a rendering fluke: `.modal-overlay { display: flex }` in
style.css always wins over the browser's built-in `[hidden]{display:none}`
(author styles beat the UA stylesheet regardless of the `hidden` attribute
being set), so the overlay was full-screen and click-blocking from the very
first page load, permanently, since toggling `.hidden` in JS never actually
changed its computed style. Fixed with an explicit `.modal-overlay[hidden]
{ display: none; }` override. Lesson for next time: checking
`element.hidden` (the DOM property) is not enough to verify a hide/show
bug — check `getComputedStyle(el).display` and, for anything that's
supposed to block/unblock clicks, verify with real hit-testing
(`document.elementFromPoint`) rather than synthetic `element.click()`, which
bypasses hit-testing entirely and will falsely "pass" even when a real tap
would've hit an invisible overlay instead.

Client-side API keys (config.js, gitignored) are a deliberate tradeoff —
no backend exists, personal non-public use case, accepted over adding a
proxy server.

## Next steps

- Fixed a real bug found via a screen recording Martin sent (2026-09-13):
  the app looked "glitchy" and unclickable every time it opened on his
  phone. Root cause was in `pullFromSupabase()` (sync.js) — it compared
  local vs. remote state with plain `JSON.stringify()`, but the remote
  side comes from a Postgres `jsonb` column, and jsonb does not preserve
  object key order (documented Postgres behavior — it decomposes into its
  own canonical binary form). So the comparison almost never matched even
  when the data was identical, which made every app open take the
  "different device" branch: wipe `localStorage`, restore it, and
  `location.reload()` — and since that reload re-triggers the same check
  immediately, the page never settled. Fixed by sorting keys before
  comparing (`stableStringify()` in sync.js). Confirms sync must have
  already been configured with real credentials on Martin's phone even
  though this file previously said pairing was still untested — worth
  confirming with him.
- Confirm Food lookup actually works in the browser (Alfred is now
  confirmed working, see above) — check the browser console for the
  exact error if it fails
- Sync (sync.js) — rebuilt a second time, dropping auth entirely. The
  original email/password version (via Supabase Auth) kept hitting real
  friction: unconfirmed-email accounts, "invalid login credentials" from
  password typos across devices, and password-reset emails linking to
  Supabase's default localhost:3000 Site URL instead of the live app
  (dashboard-only setting, never fixed). Current version: no accounts at
  all. Settings -> "Cross-device sync" has three fields — Supabase
  project URL, anon/publishable key, and a random "Sync ID" (generate
  once, paste the same one into every other device). All devices with
  the same three values read/write one shared row in `app_state`, keyed
  by `sync_id` instead of an authenticated `user_id`. Still the same
  localStorage.setItem monkey-patch + debounced push/pull underneath;
  see SUPABASE.md for the schema/policies and pairing steps. Same
  accepted tradeoff as before, now explicit: no real per-row security,
  just an unguessable Sync ID — fine for one person's own devices.
  STILL NEEDS: Martin has to run SUPABASE.md's SQL (replaces the old
  user_id-based table) and actually pair two real devices — untested
  past confirming the code loads without errors.
- Dead CSS cleanup — grown across passes, still deferred: the removed
  color-picker's swatch/intensity selectors; `.glance-tile`/`.glance-label`
  etc. (glance.js's target `#sidebar-content` was removed from the HTML in
  Step 1, so `renderGlance()` is now a harmless no-op — glance.js could be
  deleted outright, or repurposed for a tab-contextual sidebar later);
  `.brand-header`/`.brand-mark`/`.brand-name`/`.settings-btn` (dead since
  Step 1's sidebar-nav rewrite removed the old header markup)
- This was the last of the explicitly-scoped structural passes — the
  brief that drove Steps 1-4 said so. What's left is Martin's own content
  to fill in (real per-section detail beyond the scaffolding), not more
  layout/typography/box rebuilding, unless he asks for another pass

## Rules

- No token/API key ever pasted into chat — config file only (violated once
  earlier this project; moved to config.js/.env immediately, not repeated
  back — Martin should judge whether any are worth rotating at their
  source)
- Update this file before ending any session
