// Overview: a single at-a-glance landing page pulling live numbers from
// every tracked area (habits/water/food/fitness — all globals defined in
// script.js/water.js/food.js/fitness.js, loaded before this file). This is
// what the sidebar opens to now instead of Habits.

const OVERVIEW_DATE_FMT = { weekday: "long", month: "long", day: "numeric" };

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

function renderOverview() {
  const dateEl = document.getElementById("overview-date");
  if (!dateEl) return;
  dateEl.textContent = new Date().toLocaleDateString(undefined, OVERVIEW_DATE_FMT);

  const standards = overviewStandards();
  const banked = standards.filter((s) => s.met).length;
  const total = standards.length;

  document.getElementById("overview-banked").textContent = `${banked}/${total}`;

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
}

document.querySelectorAll("[data-overview-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.overviewAction;
    if (action === "water" && typeof addWater === "function") addWater(250);
    if (action === "jarvis" && window.switchSection) window.switchSection("jarvis");
  });
});

renderOverview();
