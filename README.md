# BatCave — Prototype 1

A personal all-in-one app: habit tracking, news, a fitness plan, calorie counting, and goals.

Built as a web app so it's reachable from both iPhone and Mac through the browser.

## Status

**Prototype 1** — an early working version, not a finished product.

Built so far:

- **Overview** — the landing page: an "X/4 banked" ring for how many of the day's core habits/targets are done, plus what's logged today across every section
- **Habits** — streaks, a ten-day history strip, a monthly calendar, perfect-day tracking
- **Goals** — short- and long-term horizons on a swipeable rail, with targets and deadlines
- **Alfred** — an AI assistant (Gemini-backed) that reads today's real data across the app and answers questions about it in a blunt no-cushioning tone (read-only for now — it doesn't write back to the app yet)
- **Blueprint** — a weekly plan: a time-blocked schedule per weekday, a live now/next pill, and free-text notes
- **Fitness** — a weekly training split, per-day sessions, completion logged against today
- **Fuel** — food and water on one page: a daily calorie budget broken down by meal, a maintenance estimator, and a glass-by-glass water tracker
- **Recovery** — a daily sleep/energy/soreness check-in rolled into a 0–100 readiness score, with 14/30/90-day trends and computed signals (training streak, sleep debt, sleep→energy correlation)
- **Review** — a mostly self-writing weekly review: a week score, a scorecard vs. last week, a day-by-day heat grid, auto highlights, then three reflection questions
- **Reading** — a log of books read, in progress and wanted, with covers and details from Open Library, ratings, notes and AI key ideas; add one at a time or paste a whole list
- **Mindset** — a simple free-text journal (not yet given the structured treatment the other sections have)
- **News** — live headlines from BBC World, Tagesschau, ORF and iROZHLAS, each in its own language
- **Markets** — a live watchlist dashboard: heatmap, portfolio tracking, and price charts for stocks you search for
- **Notes** — a tagged inbox: multi-line capture, #tags, pin/archive/delete, and "send to" another section's log or straight into a habit
- **Settings** — cross-device sync, Alfred's API key, food- and stock-lookup keys, and export/restore backups
- **Offline-capable** — installs to your home screen and opens with no network, via a service worker

Data is stored in the browser on each device and synced across devices through Supabase once you sign in (Settings → Cross-device sync). A local backup/restore (Settings → Backup) covers you if that data is ever lost.
