const WATER_KEY = "water";
const WATER_TARGET_ML = 4000;
const WATER_STEP_ML = 250;

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

function waterToday() {
  return water.days[todayKey()] || 0;
}

function addWater(deltaMl) {
  const key = todayKey();
  const next = Math.max(0, (water.days[key] || 0) + deltaMl);
  water.days[key] = next;
  saveWater();
  renderWater();
}

function renderWater() {
  const ml = waterToday();
  const liters = (ml / 1000).toFixed(2);
  const targetLiters = (water.target / 1000).toFixed(1);
  const pct = Math.min(100, Math.round((ml / water.target) * 100));

  const totalEl = document.getElementById("water-total");
  if (window.animateNumber) window.animateNumber(totalEl, ml / 1000, { duration: 300, decimals: 2 });
  else totalEl.textContent = `${liters}L`;
  document.getElementById("water-target-label").textContent = `of ${targetLiters}L`;
  document.getElementById("water-bar").style.width = `${pct}%`;
  if (window.renderGlance) window.renderGlance();
  if (window.renderOverview) window.renderOverview();
}

document.getElementById("water-add-btn").addEventListener("click", () => addWater(WATER_STEP_ML));
document.getElementById("water-remove-btn").addEventListener("click", () => addWater(-WATER_STEP_ML));

renderWater();
