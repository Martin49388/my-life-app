const STORAGE_KEY = "habits";
const VIEW_KEY = "habitView";

const COLORS = ["#8b5cf6", "#22c55e", "#3b82f6", "#14b8a6", "#ef4444", "#eab308", "#ec4899", "#06b6d4"];

const ICON_RULES = [
  [/water|hydrat/, "💧"],
  [/exercis|gym|workout|run|jog/, "💪"],
  [/read|book/, "📖"],
  [/medicin|pill|vitamin/, "💊"],
  [/sleep|bed/, "😴"],
  [/meditat|mindful/, "🧘"],
  [/piano|guitar|music|practice/, "🎹"],
  [/chess/, "♟️"],
  [/journal|write|diary/, "📓"],
  [/walk/, "🚶"],
  [/stretch|yoga/, "🤸"],
  [/smok|alcohol|sugar|^stop|quit/, "🚫"],
  [/code|program|study|learn/, "💻"],
  [/clean|tidy/, "🧹"],
  [/cook|meal/, "🍳"],
];
const DEFAULT_ICON = "✅";

function pickIcon(name) {
  const lower = name.toLowerCase();
  const match = ICON_RULES.find(([re]) => re.test(lower));
  return match ? match[1] : DEFAULT_ICON;
}

function pickColor(index) {
  return COLORS[index % COLORS.length];
}

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
    return { id: h.id, name: h.name, icon: pickIcon(h.name), color: pickColor(i), history };
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
  habits.push({ id: crypto.randomUUID(), name, icon: pickIcon(name), color: pickColor(habits.length), history: {} });
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
    li.style.setProperty("--habit-color", habit.color);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone;
    checkbox.addEventListener("change", () => toggleDate(habit.id, today));

    const icon = document.createElement("span");
    icon.className = "habit-icon";
    icon.textContent = habit.icon;

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
      if (habit.history[d]) cell.style.background = habit.color;
      history.appendChild(cell);
    }

    body.append(nameRow, history);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Delete ${habit.name}`);
    deleteBtn.addEventListener("click", () => deleteHabit(habit.id));

    li.append(checkbox, icon, body, deleteBtn);
    list.appendChild(li);
  }
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function renderMonthly() {
  document.getElementById("month-label").textContent = `${MONTH_NAMES[viewedMonth]} ${viewedYear}`;

  const legend = document.getElementById("legend");
  legend.innerHTML = habits
    .map((h) => `<span class="legend-item"><span class="legend-dot" style="background:${h.color}"></span>${h.name}</span>`)
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
        dot.style.background = h.color;
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
      return `<span class="legend-item"><span class="legend-dot" style="background:${h.color}"></span>${count}/${elapsedDays}</span>`;
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

document.getElementById("add-habit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("habit-name-input");
  const name = input.value.trim();
  if (name) {
    addHabit(name);
    input.value = "";
  }
});

render();
