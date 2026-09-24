// Batcave reminder sender. Runs in GitHub Actions every 15 minutes
// (.github/workflows/reminders.yml); see REMINDERS.md.
//
// For every user with a push subscription it works out, in that user's
// own time zone, which reminders are due, checks whether each one is
// still worth sending (no check-in yet, calories not on target, week not
// reviewed, a goal behind pace), sends it to every device of that user,
// and records it as handled for the day so it never goes out twice.
//
// Env: PUSH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (GitHub secrets).
// Optional: TEST=true sends a test notification to every device;
// DRY_RUN=true decides but sends/records nothing.
// SUPABASE_URL / SUPABASE_ANON_KEY are read from sync.js (public by design).

import { readFileSync } from "node:fs";
import webpush from "web-push";

const env = process.env;
const TEST = env.TEST === "true";
const DRY_RUN = env.DRY_RUN === "true";

if (!env.PUSH_SECRET || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
  console.log("Reminders not configured (missing PUSH_SECRET / VAPID keys) — nothing to do.");
  process.exit(0);
}

const syncJs = readFileSync(new URL("../sync.js", import.meta.url), "utf8");
const SUPABASE_URL = env.SUPABASE_URL || syncJs.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || syncJs.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];

webpush.setVapidDetails("https://martin49388.github.io/my-life-app/", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_secret: env.PUSH_SECRET, ...args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const parse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------
// Time, in the user's zone

function localNow(tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday, // Mon, Tue, ...
  };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const monday = addDays(date, -((d.getUTCDay() + 6) % 7));
  const thursday = new Date(`${addDays(monday, 3)}T00:00:00Z`);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.round((thursday - firstMonday) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Same rules as the app (food.js kcalStatus, goals.js goalStatus)

const KCAL_BANDS = { bulk: [0.95, Infinity], maintain: [0.925, 1.075], cut: [0.9, 1] };
const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 };

function foodGoal(food) {
  if (KCAL_BANDS[food.goal]) return food.goal;
  const b = food.body || {};
  let maintain = food.maintenance || null;
  if (b.weight && b.height && b.age) {
    const base = 10 * b.weight + 6.25 * b.height - 5 * b.age;
    maintain = Math.round((b.sex === "female" ? base - 161 : base + 5) * (ACTIVITY[b.activity] || 1.55));
  }
  const target = food.target || 3500;
  if (maintain) return target > maintain + 100 ? "bulk" : target < maintain - 100 ? "cut" : "maintain";
  return target >= 3000 ? "bulk" : "maintain";
}

const goalDir = (g) => (g.target < (g.start ?? 0) ? -1 : 1);
const goalDone = (g) => (goalDir(g) > 0 ? g.current >= g.target : g.current <= g.target);

function goalSlipping(g, today) {
  if (goalDone(g) || !g.deadline) return null;
  if (g.deadline < today) return "overdue";
  if (!g.created) return null;
  const total = Date.parse(g.deadline) - Date.parse(g.created);
  if (total <= 0) return null;
  const frac = Math.max(0, Math.min(1, (Date.parse(today) - Date.parse(g.created)) / total));
  if (frac <= 0.05) return null;
  const expected = g.start + (g.target - g.start) * frac;
  const slack = Math.abs(g.target - g.start) * 0.03;
  const behind = goalDir(g) > 0 ? g.current + slack < expected : g.current - slack > expected;
  return behind ? "behind" : null;
}

function fmt(n) {
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(r) ? r.toLocaleString("en-US") : r.toFixed(1);
}

// ---------------------------------------------------------------------
// Each reminder: when it's allowed, and what it says (null = not needed)

const DEFAULT_PREFS = {
  checkin: { on: true, time: "08:00" },
  food: { on: true, time: "20:30" },
  review: { on: true, time: "19:00" },
  goals: { on: true, time: "09:00" },
};

const REMINDERS = {
  checkin: {
    day: null,
    build(u, today) {
      const log = parse(u.checkin, {});
      const recovery = parse(u.recovery, {});
      if (log[today] || recovery?.log?.[today]) return null;
      return { title: "Morning check-in", body: "Sleep, energy, weight, water — about a minute. Everything else in Batcave reads from it.", url: "./index.html#checkin" };
    },
  },
  food: {
    day: null,
    build(u, today) {
      const food = parse(u.food, null);
      if (!food) return null;
      const target = food.target || 3500;
      const entries = food.days?.[today] || [];
      const kcal = entries.reduce((s, e) => s + (Number(e.kcal) || 0), 0);
      const goal = foodGoal(food);
      const [lo, hi] = KCAL_BANDS[goal];
      if (kcal >= lo * target && kcal <= hi * target) return null;
      if (kcal > hi * target) return null; // over on a cut: a reminder won't help tonight
      if (!entries.length) return { title: "Nothing logged today", body: `Your ${fmt(target)} kcal target is still at zero. Log what you ate while you remember it.`, url: "./index.html#fuel" };
      const left = target - kcal;
      const body =
        goal === "bulk"
          ? `${fmt(kcal)} of ${fmt(target)} kcal so far — ${fmt(left)} to go. Time for a real meal or a shake.`
          : `${fmt(kcal)} of ${fmt(target)} kcal logged. Anything missing from today?`;
      return { title: "Fuel check", body, url: "./index.html#fuel" };
    },
  },
  review: {
    day: "Sun",
    build(u, today) {
      const reviews = parse(u.reviews, {});
      const r = reviews[isoWeekKey(today)];
      if (r && (r.rating || (r.wins || "").trim() || (r.drags || "").trim() || (r.focus || "").trim())) return null;
      return { title: "Weekly review", body: "Batcave has already scored your week. Add the three answers — what worked, what dragged, one thing to change.", url: "./index.html#review" };
    },
  },
  goals: {
    day: "Mon",
    build(u, today) {
      const goals = parse(u.goals, []);
      const slipping = (Array.isArray(goals) ? goals : []).map((g) => ({ g, s: goalSlipping(g, today) })).filter((x) => x.s);
      if (!slipping.length) return null;
      const names = slipping.slice(0, 2).map((x) => x.g.name).join(" and ");
      const more = slipping.length > 2 ? ` (+${slipping.length - 2} more)` : "";
      return { title: slipping.length === 1 ? "A goal is slipping" : "Goals are slipping", body: `${names}${more} ${slipping.length === 1 ? "is" : "are"} behind pace. Worth a block in this week's plan.`, url: "./index.html#goals" };
    },
  },
};

// How late a reminder may still go out (GitHub's scheduler can run late).
const LATE_WINDOW = 180;

async function sendTo(subs, payload) {
  let delivered = 0;
  for (const s of subs) {
    if (s.dropped) continue;
    if (DRY_RUN) {
      console.log(`  [dry run] would send to ${s.device || "device"}: ${payload.title}`);
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3 * 3600, urgency: "normal" });
      delivered++;
    } catch (err) {
      console.log(`  push failed (${err.statusCode || "?"}) for one device: ${String(err.body || err.message).slice(0, 120)}`);
      if (err.statusCode === 404 || err.statusCode === 410) {
        s.dropped = true;
        await rpc("push_drop", { p_endpoint: s.endpoint });
      }
    }
  }
  return delivered;
}

async function main() {
  const rows = await rpc("push_due", {});
  const byUser = new Map();
  for (const r of rows || []) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  console.log(`${rows?.length || 0} subscription(s), ${byUser.size} user(s).`);

  for (const [userId, subs] of byUser) {
    const u = subs[0];
    if (TEST) {
      const n = await sendTo(subs, { title: "Batcave", body: "Test from the reminder job — if you can read this, reminders work.", url: "./index.html#settings", tag: "test" });
      console.log(`Test sent to ${n}/${subs.length} device(s).`);
      continue;
    }
    const now = localNow(u.tz);
    const prefsSaved = parse(u.prefs, {});
    const sent = Object.assign({}, ...subs.map((s) => s.sent || {}));
    for (const [kind, rule] of Object.entries(REMINDERS)) {
      const pref = { ...DEFAULT_PREFS[kind], ...(prefsSaved[kind] || {}) };
      const at = toMinutes(pref.time);
      if (!pref.on || at == null) continue;
      if (rule.day && rule.day !== now.weekday) continue;
      if (now.minutes < at || now.minutes > at + LATE_WINDOW) continue;
      if (sent[kind] === now.date) continue;
      const msg = rule.build(u, now.date);
      if (msg) {
        const n = await sendTo(subs, { ...msg, tag: kind });
        console.log(`${kind}: sent to ${n}/${subs.length} device(s) (${u.tz} ${now.date}).`);
      } else {
        console.log(`${kind}: due but already done — skipped.`);
      }
      if (!DRY_RUN) await rpc("push_mark_sent", { p_user: userId, p_kind: kind, p_day: now.date });
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
