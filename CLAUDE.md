# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1, mid-rebuild. Reachable from iPhone and Mac via browser. Data
is stored per-device in `localStorage`; no cross-device sync yet.

Design system: pure black/grey (no accent color, no shadows, no gradients).
Font stack: IBM Plex Mono + Manrope (unchanged, already matched the chosen
direction). The old 11-color accent/tint picker is gone.

Sections:
- Habits — streaks, ten-day history, monthly calendar (unchanged this pass)
- News — live headlines via RSS + rss2json, no API key needed, refresh
  actually re-fetches (unchanged, already worked)
- Goals — short/long-term horizon rail (unchanged this pass)
- Fitness — weekly plan + session logging. "This week" stat now shows real
  completions vs Martin's actual target (5x/week), not just how many
  template days have a plan
- Food — daily calorie budget, default target set to 3500 (Martin's real
  number). New: FoodData Central lookup — search a food name, pick a
  result, kcal/protein autofill
- Water — new: daily tally, 4L target (Martin's real number), +/-250ml,
  flat progress bar, lives at the top of the Food section

Client-side API keys (News doesn't need one; Food/Jarvis do) live in
`config.js` (gitignored, chmod 600) — `config.example.js` is the committed
template. This app has no backend, so keys are visible to anyone who reads
the shipped JS; that tradeoff was chosen deliberately over adding a proxy
server, since this is a personal, non-public app.

## Next steps

- Jarvis and the Food lookup (FoodData Central) are built but UNTESTED
  live — both make real API calls from the browser using config.js keys,
  but nothing in this dev environment could reach the internet to confirm
  they actually work end-to-end. First real test happens by opening the
  app in a browser and trying both; check the browser console for the
  exact error if either fails
- Goals-review: weekly/monthly reflection combining habit + goal data, not
  yet built
- Layout restructure: still symmetric/centered, cards stacked in a single
  column. Target is asymmetric — sticky-left key metrics, scrolling content
  on the right — not yet touched
- Dead CSS cleanup: swatch/intensity selectors from the removed color
  picker are still in style.css, unused but harmless
- Cross-device sync (Supabase mentioned as an option, not built)

## Rules

- No token/API key ever pasted into chat — config file only (this was
  violated once this session; keys were moved to config.js/.env
  immediately, not repeated back, but Martin should judge whether any of
  them are worth rotating at their source)
- Update this file before ending any session
