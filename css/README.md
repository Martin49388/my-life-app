# Styles

Batcave has no build step, so styles are plain files linked from
`index.html` **in numeric order**. Later files override earlier ones at
equal specificity, so the order is part of the design:

| Files | What |
|---|---|
| 01-14 | Base tokens and layout, then one file per area as first built (habits/fitness, fuel, markets, shared dashboard pieces, news, overview, phone shell, reading, recovery/review/notes, status pills) |
| 20-21 | Two app-wide passes that deliberately override the above: legibility/cards (2026-09-23) and Round 2 (status colours, check-in, weight...) |
| 22+ | Newer features, each self-contained: habits month view, goals, calorie goal, linked goals, Alfred's planner, reminders |

Rules of thumb:

- Change a section's look in that section's file. If a 20/21 layer
  already overrides the property, change it there instead (search both).
- New feature: new file with the next number, added to `index.html`
  **and** `sw.js`'s `SHELL` list, and bump the `?v=` / `CACHE_VERSION`.
- Colours only via the tokens in `01-base-layout.css` and the status
  tokens (`--good`, `--warn`) in `21-layer-round2.css`.

The split on 2026-09-24 moved no rule: the files concatenate to the old
`style.css` byte for byte (minus provably dead rules), verified by
comparing computed styles of every element in every section.
