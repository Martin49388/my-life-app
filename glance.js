// "At a glance" sidebar (desktop widths only — hidden under 640px, see
// style.css). Pulls live from the same globals every other module already
// uses (habits, goals, plan/TRAIN_TARGET, food, water) — no separate state
// of its own, so it can't drift out of sync with the real tabs.
function renderGlance() {
  const el = document.getElementById("sidebar-content");
  if (!el) return;

  const best = habits.length ? Math.max(...habits.map((h) => currentStreak(h))) : 0;

  const waterMl = waterToday();
  const todayEntries = entriesFor(todayKey());
  const kcalToday = todayEntries.reduce((sum, e) => sum + e.kcal, 0);
  const trained = typeof trainedThisWeek === "function" ? trainedThisWeek() : 0;
  const activeGoal = goals.find((g) => g.current < g.target);

  el.innerHTML = `
    <div class="glance-tile">
      <span class="glance-label">Best streak</span>
      <span class="glance-value">${best}d</span>
    </div>
    <div class="glance-tile">
      <span class="glance-label">Water</span>
      <span class="glance-value">${(waterMl / 1000).toFixed(2)}L</span>
      <span class="glance-sub">of ${(water.target / 1000).toFixed(1)}L</span>
    </div>
    <div class="glance-tile">
      <span class="glance-label">Food</span>
      <span class="glance-value">${kcalToday}</span>
      <span class="glance-sub">of ${food.target} kcal</span>
    </div>
    <div class="glance-tile">
      <span class="glance-label">This week</span>
      <span class="glance-value">${trained}/${TRAIN_TARGET}</span>
      <span class="glance-sub">training days</span>
    </div>
    ${
      activeGoal
        ? `<div class="glance-tile">
            <span class="glance-label">${activeGoal.name}</span>
            <span class="glance-value">${activeGoal.current}/${activeGoal.target}</span>
            <span class="glance-sub">${activeGoal.unit}</span>
          </div>`
        : ""
    }
  `;
}

window.renderGlance = renderGlance;
renderGlance();
