# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1, mid-rebuild, live at https://martin49388.github.io/my-life-app/
(that copy has no API keys — Jarvis/food lookup show "no key configured"
there, which is intentional; the real experience is local with config.js).

Design system: pure black/grey, no shadows/gradients. Font stack unchanged
(IBM Plex Mono + Manrope).

Layout: no longer locked to a fixed 520px column. Under 640px it's the
original single centered column. Above 640px, .app grows to 1100px and
splits into a sticky ~300px "at a glance" sidebar (best streak, water,
food, this-week training, nearest goal — live, see glance.js) plus a
flexible content column for the active tab.

Hierarchy: each section header now has one primary number at 30px
(today's completion ring on Habits, "This week" on Fitness, "Active" on
Goals) with everything else in that header muted to 13px. Food's
budget-number (38px) was already right and is the reference pattern.

Motion: tab switches fade/slide in (0.22s). Checking a habit pulses the
row before it re-renders. budget-number and the water total tween to their
new value instead of jumping (animateNumber() in script.js, reusable,
handles decimals). Everything respects prefers-reduced-motion.

Sections:
- Habits — streaks, ten-day history, monthly calendar, now with a bigger
  completion ring as the tab's primary visual
- News — live RSS headlines, no API key needed
- Goals — short/long-term horizon rail
- Fitness — "This week" stat is real completions vs the actual 5x/week
  target, not just how many template days have a plan
- Food — 3500 kcal default target, FoodData Central lookup wired in
- Water — 4L target, daily tally, lives at the top of Food
- Jarvis — Gemini-backed, blunt tone, reads real daily data. Built but
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
  this as its own pass once the layout/motion work above is confirmed
  working, not bundled in
- Dead CSS cleanup: swatch/intensity selectors from the removed color
  picker are still in style.css, unused but harmless
- Sidebar currently shows the same "at a glance" tiles regardless of which
  tab is active — could become tab-contextual later, but wasn't asked for

## Rules

- No token/API key ever pasted into chat — config file only (violated once
  this session; moved to config.js/.env immediately, not repeated back —
  Martin should judge whether any are worth rotating at their source)
- Update this file before ending any session
