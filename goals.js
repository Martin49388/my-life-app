// Goals (rebuilt 2026-09-24).
//
// A goal is a number moving toward a target, optionally by a deadline.
// On top of the original fields (id, name, term, target, unit, current,
// deadline — still read as-is by overview.js, alfred.js, actions.js,
// reading.js and mobile-nav.js) each goal now also carries:
//   created     "YYYY-MM-DD" the pace line starts from
//   start       value on `created` (pace runs start -> target)
//   step        how much one tap of + / − moves it
//   why         optional one-line reason, shown in the sheet
//   log         { "YYYY-MM-DD": value } one point per day, for the sparkline
//   completedAt "YYYY-MM-DD" set when it reaches target
// Goals saved before this rebuild are migrated on load: their pace starts
// today from wherever they are now, which is honest — there's no history
// to say otherwise.

const GOALS_KEY = "goals";
const GOAL_LOG_CAP = 120;

function goalToday() {
  return typeof todayKey === "function" ? todayKey() : new Date().toISOString().slice(0, 10);
}

function roundGoalNum(n) {
  return Math.round(Number(n) * 100) / 100;
}

function loadGoals() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(GOALS_KEY) || "[]");
  } catch {
    list = [];
  }
  const today = goalToday();
  let migrated = false;
  const out = list.map((g) => {
    const goal = { term: "short", unit: "done", step: 1, why: "", ...g };
    if (!goal.created) {
      goal.created = today;
      migrated = true;
    }
    if (goal.start == null) {
      goal.start = goal.current || 0;
      migrated = true;
    }
    if (!goal.log || typeof goal.log !== "object") {
      goal.log = { [today]: goal.current || 0 };
      migrated = true;
    }
    if (goal.current >= goal.target && !goal.completedAt) {
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
  if (goal.current >= goal.target) {
    if (!goal.completedAt) goal.completedAt = goalToday();
  } else {
    goal.completedAt = null;
  }
}

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
  };
  logGoalValue(goal);
  syncCompletion(goal);
  goals.push(goal);
  saveGoals(goals);
  window.renderGoals();
  return goal;
}

// Kept as the public entry point — actions.js (Alfred logging) calls it
// with arbitrary deltas like +3 or -0.5.
function adjustGoal(id, delta) {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  const wasDone = goal.current >= goal.target;
  goal.current = roundGoalNum(Math.max(0, Math.min(goal.target, goal.current + delta)));
  logGoalValue(goal);
  syncCompletion(goal);
  saveGoals(goals);
  if (!wasDone && goal.current >= goal.target) justCompleted.add(goal.id);
  window.renderGoals();
}

function setGoalValue(id, value) {
  const goal = goals.find((g) => g.id === id);
  if (!goal) return;
  adjustGoal(id, roundGoalNum(value) - goal.current);
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
  if (total <= 0) return goal.target;
  const now = new Date(new Date().toDateString());
  const frac = Math.max(0, Math.min(1, (now - start) / total));
  return { value: goal.start + (goal.target - goal.start) * frac, frac };
}

// status: done | overdue | behind | on-track | open
function goalStatus(goal) {
  if (goal.current >= goal.target) return { status: "done", label: "Done" };
  if (!goal.deadline) return { status: "open", label: "No deadline" };
  const days = daysUntil(goal.deadline);
  if (days < 0) return { status: "overdue", label: "Overdue" };
  const exp = goalExpected(goal);
  const slack = (goal.target - goal.start) * 0.03;
  if (exp && exp.frac > 0.05 && goal.current + slack < exp.value) return { status: "behind", label: "Behind" };
  return { status: "on-track", label: "On track" };
}

// "need ~2.5 kg/week" — what it takes from here to land on time.
// A plain yes/no goal ("Run 5 km under 25 min"): target 1, no unit.
function isBinaryGoal(goal) {
  return goal.target === 1 && (!goal.unit || goal.unit === "done");
}

function goalNeedText(goal) {
  if (!goal.deadline || goal.current >= goal.target || isBinaryGoal(goal)) return "";
  const days = daysUntil(goal.deadline);
  const left = goal.target - goal.current;
  if (days < 0) return `${fmtGoalNum(left)} ${goal.unit} to go`;
  if (days <= 1) return `${fmtGoalNum(left)} ${goal.unit} today`;
  if (days < 14) return `~${fmtGoalNum(left / days)} ${goal.unit}/day`;
  if (days < 120) return `~${fmtGoalNum(left / (days / 7))} ${goal.unit}/week`;
  return `~${fmtGoalNum(left / (days / 30.4))} ${goal.unit}/month`;
}

// One-liner for Alfred's context.
window.goalPaceText = function goalPaceText(goal) {
  const s = goalStatus(goal);
  const need = goalNeedText(goal);
  return `${s.label.toLowerCase()}${need ? `, needs ${need}` : ""}`;
};

const STATUS_RANK = { overdue: 0, behind: 1, "on-track": 2, open: 3, done: 4 };

function sortActive(list) {
  return list.slice().sort((a, b) => {
    const r = STATUS_RANK[goalStatus(a).status] - STATUS_RANK[goalStatus(b).status];
    if (r) return r;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return b.current / b.target - a.current / a.target;
  });
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function escGoal(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const justCompleted = new Set();
const lastPct = new Map(); // id -> pct shown last render, so bars tween

function goalPct(goal) {
  return goal.target > 0 ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : 0;
}

function goalRowHtml(goal) {
  const done = goal.current >= goal.target;
  const s = justCompleted.has(goal.id) ? { status: "done", label: "Done" } : goalStatus(goal);
  const pct = goalPct(goal);
  const from = lastPct.has(goal.id) ? lastPct.get(goal.id) : pct;
  const exp = goalExpected(goal);
  const pace = exp && !done && exp.frac > 0 ? Math.min(100, (exp.value / goal.target) * 100) : null;
  const due = goal.deadline && !done ? deadlineLabel(goal.deadline) : null;
  const need = goalNeedText(goal);
  const step = goal.step || 1;

  const binary = isBinaryGoal(goal);
  const meta = [
    binary
      ? `<span class="gl-val">${done ? "Done" : "Not done yet"}</span>`
      : `<span class="gl-val"><strong>${fmtGoalNum(goal.current)}</strong> / ${fmtGoalNum(goal.target)} ${escGoal(goal.unit)}</span>`,
    due ? `<span class="${due.overdue ? "gl-meta-bad" : ""}" title="Due ${formatGoalDate(goal.deadline)}">${escGoal(due.text)}</span>` : "",
    need && !due?.overdue ? `<span>${escGoal(need)}</span>` : "",
  ].filter(Boolean).join("");

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
    ${
      done
        ? ""
        : `<span class="gl-step" role="group" aria-label="Update ${escGoal(goal.name)}">
      ${binary ? "" : `<button type="button" class="gl-step-btn" data-goal-step="${goal.id}" data-dir="-1" aria-label="Minus ${fmtGoalNum(step)}" ${goal.current <= 0 ? "disabled" : ""}>−</button>`}
      ${
        binary
          ? `<button type="button" class="gl-step-btn gl-step-plus gl-step-check" data-goal-step="${goal.id}" data-dir="1" aria-label="Mark ${escGoal(goal.name)} done">✓</button>`
          : `<button type="button" class="gl-step-btn gl-step-plus" data-goal-step="${goal.id}" data-dir="1" aria-label="Plus ${fmtGoalNum(step)}">+${step === 1 ? "" : fmtGoalNum(step)}</button>`
      }
    </span>`
    }
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
  const active = sortActive(goals.filter((g) => g.term === term && (g.current < g.target || justCompleted.has(g.id))));
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
    <span class="gl-focus-meta">${[due ? `${due.text} · ${formatGoalDate(focus.deadline)}` : `${Math.round(goalPct(focus))}% there`, isBinaryGoal(focus) ? "not done yet" : need].filter(Boolean).map(escGoal).join(" · ")}</span>`;
}

window.renderGoals = function renderGoals() {
  const active = goals.filter((g) => g.current < g.target);
  const completed = goals
    .filter((g) => g.current >= g.target && !justCompleted.has(g.id))
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));

  renderGoalHeader(active, completed);

  const hasAny = goals.length > 0;
  document.getElementById("goals-empty").hidden = hasAny;
  document.getElementById("goals-groups").hidden = !hasAny;
  document.querySelector(".goals-header .gl-hero").hidden = !hasAny;
  document.getElementById("goals-stats").hidden = !hasAny;

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

function markDeadlineChip() {
  const v = field("deadline").value;
  goalForm.querySelectorAll("[data-deadline-chip]").forEach((chip, i) => {
    chip.classList.toggle("is-active", DEADLINE_CHIPS[i][1]() === v);
  });
}

function sparklineSvg(goal) {
  const pts = Object.entries(goal.log || {}).sort(([a], [b]) => a.localeCompare(b));
  if (pts.length < 2) return "";
  const t0 = parseGoalDate(pts[0][0]).getTime();
  const t1 = parseGoalDate(pts[pts.length - 1][0]).getTime();
  const W = 300;
  const H = 56;
  const x = (k) => (t1 === t0 ? W : ((parseGoalDate(k).getTime() - t0) / (t1 - t0)) * W);
  // Scale from the lowest point to the target, so 75 -> 85 of 100 kg
  // reads as real movement instead of a flat line near the top.
  const lo = Math.min(goal.start || 0, ...pts.map(([, v]) => v));
  const span = goal.target - lo || 1;
  const y = (v) => H - 4 - ((Math.max(lo, Math.min(goal.target, v)) - lo) / span) * (H - 8);
  const d = pts.map(([k, v], i) => `${i ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const [lk, lv] = pts[pts.length - 1];
  return `<svg class="gl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="4" y2="4" class="gl-spark-target"/>
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
    ${sparklineSvg(goal) || `<p class="gl-hist-empty">The progress line fills in as you update it on different days.</p>`}`;
  document.getElementById("goal-sheet-complete").textContent = goal.current >= goal.target ? "Reopen" : "Mark complete";
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
  field("current").value = goal ? goal.current : "";
  field("step").value = goal ? goal.step || 1 : "";
  field("deadline").value = goal ? goal.deadline || "" : preset.deadline || "";
  field("why").value = goal ? goal.why || "" : "";
  document.getElementById("goal-current-label").textContent = goal ? "Current" : "Starting at";
  setTerm(goal ? goal.term : preset.term || "short");
  markDeadlineChip();
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

// Deadline chips
const chipRow = document.getElementById("goal-deadline-chips");
chipRow.innerHTML = DEADLINE_CHIPS.map(([label], i) => `<button type="button" class="gl-chip-btn" data-deadline-chip="${i}">${label}</button>`).join("");
chipRow.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-deadline-chip]");
  if (!chip) return;
  field("deadline").value = DEADLINE_CHIPS[Number(chip.dataset.deadlineChip)][1]();
  markDeadlineChip();
});
field("deadline").addEventListener("input", markDeadlineChip);

goalForm.querySelectorAll("[data-term-opt]").forEach((b) => b.addEventListener("click", () => setTerm(b.dataset.termOpt)));

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = field("name").value.trim();
  const target = parseFloat(field("target").value);
  if (!name || !(target > 0)) {
    (!name ? field("name") : field("target")).focus();
    return;
  }
  const unit = field("unit").value.trim() || "done";
  const currentRaw = field("current").value;
  const current = currentRaw === "" ? null : Math.max(0, parseFloat(currentRaw));
  const step = parseFloat(field("step").value) > 0 ? roundGoalNum(parseFloat(field("step").value)) : 1;
  const deadline = field("deadline").value || null;
  const why = field("why").value.trim();
  const term = goalForm.dataset.term || "short";

  if (editingGoalId) {
    const goal = goals.find((g) => g.id === editingGoalId);
    const wasDone = goal.current >= goal.target;
    Object.assign(goal, { name, term, target: roundGoalNum(target), unit, step, deadline, why });
    if (current != null && roundGoalNum(Math.min(current, goal.target)) !== goal.current) {
      goal.current = roundGoalNum(Math.min(current, goal.target));
      logGoalValue(goal);
    }
    if (goal.start > goal.target) goal.start = 0;
    syncCompletion(goal);
    if (!wasDone && goal.current >= goal.target) justCompleted.add(goal.id);
    saveGoals(goals);
    window.renderGoals();
  } else {
    addGoal(name, term, target, unit, deadline, { current: Math.min(current || 0, target), step, why });
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
  if (goal.current >= goal.target) {
    // Reopen: step back one notch so it lands in the active list again.
    adjustGoal(id, -(goal.step || 1));
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
    if (goal) adjustGoal(goal.id, Number(step.dataset.dir) * (goal.step || 1));
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
