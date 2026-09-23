# BatCave — Prototype 1

A personal all-in-one app: habit tracking, news, a fitness plan, calorie counting, and goals.

Built as a web app so it's reachable from both iPhone and Mac through the browser.

## Status

**Prototype 1** — an early working version, not a finished product.

Built so far:

- **Overview** — the landing page: a daily check-in button, four tiles for today's habits, water, food and training (green when done, amber when behind), today's plan, and goals
- **Daily check-in** — one sheet for sleep, how you slept, energy, weight, water and today's habits, about a minute each morning
- **Habits** — daily or N-times-a-week habits, streaks, a ten-day history with day labels, a monthly calendar
- **Goals** — short- and long-term horizons with targets and deadlines
- **Blueprint** — a time-blocked week plan with a live now/next pill
- **Review** — a mostly self-writing weekly review with a score, scorecard, day grid, and Alfred's written summary of the week
- **Fitness** — a weekly training split, per-day sessions, completion logged against today
- **Fuel** — calories left for the day, a protein goal, water, a body-weight trend, meals and a maintenance estimator
- **Recovery** — a sleep/energy/soreness check-in rolled into a 0–100 readiness score with trends
- **Reading** — a log of books read, in progress and wanted, with covers, ratings, notes and AI key ideas
- **Notes** — a tagged inbox (including #mindset notes) plus the quote-of-the-day archive
- **Briefing** — News (BBC World, Tagesschau, ORF, iROZHLAS) and a Markets watchlist on one page
- **Alfred** — reached from the Ask bar: answers questions about your data and logs things for you ("drank 500ml", "weight 82.4", "done meditate", "oats 450 kcal 20g protein" — these work even without an AI key)
- **Settings** — cross-device sync, API keys, and export/restore backups
- **Offline-capable** — installs to your home screen and opens with no network

Data is stored in the browser on each device and synced across devices through Supabase once you sign in (Settings → Cross-device sync). A local backup/restore (Settings → Backup) covers you if that data is ever lost.
