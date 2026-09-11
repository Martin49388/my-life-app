const GOALS_KEY = "goals";

function loadGoals() {
  const raw = localStorage.getItem(GOALS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveGoals(goals) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
}

let goals = loadGoals();

function addGoal(name, target, unit, deadline) {
  goals.push({
    id: crypto.randomUUID(),
    name,
    target,
    unit: unit || "done",
    current: 0,
    deadline: deadline || null,
  });
  saveGoals(goals);
  window.renderGoals();
}

function adjustGoal(id, delta) {
  const goal = goals.find((g) => g.id === id);
  goal.current = Math.max(0, Math.min(goal.target, goal.current + delta));
  saveGoals(goals);
  window.renderGoals();
}

function deleteGoal(id) {
  goals = goals.filter((g) => g.id !== id);
  saveGoals(goals);
  window.renderGoals();
}

function daysUntil(deadline) {
  const diff = new Date(deadline + "T00:00:00") - new Date(new Date().toDateString());
  return Math.round(diff / 86400000);
}

function deadlineLabel(deadline) {
  const days = daysUntil(deadline);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true };
  if (days === 0) return { text: "due today", overdue: false };
  return { text: `${days}d left`, overdue: false };
}

window.renderGoals = function renderGoals() {
  const list = document.getElementById("goal-list");
  list.innerHTML = "";

  document.getElementById("goals-active-count").textContent = goals.filter((g) => g.current < g.target).length;
  document.getElementById("goals-done-count").textContent = goals.filter((g) => g.current >= g.target).length;

  if (goals.length === 0) {
    list.innerHTML = `<li class="empty-state">No goals yet — add your first one below.</li>`;
    return;
  }

  for (const goal of goals) {
    const isComplete = goal.current >= goal.target;
    const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));

    const li = document.createElement("li");
    li.className = "goal-row" + (isComplete ? " complete" : "");

    const top = document.createElement("div");
    top.className = "goal-top";

    const name = document.createElement("span");
    name.className = "goal-name";
    name.textContent = goal.name;

    const badge = document.createElement("span");
    if (isComplete) {
      badge.className = "goal-badge goal-badge-complete";
      badge.textContent = "✓ Complete";
    } else if (goal.deadline) {
      const { text, overdue } = deadlineLabel(goal.deadline);
      badge.className = "goal-badge" + (overdue ? " goal-badge-overdue" : "");
      badge.textContent = text;
    }

    top.append(name, badge);

    const barTrack = document.createElement("div");
    barTrack.className = "goal-bar-track";
    const barFill = document.createElement("div");
    barFill.className = "goal-bar-fill";
    barFill.style.width = `${pct}%`;
    barTrack.appendChild(barFill);

    const bottom = document.createElement("div");
    bottom.className = "goal-bottom";

    const progressText = document.createElement("span");
    progressText.className = "goal-progress-text";
    progressText.textContent = `${goal.current}/${goal.target} ${goal.unit}`;

    const controls = document.createElement("div");
    controls.className = "goal-controls";

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "goal-step-btn";
    minusBtn.textContent = "−";
    minusBtn.disabled = goal.current <= 0;
    minusBtn.addEventListener("click", () => adjustGoal(goal.id, -1));

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "goal-step-btn";
    plusBtn.textContent = "+";
    plusBtn.disabled = isComplete;
    plusBtn.addEventListener("click", () => adjustGoal(goal.id, 1));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Delete ${goal.name}`);
    deleteBtn.addEventListener("click", () => deleteGoal(goal.id));

    controls.append(minusBtn, plusBtn, deleteBtn);
    bottom.append(progressText, controls);

    li.append(top, barTrack, bottom);
    list.appendChild(li);
  }
};

const goalToggleBtn = document.getElementById("add-goal-toggle-btn");
const goalForm = document.getElementById("add-goal-form");

goalToggleBtn.addEventListener("click", () => {
  goalToggleBtn.hidden = true;
  goalForm.hidden = false;
  document.getElementById("goal-name-input").focus();
});

goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("goal-name-input");
  const targetInput = document.getElementById("goal-target-input");
  const unitInput = document.getElementById("goal-unit-input");
  const deadlineInput = document.getElementById("goal-deadline-input");

  const name = nameInput.value.trim();
  const target = parseInt(targetInput.value, 10);
  if (name && target > 0) {
    addGoal(name, target, unitInput.value.trim(), deadlineInput.value);
    nameInput.value = "";
    targetInput.value = "";
    unitInput.value = "";
    deadlineInput.value = "";
  }
  goalForm.hidden = true;
  goalToggleBtn.hidden = false;
});
