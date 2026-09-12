// Blueprint's week plan: one schedule of time blocks per weekday, entered
// here, read by Overview's "Today's Plan" (see overview.js). Shared
// helpers (DAY_KEYS, loadWeekPlan, todayDayKey) are globals other files
// can use since everything shares scope — no module system in this app.

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PLAN_DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const WEEK_PLAN_KEY = "week-plan";

// Date#getDay() is 0=Sunday..6=Saturday; DAY_KEYS is Monday-first to match
// the rest of the app's week handling (see fitness.js's weekDatesSoFar).
function todayDayKey() {
  const jsDay = new Date().getDay();
  return DAY_KEYS[(jsDay + 6) % 7];
}

function loadWeekPlan() {
  const raw = localStorage.getItem(WEEK_PLAN_KEY);
  const parsed = raw ? JSON.parse(raw) : {};
  for (const d of DAY_KEYS) if (!parsed[d]) parsed[d] = [];
  return parsed;
}

function saveWeekPlan(plan) {
  localStorage.setItem(WEEK_PLAN_KEY, JSON.stringify(plan));
}

function sortedDayEntries(plan, day) {
  return [...plan[day]].sort((a, b) => a.start.localeCompare(b.start));
}

let weekPlan = loadWeekPlan();
let selectedPlanDay = todayDayKey();

function renderPlanDayTabs() {
  const wrap = document.getElementById("week-plan-days");
  if (!wrap) return;
  wrap.innerHTML = DAY_KEYS.map(
    (d) => `<button type="button" class="nav-link plan-day-tab${d === selectedPlanDay ? " active" : ""}" data-day="${d}">${PLAN_DAY_LABELS[d]}</button>`
  ).join("");
  wrap.querySelectorAll(".plan-day-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPlanDay = btn.dataset.day;
      renderPlanDayTabs();
      renderPlanList();
    });
  });
}

function renderPlanList() {
  const list = document.getElementById("week-plan-list");
  if (!list) return;
  const entries = sortedDayEntries(weekPlan, selectedPlanDay);
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing planned for ${PLAN_DAY_LABELS[selectedPlanDay]} yet.</li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e) => `
      <li class="journal-row" data-id="${e.id}">
        <div class="journal-row-body">
          <p class="journal-time">${e.start}${e.end ? `–${e.end}` : ""}</p>
          <p class="journal-text"></p>
        </div>
        <button type="button" class="delete-btn plan-delete" data-id="${e.id}" aria-label="Delete">&#10005;</button>
      </li>`
    )
    .join("");
  list.querySelectorAll(".journal-row").forEach((row) => {
    const entry = entries.find((e) => e.id === row.dataset.id);
    row.querySelector(".journal-text").textContent = entry.title;
  });
}

function addPlanEntry(day, start, end, title) {
  weekPlan[day].push({ id: crypto.randomUUID(), start, end: end || "", title });
  saveWeekPlan(weekPlan);
  renderPlanList();
  if (window.renderOverview) window.renderOverview();
}

function deletePlanEntry(day, id) {
  weekPlan[day] = weekPlan[day].filter((e) => e.id !== id);
  saveWeekPlan(weekPlan);
  renderPlanList();
  if (window.renderOverview) window.renderOverview();
}

const planForm = document.getElementById("plan-entry-form");
if (planForm) {
  planForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const start = document.getElementById("plan-start").value;
    const end = document.getElementById("plan-end").value;
    const title = document.getElementById("plan-title").value.trim();
    if (!start || !title) return;
    addPlanEntry(selectedPlanDay, start, end, title);
    document.getElementById("plan-title").value = "";
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".plan-delete");
  if (!btn) return;
  deletePlanEntry(selectedPlanDay, btn.dataset.id);
});

renderPlanDayTabs();
renderPlanList();
