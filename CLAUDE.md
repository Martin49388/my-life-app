# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1, live at https://martin49388.github.io/my-life-app/ (that copy
has no API keys — Alfred/food lookup show "no key configured" there,
intentional; the real experience is local with config.js). Martin needs to
`git push origin main` and wait for GitHub Pages to rebuild before this
session's commits show up there.

Just finished the "FINAL STRUCTURAL REBUILD" brief — all 4 ordered steps
done, each its own commit:

1. **Sidebar restructure + kill top tabs** — the old top tab bar and
   `.brand-header` (logo/gear icon) are gone. All navigation and branding
   now live in one place: `.sidebar` (pure nav — brand name/tag, grouped
   links, inline settings panel). Under 640px the sidebar becomes a
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
System (News/Markets/Notes/Settings). The 7 new ones (Blueprint, Review,
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

Overview additionally shows Food's protein next to kcal, and a
'Logged today' feed merging every timestamped entry from every
journal-backed section (Blueprint/Review/Recovery/Mindset/Reading/
Markets/Notes) plus Alfred check-ins, filtered to today.

Client-side API keys (config.js, gitignored) are a deliberate tradeoff —
no backend exists, personal non-public use case, accepted over adding a
proxy server.

## Next steps

- Confirm Food lookup actually works in the browser (Alfred is now
  confirmed working, see above) — check the browser console for the
  exact error if it fails
- Sync (sync.js) — DONE, differently than originally planned: instead of
  rewriting every module's localStorage calls, sync.js monkey-patches
  localStorage.setItem itself, so every write from any file mirrors
  (debounced) to one JSON blob per signed-in user in Supabase. Email/
  password auth via a new Account panel in Settings. Last-write-wins,
  no real conflict resolution — fine for one person on two devices.
  STILL NEEDS: Martin has to run the SQL (given to him separately) in
  his Supabase project's SQL editor to create the app_state table with
  RLS before sync actually persists anything — confirmed via a live
  'table not found' error that the client/keys/connection are all
  correct, just waiting on that one step. Also untested past that:
  actual sign-up/sign-in and a real two-device sync round-trip.
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
