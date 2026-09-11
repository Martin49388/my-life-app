const GOALS_KEY = "goals";

// Goals saved before the term field existed default to short-term.
function loadGoals() {
  const raw = localStorage.getItem(GOALS_KEY);
  if (!raw) return [];
  return JSON.parse(raw).map((g) => ({ term: "short", ...g }));
}

function saveGoals(goals) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
}

let goals = loadGoals();

function addGoal(name, term, target, unit, deadline) {
  goals.push({
    id: crypto.randomUUID(),
    name,
    term,
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

function buildGoalRow(goal) {
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
  return li;
}

function renderGoalGroup(listId, term) {
  const list = document.getElementById(listId);
  list.innerHTML = "";
  const groupGoals = goals.filter((g) => g.term === term);

  if (groupGoals.length === 0) {
    list.innerHTML = `<li class="empty-state">No ${term === "short" ? "short-term" : "long-term"} goals yet.</li>`;
    return;
  }

  for (const goal of groupGoals) {
    list.appendChild(buildGoalRow(goal));
  }
}

window.renderGoals = function renderGoals() {
  const active = goals.filter((g) => g.current < g.target);
  document.getElementById("goals-active-count").textContent = active.length;
  document.getElementById("goals-done-count").textContent = goals.length - active.length;
  document.getElementById("horizon-count-short").textContent = active.filter((g) => g.term === "short").length;
  document.getElementById("horizon-count-long").textContent = active.filter((g) => g.term === "long").length;

  renderGoalGroup("goal-list-short", "short");
  renderGoalGroup("goal-list-long", "long");
  syncViewportHeight(false);
};

// Horizon carousel: the two panels sit side by side in a track twice the
// viewport's width. Swiping drags the track with your finger and snaps on
// release; the rail fill tracks that movement so the nav reads as a
// position along the time axis rather than a pair of toggles.
const goalTrack = document.getElementById("goal-carousel-track");
const goalViewport = document.getElementById("goal-carousel-viewport");
const railFill = document.getElementById("horizon-rail-fill");
const horizonNodes = document.querySelectorAll(".horizon-node");
const goalPanels = goalTrack.children;
let goalPanelIndex = 0; // 0 = short-term (near), 1 = long-term (far)

function syncViewportHeight(useTallest) {
  const heights = [goalPanels[0].offsetHeight, goalPanels[1].offsetHeight];
  goalViewport.style.height = `${useTallest ? Math.max(...heights) : heights[goalPanelIndex]}px`;
}

function setGoalPanel(index, animate = true) {
  goalPanelIndex = Math.max(0, Math.min(1, index));
  goalTrack.style.transition = animate ? "" : "none";
  goalTrack.style.transform = `translateX(-${goalPanelIndex * 50}%)`;
  railFill.style.width = `${goalPanelIndex * 100}%`;
  horizonNodes.forEach((node, i) => node.classList.toggle("active", i === goalPanelIndex));
  syncViewportHeight(false);
}

horizonNodes.forEach((node, i) => {
  node.addEventListener("click", () => setGoalPanel(i));
});

let touchStartX = null;
let dragging = false;

goalViewport.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  dragging = true;
  goalTrack.style.transition = "none";
  syncViewportHeight(true);
});

goalViewport.addEventListener("touchmove", (e) => {
  if (!dragging) return;
  const deltaX = e.touches[0].clientX - touchStartX;
  const viewportWidth = goalViewport.offsetWidth;
  // Resist dragging past either end so the track feels bounded.
  const atEdge = (goalPanelIndex === 0 && deltaX > 0) || (goalPanelIndex === 1 && deltaX < 0);
  const applied = atEdge ? deltaX * 0.25 : deltaX;
  goalTrack.style.transform = `translateX(calc(-${goalPanelIndex * 50}% + ${applied}px))`;
  railFill.style.width = `${Math.max(0, Math.min(100, goalPanelIndex * 100 - (applied / viewportWidth) * 100))}%`;
});

goalViewport.addEventListener("touchend", (e) => {
  if (!dragging) return;
  dragging = false;
  goalTrack.style.transition = "";
  const deltaX = e.changedTouches[0].clientX - touchStartX;
  const SWIPE_THRESHOLD = 45;
  if (deltaX < -SWIPE_THRESHOLD) setGoalPanel(goalPanelIndex + 1);
  else if (deltaX > SWIPE_THRESHOLD) setGoalPanel(goalPanelIndex - 1);
  else setGoalPanel(goalPanelIndex);
});

window.addEventListener("resize", () => syncViewportHeight(false));

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
  const termInput = document.getElementById("goal-term-input");
  const targetInput = document.getElementById("goal-target-input");
  const unitInput = document.getElementById("goal-unit-input");
  const deadlineInput = document.getElementById("goal-deadline-input");

  const name = nameInput.value.trim();
  const target = parseInt(targetInput.value, 10);
  if (name && target > 0) {
    addGoal(name, termInput.value, target, unitInput.value.trim(), deadlineInput.value);
    nameInput.value = "";
    targetInput.value = "";
    unitInput.value = "";
    deadlineInput.value = "";
    termInput.value = "short";
  }
  goalForm.hidden = true;
  goalToggleBtn.hidden = false;
});
