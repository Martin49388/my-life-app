const FOOD_KEY = "food";
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const MAX_QUICK_ADD = 8;

function loadFood() {
  const raw = localStorage.getItem(FOOD_KEY);
  return raw ? JSON.parse(raw) : { target: 2000, days: {} };
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

window.renderFood = function renderFood() {
  document.getElementById("kcal-target-input").value = food.target;
  document.getElementById("food-date-label").textContent = formatDateLabel(viewedDate);
  renderBudget();
  renderQuickAdd();
  renderMeals();
};

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
