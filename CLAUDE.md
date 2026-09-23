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
   like any other, not an inline panel. (Under 640px the sidebar is
   now hidden in favor of a bottom tab bar — see Layout below.)
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
padding. Under 640px (phone, REDESIGNED 2026-09-15 — Martin disliked the old
sideways-scrolling top nav strip): the sidebar is hidden and mobile-nav.js
takes over with an iOS-style shell — a sticky header (section name + sync
badge; tap to scroll up), a fixed bottom tab bar (Home, two sections
Martin picks, a raised center "Ask Alfred" button, More), a "More" bottom
sheet with every section as a tile + live one-line status (and an "Edit
tabs" mode; choice stored in localStorage `nav-tabs`), and the desktop's
#global-bar form restyled as an "Ask" bottom sheet with prompt chips,
lifted above the iOS keyboard via visualViewport (`--kb` CSS var).
Sheets close on scrim tap, Escape, or swipe-down on the handle.
viewport-fit=cover is on, so header/tab bar pad with env(safe-area-*).
Inputs are forced to 16px on phones so iOS doesn't zoom on focus.
switchSection() now scrolls to top on a real section change, records
window.currentSection, and calls window.onSectionChange (the nav hook).
setSynced() in sync.js updates every .sync-badge (sidebar + header).
Desktop is unchanged — all of this is display:none above 640px.
Verified in headless Chromium at 390px (touch) and 1280px, light/dark,
including resizing across the breakpoint; not yet tried on a real iPhone
(keyboard lift and safe areas are the parts most worth checking).

Sidebar now has 15 entries in 4 groups: Overview/Habits/Goals/Alfred/
Blueprint/Review, Body (Fitness/Fuel/Recovery), Mind (Mindset/Reading),
System (News/Markets/Notes/Settings — Settings opens a full section).
(Food + Water were merged into Fuel and Reading became a real book log on
2026-09-16 — see "Fuel and Reading" below.)
   The journal-backed ones (Blueprint, Review,
Recovery, Mindset, Markets, Notes; Reading originally) started as the same simple
pattern — a one-line note form + timestamped log, own localStorage
key each (journal.js) — since none of them have real tracked structure
specified yet, unlike Fitness/Food/Goals. Reading (2026-09-16) and then
Recovery/Review/Notes (2026-09-20, see below) grew real structure; the
plain pattern now survives as Mindset, plus the Notes block at the
bottom of Blueprint/Markets/Reading/Recovery/Review.

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
  free tier) that auto-adds straight to a "Portfolio" watchlist below it
  (no pick-a-result step — searching "GM" just adds it); and that
  portfolio, just symbol+name in localStorage (`markets-portfolio`), with
  live price always re-fetched fresh on render (never cached, never
  stale) and each row linking out to its own Yahoo Finance page.
  Went through two real bugs after Martin tried it live, both worth
  remembering:
  1. Searching "GM general motors" (ticker + name combined) silently did
     nothing. Root cause was upstream, not this app — confirmed by
     curling Finnhub's `/search` directly: it genuinely returns zero
     results for a combined query, even though "GM" alone or "general
     motors" alone each resolve fine. Fixed by taking Finnhub's top match
     automatically and always showing an explicit status line either way
     ("Added X", "X already in your portfolio", or "No match found —
     try just the ticker or company name") instead of ever going quiet.
  2. Bigger one: the Finnhub key lived in `config.js` — gitignored, so it
     only ever existed on whichever machine someone last edited it on.
     Martin's phone opens the live GitHub Pages link, which never had
     that file, so the feature could never have worked there no matter
     how many times the code got fixed. Moved the key to Settings ->
     "Markets stock lookup", stored per-device in localStorage exactly
     like Cross-device sync's fields already were — `config.js` is only
     a fallback now, for local dev convenience. This is the second time
     a client-side-key feature (see Sync's own history above) has needed
     rearchitecting away from a gitignored file for this exact reason;
     worth defaulting new API-key features straight to a Settings field
     instead of config.js from now on.
  Verified end-to-end with config.js's key deliberately removed (i.e.
  simulating the live-site case exactly) — no key -> clickable "add one
  in Settings" message that jumps there -> save a key -> search works ->
  survives a full page reload with zero dependency on config.js.
  Tapping a portfolio row now opens a modal with price, basic info
  (exchange/industry/market cap), and a 30-day price chart — Martin
  wanted this without being sent to Yahoo Finance, so that link moved
  from the row itself into an optional line inside the modal instead of
  being the row's default action. Needed a second free API key: Finnhub's
  free tier covers profile info but flat-out 403s on historical candles
  (confirmed directly, not assumed) — no chart possible from Finnhub
  alone. Twelve Data fills that gap; also confirmed directly that it
  serves `access-control-allow-origin: *`, i.e. actually usable from a
  browser with no proxy, unlike most providers (Yahoo's own unofficial
  chart endpoint returns real data too but zero CORS headers, so it's
  curl-only, not fetch()-from-a-page-able). Same Settings-field pattern as
  Finnhub's key, same graceful "no key yet, tap to fix in Settings"
  fallback, and an unsupported symbol (confirmed against Twelve Data's
  shared "demo" key, which only serves a few symbols) just shows "Chart
  unavailable" rather than breaking the rest of the modal. Martin still
  needs his own real Twelve Data key (twelvedata.com, free) — only tested
  against their shared demo key so far, which won't work for arbitrary
  symbols.
  REDESIGNED 2026-09-15 (Martin: "just lines of text", wanted richer and
  livelier). Now a dashboard: US market session pill (open/pre/after/
  closed, computed from New York time locally, no holidays), hero number
  = average day move across the watchlist (+ breadth / top mover /
  laggard), a heatmap of tiles tinted by each stock's move, rows with
  company logo (Finnhub profile2 `logo`), 30-day sparkline, price and a
  change pill, and a richer modal (scrubbable 30-day chart, day-range
  bar, stats grid). Quotes auto-refresh every 60s only while Markets is
  visible, the tab is visible and the market is in session; prices tween
  and flash on a tick. Introduced `--gain` (green) — used ONLY in
  Markets; the rest of the app stays black/grey. Twelve Data calls go
  through `tdThrottle()` (8/min free-tier cap) and profiles/series are
  cached in sessionStorage — deliberately not localStorage, since
  sync.js would push every localStorage key to Supabase. New top-level
  names in markets.js are `mkt`-prefixed because classic scripts share
  one global scope (script.js already owns `prefersReducedMotion`).
  Verified in headless Chromium with mocked Finnhub/Twelve Data at
  desktop + 390px widths, light + dark, empty and no-key states; not
  yet seen against the real APIs.

OVERVIEW / BLUEPRINT / NEWS REDESIGN (2026-09-15, same visual language as
Markets; Martin said he'll spend most of his time on Overview). Shared
pieces live in style.css under "Shared dashboard pieces": .live-pill
(data-state live/next/loading/error/idle), .dash-hero, .dash-stats,
.dash-block, the day timeline (.day-track) and plan rows (.plan-block).
Green (--gain) is still Markets-only; these three are monochrome.
- Overview (overview.js, rewritten): greeting + live now/next pill (from
  the week plan), a segmented ring (one arc per standard, fills with
  progress, solid when banked), four standard tiles updated in place so
  bars animate (water tile has its own +250 ml button, training shows
  this week's day dots), today's plan (timeline + check-off rows),
  logged today, quote, a briefing (window.marketsSummary() +
  window.newsSnapshot()) and goals in motion. Two columns above 980px.
  Navigation is data-goto delegation on the section. The mini-overview
  bar on other sections also shows the now/next pill (not on
  Blueprint, which has its own). Re-renders once a minute. Food's "met"
  rule (0 < kcal <= target) is unchanged, even though the target is a
  3500 kcal surplus goal — worth revisiting with Martin.
- Blueprint (blueprint.js, rewritten): plan helpers are shared globals
  (planMinutes, planEntryEnd, planDayStatus, planStatusText,
  buildDayTrack, planBlockRowHtml, setLivePill...). loadPlanDone /
  togglePlanDone / PLAN_DONE_PREFIX MOVED here from overview.js.
  Hero = total planned time this week; week strip of 7 tiles (tint =
  load, each with a mini timeline) replaces the old day tabs; selected
  day gets a timeline + rows with live Now/Up next/Done states. Blocks
  with no end time count as 0 duration (planMinutes("") must be null,
  not 0 — that bug briefly made them run to midnight). Its week strip
  function is renderPlanWeekStrip — fitness.js already owns a global
  renderWeekStrip and a same-named function would silently replace it.
- News (news.js, rewritten): one merged timeline instead of four
  columns — lead story with image, stats, 24h activity bars, region
  filter chips with counts, rows with thumbnails grouped by day, "new
  since your last visit" (news-last-seen in localStorage, advanced by
  window.openNews() when the section opens; Overview's background
  loadNews() doesn't advance it). FIXED a real bug: rss2json pubDate is
  UTC without a zone marker (verified against BBC's raw GMT pubDate);
  `new Date()` read it as local time (every story looked 2h older in
  Prague) and older Safari can't parse that format at all —
  parseNewsDate() now parses it as UTC. Images: BBC `thumbnail`,
  ORF/iRozhlas `enclosure.link`, tagesschau has none (placeholder tile).
  Feed text is decoded to plain text and always escaped.
Verified in headless Chromium (Europe/Prague timezone, mocked feeds and
quotes, seeded data) at desktop + 390px, light + dark, empty state;
Habits and Fitness re-checked for regressions.

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

Client-side API keys are a deliberate tradeoff — no backend exists,
personal non-public use case, accepted over adding a proxy server. WHERE
they live matters though (see Markets' history above): config.js is
gitignored, so a key pasted there only exists on whichever single machine
someone edited it on — invisible to any other device, including the live
GitHub Pages link Martin's phone actually opens. Markets' Finnhub/Twelve
Data keys were the first to move to Settings/localStorage for exactly
this reason; GEMINI_API_KEY (Settings -> "Alfred (AI)", shared by Alfred
and quotes.js's daily quote — see `geminiKey()` in alfred.js) and
FOODDATA_API_KEY (Settings -> "Food lookup", see `foodDataKey()` in
food.js) followed the same pattern once Martin asked for it directly.
Every client-side key in the app now lives in Settings/localStorage, not
config.js — config.js is only ever a local-dev fallback at this point,
never the primary path for any of them. Verified each of Alfred and Food
lookup working end-to-end from a Settings-saved key alone, config.js
values deliberately cleared first to simulate the live-site case.

## Fuel and Reading (2026-09-16)

Martin asked to merge Food and Water ("the layout is the same anyway" —
the old Water nav item only scrolled down the Food page) into one section
called **Fuel**, and to make **Reading** a proper list of books he's read,
with info on each, because it was a plain note log.

Fuel (`#fuel-section`; food.js + water.js, no new file):
- One nav entry, section id `fuel`. `switchSection()` keeps `food` and
  `water` as aliases (`SECTION_ALIASES` in script.js; `water` also scrolls
  to `#fuel-water`), so Overview's Water/Food tiles and anything old still
  land there. `window.currentSection` is always the resolved id.
- Storage is untouched: same `food` and `water` keys and shapes.
- Layout in the Markets/Overview style: day switcher pill (tap the date to
  jump back to today), big "kcal left" number, stats (Target input /
  Protein / Water) with hairlines, the existing budget bar, a Water block
  drawn as one glass per 250 ml, Meals (log form + "Again" chips + meal
  groups), Maintenance estimator last. The stale "Saved on this device
  only" note is gone (sync exists).
- Water now follows the Fuel day switcher (`addWater(ml, date)` — date
  defaults to today, which is what Overview's +250 ml uses), so a past
  day can be back-filled. `renderFood()` calls `window.renderWater()`.
- Phone nav: MNAV_SECTIONS has `fuel` (new fork+drop icon) instead of
  food/water; `mnavLoadTabs()` maps pinned `food`/`water` to `fuel`
  (MNAV_RENAMED) and tops the pair back up if both collapsed into one.

Reading (`#reading-section`, new reading.js, loaded after journal.js):
- localStorage key `books` (syncs like everything else) — array of
  `{id, title, origTitle, author, year, pages, cover, olKey, subjects,
  description, status: read|reading|want, rating 0-5, started, finished
  ("YYYY-MM", or just "YYYY" when only the year is known, or ""), page,
  notes, ai: {summary, ideas, forWho} | {unknown:true} | null, addedAt}`.
  `reading-view` remembers grid vs list.
- Metadata from Open Library (free, no key, CORS OK from github.io —
  verified live): search.json with `editions.*` fields, so a Czech title
  ("Malý princ", "Harry Potter a kámen mudrců") finds the work and is shown
  under the typed title (`origTitle` keeps the original). Covers from
  covers.openlibrary.org with `?default=false` (missing → 404 → the drawn
  placeholder cover underneath stays). Work blurb fetched in the
  background after adding (`enrichBook`).
- "Key ideas": Gemini (same `geminiKey()` as Alfred/quotes,
  gemini-3.6-flash) generates a 2-3 sentence summary + 3-5 takeaways +
  who it's for, automatically the first time a book's detail sheet is
  opened, cached on the book; "Redo" regenerates. Asked to answer
  `{"unknown": true}` rather than guess for books it doesn't know.
- UI: hero = books finished this year + a Jan–Dec bar strip, a link to a
  goal whose name starts with "Read" (display only — it does NOT change
  the goal), stats (all time / pages / avg rating); "Reading now" cards
  with an editable page number and "Finished ✓" (marks read this month and
  opens the sheet to rate); shelf tabs Read / Want to read, sort, grid of
  covers or list rows, Read grouped by finish year; detail sheet (bottom
  sheet on the phone) with editable title/author, stars, status, dates,
  pages, key ideas, blurb, notes, two-tap remove. "+ Add books" sheet:
  search (tap a result to add) or **paste a list** (one per line,
  optional "- Author"; each line matched with a scored best-match —
  exact title, author, derivative "summary/workbook/adaptation" editions
  penalised, popularity as tie-breaker; misses are still added as typed).
  Shelf + "Finished" choice (this month / this year / last year / earlier).
- Old reading notes (`journal-reading`) are the Notes block at the bottom.
- Whole file is one IIFE: every `<script>` shares the global scope and
  names like `searchInput` already exist elsewhere (that collision broke
  the first test run). Only `window.renderReading` and
  `window.readingSummary` (used by the More sheet and Alfred's daily
  context) are exported.

Verified in headless Chromium (390px touch + 1360px, dark + light) with
Open Library / Gemini stubbed: every section switch (incl. food/water
aliases) error-free, day switching + water back-fill, nav-tab migration,
search add, paste add (dedupe, no-match fallback), finish → rate flow,
manual add + remove, AI summary render. Open Library matching was also
checked against the live API from the github.io origin with a mixed
English/Czech list. Not yet tried on the real iPhone.

## Recovery, Review and Notes (2026-09-20)

Martin asked for "the remaining boring sections" — Recovery, Review,
Notes — to be made aesthetic *and* useful, with no brief of his own
("try your best and I'll see what you come up with"). All three were
still the plain journal pattern. Each keeps its old free-text log as a
Notes block at the bottom (nothing was thrown away), and all three follow
the Overview/Markets visual language: one hero number, hairline rows,
flat tinted cells, mono for numerals, monochrome (--gain stays
Markets-only; --danger only marks an armed delete). Each file is one
IIFE — classic scripts share a global scope (the collision that broke
reading.js's first test run) — and exports only its render + summary.

**Recovery (recovery.js, key `recovery`)** — a readiness layer.
- Storage: `{ sleepTarget (minutes), log: { "YYYY-MM-DD": { sleep,
  quality 1-5, energy 1-5, soreness 1-5, areas: [], rest, at, updated } } }`.
- Readiness 0-100 = sleep vs target (weight 40), quality (20), energy
  (25), soreness inverted (15), **normalised by the weights actually
  filled in** — half a check-in reads as half a check-in, not a bad day.
  Bands: 80+ Primed / 65 Good / 50 Manageable / 35 Run down / below
  Depleted.
- Check-in has no save button (every tap writes through, same as habits);
  a day toggled back to empty deletes its entry rather than leaving a husk.
- Trend: one chart, four metrics (readiness/sleep/energy/soreness) ×
  14/30/90 days. Tapping a bar switches the check-in to that day, so
  back-filling is the same UI as today (Fuel's day-switcher idea). Sleep
  draws a dashed target line. An empty range shows a line of text instead
  of 30 stub bars.
- Signal block: only lines computable from real data — training streak
  and last rest day (from fitness.js's `plan.log`), readiness vs a
  session planned today, sleep debt over the last 7 logged nights,
  repeated sore areas, and sleep→energy (NOT sleep→readiness, which
  would be circular since readiness contains sleep).
- Exports `window.recoveryScoreOn(date)` (Review reads it),
  `window.recoverySummary()`.

**Review (review.js, key `reviews`)** — the weekly review, mostly
written by the app.
- Storage: `{ "2026-W38": { rating 0-5, wins, drags, focus, focusHit,
  monday, at, updated } }`, ISO week keys (week 1 = the week containing
  4 January; the week belongs to its Thursday's year).
- Week score = average of the areas that had anything to measure, out of
  Habits / Training / Water / Fuel / Plan / Recovery, all read back out
  of the other sections' storage. An unfinished week is compared against
  **the same slice** of the week before (`weekData(monday, limit)`), so
  Wednesday isn't measured against a full week.
- Scorecard rows (bar capped at 240px — a 900px bar is decoration, not a
  measurement), a 6×7 day-by-day heat grid, auto "what stands out" lines,
  then the only three questions a person has to answer: what worked,
  what dragged, one thing for next week. Last week's "one thing" is
  carried into this week's write-up with Did it / Didn't, which writes
  back to *that* week's record.
- The write-up is rebuilt only when the viewed week changes
  (`writeupWeek`), otherwise a re-render mid-sentence takes the caret
  with it. Autosaves 500ms after the last keystroke.
- Week navigation can't go past the current week; past reviews list
  navigates back to any week.

**Notes (notes.js, key `notes`)** — an inbox, not a log.
- Storage: `[{ id, text, tags: [], pinned, archived, at, updated }]`.
  Multi-line capture (⌘/Ctrl+↵ files it; plain ↵ is a newline), #tags
  parsed out of the text and highlighted in place — the inline tag IS
  the filter control, so cards don't repeat their tags in a chip row.
- Triage: pin, edit in place, archive, two-tap delete, and **Send to** —
  files the note as a journal entry in Blueprint/Review/Recovery/Mindset/
  Markets/Reading, or turns it into a habit via `addHabit()`, then
  archives it here.
- Views Inbox / Pinned / Archive / All, tag bar with counts, search.
- Migration: old `journal-notes` entries are imported once with ids
  derived from their timestamps (`j<at>`), so a re-run — or a sync pull
  that restores the old key — can't duplicate them; the old key is then
  set to `[]` (not removed) so sync.js pushes the emptying too.

Wiring: `switchSection()` calls each section's render; `mnavSubtitle()`
has a case per section for the phone More sheet; Alfred's
`buildDailyContext()` appends `window.recoverySummary/reviewSummary/
notesSummary().line`; Overview's "Logged today" feed gained a generic
`window.TODAY_LOG_SOURCES` array (files push a function returning
`{key, section, text, at}` entries) instead of hand-wiring each new
section into overview.js.

Verified in headless Chromium (Europe/Prague, seeded and empty data) at
1400px and 390px, light + dark: 55 interaction assertions covering every
control in all three sections (check-in writes, back-filling a past day,
metric/range switches, week navigation, autosave, the carried-over focus,
tag filtering, send-to, edit, delete, search, migration) plus zero
console/page errors. Not yet tried on the real iPhone.

## Offline and Backup (2026-09-20)

Martin handed over the choice of what to do next ("you choose right now
what to do and how to do it"). The pick was the foundation rather than a
16th section: the app was feature-rich and proof-poor — every section
designed, nothing yet proving it survives a real month — and two gaps
were provable from the repo alone.

**There was no backup, at all.** Every byte lived in localStorage.
Supabase sync is a mirror, not a backup: its job is to make devices
agree, so a bad write or a wipe agrees everywhere too. And on iOS,
localStorage for a site not installed to the home screen is evicted
after roughly a week unopened. Months of data, no second copy Martin
controlled.

**There was no service worker.** manifest.json + the apple meta tags
made it installable, but installable is not offline — the home-screen
icon opened a white page the moment the connection dropped. It's also
the precondition for ever doing web push.

**`sw.js`** — cache-first app shell, three rules in order: cross-origin
requests bypass the worker entirely (Supabase, Gemini, Finnhub, Twelve
Data, Open Library, rss2json, Google Fonts — a stale API response is
worse than a failed one, and an opaque response can't be checked
anyway); navigations are network-first with the cached index.html as
fallback, so a deploy is picked up immediately but the app still opens
with no network; other same-origin assets are stale-while-revalidate,
exact-URL match first and `ignoreSearch` only as a fallback so an
`ignoreSearch` hit can never serve a previous version's file. All paths
are relative, so the same worker works at `/` locally and at
`/my-life-app/` on Pages. A failed precache entry doesn't fail the
install (config.js is gitignored and genuinely 404s on the live copy).
**CACHE_VERSION must be bumped in the same commit as index.html's `?v=`
strings** — the two together are what make a deploy actually land.

**`offline.js`** — registers the worker and owns two pills (top-centre
on desktop; above the tab bar on the phone, where the top is already
occupied by the date and the now/next pill): "Offline — live data
paused", and "Update ready — tap to reload". Also sets `data-offline` on
`<html>` for any section that wants to explain itself. Caught a real bug
in testing: `clients.claim()` fires `controllerchange` on a *first*
install, so an unguarded reload-on-controllerchange meant every first
visit silently reloaded itself. Now only a user-tapped update sets the
flag that permits a reload — consistent with sync.js's standing rule in
this repo that nothing reloads the page on its own.

**`backup.js`** (Settings → Backup) — Download backup / Copy to
clipboard / Restore backup.
- The file is `{app, version, exportedAt, keyCount, data}` where `data`
  is the same flat `{key: rawString}` map sync.js's `dumpLocalStorage()`
  produces, so a Supabase `app_state.data` row pasted into a file
  restores as-is (and the importer accepts a bare map for that reason).
- Two key classes are excluded from the file *and* preserved across a
  restore: `sb-*` (auth session) and `*-api-key` (Gemini, FoodData,
  Finnhub, Twelve Data). So the file is safe to mail to yourself, and
  restoring never signs you out or clears your keys.
- Restore is the most destructive thing in the app: pick a file (parsed
  and validated then, so the confirmation can name what's about to
  replace what), then confirm on the button, which arms red and disarms
  itself after 30s. It clears non-excluded keys first, so a restore is a
  true snapshot rather than a merge leaving orphans.
- Writes go through the normal sync-wrapped `setItem` (debounced: one
  push, not one per key), then `window.syncPushNow()` — a new tiny
  export in sync.js — flushes before the reload. Without that flush the
  reload races the pull, which would read the restore as "this device is
  behind" and hand the old copy straight back.
- "Copy to clipboard" exists because a standalone iOS home-screen PWA
  has no visible downloads folder and `<a download>` can dead-end there.

Verified in headless Chromium: 36 assertions covering worker
registration, precache contents, cross-origin requests staying
*uncached*, a genuine offline reload rendering the app, section
switching offline, the pills, export naming/contents/exclusions,
the "last backup" line persisting, arm-then-confirm, this device's key
surviving a restore, orphan keys being cleared, and four bad-input
cases. Plus a regression sweep: 17 sections × (light/dark ×
1400px/390px), zero console errors. Not yet tried on the real iPhone —
the install-to-home-screen path and the download fallback are the parts
most worth checking there.

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
- Sync (sync.js) — rebuilt a third time (2026-09-15), back to Supabase
  Auth, but email-only this time: no password field exists anywhere in
  the app, so the password-typo and password-reset failure modes from
  attempt #1 can't recur. Settings -> "Cross-device sync" just asks for
  an email; Supabase emails a 6-digit code (`{{ .Token }}` added to the
  Magic Link template — see SUPABASE.md step 3) and `verifyOtp()` takes
  it straight from what the user types, so there's no clickable link and
  no Site-URL/redirect setting to misconfigure either — that was attempt
  #1's other failure mode. `app_state` is now keyed by `user_id`
  (references `auth.users`, RLS restricted to `auth.uid() = user_id`),
  a real improvement over attempt #2's Sync-ID scheme, which had no
  per-user access control at all. Supabase project URL + anon key are
  now hardcoded constants at the top of sync.js (committed, not
  config.js) rather than typed into Settings per device — same fix as
  the Finnhub/TwelveData key issue above (a gitignored/per-device value
  silently never reaches the phone's GitHub Pages copy), and safe to
  commit since the anon key was never the actual access control, RLS is.
  Same localStorage.setItem monkey-patch + debounced push/pull
  underneath, careful this time to never sync or wipe the `sb-*`
  keys Supabase's own client uses to persist the session (attempt #2's
  pull-and-reload logic would otherwise sign every device back out on
  its first sync). Project URL + anon key are confirmed already in
  sync.js (not placeholders) — this note previously said that step was
  still pending; it wasn't, as of 2026-09-23. STILL NEEDS (can't be
  checked from the repo alone): confirm SUPABASE.md's SQL has actually
  been run, confirm `{{ .Token }}` is live in the Magic Link email
  template, and sign in with the same email on both real devices to see
  "Synced" on each — none of this is verifiable without Martin.
- Dead CSS cleanup — done (2026-09-23): deleted glance.js outright (its
  script tag and sw.js precache entry too) rather than repurposing it,
  since nothing pointed at a tab-contextual sidebar use for it; removed
  the orphaned `.brand-header`/`.brand-mark`/`.brand-icon`/`.brand-name`/
  `.settings-btn`(+svg/hover/on) and the old accent-color-picker's
  `.swatch*`/`.intensity*`/`#intensity-slider` selectors — none were
  referenced in index.html or any .js file. ~2.6KB removed, brace count
  balanced before/after, all JS still passes `node -c`. Also caught and
  fixed while in there: README.md still advertised the old Settings
  accent-color/tint picker (gone) and never mentioned Alfred, Blueprint,
  Recovery, Review, Mindset, Markets, Notes, offline, or Backup at all —
  rewritten to match what's actually in the sidebar today.
- This was the last of the explicitly-scoped structural passes — the
  brief that drove Steps 1-4 said so. What's left is Martin's own content
  to fill in (real per-section detail beyond the scaffolding), not more
  layout/typography/box rebuilding, unless he asks for another pass
- launchd/ was untracked and machine-specific (a local dev-server
  launcher with an absolute path baked in) — added to .gitignore
  (2026-09-23)
- Couldn't get a live browser onto the app this session (Chrome extension
  not connected; the Browser pane's sandbox can't reach a localhost
  server started from this shell — same issue noted earlier in this
  file). Verified statically instead: all JS passes `node -c`, HTML tags
  balance, Food lookup's key-resolution and USDA endpoint check out by
  reading the code, and backup.js's export/restore round-trip (including
  the sb-*/*-api-key exclusions and the pre-reload sync push) reads
  correctly. None of this substitutes for Martin actually clicking
  through it on a real device — see Next steps below.
- projects/calibrate.md in the vault was still the blank template with
  every field empty — filled in with actual current state, next actions
  and open questions (2026-09-23), per the vault's own operating
  protocol which asks for that at the end of every session
- This file is 600+ lines against its own ~100-line budget ("Keep
  CLAUDE.md under ~100 lines... not a changelog" — see Rules below).
  Worth an actual pruning pass; not done this session since it means
  deciding what history is safe to cut, which felt like Martin's call
- Second dead-CSS pass (2026-09-23, later same day): wrote a script to
  cross-check every CSS class/id against actual usage in the JS/HTML
  instead of eyeballing it. Removed 8 more confirmed-orphaned rules
  (~1.5KB): `.settings-note`, `.budget-headline`, `.estimator-row`, the
  whole pre-Fuel-merge water widget (`.water-widget`/`.water-headline`/
  `.water-total`/`.water-target-label`/`.water-bar-wrap`/`.water-bar` —
  superseded by `.fuel-water-total`/`.fuel-water-target`, kept
  `.water-actions` which is still live), `.overview-actions`, the old
  pre-OTP `.sync-id-row` auth UI (kept `.account-actions`, which
  replaced it), `.ov-dot.is-missed` (a day-dot state CSS supports but
  overview.js never applies), and `.is-list` (a Reading shelf list-view
  toggle that was styled but never wired to a button). False positives
  the script caught and did NOT remove: `seg-*`/`tint-*`/`spark-down`
  all get built from template literals (`` `seg-${i}` ``, `` `tint-${tint}` ``,
  `` `spark-${tone}` ``) — a plain grep misses those, worth remembering
  before trusting this kind of scan again.
- Bumped the cache-bust version — `?v=20260920-2` → `?v=20260923-1`
  across every script/link tag in index.html, and `CACHE_VERSION` to
  match in sw.js. This file's own Rules say the two must move together
  in the same commit as any shipped change, and neither the glance.js
  removal earlier today nor (looking back) some earlier sessions'
  style.css edits had bumped it — so devices with the PWA already
  installed could've kept serving stale cached files for an extra
  load or two via the stale-while-revalidate path. Not a data-loss
  bug, just a deploy-visibility one; fixed going forward.
- CORRECTION to the second dead-CSS pass above: `.is-list` and
  `.ov-dot.is-missed` were NOT dead — reading.js sets
  `` `read-shelf is-${readView}` `` and overview.js sets
  `` `ov-dot is-${d.state}` `` (state "missed"). Both restored in the
  design pass below. Lesson: grep for `is-${` before trusting a
  dead-class scan.
- Legibility + structure pass (2026-09-23, commit "Readable, card-based
  layout"): Martin said the grey was hard to see, there was too much
  small useless text, and sections looked unorganized. Changes, all in
  one layer at the END of style.css plus small HTML edits:
  * Tokens: --text-dim/--text-faint raised to >=4.5:1 contrast in both
    themes (old faint was ~3:1); new --card/--card-border; lighter
    --track and --surface-2 so bars/chips show on cards.
  * Every font-size under 13px lifted a notch (9px->10.5, 10->11.5,
    11->12, 12->13...).
  * Each section now opens with an `<h1 class="eyebrow page-title">`
    (hidden under 640px, where the phone header names the section).
  * Every content block (.dash-block/.fuel-block/.read-block/
    .markets-block/.session/.settings-block/.goal-group/#daily-view/
    #monthly-view/.nt-capture/.ov-tile) is a card; block headings are
    15px full-strength text, not 10px faint mono caps. Mindset and
    Alfred were regrouped into cards in index.html.
  * Hidden: #mini-overview (the repeated summary bar on every
    section), all .sync-note footers, "Personal OS" tag, flavour
    .section-hint text outside Settings; ✕ delete buttons only show on
    row hover on devices with a mouse.
  * Quote of the day: with no Gemini key it now shows a rotating
    public-domain classic (Marcus Aurelius/Seneca/Epictetus/Aristotle)
    instead of an error message styled as a quote. Not saved to the log.
  * Bat logo inverted on the light theme (it was white-on-white).
  Verified in headless Chromium (cloud side, fonts served locally) with
  seeded data: all 15 sections x desktop 1440 + phone 390, dark, plus
  light spot checks; no page errors. Still not seen on the real iPhone.

## Round 2: fewer sections, status colours, check-in, weight, Alfred logs (2026-09-23)

Martin: "do all that" on a list of design + content suggestions.
- Nav 15 -> 12. **Briefing** (`#briefing-section`) wraps News and Markets
  (both now `<div class="briefing-part">` keeping their old ids, so
  news.js/markets.js work unchanged; their "is it on screen" interval
  checks now look at `#briefing-section`). **Mindset folded into Notes**:
  notes.js `migrateMindset()` turns `journal-mindset` entries into notes
  tagged #mindset (ids `m<at>`), the Quotes list moved to a card in Notes.
  **Alfred left the sidebar** (still a section; reached via the Ask bar /
  phone center button; `group: null` in MNAV_SECTIONS keeps its header
  label). Old ids alias: news/markets -> briefing (markets scrolls to its
  part), mindset -> notes, in SECTION_ALIASES and MNAV_RENAMED.
- Status colours `--good` (green) / `--warn` (amber), status only:
  met tiles/ring/checkboxes/history cells/complete goals/good scorecard
  rows green; Overview tiles amber when behind pace for the time of day
  (`isBehindPace()` in overview.js, 07:00-22:00 day, <50% of even pace,
  nothing before 11:00) or over target; weak scorecard rows amber.
- Small text: every rule with IBM Plex Mono under 16px switched to
  Manrope + tabular-nums; mono stays for big numbers.
- Overview: stats row under the greeting hidden, replaced by the daily
  check-in button; right column reordered Goals -> Quote -> Briefing.
- Empty states have buttons (`.empty-action` / `.empty-btn`); the
  "Nothing logged yet" under journal inputs is hidden.
- Fuel: Target/Maintain pins removed from the calorie bar (full width =
  target; maintenance is a legend line). **Protein goal**:
  `food.proteinTarget` (null = 1.8 g/kg of latest weight, else 150),
  input in the hero stats, progress row under the bar. **Body weight**
  (weight.js, key `weight` = `{log: {date: kg}, times: {date: ms}}`):
  card in Fuel with input + 7-day-average trend chart; logging also sets
  `food.body.weight`.
- **Flexible habits**: `habit.perWeek` 1-7 (default 7). `habitSatisfied(h,
  date)` = ticked that day OR that Mon-Sun week's quota met — used for
  counts, perfect days, Overview, Review, phone More sheet. Weekly habits
  show "2/4 this week" (tap to cycle frequency) and a week streak;
  `currentStreak()` returns 0 for them so "best streak" stays in days.
  Ten-day strip has weekday initials above it.
- **Daily check-in** (checkin.js): sheet with sleep hours + quality +
  energy (writes via new `window.recoverySet/recoveryEntry`), weight,
  water, habits. Everything writes through; "Done" records the day in
  `checkin-log`, which Overview's button reads.
- **Alfred logs** (actions.js): `window.appActions.parseLocal()` handles
  plain commands with no API call/key ("drank 500ml", "weight 82.4",
  "slept 7.5h", "done meditate", "oats 450 kcal 20g protein", "trained",
  "note: ..."); anything else goes to Gemini in JSON mode returning
  `{reply, actions}`. Whitelisted, bounded, additive actions only (water,
  food, habit, weight, sleep, training, note, goal) — no deletes; unknown
  types are ignored. Applied actions show as green chips in the chat.
  `window.callGemini()` in alfred.js is now shared.
- **Alfred's take** on Review: Gemini summary stored on the week record
  (`reviews[key].ai`), auto-written for last week (and this week on
  Sundays) when a key exists, "Write it"/"Rewrite" button otherwise.
Verified in headless Chromium: 36 interaction checks (desktop + phone:
nav, aliases, local logging, check-in writes, habit frequency, protein
goal, Review no-key state, phone More sheet) plus a mocked-Gemini run
(actions applied, unknown action ignored, weekly summary written);
screenshots of every section; zero page errors. Not seen on a real
iPhone yet.

- Briefing tabs (2026-09-23, Martin didn't want to scroll past News to
  reach stocks): Markets | News segmented tabs, one part shown at a time,
  Markets first by default, last choice in localStorage `briefing-tab`
  (`setBriefingTab()` in script.js; the "markets"/"news" aliases pick
  their tab). news.js/markets.js refresh checks look at their own part
  with `closest("[hidden]")`. Habits' Daily/Monthly handlers are now
  scoped to `.tab-btn[data-view]` — the unscoped `.tab-btn` selector
  would have hijacked the new tab buttons.

- Habits month view rebuilt (2026-09-23, Martin's phone screenshot:
  Sunday column cut off, dots wrapping out of cells, mono legend of
  names that explained nothing, footer overlapping the last row). Cells
  now shade green by the share of habits done that day (solid = perfect
  day), tap a day to see done/missed habits, one row per habit with a
  count + bar below (beside the calendar on desktop). Counted from the
  first day anything was ever ticked, so a month started mid-way isn't
  scored against days before tracking began. Root cause of the overflow:
  `grid-template-columns: repeat(7, 1fr)` — 1fr has an auto minimum, so
  cell content widened the grid; now `minmax(0, 1fr)`.

## Rules

- No token/API key ever pasted into chat — config file only (violated once
  earlier this project; moved to config.js/.env immediately, not repeated
  back — Martin should judge whether any are worth rotating at their
  source)
- Update this file before ending any session
