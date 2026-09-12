const STORAGE_KEY = "habits";
const VIEW_KEY = "habitView";

// Uses local Y/M/D (not toISOString, which is UTC and can land on the
// wrong calendar day depending on your timezone offset).
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return dateKey(new Date());
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Tweens a number element's text from its current displayed value to a new
// one instead of jumping straight to it. Keeps whatever non-digit
// characters (like "g" or "%") already surround the number, and does
// nothing but set the final value when the user prefers reduced motion.
function animateNumber(el, newValue, { duration = 400, decimals = 0 } = {}) {
  const prevText = el.textContent || "";
  const numberPattern = /-?[\d,]+(\.\d+)?/;
  const prevMatch = prevText.match(numberPattern);
  const from = prevMatch ? parseFloat(prevMatch[0].replace(/,/g, "")) : 0;
  const to = Number(newValue.toFixed(decimals));

  const format = (n) =>
    decimals > 0
      ? n.toFixed(decimals)
      : Math.round(n).toLocaleString();

  if (prefersReducedMotion || from === to) {
    el.textContent = prevMatch ? prevText.replace(numberPattern, format(to)) : format(to);
    return;
  }

  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = from + (to - from) * eased;
    el.textContent = prevMatch ? prevText.replace(numberPattern, format(value)) : format(value);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
window.animateNumber = animateNumber;

// Replays a short fade/slide-in on a section when it becomes the active
// tab, instead of the content just appearing instantly.
function playTabEnter(section) {
  if (prefersReducedMotion) return;
  section.classList.remove("tab-fade-in");
  void section.offsetWidth; // force reflow so the animation restarts
  section.classList.add("tab-fade-in");
}
window.playTabEnter = playTabEnter;

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Migrates the old {doneDates: []} shape (v1) into the new {history: {}} shape.
function loadHabits() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return parsed.map((h, i) => {
    if (h.history) return h;
    const history = {};
    for (const d of h.doneDates || []) history[d] = true;
    return { id: h.id, name: h.name, history };
  });
}

function saveHabits(habits) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

let habits = loadHabits();
let currentView = localStorage.getItem(VIEW_KEY) || "daily";
let viewedYear = new Date().getFullYear();
let viewedMonth = new Date().getMonth(); // 0-indexed

function addHabit(name) {
  habits.push({ id: crypto.randomUUID(), name, history: {} });
  saveHabits(habits);
  render();
}

function toggleDate(habitId, date) {
  const habit = habits.find((h) => h.id === habitId);
  if (habit.history[date]) {
    delete habit.history[date];
  } else {
    habit.history[date] = true;
  }
  saveHabits(habits);
  render();
}

function deleteHabit(id) {
  habits = habits.filter((h) => h.id !== id);
  saveHabits(habits);
  render();
}

// Consecutive completed days ending today (or yesterday, so an unchecked
// "today" doesn't zero out a streak still in progress).
function currentStreak(habit) {
  let count = 0;
  let cursor = new Date();
  if (!habit.history[dateKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (habit.history[dateKey(cursor)]) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function isPerfectDay(date) {
  return habits.length > 0 && habits.every((h) => h.history[date]);
}

function perfectDaysThisMonth() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  let count = 0;
  for (let d = 1; d <= today.getDate(); d++) {
    const date = dateKey(new Date(y, m, d));
    if (isPerfectDay(date)) count++;
  }
  return count;
}

function renderHeader() {
  const today = todayKey();
  const total = habits.length;
  const done = habits.filter((h) => h.history[today]).length;
  const pct = total === 0 ? 0 : done / total;

  document.getElementById("today-count").textContent = `${done}/${total}`;
  const ring = document.getElementById("today-ring").querySelector(".ring-fill");
  const circumference = 2 * Math.PI * 17;
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference * (1 - pct)}`;

  const best = habits.length ? Math.max(...habits.map(currentStreak)) : 0;
  document.getElementById("best-streak").textContent = `${best}d`;
  document.getElementById("perfect-days").textContent = perfectDaysThisMonth();
}

function renderDaily() {
  const list = document.getElementById("habit-list");
  const today = todayKey();
  list.innerHTML = "";

  if (habits.length === 0) {
    list.innerHTML = `<li class="empty-state">No habits yet — add your first one above.</li>`;
    return;
  }

  for (const habit of habits) {
    const isDone = !!habit.history[today];

    const li = document.createElement("li");
    li.className = "habit-row" + (isDone ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone;
    checkbox.addEventListener("change", () => {
      li.classList.add("habit-pulse");
      // Let the pulse actually show before the row gets rebuilt on render.
      setTimeout(() => toggleDate(habit.id, today), 150);
    });

    const body = document.createElement("div");
    body.className = "habit-body";

    const nameRow = document.createElement("div");
    nameRow.className = "habit-name-row";
    const name = document.createElement("span");
    name.className = "habit-name";
    name.textContent = habit.name;
    const streak = document.createElement("span");
    streak.className = "habit-streak";
    streak.textContent = `${currentStreak(habit)}d streak`;
    nameRow.append(name, streak);

    const history = document.createElement("div");
    history.className = "habit-history";
    for (let i = 9; i >= 0; i--) {
      const d = addDays(today, -i);
      const cell = document.createElement("span");
      cell.className = "history-cell" + (habit.history[d] ? " filled" : "");
      history.appendChild(cell);
    }

    body.append(nameRow, history);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Delete ${habit.name}`);
    deleteBtn.addEventListener("click", () => deleteHabit(habit.id));

    li.append(checkbox, body, deleteBtn);
    list.appendChild(li);
  }
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function renderMonthly() {
  document.getElementById("month-label").textContent = `${MONTH_NAMES[viewedMonth]} ${viewedYear}`;

  const legend = document.getElementById("legend");
  legend.innerHTML = habits
    .map((h) => `<span class="legend-item">${h.name}</span>`)
    .join("");

  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";
  WEEKDAY_LABELS.forEach((label) => {
    const el = document.createElement("div");
    el.className = "weekday-label";
    el.textContent = label;
    calendar.appendChild(el);
  });

  const firstOfMonth = new Date(viewedYear, viewedMonth, 1);
  const daysInMonth = new Date(viewedYear, viewedMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first

  for (let i = 0; i < leadingBlanks; i++) {
    calendar.appendChild(document.createElement("div"));
  }

  const today = todayKey();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = dateKey(new Date(viewedYear, viewedMonth, d));
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (date === today) cell.classList.add("is-today");
    if (isPerfectDay(date)) cell.classList.add("is-perfect");

    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d;

    const dots = document.createElement("div");
    dots.className = "day-dots";
    for (const h of habits) {
      if (h.history[date]) {
        const dot = document.createElement("span");
        dot.className = "day-dot";
        dots.appendChild(dot);
      }
    }

    cell.append(num, dots);
    calendar.appendChild(cell);
  }

  const today_ = new Date();
  const isCurrentMonth = viewedYear === today_.getFullYear() && viewedMonth === today_.getMonth();
  const elapsedDays = isCurrentMonth ? today_.getDate() : daysInMonth;

  let perfectCount = 0;
  for (let d = 1; d <= elapsedDays; d++) {
    if (isPerfectDay(dateKey(new Date(viewedYear, viewedMonth, d)))) perfectCount++;
  }

  const perHabit = habits
    .map((h) => {
      let count = 0;
      for (let d = 1; d <= elapsedDays; d++) {
        if (h.history[dateKey(new Date(viewedYear, viewedMonth, d))]) count++;
      }
      return `<span class="legend-item">${h.name} ${count}/${elapsedDays}</span>`;
    })
    .join("");

  document.getElementById("calendar-footer").innerHTML =
    `<strong>${perfectCount} perfect</strong> / ${elapsedDays} days &nbsp; ${perHabit}`;
}

function render() {
  renderHeader();
  document.getElementById("daily-view").hidden = currentView !== "daily";
  document.getElementById("monthly-view").hidden = currentView !== "monthly";
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });
  if (currentView === "daily") renderDaily();
  else renderMonthly();
  if (window.renderGlance) window.renderGlance();
  if (window.renderOverview) window.renderOverview();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    localStorage.setItem(VIEW_KEY, currentView);
    render();
  });
});

document.getElementById("prev-month").addEventListener("click", () => {
  viewedMonth -= 1;
  if (viewedMonth < 0) {
    viewedMonth = 11;
    viewedYear -= 1;
  }
  renderMonthly();
});

document.getElementById("next-month").addEventListener("click", () => {
  viewedMonth += 1;
  if (viewedMonth > 11) {
    viewedMonth = 0;
    viewedYear += 1;
  }
  renderMonthly();
});

const addToggleBtn = document.getElementById("add-habit-toggle-btn");
const addForm = document.getElementById("add-habit-form");

addToggleBtn.addEventListener("click", () => {
  addToggleBtn.hidden = true;
  addForm.hidden = false;
  document.getElementById("habit-name-input").focus();
});

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("habit-name-input");
  const name = input.value.trim();
  if (name) {
    addHabit(name);
    input.value = "";
  }
  addForm.hidden = true;
  addToggleBtn.hidden = false;
});

// Shared by the sidebar nav buttons and the persistent bottom input bar
// (global-bar.js), which jumps to Alfred after asking a question.
// Every section that lives behind the sidebar nav. Add new ones here (and
// give them a matching #<name>-section in index.html) rather than hand-wiring
// another hidden-toggle line per section.
const ALL_SECTIONS = [
  "overview",
  "habits", "goals", "alfred", "blueprint", "review",
  "fitness", "food", "recovery",
  "mindset", "reading",
  "news", "markets", "notes",
];

function switchSection(requested) {
  // "Water" has no section of its own — it lives inside Food (see
  // water.js/index.html) — so it activates Food and then scrolls the
  // water widget into view instead of pretending it's a separate tab.
  const section = requested === "water" ? "food" : requested;

  document.querySelectorAll(".section-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === requested));
  ALL_SECTIONS.forEach((s) => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.hidden = s !== section;
  });
  if (section === "news" && window.loadNews) window.loadNews();
  if (section === "goals" && window.renderGoals) window.renderGoals();
  if (section === "fitness" && window.renderFitness) window.renderFitness();
  if (section === "food" && window.renderFood) window.renderFood();
  if (window.renderOverview) window.renderOverview();
  const miniBar = document.getElementById("mini-overview");
  if (miniBar) miniBar.hidden = section === "overview";
  playTabEnter(document.getElementById(`${section}-section`));

  if (requested === "water") {
    document.querySelector(".water-widget")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }
}
window.switchSection = switchSection;

document.querySelectorAll(".section-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

render();
