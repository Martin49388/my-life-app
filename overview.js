// Overview: a single at-a-glance landing page pulling live numbers from
// every tracked area (habits/water/food/fitness/blueprint's week plan —
// all globals defined in script.js/water.js/food.js/fitness.js/
// blueprint.js, loaded before this file). This is what the sidebar opens
// to now instead of Habits. Also renders the condensed "mini-overview"
// header shown above every other section (see #mini-overview in
// index.html, toggled by switchSection in script.js).

const OVERVIEW_DATE_FMT = { weekday: "long", month: "long", day: "numeric" };
const PLAN_DONE_PREFIX = "plan-done-";

function bestStreak() {
  return habits.length ? Math.max(...habits.map(currentStreak)) : 0;
}

function overviewStandards() {
  const today = todayKey();
  const habitsDone = habits.filter((h) => h.history[today]).length;
  const habitsTotal = habits.length;

  const waterMl = typeof waterToday === "function" ? waterToday() : 0;
  const waterTarget = typeof water !== "undefined" ? water.target : 0;

  const foodToday = typeof entriesFor === "function" ? entriesFor(today) : [];
  const kcalToday = foodToday.reduce((sum, e) => sum + e.kcal, 0);
  const kcalTarget = typeof food !== "undefined" ? food.target : 0;

  const trained = typeof trainedThisWeek === "function" ? trainedThisWeek() : 0;
  const trainTarget = typeof TRAIN_TARGET !== "undefined" ? TRAIN_TARGET : 0;

  return [
    { label: "Habits today", value: `${habitsDone}/${habitsTotal}`, met: habitsTotal > 0 && habitsDone === habitsTotal },
    { label: "Water", value: `${(waterMl / 1000).toFixed(2)}L / ${(waterTarget / 1000).toFixed(1)}L`, met: waterMl >= waterTarget },
    { label: "Food", value: `${kcalToday} / ${kcalTarget} kcal`, met: kcalToday > 0 && kcalToday <= kcalTarget },
    { label: "Training this week", value: `${trained}/${trainTarget}`, met: trained >= trainTarget },
  ];
}

// Today's entries from Blueprint's week plan (blueprint.js), with a
// per-date done/not-done toggle — the plan itself is a weekly template,
// but whether you actually did Tuesday's 07:30 block is specific to this
// Tuesday, so that's stored separately, keyed by date.
function loadPlanDone(dateKey) {
  const raw = localStorage.getItem(`${PLAN_DONE_PREFIX}${dateKey}`);
  return raw ? JSON.parse(raw) : {};
}

function togglePlanDone(dateKey, entryId) {
  const done = loadPlanDone(dateKey);
  done[entryId] = !done[entryId];
  localStorage.setItem(`${PLAN_DONE_PREFIX}${dateKey}`, JSON.stringify(done));
  renderOverview();
}

function renderOverview() {
  const dateEl = document.getElementById("overview-date");
  if (!dateEl) return;
  dateEl.textContent = new Date().toLocaleDateString(undefined, OVERVIEW_DATE_FMT);

  const standards = overviewStandards();
  const banked = standards.filter((s) => s.met).length;
  const total = standards.length;
  const streak = bestStreak();

  document.getElementById("overview-banked").textContent = `${banked}/${total}`;
  document.getElementById("overview-best-streak").textContent = `${streak}d`;

  const ring = document.getElementById("overview-ring")?.querySelector(".ring-fill");
  if (ring) {
    const circumference = 2 * Math.PI * 17;
    const pct = total === 0 ? 0 : banked / total;
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - pct)}`;
  }

  const statusEl = document.getElementById("overview-status");
  const open = standards.filter((s) => !s.met);
  statusEl.textContent =
    open.length === 0
      ? "Everything on target today."
      : `Still open: ${open.map((s) => s.label).join(", ")}.`;

  const list = document.getElementById("overview-standards");
  list.innerHTML = standards
    .map(
      (s) => `
      <li class="journal-row">
        <div class="journal-row-body">
          <p class="journal-text">${s.label}</p>
        </div>
        <p class="journal-time">${s.value}</p>
      </li>`
    )
    .join("");

  renderTodaysPlan();
  renderMiniOverview(banked, total, streak);
}

function renderTodaysPlan() {
  const planList = document.getElementById("overview-plan");
  if (!planList) return;
  if (typeof loadWeekPlan !== "function") {
    planList.innerHTML = `<li class="empty-state">Set up a week plan in Blueprint first.</li>`;
    return;
  }

  const plan = loadWeekPlan();
  const day = todayDayKey();
  const entries = sortedDayEntries(plan, day);
  const dateKey = todayKey();
  const done = loadPlanDone(dateKey);

  if (entries.length === 0) {
    planList.innerHTML = `<li class="empty-state">Nothing planned for today yet — add it in Blueprint.</li>`;
    return;
  }

  planList.innerHTML = entries
    .map(
      (e) => `
      <li class="journal-row plan-row${done[e.id] ? " done" : ""}" data-id="${e.id}">
        <div class="journal-row-body">
          <p class="journal-time">${e.start}${e.end ? `–${e.end}` : ""}</p>
          <p class="journal-text"></p>
        </div>
        <input type="checkbox" class="plan-check" data-id="${e.id}" ${done[e.id] ? "checked" : ""} />
      </li>`
    )
    .join("");

  planList.querySelectorAll(".journal-row").forEach((row) => {
    const entry = entries.find((e) => e.id === row.dataset.id);
    row.querySelector(".journal-text").textContent = entry.title;
  });
  planList.querySelectorAll(".plan-check").forEach((box) => {
    box.addEventListener("change", () => togglePlanDone(dateKey, box.dataset.id));
  });
}

// The slim header shown above every other section (see index.html,
// toggled by switchSection in script.js) — just the two numbers worth
// carrying around, not the full Overview page.
function renderMiniOverview(banked, total, streak) {
  const bar = document.getElementById("mini-overview");
  if (!bar) return;
  bar.innerHTML = `
    <span class="mini-overview-item"><strong>${banked}/${total}</strong> banked today</span>
    <span class="mini-overview-item"><strong>${streak}d</strong> best streak</span>
  `;
}

document.querySelectorAll("[data-overview-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.overviewAction;
    if (action === "water" && typeof addWater === "function") addWater(250);
    if (action === "jarvis" && window.switchSection) window.switchSection("jarvis");
  });
});

renderOverview();
