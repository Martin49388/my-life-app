# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1, live at https://martin49388.github.io/my-life-app/ (that copy
has no API keys — Jarvis/food lookup show "no key configured" there,
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
   restructure…") visible across every section, not just Jarvis.
   Submitting it switches to the Jarvis section and calls the same
   `handleJarvisQuestion()` the in-section form uses — one log, one code
   path, not a parallel Jarvis. `script.js`'s section-switch logic is now
   a named `switchSection()` on `window` so both the sidebar nav and this
   bar can call it.

Design system: pure black/grey, no shadows/gradients. Font stack unchanged
(IBM Plex Mono + Manrope).

Layout: no longer locked to a fixed 520px column. Under 640px it's a
single centered column with the sidebar as a horizontal nav strip. Above
640px, `.app` grows to 1100px and splits into the sidebar (pure nav, 220px)
plus a flexible content column for the active section.

Motion: tab switches fade/slide in (0.22s). Checking a habit pulses the
row before it re-renders. `budget-number` and the water total tween to
their new value instead of jumping (`animateNumber()` in script.js,
reusable, handles decimals). Everything respects `prefers-reduced-motion`.

Sections:
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
- Jarvis — Gemini-backed, blunt tone, reads real daily data, reachable
  either from its own section or the persistent bottom bar. Built but
  UNTESTED live (this dev environment has no path to generativelanguage.
  googleapis.com or api.nal.usda.gov to verify end-to-end — first real
  test has to happen in an actual browser)

Client-side API keys (config.js, gitignored) are a deliberate tradeoff —
no backend exists, personal non-public use case, accepted over adding a
proxy server.

## Next steps

- Confirm Jarvis and Food lookup actually work in the browser (untested,
  see above) — check the browser console for the exact error if either
  fails
- Sync/backend (Supabase or Firebase) — explicitly NOT done yet. This is
  a bigger, separate task: replace every localStorage call across script.js,
  goals.js, fitness.js, food.js, water.js with backend reads/writes, plus
  some lightweight device-agnostic login (passphrase/PIN is enough). Do
  this as its own pass, not bundled in with layout work
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
