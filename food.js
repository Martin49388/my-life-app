// The FoodData Central key lives in Settings -> "Food lookup", stored per
// device in localStorage — NOT config.js. config.js is gitignored, so a
// key pasted there only ever exists on whichever single machine someone
// edited it on, invisible to any other device (a phone opening the live
// GitHub Pages link, for instance). Same reasoning, same fix, as Markets'
// and Alfred's keys — see CLAUDE.md for the fuller story.
const FOODDATA_KEY_STORAGE = "fooddata-api-key";

function foodDataKey() {
  return localStorage.getItem(FOODDATA_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.FOODDATA_API_KEY) || "";
}

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
  target: 3500,
  // Grams a day. null = suggest one from body weight (see proteinTarget).
  proteinTarget: null,
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
  addEntryOn(viewedDate, name, kcal, protein, meal);
}

// Same as addEntry but for any day — Alfred and the check-in log to today
// whatever day the Fuel page happens to be showing.
function addEntryOn(date, name, kcal, protein, meal) {
  if (!food.days[date]) food.days[date] = [];
  food.days[date].push({ id: crypto.randomUUID(), name, kcal, protein: protein || 0, meal: meal || defaultMeal() });
  saveFood();
  window.renderFood();
}

// The daily protein goal: whatever Martin set, else ~1.8 g per kg of the
// latest logged body weight, else 150 g.
function proteinTarget() {
  if (food.proteinTarget > 0) return food.proteinTarget;
  const kg = (window.latestWeight && window.latestWeight()?.kg) || food.body.weight;
  return kg ? Math.round((kg * 1.8) / 5) * 5 : 150;
}

function proteinOn(date) {
  return entriesFor(date).reduce((sum, e) => sum + (e.protein || 0), 0);
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

  const budgetEl = document.getElementById("budget-number");
  if (window.animateNumber) window.animateNumber(budgetEl, Math.abs(remaining));
  else budgetEl.textContent = Math.abs(remaining).toLocaleString();
  document.getElementById("budget-caption").textContent = over ? "kcal over" : "kcal left";
  document.getElementById("budget-number").classList.toggle("over", over);
  const eatenEl = document.getElementById("fuel-eaten-caption");
  if (eatenEl) eatenEl.textContent = ` · ${consumed.toLocaleString()} of ${target.toLocaleString()} eaten`;

  const protein = entries.reduce((sum, e) => sum + (e.protein || 0), 0);
  const pGoal = proteinTarget();
  document.getElementById("protein-total").textContent = `${protein} / ${pGoal} g`;
  const pFill = document.getElementById("protein-bar-fill");
  if (pFill) {
    pFill.style.width = `${Math.min(100, (protein / pGoal) * 100)}%`;
    pFill.parentElement.classList.toggle("is-met", protein >= pGoal);
  }

  // One bar, split into a segment per meal: full width is the target, so
  // how much is left reads straight off it. (The old Target/Maintain pins
  // sitting on the bar were hard to read — maintenance is now a line in
  // the legend instead.)
  const maintain = maintenanceCalories() ?? food.maintenance;
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
  }).join("") + (maintain ? `<span class="legend-item legend-maintain">Maintenance ≈ ${maintain.toLocaleString()} kcal</span>` : "");
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

// The stops themselves live on the main budget bar; this just states the gap
// between target and maintenance in words.
function renderScale() {
  const maintain = maintenanceCalories() ?? food.maintenance;
  const relation = document.getElementById("scale-relation");

  if (!maintain) {
    relation.textContent = "Fill in weight, height and age to place the maintenance stop on the bar.";
    return;
  }
  const diff = food.target - maintain;
  if (diff === 0) relation.textContent = "Your target sits exactly at maintenance.";
  else relation.textContent = `Your target is ${Math.abs(diff).toLocaleString()} kcal ${diff > 0 ? "above" : "below"} maintenance.`;
}

window.renderFood = function renderFood() {
  document.getElementById("kcal-target-input").value = food.target;
  const pInput = document.getElementById("protein-target-input");
  if (pInput && document.activeElement !== pInput) pInput.value = proteinTarget();
  document.getElementById("food-date-label").textContent = formatDateLabel(viewedDate);
  renderEstimator();
  renderBudget();
  renderQuickAdd();
  renderMeals();
  // Water shares Fuel's day switcher, so it follows the same day.
  if (window.renderWater) window.renderWater();
  if (window.renderGlance) window.renderGlance();
  if (window.renderOverview) window.renderOverview();
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
// Tapping the date itself jumps back to today.
document.getElementById("food-date-label").addEventListener("click", () => {
  if (viewedDate === todayKey()) return;
  viewedDate = todayKey();
  window.renderFood();
});

document.getElementById("kcal-target-input").addEventListener("change", (e) => {
  const value = parseInt(e.target.value, 10);
  if (value > 0) {
    food.target = value;
    saveFood();
  }
  window.renderFood();
});

document.getElementById("protein-target-input")?.addEventListener("change", (e) => {
  const value = parseInt(e.target.value, 10);
  food.proteinTarget = value > 0 ? value : null;
  saveFood();
  window.renderFood();
});

window.proteinTarget = proteinTarget;
window.proteinOn = proteinOn;
window.addEntryOn = addEntryOn;

const foodToggleBtn = document.getElementById("add-food-toggle-btn");
const foodForm = document.getElementById("add-food-form");
const foodLookupBtn = document.getElementById("food-lookup-btn");
const foodLookupResults = document.getElementById("food-lookup-results");

// FoodData Central (USDA) — free-tier nutrition lookup. Client-side key
// (no backend in this app) — see foodDataKey() above for where it lives.
async function lookupFood(query) {
  const key = foodDataKey();
  foodLookupResults.innerHTML = "";
  if (!key) {
    foodLookupResults.innerHTML = `<li class="food-lookup-empty">No FoodData Central key set — add one in Settings under Food lookup.</li>`;
    foodLookupResults.hidden = false;
    return;
  }

  foodLookupResults.innerHTML = `<li class="food-lookup-empty">Searching…</li>`;
  foodLookupResults.hidden = false;

  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&pageSize=6`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const foods = data.foods || [];

    if (foods.length === 0) {
      foodLookupResults.innerHTML = `<li class="food-lookup-empty">No matches.</li>`;
      return;
    }

    foodLookupResults.innerHTML = "";
    for (const item of foods) {
      const nutrient = (id) => {
        const n = (item.foodNutrients || []).find((fn) => fn.nutrientId === id);
        return n ? Math.round(n.value) : null;
      };
      const kcal = nutrient(1008); // Energy (KCAL)
      const protein = nutrient(1003); // Protein (g)

      const li = document.createElement("li");
      li.className = "food-lookup-item";
      li.textContent = `${item.description}${kcal != null ? ` — ${kcal} kcal` : ""}${protein != null ? `, ${protein}g protein` : ""}`;
      li.addEventListener("click", () => {
        document.getElementById("food-name-input").value = item.description;
        if (kcal != null) document.getElementById("food-kcal-input").value = kcal;
        if (protein != null) document.getElementById("food-protein-input").value = protein;
        foodLookupResults.hidden = true;
        foodLookupResults.innerHTML = "";
      });
      foodLookupResults.appendChild(li);
    }
  } catch (err) {
    foodLookupResults.innerHTML = `<li class="food-lookup-empty">Lookup failed — try again.</li>`;
  }
}

foodLookupBtn.addEventListener("click", () => {
  const query = document.getElementById("food-name-input").value.trim();
  if (query) lookupFood(query);
});

foodToggleBtn.addEventListener("click", () => {
  foodToggleBtn.hidden = true;
  foodForm.hidden = false;
  foodLookupResults.hidden = true;
  foodLookupResults.innerHTML = "";
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
  foodLookupResults.hidden = true;
  foodLookupResults.innerHTML = "";
  foodForm.hidden = true;
  foodToggleBtn.hidden = false;
});

const foodDataForm = document.getElementById("fooddata-config-form");
const foodDataInput = document.getElementById("fooddata-key-input");
const foodDataKeyStatus = document.getElementById("fooddata-key-status");

function renderFoodDataKeyStatus() {
  const key = localStorage.getItem(FOODDATA_KEY_STORAGE);
  foodDataInput.value = key || "";
  foodDataKeyStatus.textContent = key ? "Key saved on this device." : "Not set on this device";
}

if (foodDataForm) {
  foodDataForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = foodDataInput.value.trim();
    if (value) localStorage.setItem(FOODDATA_KEY_STORAGE, value);
    else localStorage.removeItem(FOODDATA_KEY_STORAGE);
    renderFoodDataKeyStatus();
  });
  renderFoodDataKeyStatus();
}
