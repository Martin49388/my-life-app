const FOOD_KEY = "food";
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const MAX_QUICK_ADD = 8;

const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

// target and maintenance are stored separately and never write to each other —
// they're two independent stops on the scale.
const DEFAULT_FOOD = {
  target: 2000,
  maintenance: null,
  days: {},
  showEstimator: false,
  body: { weight: null, height: null, age: null, sex: "male", activity: "moderate" },
};

function loadFood() {
  const raw = localStorage.getItem(FOOD_KEY);
  if (!raw) return structuredClone(DEFAULT_FOOD);
  const saved = JSON.parse(raw);
  return { ...structuredClone(DEFAULT_FOOD), ...saved, body: { ...DEFAULT_FOOD.body, ...saved.body } };
}

// Mifflin-St Jeor: the equation most fitness tools use. Needs age and sex
// as well as size — without them the result drifts by hundreds of kcal.
function maintenanceCalories() {
  const { weight, height, age, sex, activity } = food.body;
  if (!weight || !height || !age) return null;
  const base = 10 * weight + 6.25 * height - 5 * age;
  const bmr = sex === "female" ? base - 161 : base + 5;
  return Math.round(bmr * ACTIVITY_FACTORS[activity]);
}

function saveFood() {
  localStorage.setItem(FOOD_KEY, JSON.stringify(food));
}

let food = loadFood();
let viewedDate = todayKey();

function entriesFor(date) {
  return food.days[date] || [];
}

// Whichever meal you're most likely logging right now.
function defaultMeal() {
  const hour = new Date().getHours();
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  if (hour < 21) return "Dinner";
  return "Snacks";
}

function addEntry(name, kcal, protein, meal) {
  if (!food.days[viewedDate]) food.days[viewedDate] = [];
  food.days[viewedDate].push({ id: crypto.randomUUID(), name, kcal, protein: protein || 0, meal });
  saveFood();
  window.renderFood();
}

function deleteEntry(id) {
  food.days[viewedDate] = entriesFor(viewedDate).filter((e) => e.id !== id);
  saveFood();
  window.renderFood();
}

function shiftDay(delta) {
  viewedDate = addDays(viewedDate, delta);
  window.renderFood();
}

function formatDateLabel(date) {
  const d = new Date(date + "T00:00:00");
  const label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (date === todayKey()) return `${label} · today`;
  if (date === addDays(todayKey(), -1)) return `${label} · yesterday`;
  return label;
}

// Most recently logged foods across all days, newest first, one per name.
function recentFoods() {
  const seen = new Map();
  const dates = Object.keys(food.days).sort().reverse();
  for (const date of dates) {
    for (const entry of [...entriesFor(date)].reverse()) {
      const key = entry.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, entry);
      if (seen.size >= MAX_QUICK_ADD) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

function renderBudget() {
  const entries = entriesFor(viewedDate);
  const consumed = entries.reduce((sum, e) => sum + e.kcal, 0);
  const target = food.target;
  const remaining = target - consumed;
  const over = remaining < 0;

  document.getElementById("budget-number").textContent = Math.abs(remaining).toLocaleString();
  document.getElementById("budget-caption").textContent = over ? "kcal over" : "kcal left";
  document.getElementById("budget-number").classList.toggle("over", over);

  document.getElementById("protein-total").textContent =
    `${entries.reduce((sum, e) => sum + (e.protein || 0), 0)}g`;

  // One bar, split into a segment per meal: shows how much of the budget is
  // gone and where it went, without needing a second chart.
  const scale = Math.max(target, consumed) || 1;
  const bar = document.getElementById("budget-bar");
  bar.innerHTML = "";
  bar.classList.toggle("over", over);

  MEALS.forEach((meal, i) => {
    const mealTotal = entries.filter((e) => e.meal === meal).reduce((sum, e) => sum + e.kcal, 0);
    if (mealTotal === 0) return;
    const seg = document.createElement("div");
    seg.className = `budget-seg seg-${i}`;
    seg.style.width = `${(mealTotal / scale) * 100}%`;
    seg.title = `${meal}: ${mealTotal} kcal`;
    bar.appendChild(seg);
  });

  const legend = document.getElementById("budget-legend");
  legend.innerHTML = MEALS.map((meal, i) => {
    const mealTotal = entries.filter((e) => e.meal === meal).reduce((sum, e) => sum + e.kcal, 0);
    if (mealTotal === 0) return "";
    return `<span class="legend-item"><span class="legend-swatch seg-${i}"></span>${meal} ${mealTotal}</span>`;
  }).join("");
}

function renderQuickAdd() {
  const container = document.getElementById("quick-add");
  const recents = recentFoods();
  container.innerHTML = "";
  if (recents.length === 0) return;

  const label = document.createElement("span");
  label.className = "quick-add-label";
  label.textContent = "Again:";
  container.appendChild(label);

  for (const item of recents) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-chip";
    chip.innerHTML = `${item.name} <span class="quick-chip-kcal">${item.kcal}</span>`;
    chip.addEventListener("click", () => addEntry(item.name, item.kcal, item.protein, defaultMeal()));
    container.appendChild(chip);
  }
}

function renderMeals() {
  const entries = entriesFor(viewedDate);
  const container = document.getElementById("meal-groups");
  container.innerHTML = "";

  if (entries.length === 0) {
    container.innerHTML = `<p class="empty-state">Nothing logged yet for this day.</p>`;
    return;
  }

  MEALS.forEach((meal, i) => {
    const mealEntries = entries.filter((e) => e.meal === meal);
    if (mealEntries.length === 0) return;

    const group = document.createElement("div");
    group.className = "meal-group";

    const head = document.createElement("div");
    head.className = "meal-head";
    head.innerHTML = `
      <span class="meal-name"><span class="legend-swatch seg-${i}"></span>${meal}</span>
      <span class="meal-total">${mealEntries.reduce((s, e) => s + e.kcal, 0)} kcal</span>`;

    const list = document.createElement("ul");
    list.className = "food-list";

    for (const entry of mealEntries) {
      const li = document.createElement("li");
      li.className = "food-row";

      const name = document.createElement("span");
      name.className = "food-name";
      name.textContent = entry.name;

      const macros = document.createElement("span");
      macros.className = "food-macros";
      macros.textContent = entry.protein ? `${entry.kcal} kcal · ${entry.protein}g P` : `${entry.kcal} kcal`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.setAttribute("aria-label", `Remove ${entry.name}`);
      deleteBtn.addEventListener("click", () => deleteEntry(entry.id));

      li.append(name, macros, deleteBtn);
      list.appendChild(li);
    }

    group.append(head, list);
    container.appendChild(group);
  });
}

function renderEstimator() {
  const toggle = document.getElementById("estimator-toggle-btn");
  const panel = document.getElementById("estimator");

  panel.hidden = !food.showEstimator;
  toggle.classList.toggle("on", food.showEstimator);
  toggle.setAttribute("aria-pressed", String(food.showEstimator));

  document.getElementById("body-weight").value = food.body.weight ?? "";
  document.getElementById("body-height").value = food.body.height ?? "";
  document.getElementById("body-age").value = food.body.age ?? "";
  document.getElementById("body-sex").value = food.body.sex;
  document.getElementById("body-activity").value = food.body.activity;

  const estimate = maintenanceCalories();
  document.getElementById("estimator-value").textContent = estimate ? estimate.toLocaleString() : "—";

  const pinBtn = document.getElementById("pin-maintenance-btn");
  pinBtn.disabled = !estimate;
  pinBtn.textContent = estimate && estimate === food.maintenance ? "Maintenance set" : "Set as maintenance";

  const useBtn = document.getElementById("use-estimate-btn");
  useBtn.disabled = !estimate;
  useBtn.textContent = estimate && estimate === food.target ? "Is target" : "Set as target";

  renderScale();
}

// One axis carrying all three numbers: today's intake as a filled bar, with a
// stop marking the target and another marking maintenance. The two stops are
// independent values, so they only coincide if you deliberately match them.
function renderScale() {
  const eaten = entriesFor(viewedDate).reduce((sum, e) => sum + e.kcal, 0);
  const target = food.target;
  const maintain = food.maintenance;
  const ceiling = Math.max(eaten, target, maintain || 0) * 1.08 || 1;
  const pct = (value) => `${Math.min(100, (value / ceiling) * 100)}%`;

  document.getElementById("scale-eaten").style.width = pct(eaten);
  document.getElementById("scale-eaten").classList.toggle("over", eaten > target);
  document.getElementById("scale-tick-target").style.left = pct(target);

  const maintainStop = document.getElementById("scale-tick-maintain");
  maintainStop.hidden = !maintain;
  if (maintain) maintainStop.style.left = pct(maintain);

  document.getElementById("scale-legend").innerHTML = `
    <span class="legend-item"><span class="scale-key key-eaten"></span>Eaten ${eaten.toLocaleString()}</span>
    <span class="legend-item"><span class="scale-key key-target"></span>Target ${target.toLocaleString()}</span>
    ${maintain ? `<span class="legend-item"><span class="scale-key key-maintain"></span>Maintain ${maintain.toLocaleString()}</span>` : ""}`;

  const relation = document.getElementById("scale-relation");
  if (!maintain) {
    relation.textContent = "Set a maintenance figure to see it as a second stop on the line.";
    return;
  }
  const diff = target - maintain;
  if (diff === 0) relation.textContent = "Your target sits exactly at maintenance.";
  else relation.textContent = `Your target is ${Math.abs(diff).toLocaleString()} kcal ${diff > 0 ? "above" : "below"} maintenance.`;
}

window.renderFood = function renderFood() {
  document.getElementById("kcal-target-input").value = food.target;
  document.getElementById("food-date-label").textContent = formatDateLabel(viewedDate);
  renderEstimator();
  renderBudget();
  renderQuickAdd();
  renderMeals();
};

document.getElementById("estimator-toggle-btn").addEventListener("click", () => {
  food.showEstimator = !food.showEstimator;
  saveFood();
  renderEstimator();
});

const BODY_FIELDS = {
  "body-weight": "weight",
  "body-height": "height",
  "body-age": "age",
  "body-sex": "sex",
  "body-activity": "activity",
};

for (const [elementId, key] of Object.entries(BODY_FIELDS)) {
  document.getElementById(elementId).addEventListener("input", (e) => {
    const raw = e.target.value;
    food.body[key] = e.target.type === "number" ? parseFloat(raw) || null : raw;
    saveFood();
    renderEstimator();
  });
}

document.getElementById("pin-maintenance-btn").addEventListener("click", () => {
  const estimate = maintenanceCalories();
  if (!estimate) return;
  food.maintenance = estimate;
  saveFood();
  window.renderFood();
});

document.getElementById("use-estimate-btn").addEventListener("click", () => {
  const estimate = maintenanceCalories();
  if (!estimate) return;
  food.target = estimate;
  saveFood();
  window.renderFood();
});

document.getElementById("food-prev-day").addEventListener("click", () => shiftDay(-1));
document.getElementById("food-next-day").addEventListener("click", () => shiftDay(1));

document.getElementById("kcal-target-input").addEventListener("change", (e) => {
  const value = parseInt(e.target.value, 10);
  if (value > 0) {
    food.target = value;
    saveFood();
  }
  window.renderFood();
});

const foodToggleBtn = document.getElementById("add-food-toggle-btn");
const foodForm = document.getElementById("add-food-form");

foodToggleBtn.addEventListener("click", () => {
  foodToggleBtn.hidden = true;
  foodForm.hidden = false;
  document.getElementById("food-meal-input").value = defaultMeal();
  document.getElementById("food-name-input").focus();
});

foodForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("food-name-input");
  const kcalInput = document.getElementById("food-kcal-input");
  const proteinInput = document.getElementById("food-protein-input");
  const mealInput = document.getElementById("food-meal-input");

  const name = nameInput.value.trim();
  const kcal = parseInt(kcalInput.value, 10);
  if (name && kcal >= 0) {
    addEntry(name, kcal, parseInt(proteinInput.value, 10) || 0, mealInput.value);
    nameInput.value = "";
    kcalInput.value = "";
    proteinInput.value = "";
  }
  foodForm.hidden = true;
  foodToggleBtn.hidden = false;
});
