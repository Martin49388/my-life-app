// Goals.
//
// A goal is a number moving toward a target, optionally by a deadline.
// Fields (the first seven are the original ones, still read elsewhere):
//   id, name, term ("short" | "long"), target, unit, current, deadline
//   created     "YYYY-MM-DD" the pace line starts from
//   start       value on `created` (pace runs start -> target). A goal
//               whose target is BELOW its start counts down (weight loss).
//   step        how much one tap of the stepper moves it
//   why         optional one-line reason, shown in the sheet
//   log         { "YYYY-MM-DD": value } one point per day, for the sparkline
//   completedAt "YYYY-MM-DD" set when it reaches target
//   source      null for a manual goal, or { type, id?, from } for a goal
//               that counts itself from the rest of the app (see
//               GOAL_SOURCES): books / pages from Reading, training days
//               from Fitness, days a habit was done, body weight from Fuel.
//   linkDismissed  true once Martin said no to a "link this?" suggestion
//
// Other files should ask goalIsDone(g) / goalPct(g) / goalStatus(g) rather
// than compare current to target themselves — a countdown goal is done
// when current <= target, not >=.

const GOALS_KEY = "goals";
const GOAL_LOG_CAP = 120;

function goalToday() {
  return typeof todayKey === "function" ? todayKey() : new Date().toISOString().slice(0, 10);
}

function roundGoalNum(n) {
  return Math.round(Number(n) * 100) / 100;
}

function readJsonKey(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------
// Direction and progress
// ---------------------------------------------------------------------

function goalDir(goal) {
  return goal.target < (goal.start ?? 0) ? -1 : 1;
}

function goalIsDone(goal) {
  return goalDir(goal) > 0 ? goal.current >= goal.target : goal.current <= goal.target;
}

// 0-100. Counting up reads as current / target (85 of 100 kg = 85%);
// counting down reads as distance covered from start (90 -> 86 of a
// 90 -> 82 kg goal = 50%).
function goalPct(goal) {
  if (goalIsDone(goal)) return 100;
  let frac;
  if (goalDir(goal) > 0) frac = goal.target > 0 ? goal.current / goal.target : 0;
  else frac = (goal.start - goal.current) / (goal.start - goal.target);
  return Math.max(0, Math.min(100, frac * 100));
}

function loadGoals() {
  const list = readJsonKey(GOALS_KEY, []);
  const today = goalToday();
  let migrated = false;
  const out = (Array.isArray(list) ? list : []).map((g) => {
    const goal = { term: "short", unit: "done", step: 1, why: "", source: null, ...g };
    if (!goal.created) {
      goal.created = today;
      migrated = true;
    }
    if (goal.start == null && !goal.source) {
      goal.start = goal.current || 0;
      migrated = true;
    }
    if (!goal.log || typeof goal.log !== "object") {
      goal.log = { [today]: goal.current || 0 };
      migrated = true;
    }
    if (goalIsDone(goal) && !goal.completedAt) {
      goal.completedAt = today;
      migrated = true;
    }
    return goal;
  });
  if (migrated) localStorage.setItem(GOALS_KEY, JSON.stringify(out));
  return out;
}

function saveGoals(list) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(list));
}

let goals = loadGoals();

function logGoalValue(goal) {
  goal.log = goal.log || {};
  goal.log[goalToday()] = goal.current;
  const keys = Object.keys(goal.log).sort();
  while (keys.length > GOAL_LOG_CAP) delete goal.log[keys.shift()];
}

function syncCompletion(goal) {
  if (goalIsDone(goal)) {
    if (!goal.completedAt) goal.completedAt = goalToday();
  } else {
    goal.completedAt = null;
  }
}

// ---------------------------------------------------------------------
// Linked goals: progress read from the rest of the app
// ---------------------------------------------------------------------

const GOAL_SOURCES = {
  books: { label: "Books finished", from: "Reading", section: "reading", unit: "books", counts: true, since: "year" },
  pages: { label: "Pages of finished books", from: "Reading", section: "reading", unit: "pages", counts: true, since: "year" },
  training: { label: "Training days", from: "Fitness", section: "fitness", unit: "sessions", counts: true, since: "today" },
  habit: { label: "Days done", from: "Habits", section: "habits", unit: "days", counts: true, since: "today" },
  weight: { label: "Body weight", from: "Fuel", section: "fuel", unit: "kg", counts: false, since: "today" },
};

// Where counting starts when nobody picked a date: Jan 1 for reading
// (yearly book goals are the norm), otherwise the day the goal was set.
function sourceDefaultFrom(type, goal) {
  if (GOAL_SOURCES[type]?.since === "year") return `${new Date().getFullYear()}-01-01`;
  const created = goal?.created;
  return created && created < goalToday() ? created : goalToday();
}

// "1 books" -> "1 book"
function unitFor(n, unit) {
  return Number(n) === 1 && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit;
}

// Finished "YYYY-MM" (or just "YYYY") on/after the "YYYY-MM-DD" from date.
function finishedSince(finished, from) {
  if (!finished) return false;
  if (finished.length >= 7) return finished.slice(0, 7) >= from.slice(0, 7);
  const year = finished.slice(0, 4);
  const fromYear = from.slice(0, 4);
  return year > fromYear || (year === fromYear && from.slice(5, 7) === "01");
}

function finishedBooksSince(from) {
  const books = readJsonKey("books", []);
  return (Array.isArray(books) ? books : []).filter((b) => b.status === "read" && finishedSince(b.finished || "", from));
}

function habitById(id) {
  return typeof habits !== "undefined" ? habits.find((h) => h.id === id) || null : null;
}

function weightLog() {
  const data = readJsonKey("weight", {});
  const log = data && typeof data.log === "object" ? data.log : {};
  return Object.entries(log)
    .filter(([, kg]) => Number(kg) > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

// Weight on `date`, else the last one before it, else the first one after.
function weightAt(date) {
  const log = weightLog();
  if (!log.length) return null;
  const before = log.filter(([d]) => d <= date);
  return Number((before.length ? before[before.length - 1] : log[0])[1]);
}

// What the source says right now: { value, start } or null if it can't
// say (no weight logged yet, habit deleted...).
function sourceValue(source) {
  if (!source || !GOAL_SOURCES[source.type]) return null;
  const from = source.from || goalToday();
  switch (source.type) {
    case "books":
      return { value: finishedBooksSince(from).length, start: 0 };
    case "pages":
      return { value: finishedBooksSince(from).reduce((sum, b) => sum + (Number(b.pages) || 0), 0), start: 0 };
    case "training": {
      const plan = readJsonKey("fitness", {});
      const log = plan && typeof plan.log === "object" ? plan.log : {};
      return { value: Object.keys(log).filter((d) => d >= from && (log[d] || []).length > 0).length, start: 0 };
    }
    case "habit": {
      const habit = habitById(source.id);
      if (!habit) return null;
      return { value: Object.keys(habit.history || {}).filter((d) => d >= from && habit.history[d]).length, start: 0 };
    }
    case "weight": {
      const log = weightLog();
      if (!log.length) return null;
      return { value: Number(log[log.length - 1][1]), start: weightAt(from) };
    }
    default:
      return null;
  }
}

function sourceLabel(source) {
  const s = GOAL_SOURCES[source?.type];
  if (!s) return "";
  if (source.type === "habit") {
    const habit = habitById(source.id);
    return habit ? `${habit.name} · Habits` : "Deleted habit";
  }
  return `${s.label} · ${s.from}`;
}

// Pull every linked goal up to date. Cheap (a few JSON.parse calls), so
// anything that shows goals calls it first. Only writes when a value
// actually moved.
function refreshLinkedGoals() {
  let changed = false;
  for (const goal of goals) {
    if (!goal.source) continue;
    const r = sourceValue(goal.source);
    if (!r) continue;
    const value = roundGoalNum(r.value);
    if (!GOAL_SOURCES[goal.source.type].counts && goal.start == null && r.start != null) {
      goal.start = roundGoalNum(r.start);
      changed = true;
    }
    if (value !== goal.current) {
      goal.current = value;
      logGoalValue(goal);
      syncCompletion(goal);
      changed = true;
    }
  }
  if (changed) saveGoals(goals);
  return changed;
}

// "Read 12 books" -> Reading, "Train 100 times" -> Fitness, a goal
// mentioning a habit's name -> that habit. Conservative on purpose:
// "Bench 100 kg" is kg but not body weight, so it stays manual.
function suggestSource(goal) {
  const name = String(goal.name || "").toLowerCase();
  const unit = String(goal.unit || "").toLowerCase();
  if (unit === "pages" || /\bpages?\b/.test(name)) return { type: "pages" };
  if (unit === "books" || /\b(read|reading|books?)\b/.test(name)) return { type: "books" };
  if (/(weigh|body ?weight|lose \d|lose weight|get down to|cut to|bulk to)/.test(name)) return { type: "weight" };
  if (/\b(train|training|trainings|workouts?|gym|sessions?)\b/.test(name) || /^(sessions|workouts|trainings)$/.test(unit)) return { type: "training" };
  if (typeof habits !== "undefined") {
    const habit = habits.find((h) => h.name && h.name.length >= 3 && name.includes(h.name.toLowerCase()));
    if (habit) return { type: "habit", id: habit.id };
  }
  return null;
}

// Attach a source to an existing goal and re-base its pace on it.
function linkGoal(goal, source) {
  const from = source.from || sourceDefaultFrom(source.type, goal);
  goal.source = { type: source.type, from, ...(source.id ? { id: source.id } : {}) };
  goal.created = from;
  const r = sourceValue(goal.source);
  if (GOAL_SOURCES[source.type].counts) goal.start = 0;
  // Weight: the starting point is whatever was logged when the goal
  // began. Nothing logged yet -> null, filled in by refreshLinkedGoals().
  else goal.start = r && r.start != null ? roundGoalNum(r.start) : null;
  if (r) goal.current = roundGoalNum(r.value);
  if (!goal.unit || goal.unit === "done") goal.unit = GOAL_SOURCES[source.type].unit;
  goal.step = goal.step || 1;
  logGoalValue(goal);
  syncCompletion(goal);
}

// ---------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------

function addGoal(name, term, target, unit, deadline, extra = {}) {
  const current = roundGoalNum(extra.current || 0);
  const goal = {
    id: crypto.randomUUID(),
    name,
    term,
    target: roundGoalNum(target),
    unit: unit || "done",
    current,
    deadline: deadline || null,
    created: goalToday(),
    start: current,
    step: extra.step > 0 ? roundGoalNum(extra.step) : 1,
    why: extra.why || "",
    log: {},
    completedAt: null,
    source: null,
  };
  if (extra.source) linkGoal(goal, extra.source);
  logGoalValue(goal);
  syncCompletion(goal);
  goals.push(goal);
  saveGoals(goals);
  window.renderGoals();
  return goal;
}

// Public entry point — actions.js (Alfred logging) calls it with raw value
// deltas like +3 or -0.5. Linked goals ignore it: their value comes from
// the source, and a manual nudge would be overwritten on the next render.
function adjustGoal(id, delta) {
  const goal = goals.find((g) => g.id === id);
  if (!goal || goal.source) return false;
  const wasDone = goalIsDone(goal);
  let next = goal.current + Number(delta || 0);
  if (goalDir(goal) > 0) next = Math.min(goal.target, next);
  else next = Math.max(goal.target, next);
  goal.current = roundGoalNum(Math.max(0, next));
  logGoalValue(goal);
  syncCompletion(goal);
  saveGoals(goals);
  if (!wasDone && goalIsDone(goal)) justCompleted.add(goal.id);
  window.renderGoals();
  return true;
}

function deleteGoal(id) {
  goals = goals.filter((g) => g.id !== id);
  saveGoals(goals);
  window.renderGoals();
}

// ---------------------------------------------------------------------
// Dates and pace
// ---------------------------------------------------------------------

function parseGoalDate(key) {
  return new Date(key + "T00:00:00");
}

function daysUntil(deadline) {
  const diff = parseGoalDate(deadline) - new Date(new Date().toDateString());
  return Math.round(diff / 86400000);
}

// Used by overview.js and reading.js too — keep the { text, overdue } shape.
function deadlineLabel(deadline) {
  const days = daysUntil(deadline);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { text: "due today", overdue: false };
  if (days === 1) return { text: "due tomorrow", overdue: false };
  if (days < 60) return { text: `${days}d left`, overdue: false };
  const months = Math.round(days / 30.4);
  return { text: `${months} mo left`, overdue: false };
}

function formatGoalDate(key) {
  const d = parseGoalDate(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

function fmtGoalNum(n) {
  const r = roundGoalNum(n);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(Math.abs(r) < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "");
}

// Where the goal should be today if progress were spread evenly from
// `created` to `deadline`. null when there's no deadline to pace against.
function goalExpected(goal) {
  if (!goal.deadline || !goal.created) return null;
  const start = parseGoalDate(goal.created);
  const end = parseGoalDate(goal.deadline);
  const total = end - start;
  if (total <= 0) return { value: goal.target, frac: 1 };
  const now = new Date(new Date().toDateString());
  const frac = Math.max(0, Math.min(1, (now - start) / total));
  return { value: goal.start + (goal.target - goal.start) * frac, frac };
}

// A plain yes/no goal ("Run 5 km under 25 min"): target 1, no unit.
function isBinaryGoal(goal) {
  return !goal.source && goal.target === 1 && (goal.start ?? 0) === 0 && (!goal.unit || goal.unit === "done");
}

// status: done | overdue | behind | on-track | open
function goalStatus(goal) {
  if (goalIsDone(goal)) return { status: "done", label: "Done" };
  if (!goal.deadline) return { status: "open", label: "No deadline" };
  if (daysUntil(goal.deadline) < 0) return { status: "overdue", label: "Overdue" };
  const exp = goalExpected(goal);
  const slack = Math.abs(goal.target - goal.start) * 0.03;
  if (exp && exp.frac > 0.05) {
    const behind = goalDir(goal) > 0 ? goal.current + slack < exp.value : goal.current - slack > exp.value;
    if (behind) return { status: "behind", label: "Behind" };
  }
  return { status: "on-track", label: "On track" };
}

// "need ~2.5 kg/week" — what it takes from here to land on time.
function goalNeedText(goal) {
  if (!goal.deadline || goalIsDone(goal) || isBinaryGoal(goal)) return "";
  const days = daysUntil(goal.deadline);
  const left = Math.abs(goal.target - goal.current);
  const verb = goalDir(goal) < 0 ? " down" : "";
  if (days < 0) return `${fmtGoalNum(left)} ${goal.unit}${verb} to go`;
  if (days <= 1) return `${fmtGoalNum(left)} ${goal.unit}${verb} today`;
  if (days < 14) return `~${fmtGoalNum(left / days)} ${goal.unit}/day${verb}`;
  if (days < 120) return `~${fmtGoalNum(left / (days / 7))} ${goal.unit}/week${verb}`;
  return `~${fmtGoalNum(left / (days / 30.4))} ${goal.unit}/month${verb}`;
}

// One-liner for Alfred's context.
function goalPaceText(goal) {
  const s = goalStatus(goal);
  const need = goalNeedText(goal);
  return `${s.label.toLowerCase()}${need ? `, needs ${need}` : ""}${goal.source ? ` (counts itself from ${sourceLabel(goal.source)})` : ""}`;
}

const STATUS_RANK = { overdue: 0, behind: 1, "on-track": 2, open: 3, done: 4 };

function sortActive(list) {
  return list.slice().sort((a, b) => {
    const r = STATUS_RANK[goalStatus(a).status] - STATUS_RANK[goalStatus(b).status];
    if (r) return r;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return goalPct(b) - goalPct(a);
  });
}

// Active goals, freshest values, worst first. What Overview, Review, the
// phone More sheet and Alfred should read.
function activeGoals() {
  refreshLinkedGoals();
  return sortActive(goals.filter((g) => !goalIsDone(g)));
}

Object.assign(window, {
  goalDir,
  goalIsDone,
  goalPct,
  goalStatus,
  goalNeedText,
  goalPaceText,
  refreshLinkedGoals,
  activeGoals,
  sourceLabel,
});

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function escGoal(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const justCompleted = new Set();
const lastPct = new Map(); // id -> pct shown last render, so bars tween

function goalValueHtml(goal) {
  if (isBinaryGoal(goal)) return `<span class="gl-val">${goalIsDone(goal) ? "Done" : "Not done yet"}</span>`;
  const sep = goalDir(goal) < 0 ? " → " : " / ";
  return `<span class="gl-val"><strong>${fmtGoalNum(goal.current)}</strong>${sep}${fmtGoalNum(goal.target)} ${escGoal(goal.unit)}</span>`;
}

function goalStepperHtml(goal) {
  if (goalIsDone(goal)) return "";
  const name = escGoal(goal.name);
  if (goal.source) {
    return `<span class="gl-auto" title="Counts itself from ${escGoal(sourceLabel(goal.source))}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Auto</span>`;
  }
  if (isBinaryGoal(goal)) {
    return `<span class="gl-step" role="group" aria-label="Update ${name}">
      <button type="button" class="gl-step-btn gl-step-plus gl-step-check" data-goal-step="${goal.id}" data-dir="1" aria-label="Mark ${name} done">✓</button>
    </span>`;
  }
  const step = goal.step || 1;
  const dir = goalDir(goal);
  const toward = dir > 0 ? "+" : "−";
  const away = dir > 0 ? "−" : "+";
  const awayDisabled = dir > 0 ? goal.current <= 0 : false;
  return `<span class="gl-step" role="group" aria-label="Update ${name}">
    <button type="button" class="gl-step-btn" data-goal-step="${goal.id}" data-dir="-1" aria-label="${away} ${fmtGoalNum(step)}" ${awayDisabled ? "disabled" : ""}>${away}</button>
    <button type="button" class="gl-step-btn gl-step-plus" data-goal-step="${goal.id}" data-dir="1" aria-label="${toward} ${fmtGoalNum(step)}">${toward}${step === 1 ? "" : fmtGoalNum(step)}</button>
  </span>`;
}

function goalRowHtml(goal) {
  const done = goalIsDone(goal);
  const s = justCompleted.has(goal.id) ? { status: "done", label: "Done" } : goalStatus(goal);
  const pct = goalPct(goal);
  const from = lastPct.has(goal.id) ? lastPct.get(goal.id) : pct;
  const exp = goalExpected(goal);
  let pace = null;
  if (exp && !done && exp.frac > 0) {
    const shadow = { ...goal, current: exp.value };
    pace = goalPct(shadow);
  }
  const due = goal.deadline && !done ? deadlineLabel(goal.deadline) : null;
  const need = goalNeedText(goal);

  const meta = [
    goalValueHtml(goal),
    due ? `<span class="${due.overdue ? "gl-meta-bad" : ""}" title="Due ${formatGoalDate(goal.deadline)}">${escGoal(due.text)}</span>` : "",
    need && !due?.overdue ? `<span>${escGoal(need)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `
  <li class="gl-row${justCompleted.has(goal.id) ? " is-just-done" : ""}" data-id="${goal.id}" data-status="${s.status}">
    <button type="button" class="gl-main" data-goal-open="${goal.id}" aria-label="Edit ${escGoal(goal.name)}">
      <span class="gl-line1">
        <span class="gl-name">${escGoal(goal.name)}</span>
        <span class="gl-pct">${Math.round(pct)}<small>%</small></span>
      </span>
      <span class="gl-bar" data-from="${from}" data-to="${pct}">
        <span class="gl-bar-fill" style="width:${from}%"></span>
        ${pace != null ? `<span class="gl-bar-pace" style="left:${pace}%" title="Where you'd be on an even pace today"></span>` : ""}
      </span>
      <span class="gl-meta">
        <span class="gl-chip" data-status="${s.status}">${s.label}</span>
        ${meta}
      </span>
    </button>
    ${goalStepperHtml(goal)}
  </li>`;
}

function doneRowHtml(goal) {
  return `
  <li class="gl-done-row">
    <button type="button" class="gl-done-main" data-goal-open="${goal.id}">
      <span class="gl-done-check" aria-hidden="true">✓</span>
      <span class="gl-done-name">${escGoal(goal.name)}</span>
      <span class="gl-done-meta">${fmtGoalNum(goal.target)} ${escGoal(goal.unit)}${goal.completedAt ? ` · ${formatGoalDate(goal.completedAt)}` : ""}</span>
    </button>
  </li>`;
}

function renderGoalGroup(term) {
  const list = document.getElementById(`goal-list-${term}`);
  const count = document.getElementById(`goal-count-${term}`);
  const active = sortActive(goals.filter((g) => g.term === term && (!goalIsDone(g) || justCompleted.has(g.id))));
  count.textContent = active.length || "";
  if (!active.length) {
    list.innerHTML = `<li class="gl-group-empty">
      <p>${term === "short" ? "Nothing for the next few weeks. What would make this month a win?" : "Nothing long-term yet. What do you want to be true a year from now?"}</p>
      <button type="button" class="empty-btn" data-goal-new="${term}">+ Add ${term === "short" ? "short" : "long"}-term goal</button>
    </li>`;
    return;
  }
  list.innerHTML = active.map(goalRowHtml).join("");
}

// "These goals could count themselves" — one row per suggestion.
function renderLinkSuggestions() {
  const box = document.getElementById("goals-link-suggest");
  if (!box) return;
  const rows = goals
    .filter((g) => !g.source && !g.linkDismissed && !goalIsDone(g))
    .map((g) => ({ goal: g, source: suggestSource(g) }))
    .filter((x) => x.source);
  box.hidden = rows.length === 0;
  if (!rows.length) return;
  box.innerHTML = `
    <div class="gl-suggest-head">
      <span class="gl-suggest-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <p><strong>${rows.length === 1 ? "This goal can" : "These goals can"} update ${rows.length === 1 ? "itself" : "themselves"}.</strong> No more tapping +: the number comes straight from what you already log.</p>
    </div>
    <ul class="gl-suggest-list">
      ${rows
        .map(({ goal, source }) => {
          const from = sourceDefaultFrom(source.type, goal);
          const r = sourceValue({ ...source, from });
          const preview = r ? `${sourceLabel(source)} says <strong>${fmtGoalNum(r.value)} ${escGoal(unitFor(r.value, GOAL_SOURCES[source.type].unit))}</strong>${GOAL_SOURCES[source.type].counts ? ` since ${formatGoalDate(from)}` : " now"}` : `Counts from ${escGoal(sourceLabel(source))}`;
          return `<li class="gl-suggest-row">
            <span class="gl-suggest-text"><span class="gl-suggest-name">${escGoal(goal.name)}</span><span class="gl-suggest-meta">${preview}</span></span>
            <span class="gl-suggest-actions">
              <button type="button" class="gl-ghost-btn" data-goal-dismiss="${goal.id}">Keep manual</button>
              <button type="button" class="read-primary-btn" data-goal-link="${goal.id}" data-source="${source.type}" data-source-id="${source.id || ""}">Link</button>
            </span>
          </li>`;
        })
        .join("")}
    </ul>`;
}

function renderGoalHeader(active, completed) {
  document.getElementById("goals-active-count").textContent = active.length;
  const year = String(new Date().getFullYear());
  const doneThisYear = completed.filter((g) => (g.completedAt || "").startsWith(year)).length;
  document.getElementById("goals-hero-caption").textContent =
    `${active.length === 1 ? "goal" : "goals"} in motion` + (doneThisYear ? ` · ${doneThisYear} completed in ${year}` : "");

  const counts = { "on-track": 0, behind: 0, overdue: 0, open: 0 };
  for (const g of active) counts[goalStatus(g).status]++;
  const stats = [
    ["on-track", "On track", counts["on-track"]],
    ["behind", "Behind", counts.behind],
    ["overdue", "Overdue", counts.overdue],
    ["done", "Completed", completed.length],
  ];
  document.getElementById("goals-stats").innerHTML = stats
    .map(
      ([key, label, n]) => `<div class="read-stat gl-stat" data-status="${key}" data-zero="${n === 0}">
        <span class="stat-label"><i class="gl-stat-dot" aria-hidden="true"></i>${label}</span>
        <span class="read-stat-value">${n}</span>
      </div>`
    )
    .join("");

  // Focus callout: the one goal that most needs a look.
  const focus = sortActive(active)[0];
  const box = document.getElementById("goals-focus");
  if (!focus) {
    box.hidden = true;
    return;
  }
  const s = goalStatus(focus);
  const title = { overdue: "Overdue", behind: "Falling behind", "on-track": "Next deadline", open: "Up next" }[s.status];
  const due = focus.deadline ? deadlineLabel(focus.deadline) : null;
  const need = goalNeedText(focus);
  box.hidden = false;
  box.dataset.status = s.status;
  box.dataset.goalOpen = focus.id;
  box.innerHTML = `
    <span class="stat-label">${title}</span>
    <span class="gl-focus-name">${escGoal(focus.name)}</span>
    <span class="gl-focus-bar"><span style="width:${goalPct(focus)}%"></span></span>
    <span class="gl-focus-meta">${[due ? `${due.text} · ${formatGoalDate(focus.deadline)}` : `${Math.round(goalPct(focus))}% there`, isBinaryGoal(focus) ? "not done yet" : need]
      .filter(Boolean)
      .map(escGoal)
      .join(" · ")}</span>`;
}

window.renderGoals = function renderGoals() {
  refreshLinkedGoals();
  const active = goals.filter((g) => !goalIsDone(g));
  const completed = goals
    .filter((g) => goalIsDone(g) && !justCompleted.has(g.id))
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));

  renderGoalHeader(active, completed);

  const hasAny = goals.length > 0;
  document.getElementById("goals-empty").hidden = hasAny;
  document.getElementById("goals-groups").hidden = !hasAny;
  document.querySelector(".goals-header .gl-hero").hidden = !hasAny;
  document.getElementById("goals-stats").hidden = !hasAny;

  renderLinkSuggestions();
  renderGoalGroup("short");
  renderGoalGroup("long");

  const doneBlock = document.getElementById("goals-done-block");
  doneBlock.hidden = completed.length === 0;
  document.getElementById("goals-done-count").textContent = completed.length;
  document.getElementById("goal-list-done").innerHTML = completed.map(doneRowHtml).join("");

  // Tween bars from where they were to where they are now.
  const section = document.getElementById("goals-section");
  const bars = section.querySelectorAll(".gl-bar[data-to]");
  requestAnimationFrame(() => {
    bars.forEach((bar) => {
      bar.querySelector(".gl-bar-fill").style.width = `${bar.dataset.to}%`;
    });
  });
  lastPct.clear();
  for (const g of goals) lastPct.set(g.id, goalPct(g));

  // A goal that just hit its target stays in place, green, for a moment
  // before moving down to Completed.
  if (justCompleted.size) {
    clearTimeout(window.__goalDoneTimer);
    window.__goalDoneTimer = setTimeout(() => {
      justCompleted.clear();
      window.renderGoals();
    }, 1600);
  }

  if (window.renderOverview) window.renderOverview();
};

// ---------------------------------------------------------------------
// Sheet: create + edit
// ---------------------------------------------------------------------

const goalOverlay = document.getElementById("goal-sheet-overlay");
const goalForm = document.getElementById("goal-sheet");
let editingGoalId = null;
let deleteArmed = false;

function isoPlus({ days = 0, months = 0 }) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return typeof dateKey === "function" ? dateKey(d) : d.toISOString().slice(0, 10);
}

const DEADLINE_CHIPS = [
  ["1 month", () => isoPlus({ months: 1 })],
  ["3 months", () => isoPlus({ months: 3 })],
  ["End of year", () => `${new Date().getFullYear()}-12-31`],
  ["1 year", () => isoPlus({ months: 12 })],
  ["None", () => ""],
];

const FROM_CHIPS = [
  ["Jan 1", () => `${new Date().getFullYear()}-01-01`],
  ["Today", () => goalToday()],
];

function field(name) {
  return goalForm.elements[name];
}

function setTerm(term) {
  goalForm.querySelectorAll("[data-term-opt]").forEach((b) => {
    const on = b.dataset.termOpt === term;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-checked", on);
  });
  goalForm.dataset.term = term;
}

function markChips(rowId, chips, value) {
  document.querySelectorAll(`#${rowId} [data-chip]`).forEach((chip, i) => {
    chip.classList.toggle("is-active", chips[i][1]() === value);
  });
}

// "manual" | "books" | "habit:<id>" ... -> { type, id } | null
function parseSourceValue(v) {
  if (!v || v === "manual") return null;
  const [type, id] = v.split(":");
  return GOAL_SOURCES[type] ? { type, ...(id ? { id } : {}) } : null;
}

function sourceOptionValue(source) {
  if (!source) return "manual";
  return source.type === "habit" ? `habit:${source.id}` : source.type;
}

function fillSourceOptions() {
  const sel = field("source");
  const current = sel.value;
  const habitOpts = typeof habits !== "undefined" ? habits.map((h) => `<option value="habit:${h.id}">Habit: ${escGoal(h.name)}</option>`).join("") : "";
  sel.innerHTML = `
    <option value="manual">Manual — I tap + myself</option>
    <optgroup label="Counts itself">
      <option value="books">Books finished · Reading</option>
      <option value="pages">Pages of finished books · Reading</option>
      <option value="training">Training days · Fitness</option>
      <option value="weight">Body weight · Fuel</option>
      ${habitOpts}
    </optgroup>`;
  sel.value = current && [...sel.options].some((o) => o.value === current) ? current : "manual";
}

// Show/hide the manual-only and linked-only fields, and preview what the
// source says right now.
function syncSourceFields() {
  const source = parseSourceValue(field("source").value);
  const def = source ? GOAL_SOURCES[source.type] : null;
  document.getElementById("goal-manual-fields").hidden = Boolean(source);
  document.getElementById("goal-from-field").hidden = !def || !def.counts;
  const preview = document.getElementById("goal-source-preview");
  if (!source) {
    preview.hidden = true;
    return;
  }
  const editing = editingGoalId ? goals.find((g) => g.id === editingGoalId) : null;
  if (!field("from").value) field("from").value = sourceDefaultFrom(source.type, editing);
  markChips("goal-from-chips", FROM_CHIPS, field("from").value);
  const unitInput = field("unit");
  if (!unitInput.value || unitInput.dataset.auto === "1") {
    unitInput.value = def.unit;
    unitInput.dataset.auto = "1";
  }
  const r = sourceValue({ ...source, from: field("from").value || sourceDefaultFrom(source.type, editing) });
  preview.hidden = false;
  if (!r) {
    preview.textContent = source.type === "weight" ? "No weight logged yet — log one in Fuel and this fills in." : "Nothing to count yet.";
    return;
  }
  preview.innerHTML = def.counts
    ? `Right now: <strong>${fmtGoalNum(r.value)} ${escGoal(unitFor(r.value, def.unit))}</strong> since ${formatGoalDate(field("from").value)}. It keeps counting as you log.`
    : `Right now: <strong>${fmtGoalNum(r.value)} kg</strong>${r.start != null ? `, ${fmtGoalNum(r.start)} kg when it starts` : ""}. Set a lower target to count down.`;
}

function sparklineSvg(goal) {
  const pts = Object.entries(goal.log || {}).sort(([a], [b]) => a.localeCompare(b));
  if (pts.length < 2) return "";
  const t0 = parseGoalDate(pts[0][0]).getTime();
  const t1 = parseGoalDate(pts[pts.length - 1][0]).getTime();
  const W = 300;
  const H = 56;
  const x = (k) => (t1 === t0 ? W : ((parseGoalDate(k).getTime() - t0) / (t1 - t0)) * W);
  // Scale between the start/lowest point and the target, so 75 -> 85 of
  // 100 kg reads as real movement instead of a flat line near the top.
  const vals = pts.map(([, v]) => v);
  const lo = Math.min(goal.start ?? 0, goal.target, ...vals);
  const hi = Math.max(goal.start ?? 0, goal.target, ...vals);
  const span = hi - lo || 1;
  const y = (v) => H - 4 - ((v - lo) / span) * (H - 8);
  const d = pts.map(([k, v], i) => `${i ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [lk, lv] = pts[pts.length - 1];
  return `<svg class="gl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${y(goal.target).toFixed(1)}" y2="${y(goal.target).toFixed(1)}" class="gl-spark-target"/>
    <path d="${d}" class="gl-spark-line" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(lk)}" cy="${y(lv)}" r="3" class="gl-spark-dot"/>
  </svg>`;
}

function renderSheetExtras(goal) {
  const box = document.getElementById("goal-sheet-history");
  const actions = document.getElementById("goal-sheet-edit-actions");
  if (!goal) {
    box.hidden = true;
    actions.hidden = true;
    return;
  }
  actions.hidden = false;
  const keys = Object.keys(goal.log || {}).sort();
  const last = keys[keys.length - 1];
  const ago = last ? Math.max(0, -daysUntil(last)) : null;
  const s = goalStatus(goal);
  box.hidden = false;
  box.innerHTML = `
    <div class="gl-hist-head">
      <span class="gl-chip" data-status="${s.status}">${s.label}</span>
      <span>Started ${formatGoalDate(goal.created)} at ${fmtGoalNum(goal.start)}${ago != null ? ` · updated ${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago}d ago`}` : ""}</span>
    </div>
    ${sparklineSvg(goal) || `<p class="gl-hist-empty">The progress line fills in as it changes on different days.</p>`}`;
  const complete = document.getElementById("goal-sheet-complete");
  complete.hidden = Boolean(goal.source);
  complete.textContent = goalIsDone(goal) ? "Reopen" : "Mark complete";
}

function openGoalSheet(id, preset = {}) {
  const goal = id ? goals.find((g) => g.id === id) : null;
  editingGoalId = goal ? goal.id : null;
  deleteArmed = false;
  const del = document.getElementById("goal-sheet-delete");
  del.textContent = "Delete";
  del.classList.remove("is-armed");

  document.getElementById("goal-sheet-title").textContent = goal ? "Edit goal" : "New goal";
  document.getElementById("goal-sheet-submit").textContent = goal ? "Save" : "Add goal";
  field("name").value = goal ? goal.name : preset.name || "";
  field("target").value = goal ? goal.target : preset.target || "";
  field("unit").value = goal ? (goal.unit === "done" ? "" : goal.unit) : preset.unit || "";
  field("unit").dataset.auto = "";
  field("current").value = goal ? goal.current : "";
  field("step").value = goal ? goal.step || 1 : "";
  field("deadline").value = goal ? goal.deadline || "" : preset.deadline || "";
  field("why").value = goal ? goal.why || "" : "";
  document.getElementById("goal-current-label").textContent = goal ? "Current" : "Starting at";
  setTerm(goal ? goal.term : preset.term || "short");

  fillSourceOptions();
  const source = goal ? goal.source : preset.source || (preset.name ? suggestSource(preset) : null);
  field("source").value = sourceOptionValue(source);
  field("source").dataset.touched = goal ? "1" : "";
  field("from").value = goal?.source?.from || "";
  syncSourceFields();
  markChips("goal-deadline-chips", DEADLINE_CHIPS, field("deadline").value);
  renderSheetExtras(goal);

  goalOverlay.hidden = false;
  document.body.classList.add("goal-sheet-open");
  goalForm.scrollTop = 0;
  if (!goal && !(window.matchMedia && window.matchMedia("(hover: none)").matches)) field("name").focus();
}

function closeGoalSheet() {
  goalOverlay.hidden = true;
  editingGoalId = null;
  document.body.classList.remove("goal-sheet-open");
}

// Chip rows
function buildChipRow(rowId, chips, fieldName, after) {
  const row = document.getElementById(rowId);
  row.innerHTML = chips.map(([label], i) => `<button type="button" class="gl-chip-btn" data-chip="${i}">${label}</button>`).join("");
  row.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    field(fieldName).value = chips[Number(chip.dataset.chip)][1]();
    markChips(rowId, chips, field(fieldName).value);
    if (after) after();
  });
  field(fieldName).addEventListener("input", () => {
    markChips(rowId, chips, field(fieldName).value);
    if (after) after();
  });
}
buildChipRow("goal-deadline-chips", DEADLINE_CHIPS, "deadline");
buildChipRow("goal-from-chips", FROM_CHIPS, "from", syncSourceFields);

goalForm.querySelectorAll("[data-term-opt]").forEach((b) => b.addEventListener("click", () => setTerm(b.dataset.termOpt)));

field("source").addEventListener("change", () => {
  field("source").dataset.touched = "1";
  field("from").value = "";
  syncSourceFields();
});

// While typing a new goal's name, pre-pick the source it sounds like —
// until Martin picks one himself.
field("name").addEventListener("input", () => {
  if (editingGoalId || field("source").dataset.touched === "1") return;
  const guess = suggestSource({ name: field("name").value, unit: field("unit").value });
  const next = sourceOptionValue(guess);
  if (field("source").value !== next) {
    field("source").value = next;
    field("from").value = "";
    if (!guess && field("unit").dataset.auto === "1") {
      field("unit").value = "";
      field("unit").dataset.auto = "";
    }
    syncSourceFields();
  }
});
field("unit").addEventListener("input", () => {
  field("unit").dataset.auto = "";
});

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = field("name").value.trim();
  const target = parseFloat(field("target").value);
  if (!name || !(target > 0)) {
    (!name ? field("name") : field("target")).focus();
    return;
  }
  const source = parseSourceValue(field("source").value);
  if (source) source.from = GOAL_SOURCES[source.type].counts ? field("from").value || sourceDefaultFrom(source.type) : editingGoalId ? goals.find((g) => g.id === editingGoalId)?.source?.from || goalToday() : goalToday();
  const unit = field("unit").value.trim() || (source ? GOAL_SOURCES[source.type].unit : "done");
  const currentRaw = field("current").value;
  const current = currentRaw === "" ? null : Math.max(0, parseFloat(currentRaw));
  const step = parseFloat(field("step").value) > 0 ? roundGoalNum(parseFloat(field("step").value)) : 1;
  const deadline = field("deadline").value || null;
  const why = field("why").value.trim();
  const term = goalForm.dataset.term || "short";

  if (editingGoalId) {
    const goal = goals.find((g) => g.id === editingGoalId);
    const wasDone = goalIsDone(goal);
    const sourceChanged = sourceOptionValue(goal.source) !== sourceOptionValue(source) || (source && goal.source && source.from !== goal.source.from);
    Object.assign(goal, { name, term, target: roundGoalNum(target), unit, step, deadline, why });
    if (source) {
      if (sourceChanged) linkGoal(goal, source);
    } else {
      if (goal.source) {
        goal.source = null;
        goal.linkDismissed = true;
      }
      if (current != null && roundGoalNum(current) !== goal.current) {
        goal.current = roundGoalNum(current);
        logGoalValue(goal);
      }
    }
    syncCompletion(goal);
    if (!wasDone && goalIsDone(goal)) justCompleted.add(goal.id);
    saveGoals(goals);
    window.renderGoals();
  } else {
    addGoal(name, term, target, unit, deadline, { current: current || 0, step, why, source });
  }
  closeGoalSheet();
});

document.getElementById("goal-sheet-delete").addEventListener("click", (e) => {
  if (!editingGoalId) return;
  if (!deleteArmed) {
    deleteArmed = true;
    e.currentTarget.textContent = "Tap again to delete";
    e.currentTarget.classList.add("is-armed");
    return;
  }
  const id = editingGoalId;
  closeGoalSheet();
  deleteGoal(id);
});

document.getElementById("goal-sheet-complete").addEventListener("click", () => {
  const goal = goals.find((g) => g.id === editingGoalId);
  if (!goal) return;
  const id = goal.id;
  closeGoalSheet();
  if (goalIsDone(goal)) {
    // Reopen: step back one notch so it lands in the active list again.
    adjustGoal(id, -goalDir(goal) * (goal.step || 1));
  } else {
    adjustGoal(id, goal.target - goal.current);
  }
});

document.getElementById("goal-sheet-close").addEventListener("click", closeGoalSheet);
goalOverlay.addEventListener("click", (e) => {
  if (e.target === goalOverlay) closeGoalSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !goalOverlay.hidden) closeGoalSheet();
});

// ---------------------------------------------------------------------
// Section-level clicks (one delegated listener)
// ---------------------------------------------------------------------

document.getElementById("goals-section").addEventListener("click", (e) => {
  const step = e.target.closest("[data-goal-step]");
  if (step) {
    const goal = goals.find((g) => g.id === step.dataset.goalStep);
    if (goal) adjustGoal(goal.id, Number(step.dataset.dir) * goalDir(goal) * (goal.step || 1));
    return;
  }
  const link = e.target.closest("[data-goal-link]");
  if (link) {
    const goal = goals.find((g) => g.id === link.dataset.goalLink);
    if (goal) {
      linkGoal(goal, { type: link.dataset.source, ...(link.dataset.sourceId ? { id: link.dataset.sourceId } : {}) });
      saveGoals(goals);
      window.renderGoals();
    }
    return;
  }
  const dismiss = e.target.closest("[data-goal-dismiss]");
  if (dismiss) {
    const goal = goals.find((g) => g.id === dismiss.dataset.goalDismiss);
    if (goal) {
      goal.linkDismissed = true;
      saveGoals(goals);
      window.renderGoals();
    }
    return;
  }
  const open = e.target.closest("[data-goal-open]");
  if (open) {
    openGoalSheet(open.dataset.goalOpen);
    return;
  }
  const add = e.target.closest("[data-goal-new]");
  if (add) {
    openGoalSheet(null, { term: add.dataset.goalNew || "short" });
    return;
  }
  const idea = e.target.closest("[data-goal-idea]");
  if (idea) {
    const [name, target, unit, term, months] = idea.dataset.goalIdea.split("|");
    openGoalSheet(null, { name, target, unit, term, deadline: months ? isoPlus({ months: Number(months) }) : "" });
    return;
  }
  const toggle = e.target.closest("#goals-done-toggle");
  if (toggle) {
    const list = document.getElementById("goal-list-done");
    list.hidden = !list.hidden;
    toggle.setAttribute("aria-expanded", String(!list.hidden));
  }
});

document.getElementById("goals-focus").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openGoalSheet(e.currentTarget.dataset.goalOpen);
  }
});

window.openGoalSheet = openGoalSheet;
window.renderGoals();
