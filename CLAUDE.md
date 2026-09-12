# CLAUDE.md — my-life-app (Batcave)

## Current state

Prototype 1 — an early working web app, not a finished product. Reachable
from both iPhone and Mac through the browser. Data is stored per-device in
the browser; no cross-device sync yet.

Built so far (per README.md):
- Habits — streaks, ten-day history strip, monthly calendar, perfect-day tracking
- News — live headlines from BBC World, Tagesschau, ORF, iROZHLAS
- Goals — short/long-term horizons on a swipeable rail, targets and deadlines
- Fitness — weekly training split, per-day sessions, completion logged
- Food — daily calorie budget by meal, with a maintenance estimator
- Settings — accent colour, background tint, tint intensity

Files: index.html, script.js, style.css, plus per-feature JS modules
(fitness.js, food.js, goals.js, news.js, settings.js), manifest.json and
icons for PWA install.

Repo: github.com/Martin49388/my-life-app

## Next steps

- Define tracked goals/domains more concretely (not yet done)
- Redesign UI away from default AI styling
- Cross-device sync (Supabase mentioned as an option, not built)

## Rules

- No token/API key ever pasted into chat — config file only
- Update this file before ending any session
