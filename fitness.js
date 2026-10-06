const FITNESS_KEY = "fitness";

// Martin's real weekly target (see profile/about-me.md in the vault) —
// how many DISTINCT calendar days this week had at least one exercise
// checked off, not how many days the template happens to have a plan for.
const TRAIN_TARGET = 5;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function emptyPlan() {
  return {
    days: DAY_LABELS.map(() => ({ title: "", exercises: [] })),
    log: {},
  };
}

function loadPlan() {
  const raw = localStorage.getItem(FITNESS_KEY);
  return raw ? JSON.parse(raw) : emptyPlan();
}

function savePlan() {
  localStorage.setItem(FITNESS_KEY, JSON.stringify(plan));
}

let plan = loadPlan();

// Monday-first index, matching the week strip and the habit calendar.
function weekdayIndex(date) {
  return (new Date(date + "T00:00:00").getDay() + 6) % 7;
}

// Which calendar date the session panel is showing. Defaults to today;
// the day arrows next to the session title (see shiftFitnessDay) step it
// into the past so a forgotten day can be checked off after the fact —
// same idea as the habit month calendar's backfill, one day at a time.
let fitnessViewedDate = todayKey();
const todayIndex = weekdayIndex(todayKey());
let selectedDay = weekdayIndex(fitnessViewedDate);

function completedOn(date) {
  return plan.log[date] || [];
}

function completedToday() {
  return completedOn(todayKey());
}

// Monday of the week containing `date`.
function mondayOf(date) {
  return addDays(date, -weekdayIndex(date));
}

// Monday of the current week, through today — future days in the week
// can't have been trained yet, so they don't count against the target.
function weekDatesSoFar() {
  const monday = mondayOf(todayKey());
  const dates = [];
  for (let d = monday; ; d = addDays(d, 1)) {
    dates.push(d);
    if (d === todayKey()) break;
  }
  return dates;
}

function trainedThisWeek() {
  return weekDatesSoFar().filter((d) => (plan.log[d] || []).length > 0).length;
}

function toggleExerciseDone(exerciseId) {
  if (fitnessViewedDate > todayKey()) return; // can't check off a day that hasn't happened yet
  const done = new Set(plan.log[fitnessViewedDate] || []);
  if (done.has(exerciseId)) done.delete(exerciseId);
  else done.add(exerciseId);
  plan.log[fitnessViewedDate] = [...done];
  savePlan();
  window.renderFitness();
}

// Step the viewed day back or forward (never past today) — the backfill
// control: go back to a day you forgot to log and tick off what you
// actually did. Also moves `selectedDay` so the right weekday's
// exercises show.
function shiftFitnessDay(delta) {
  const next = addDays(fitnessViewedDate, delta);
  if (next > todayKey()) return;
  fitnessViewedDate = next;
  selectedDay = weekdayIndex(fitnessViewedDate);
  window.renderFitness();
}

function addExercise(name, sets, reps) {
  plan.days[selectedDay].exercises.push({ id: crypto.randomUUID(), name, sets, reps });
  savePlan();
  window.renderFitness();
}

function deleteExercise(id) {
  const day = plan.days[selectedDay];
  day.exercises = day.exercises.filter((ex) => ex.id !== id);
  savePlan();
  window.renderFitness();
}

function exerciseDetail(ex) {
  if (ex.sets && ex.reps) return `${ex.sets} × ${ex.reps}`;
  if (ex.sets) return `${ex.sets} sets`;
  return ex.reps || "";
}

function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  strip.innerHTML = "";

  plan.days.forEach((day, i) => {
    const isTraining = day.exercises.length > 0;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-chip";
    if (i === selectedDay) btn.classList.add("selected");
    if (i === todayIndex) btn.classList.add("is-today");
    if (!isTraining) btn.classList.add("rest");

    const label = document.createElement("span");
    label.className = "day-chip-label";
    label.textContent = DAY_LABELS[i];

    const title = document.createElement("span");
    title.className = "day-chip-title";
    title.textContent = isTraining ? day.title || "Session" : "Rest";

    // Volume read at a glance: one bar per exercise, up to five.
    const bars = document.createElement("span");
    bars.className = "day-chip-bars";
    for (let b = 0; b < Math.min(day.exercises.length, 5); b++) {
      const bar = document.createElement("span");
      bar.className = "volume-bar";
      bars.appendChild(bar);
    }

    btn.append(label, title, bars);
    btn.addEventListener("click", () => {
      selectedDay = i;
      fitnessViewedDate = addDays(mondayOf(todayKey()), i);
      window.renderFitness();
    });
    strip.appendChild(btn);
  });
}

// "Tuesday · today", "Tuesday · yesterday", or "Tuesday · 3 Oct" further back.
function sessionDayLabel() {
  const name = DAY_NAMES[selectedDay];
  if (fitnessViewedDate === todayKey()) return `${name} · today`;
  if (fitnessViewedDate === addDays(todayKey(), -1)) return `${name} · yesterday`;
  const d = new Date(fitnessViewedDate + "T00:00:00");
  return `${name} · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

function renderSession() {
  const day = plan.days[selectedDay];
  const isFuture = fitnessViewedDate > todayKey();
  const done = completedOn(fitnessViewedDate);

  document.getElementById("session-day").textContent = sessionDayLabel();
  document.getElementById("fitness-next-day").disabled = fitnessViewedDate >= todayKey();
  document.getElementById("fitness-today-btn").hidden = fitnessViewedDate === todayKey();
  document.getElementById("session-title-input").value = day.title;

  const list = document.getElementById("exercise-list");
  list.innerHTML = "";

  if (day.exercises.length === 0) {
    list.innerHTML = `<li class="empty-state">Rest day — add an exercise to make it a session.</li>`;
    return;
  }

  for (const ex of day.exercises) {
    const isDone = !isFuture && done.includes(ex.id);

    const li = document.createElement("li");
    li.className = "exercise-row" + (isDone ? " done" : "");

    if (!isFuture) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isDone;
      checkbox.addEventListener("change", () => toggleExerciseDone(ex.id));
      li.appendChild(checkbox);
    }

    const body = document.createElement("div");
    body.className = "exercise-body";

    const name = document.createElement("span");
    name.className = "exercise-name";
    name.textContent = ex.name;

    const detail = document.createElement("span");
    detail.className = "exercise-detail";
    detail.textContent = exerciseDetail(ex);

    body.append(name, detail);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Remove ${ex.name}`);
    deleteBtn.addEventListener("click", () => deleteExercise(ex.id));

    li.append(body, deleteBtn);
    list.appendChild(li);
  }
}

window.renderFitness = function renderFitness() {
  const todayExercises = plan.days[todayIndex].exercises;
  const doneCount = completedToday().filter((id) => todayExercises.some((ex) => ex.id === id)).length;

  document.getElementById("fitness-traindays").textContent = `${trainedThisWeek()}/${TRAIN_TARGET}`;
  document.getElementById("fitness-today").textContent = `${doneCount}/${todayExercises.length}`;

  renderWeekStrip();
  renderSession();
  if (window.renderOverview) window.renderOverview();
};

document.getElementById("session-title-input").addEventListener("input", (e) => {
  plan.days[selectedDay].title = e.target.value;
  savePlan();
  renderWeekStrip();
});

document.getElementById("fitness-prev-day").addEventListener("click", () => shiftFitnessDay(-1));
document.getElementById("fitness-next-day").addEventListener("click", () => shiftFitnessDay(1));
document.getElementById("fitness-today-btn").addEventListener("click", () => {
  fitnessViewedDate = todayKey();
  selectedDay = todayIndex;
  window.renderFitness();
});

const exerciseToggleBtn = document.getElementById("add-exercise-toggle-btn");
const exerciseForm = document.getElementById("add-exercise-form");

exerciseToggleBtn.addEventListener("click", () => {
  exerciseToggleBtn.hidden = true;
  exerciseForm.hidden = false;
  document.getElementById("exercise-name-input").focus();
});

exerciseForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("exercise-name-input");
  const setsInput = document.getElementById("exercise-sets-input");
  const repsInput = document.getElementById("exercise-reps-input");

  const name = nameInput.value.trim();
  if (name) {
    addExercise(name, parseInt(setsInput.value, 10) || null, repsInput.value.trim());
    nameInput.value = "";
    setsInput.value = "";
    repsInput.value = "";
  }
  exerciseForm.hidden = true;
  exerciseToggleBtn.hidden = false;
});
