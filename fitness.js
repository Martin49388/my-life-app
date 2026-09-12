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
const todayIndex = (new Date().getDay() + 6) % 7;
let selectedDay = todayIndex;

function completedToday() {
  return plan.log[todayKey()] || [];
}

// Monday of the current week, through today — future days in the week
// can't have been trained yet, so they don't count against the target.
function weekDatesSoFar() {
  const mondayOffset = -((new Date().getDay() + 6) % 7);
  const monday = addDays(todayKey(), mondayOffset);
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
  const date = todayKey();
  const done = new Set(plan.log[date] || []);
  if (done.has(exerciseId)) done.delete(exerciseId);
  else done.add(exerciseId);
  plan.log[date] = [...done];
  savePlan();
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
      window.renderFitness();
    });
    strip.appendChild(btn);
  });
}

function renderSession() {
  const day = plan.days[selectedDay];
  const isToday = selectedDay === todayIndex;
  const done = completedToday();

  document.getElementById("session-day").textContent =
    DAY_NAMES[selectedDay] + (isToday ? " · today" : "");
  document.getElementById("session-title-input").value = day.title;

  const list = document.getElementById("exercise-list");
  list.innerHTML = "";

  if (day.exercises.length === 0) {
    list.innerHTML = `<li class="empty-state">Rest day — add an exercise to make it a session.</li>`;
    return;
  }

  for (const ex of day.exercises) {
    const isDone = isToday && done.includes(ex.id);

    const li = document.createElement("li");
    li.className = "exercise-row" + (isDone ? " done" : "");

    if (isToday) {
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
  if (window.renderGlance) window.renderGlance();
  if (window.renderOverview) window.renderOverview();
};

document.getElementById("session-title-input").addEventListener("input", (e) => {
  plan.days[selectedDay].title = e.target.value;
  savePlan();
  renderWeekStrip();
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
