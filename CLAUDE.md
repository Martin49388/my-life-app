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
  its first sync). STILL NEEDS: Martin has to (1) create/reuse a
  Supabase project and paste its URL + anon key into sync.js, (2) run
  SUPABASE.md's SQL, (3) add `{{ .Token }}` to the Magic Link email
  template, (4) commit + push + wait for Pages to rebuild, (5) sign in
  with the same email on both real devices — untested past confirming
  the code loads without errors.
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
