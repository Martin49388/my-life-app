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

// perWeek: 7 = every day (the default, and what every habit saved before
// this existed means); 1-6 = that many times in each Mon-Sun week, so a
// rest day doesn't break anything.
function addHabit(name, perWeek = 7) {
  habits.push({ id: crypto.randomUUID(), name, history: {}, perWeek });
  saveHabits(habits);
  render();
}

function habitFreq(habit) {
  const n = Number(habit.perWeek);
  return n >= 1 && n <= 7 ? Math.round(n) : 7;
}

function weekStartKey(date) {
  const d = new Date(date + "T00:00:00");
  return addDays(date, -((d.getDay() + 6) % 7));
}

// Times done in the Mon-Sun week that contains `date`.
function habitWeekCount(habit, date) {
  const start = weekStartKey(date);
  let n = 0;
  for (let i = 0; i < 7; i++) if (habit.history[addDays(start, i)]) n++;
  return n;
}

// Whether the habit counts as handled on `date`: ticked that day, or — for
// an N-per-week habit — that week's quota is already met.
function habitSatisfied(habit, date) {
  if (habit.history[date]) return true;
  const freq = habitFreq(habit);
  return freq < 7 && habitWeekCount(habit, date) >= freq;
}
window.habitSatisfied = habitSatisfied;
window.habitFreq = habitFreq;

// Consecutive weeks that hit the quota, ending with this week if it's
// already met, otherwise last week (this week is still in play).
function weekStreak(habit) {
  const freq = habitFreq(habit);
  let cursor = weekStartKey(todayKey());
  if (habitWeekCount(habit, cursor) < freq) cursor = addDays(cursor, -7);
  let count = 0;
  while (habitWeekCount(habit, cursor) >= freq && count < 520) {
    count++;
    cursor = addDays(cursor, -7);
  }
  return count;
}

function habitStreakText(habit) {
  return habitFreq(habit) < 7 ? `${weekStreak(habit)}w streak` : `${currentStreak(habit)}d streak`;
}
window.habitStreakText = habitStreakText;

const FREQ_CYCLE = [7, 6, 5, 4, 3, 2, 1];

function freqLabel(freq) {
  return freq === 7 ? "Daily" : `${freq}× a week`;
}

function cycleHabitFreq(habitId) {
  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return;
  const i = FREQ_CYCLE.indexOf(habitFreq(habit));
  habit.perWeek = FREQ_CYCLE[(i + 1) % FREQ_CYCLE.length];
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
// "today" doesn't zero out a streak still in progress). Only meaningful
// for daily habits — N-per-week ones count weeks instead (weekStreak), and
// return 0 here so "best streak" stays in days.
function currentStreak(habit) {
  if (habitFreq(habit) < 7) return 0;
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
  return habits.length > 0 && habits.every((h) => habitSatisfied(h, date));
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
  const done = habits.filter((h) => habitSatisfied(h, today)).length;
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
    list.innerHTML = `<li class="empty-state empty-action">
      <p>No habits yet. Start with one small thing you want to do every day.</p>
      <button type="button" class="empty-btn" data-empty-action="add-habit">+ Add your first habit</button>
    </li>`;
    return;
  }

  // Weekday initials over the ten-day strips, so each square has a day.
  const head = document.createElement("li");
  head.className = "habit-days-head";
  head.setAttribute("aria-hidden", "true");
  const initials = ["M", "T", "W", "T", "F", "S", "S"];
  let headCells = "";
  for (let i = 9; i >= 0; i--) {
    const d = addDays(today, -i);
    const wd = (new Date(d + "T00:00:00").getDay() + 6) % 7;
    headCells += `<span class="${i === 0 ? "is-today" : ""}">${initials[wd]}</span>`;
  }
  head.innerHTML = `<span class="habit-days-spacer"></span><span class="habit-days">${headCells}</span>`;
  list.appendChild(head);

  for (const habit of habits) {
    const isDone = !!habit.history[today];
    const freq = habitFreq(habit);
    const weekMet = freq < 7 && !isDone && habitSatisfied(habit, today);

    const li = document.createElement("li");
    li.className = "habit-row" + (isDone ? " done" : "") + (weekMet ? " week-met" : "");

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
    const meta = document.createElement("span");
    meta.className = "habit-meta";
    const freqBtn = document.createElement("button");
    freqBtn.type = "button";
    freqBtn.className = "habit-freq" + (freq < 7 ? " is-weekly" : "");
    freqBtn.textContent = freq < 7 ? `${habitWeekCount(habit, today)}/${freq} this week` : "Daily";
    freqBtn.title = `${freqLabel(freq)} — tap to change how often`;
    freqBtn.addEventListener("click", () => cycleHabitFreq(habit.id));
    const streak = document.createElement("span");
    streak.className = "habit-streak";
    streak.textContent = habitStreakText(habit);
    meta.append(freqBtn, streak);
    nameRow.append(name, meta);

    const history = document.createElement("div");
    history.className = "habit-history";
    for (let i = 9; i >= 0; i--) {
      const d = addDays(today, -i);
      const cell = document.createElement("span");
      cell.className = "history-cell" + (habit.history[d] ? " filled" : "") + (i === 0 ? " is-today" : "");
      cell.title = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + (habit.history[d] ? " — done" : "");
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

// Month view: one calendar cell per day, shaded by how much of the day's
// habits got done (full green = every habit, i.e. a perfect day) — the
// old version drew one dot per habit, which wrapped and overflowed on a
// phone and couldn't say WHICH habit a dot was. Tapping a day names what
// was done; below, one row per habit with its count for the month.
let monthSelectedDate = null;

// Local escape (alfred.js's escapeHtml loads after this file, and this
// view can render on page load).
function habitEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function habitsDoneOn(date) {
  return habits.filter((h) => habitSatisfied(h, date));
}

function renderMonthly() {
  document.getElementById("month-label").textContent = `${MONTH_NAMES[viewedMonth]} ${viewedYear}`;

  const today = todayKey();
  const daysInMonth = new Date(viewedYear, viewedMonth + 1, 0).getDate();
  const leadingBlanks = (new Date(viewedYear, viewedMonth, 1).getDay() + 6) % 7; // Monday-first
  const now = new Date();
  const isCurrentMonth = viewedYear === now.getFullYear() && viewedMonth === now.getMonth();
  const isFutureMonth = viewedYear > now.getFullYear() || (viewedYear === now.getFullYear() && viewedMonth > now.getMonth());
  // Count from the first day anything was ever ticked, so a month you
  // started tracking halfway through isn't scored against days before
  // the app existed.
  const firstTracked = habits.flatMap((h) => Object.keys(h.history)).sort()[0] || today;
  const monthStart = dateKey(new Date(viewedYear, viewedMonth, 1));
  const startDay = firstTracked > monthStart && firstTracked.slice(0, 7) === monthStart.slice(0, 7) ? Number(firstTracked.slice(8)) : 1;
  const beforeTracking = firstTracked.slice(0, 7) > monthStart.slice(0, 7);
  const lastDay = isFutureMonth || beforeTracking ? 0 : isCurrentMonth ? now.getDate() : daysInMonth;
  const elapsedDays = Math.max(0, lastDay - startDay + 1);
  const total = habits.length;

  const calendar = document.getElementById("calendar");
  const cells = ["M", "T", "W", "T", "F", "S", "S"].map((l) => `<div class="weekday-label">${l}</div>`);
  for (let i = 0; i < leadingBlanks; i++) cells.push(`<div class="day-cell is-blank" aria-hidden="true"></div>`);

  let perfect = 0;
  let checks = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = dateKey(new Date(viewedYear, viewedMonth, d));
    const future = date > today;
    const done = future ? 0 : habitsDoneOn(date).length;
    const ratio = total && !future ? done / total : 0;
    const tracked = !future && d >= startDay && d <= lastDay;
    if (tracked && total && done === total) perfect++;
    if (tracked) checks += done;
    const cls = ["day-cell"];
    if (future) cls.push("is-future");
    if (date === today) cls.push("is-today");
    if (!future && total && done === total) cls.push("is-perfect");
    if (date === monthSelectedDate) cls.push("is-selected");
    const label = future ? `${d}` : `${d}: ${done} of ${total} habits`;
    cells.push(
      `<button type="button" class="${cls.join(" ")}" data-date="${date}" style="--fill:${ratio.toFixed(2)}" aria-label="${label}" ${future ? "disabled" : ""}><span class="day-number">${d}</span></button>`
    );
  }
  calendar.innerHTML = cells.join("");

  const possible = total * elapsedDays;
  document.getElementById("month-summary").innerHTML = elapsedDays
    ? `<strong>${perfect}</strong> perfect ${perfect === 1 ? "day" : "days"} · ${possible ? Math.round((checks / possible) * 100) : 0}% of habits done · ${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} tracked`
    : "Nothing to show yet for this month.";

  // Tapped day: what was and wasn't done.
  const detail = document.getElementById("month-day-detail");
  const inMonth = monthSelectedDate && monthSelectedDate.startsWith(`${viewedYear}-${String(viewedMonth + 1).padStart(2, "0")}`);
  if (inMonth && total) {
    const doneList = habitsDoneOn(monthSelectedDate);
    const missed = habits.filter((h) => !doneList.includes(h));
    const when = new Date(`${monthSelectedDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    detail.innerHTML = `<strong>${habitEsc(when)} · ${doneList.length}/${total}</strong>` +
      (doneList.length ? `<span class="month-done">✓ ${doneList.map((h) => habitEsc(h.name)).join(", ")}</span>` : "") +
      (missed.length ? `<span class="month-missed">✗ ${missed.map((h) => habitEsc(h.name)).join(", ")}</span>` : "");
    detail.hidden = false;
  } else {
    detail.innerHTML = "";
    detail.hidden = true;
  }

  // One row per habit: how often this month.
  const list = document.getElementById("month-habits");
  list.innerHTML = habits
    .map((h) => {
      let count = 0;
      for (let d = startDay; d <= lastDay; d++) if (h.history[dateKey(new Date(viewedYear, viewedMonth, d))]) count++;
      const freq = habitFreq(h);
      // What "on track" would be this far into the month.
      const expected = freq === 7 ? elapsedDays : Math.max(1, Math.round((elapsedDays / 7) * freq));
      const ratio = expected ? Math.min(1, count / expected) : 0;
      const tone = !elapsedDays ? "" : ratio >= 0.8 ? " is-good" : ratio < 0.5 ? " is-warn" : "";
      return `<li class="month-habit${tone}">
        <span class="month-habit-name">${habitEsc(h.name)}</span>
        <span class="month-habit-bar"><span style="width:${Math.round(ratio * 100)}%"></span></span>
        <span class="month-habit-count">${count}/${expected}</span>
      </li>`;
    })
    .join("");
}

document.getElementById("calendar").addEventListener("click", (e) => {
  const cell = e.target.closest(".day-cell[data-date]");
  if (!cell || cell.disabled) return;
  monthSelectedDate = monthSelectedDate === cell.dataset.date ? null : cell.dataset.date;
  renderMonthly();
});

function render() {
  renderHeader();
  document.getElementById("daily-view").hidden = currentView !== "daily";
  document.getElementById("monthly-view").hidden = currentView !== "monthly";
  document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === currentView);
  });
  if (currentView === "daily") renderDaily();
  else renderMonthly();
  if (window.renderOverview) window.renderOverview();
}

document.querySelectorAll(".tab-btn[data-view]").forEach((btn) => {
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

document.getElementById("habit-list").addEventListener("click", (e) => {
  if (e.target.closest('[data-empty-action="add-habit"]')) addToggleBtn.click();
});

addToggleBtn.addEventListener("click", () => {
  addToggleBtn.hidden = true;
  addForm.hidden = false;
  document.getElementById("habit-name-input").focus();
});

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("habit-name-input");
  const name = input.value.trim();
  const freqSelect = document.getElementById("habit-freq-input");
  if (name) {
    addHabit(name, freqSelect ? Number(freqSelect.value) : 7);
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
  "habits", "goals", "blueprint", "review",
  "fitness", "fuel", "recovery",
  "reading", "notes",
  "briefing", "settings",
  // Not in the sidebar — reached through the Ask bar / center button.
  "alfred",
];

// Merged sections keep working under their old ids (Overview's tiles,
// Review's rows, anything saved from before a merge):
//   Food + Water -> Fuel      ("water" scrolls to the water block)
//   News + Markets -> Briefing (each scrolls to its part)
//   Mindset -> Notes           (its journal became #mindset notes)
const SECTION_ALIASES = { food: "fuel", water: "fuel", news: "briefing", markets: "briefing", mindset: "notes" };
const SECTION_SCROLL_TO = { water: "fuel-water" };

// Briefing shows one part at a time (Markets or News) behind two tabs, so
// neither is a scroll away. The last choice is remembered per device;
// opening "markets" or "news" by their old ids picks that tab.
const BRIEFING_TAB_KEY = "briefing-tab";
function setBriefingTab(tab) {
  const current = tab === "news" ? "news" : "markets";
  try {
    localStorage.setItem(BRIEFING_TAB_KEY, current);
  } catch {
    // Not fatal — it just won't be remembered.
  }
  document.querySelectorAll("[data-briefing-tab]").forEach((b) => {
    const on = b.dataset.briefingTab === current;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const newsPart = document.getElementById("news-section");
  const marketsPart = document.getElementById("markets-section");
  if (newsPart) newsPart.hidden = current !== "news";
  if (marketsPart) marketsPart.hidden = current !== "markets";
  const briefing = document.getElementById("briefing-section");
  if (briefing && !briefing.hidden) {
    if (current === "news" && window.openNews) window.openNews();
    if (current === "markets" && window.refreshMarkets) window.refreshMarkets();
  }
}
window.setBriefingTab = setBriefingTab;
function savedBriefingTab() {
  try {
    return localStorage.getItem(BRIEFING_TAB_KEY) || "markets";
  } catch {
    return "markets";
  }
}
document.querySelectorAll("[data-briefing-tab]").forEach((b) => {
  b.addEventListener("click", () => setBriefingTab(b.dataset.briefingTab));
});

function switchSection(requested) {
  const section = SECTION_ALIASES[requested] || requested;

  document.querySelectorAll(".section-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
  ALL_SECTIONS.forEach((s) => {
    const el = document.getElementById(`${s}-section`);
    if (el) el.hidden = s !== section;
  });
  if (section === "briefing") setBriefingTab(requested === "news" || requested === "markets" ? requested : savedBriefingTab());
  if (section === "blueprint" && window.renderBlueprint) window.renderBlueprint();
  if (section === "goals" && window.renderGoals) window.renderGoals();
  if (section === "fitness" && window.renderFitness) window.renderFitness();
  if (section === "fuel" && window.renderFood) window.renderFood();
  if (section === "reading" && window.renderReading) window.renderReading();
  if (section === "recovery" && window.renderRecovery) window.renderRecovery();
  if (section === "review" && window.renderReview) window.renderReview();
  if (section === "notes" && window.renderNotes) window.renderNotes();
  if (section === "settings" && window.renderReminders) window.renderReminders();
  if (window.renderOverview) window.renderOverview();
  playTabEnter(document.getElementById(`${section}-section`));

  const changed = window.currentSection !== section;
  window.currentSection = section;
  if (SECTION_SCROLL_TO[requested]) {
    document.getElementById(SECTION_SCROLL_TO[requested])?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  } else if (changed) {
    // A new section starts at its top, not wherever the last one was scrolled to.
    window.scrollTo(0, 0);
  }
  // Lets the phone navigation (mobile-nav.js) follow along.
  if (window.onSectionChange) window.onSectionChange(section);
}
window.switchSection = switchSection;
setBriefingTab(savedBriefingTab());
window.currentSection = "overview";

document.querySelectorAll(".section-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

render();
