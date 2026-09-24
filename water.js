// Water — lives on the Fuel page (with food.js) and on Overview's Water
// tile. Stored per day under the "water" key, same shape as ever.
const WATER_KEY = "water";
const WATER_TARGET_ML = 4000;
const WATER_STEP_ML = 250;
// Glasses drawn in the Fuel gauge are WATER_STEP_ML each; cap how many so
// a big target doesn't turn into a wall of tiny cells.
const WATER_MAX_GLASSES = 24;

const DEFAULT_WATER = { target: WATER_TARGET_ML, days: {} };

function loadWater() {
  const raw = localStorage.getItem(WATER_KEY);
  if (!raw) return structuredClone(DEFAULT_WATER);
  const saved = JSON.parse(raw);
  return { ...structuredClone(DEFAULT_WATER), ...saved };
}

function saveWater() {
  localStorage.setItem(WATER_KEY, JSON.stringify(water));
}

let water = loadWater();

function waterOn(date) {
  return water.days[date] || 0;
}

function waterToday() {
  return waterOn(todayKey());
}

// Defaults to today (Overview's +250 ml). The Fuel page passes the day
// it's currently showing, so back-filling yesterday works too.
function addWater(deltaMl, date = todayKey()) {
  water.days[date] = Math.max(0, waterOn(date) + deltaMl);
  saveWater();
  renderWater();
}

// The day the Fuel page is showing — food.js's viewedDate, shared so food
// and water always show the same day.
function fuelDate() {
  return typeof viewedDate !== "undefined" ? viewedDate : todayKey();
}

function renderWaterGlasses(ml) {
  const wrap = document.getElementById("water-glasses");
  if (!wrap) return;
  const step = water.target / Math.min(WATER_MAX_GLASSES, Math.max(1, Math.round(water.target / WATER_STEP_ML)));
  const count = Math.round(water.target / step);
  if (wrap.childElementCount !== count) {
    // Set on the whole water block so the buttons can size to match.
    (document.getElementById("fuel-water") || wrap).style.setProperty("--glasses", count);
    wrap.innerHTML = Array.from({ length: count }, () => `<span class="fuel-glass"><span></span></span>`).join("");
  }
  [...wrap.children].forEach((glass, i) => {
    const fill = Math.max(0, Math.min(1, (ml - i * step) / step));
    glass.firstElementChild.style.height = `${Math.round(fill * 100)}%`;
    glass.classList.toggle("is-full", fill >= 1);
  });
}

function renderWater() {
  const date = fuelDate();
  const ml = waterOn(date);
  const totalEl = document.getElementById("water-total");
  if (totalEl) {
    if (window.animateNumber) window.animateNumber(totalEl, ml / 1000, { duration: 300, decimals: 2 });
    else totalEl.textContent = `${(ml / 1000).toFixed(2)}L`;
  }
  const targetEl = document.getElementById("water-target-label");
  if (targetEl) targetEl.textContent = `of ${(water.target / 1000).toFixed(1)}L`;
  const statEl = document.getElementById("fuel-water-stat");
  if (statEl) statEl.textContent = `${(ml / 1000).toFixed(2)}L`;

  const noteEl = document.getElementById("water-note");
  if (noteEl) {
    const left = water.target - ml;
    const glassesLeft = Math.ceil(left / WATER_STEP_ML);
    noteEl.textContent =
      left <= 0
        ? left === 0 ? "Target hit." : `Target hit — ${(-left / 1000).toFixed(2)}L over.`
        : `${glassesLeft} ${glassesLeft === 1 ? "glass" : "glasses"} (${WATER_STEP_ML} ml) to go.`;
    noteEl.classList.toggle("is-met", left <= 0);
  }
  document.getElementById("fuel-water")?.classList.toggle("is-met", ml >= water.target);
  renderWaterGlasses(ml);

  if (window.renderOverview) window.renderOverview();
}
window.renderWater = renderWater;

document.getElementById("water-add-btn").addEventListener("click", () => addWater(WATER_STEP_ML, fuelDate()));
document.getElementById("water-remove-btn").addEventListener("click", () => addWater(-WATER_STEP_ML, fuelDate()));

renderWater();
