// Daily check-in — one sheet instead of visiting five sections every
// morning: sleep + how it felt (Recovery), body weight (Fuel), water so
// far (Fuel), and today's habits (Habits).
//
// Every control writes straight through to the module that owns the data
// (recoverySet, logWeight, addWater, toggleDate), so there's nothing to
// "save" and closing early loses nothing. "Done" only records that the
// check-in happened today (key "checkin-log"), which is what Overview's
// button reads to show "Check-in done".

(function () {
  const LOG_KEY = "checkin-log";
  const SLEEP_CHOICES = [300, 360, 390, 420, 450, 480, 510, 540];

  function loadLog() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function doneToday() {
    return Boolean(loadLog()[todayKey()]);
  }

  function markDone() {
    const log = loadLog();
    log[todayKey()] = Date.now();
    // Keep a year of history, no more.
    const keys = Object.keys(log).sort();
    while (keys.length > 366) delete log[keys.shift()];
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function fmtHours(min) {
    const h = min / 60;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
  }

  // ------------------------------------------------------------------ DOM

  const overlay = document.createElement("div");
  overlay.className = "ci-overlay";
  overlay.id = "ci-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ci-sheet" role="dialog" aria-modal="true" aria-labelledby="ci-title">
      <header class="ci-head">
        <div>
          <h2 class="ci-title" id="ci-title">Daily check-in</h2>
          <p class="ci-sub" id="ci-date"></p>
        </div>
        <button type="button" class="ci-close" data-ci="close" aria-label="Close">&#10005;</button>
      </header>
      <div class="ci-body" id="ci-body"></div>
      <footer class="ci-foot">
        <button type="button" class="ci-done" data-ci="done">Done</button>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector("#ci-body");

  function scaleRow(scale, value) {
    return `<div class="ci-scale" role="group" aria-label="${esc(scale.label)}">
      ${scale.words
        .map(
          (w, i) =>
            `<button type="button" class="ci-chip${value === i + 1 ? " is-on" : ""}" data-ci-scale="${scale.id}" data-value="${i + 1}">${esc(w)}</button>`
        )
        .join("")}
    </div>`;
  }

  function render() {
    const today = todayKey();
    overlay.querySelector("#ci-date").textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    // Sleep ---------------------------------------------------------
    const rec = (window.recoveryEntry && window.recoveryEntry(today)) || {};
    const scales = window.RECOVERY_SCALES || [];
    const quality = scales.find((s) => s.id === "quality");
    const energy = scales.find((s) => s.id === "energy");
    const sleepHtml = window.recoverySet
      ? `<section class="ci-step">
          <h3 class="ci-step-title">Sleep</h3>
          <div class="ci-scale ci-hours" role="group" aria-label="Hours slept">
            ${SLEEP_CHOICES.map(
              (m) =>
                `<button type="button" class="ci-chip${rec.sleep === m ? " is-on" : ""}" data-ci-sleep="${m}">${fmtHours(m)}</button>`
            ).join("")}
          </div>
          ${quality ? `<p class="ci-label">How did you sleep?</p>${scaleRow(quality, rec.quality)}` : ""}
          ${energy ? `<p class="ci-label">Energy right now</p>${scaleRow(energy, rec.energy)}` : ""}
        </section>`
      : "";

    // Weight --------------------------------------------------------
    const latest = window.latestWeight ? window.latestWeight() : null;
    const todayKg = window.weightOn ? window.weightOn(today) : null;
    const weightHtml = window.logWeight
      ? `<section class="ci-step">
          <h3 class="ci-step-title">Weight</h3>
          <form class="ci-inline" data-ci-form="weight">
            <input type="number" step="0.1" min="25" max="350" inputmode="decimal" id="ci-weight"
              value="${todayKg ? todayKg.toFixed(1) : ""}" placeholder="${latest ? latest.kg.toFixed(1) : "kg"}" aria-label="Weight in kg" />
            <span class="ci-unit">kg</span>
            <button type="submit" class="ci-btn">${todayKg ? "Update" : "Save"}</button>
          </form>
          <p class="ci-hint">${todayKg ? `Logged: ${todayKg.toFixed(1)} kg` : latest ? `Last: ${latest.kg.toFixed(1)} kg` : "First entry starts your trend."}</p>
        </section>`
      : "";

    // Water ---------------------------------------------------------
    const ml = typeof waterToday === "function" ? waterToday() : 0;
    const target = typeof water !== "undefined" ? water.target : 0;
    const waterHtml =
      typeof addWater === "function"
        ? `<section class="ci-step">
          <h3 class="ci-step-title">Water so far</h3>
          <div class="ci-water">
            <span class="ci-water-value">${(ml / 1000).toFixed(2)}L <span class="ci-hint">of ${(target / 1000).toFixed(1)}L</span></span>
            <span class="ci-water-btns">
              <button type="button" class="ci-btn" data-ci-water="250">+250 ml</button>
              <button type="button" class="ci-btn" data-ci-water="500">+500 ml</button>
            </span>
          </div>
        </section>`
        : "";

    // Habits --------------------------------------------------------
    const list = typeof habits !== "undefined" ? habits : [];
    const habitsHtml = list.length
      ? `<section class="ci-step">
          <h3 class="ci-step-title">Habits today</h3>
          <ul class="ci-habits">
            ${list
              .map((h) => {
                const on = !!h.history[today];
                const weekMet = !on && window.habitSatisfied && window.habitSatisfied(h, today);
                return `<li><button type="button" class="ci-habit${on ? " is-on" : ""}" data-ci-habit="${esc(h.id)}" aria-pressed="${on}">
                  <span class="ci-check" aria-hidden="true"></span>
                  <span class="ci-habit-name">${esc(h.name)}</span>
                  ${weekMet ? `<span class="ci-hint">week done</span>` : ""}
                </button></li>`;
              })
              .join("")}
          </ul>
        </section>`
      : "";

    body.innerHTML = sleepHtml + weightHtml + waterHtml + habitsHtml;
  }

  // ----------------------------------------------------------- Actions

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    render();
    overlay.hidden = false;
    document.body.classList.add("ci-open");
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    overlay.querySelector(".ci-close").focus();
  }

  function close() {
    overlay.classList.remove("is-visible");
    document.body.classList.remove("ci-open");
    overlay.hidden = true;
    if (window.renderOverview) window.renderOverview();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function refreshAfter(fn) {
    fn();
    // Keep whatever is scrolled into view where it is while re-rendering.
    const top = body.scrollTop;
    render();
    body.scrollTop = top;
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) return close();
    const ci = e.target.closest("[data-ci]");
    if (ci && ci.dataset.ci === "close") return close();
    if (ci && ci.dataset.ci === "done") {
      markDone();
      return close();
    }
    const today = todayKey();
    const sleep = e.target.closest("[data-ci-sleep]");
    if (sleep && window.recoverySet) {
      const m = Number(sleep.dataset.ciSleep);
      const cur = (window.recoveryEntry(today) || {}).sleep;
      return refreshAfter(() => window.recoverySet(today, { sleep: cur === m ? 0 : m }));
    }
    const scale = e.target.closest("[data-ci-scale]");
    if (scale && window.recoverySet) {
      const id = scale.dataset.ciScale;
      const v = Number(scale.dataset.value);
      const cur = (window.recoveryEntry(today) || {})[id];
      return refreshAfter(() => window.recoverySet(today, { [id]: cur === v ? 0 : v }));
    }
    const w = e.target.closest("[data-ci-water]");
    if (w && typeof addWater === "function") return refreshAfter(() => addWater(Number(w.dataset.ciWater)));
    const habit = e.target.closest("[data-ci-habit]");
    if (habit && typeof toggleDate === "function") return refreshAfter(() => toggleDate(habit.dataset.ciHabit, today));
  });

  overlay.addEventListener("submit", (e) => {
    const form = e.target.closest('[data-ci-form="weight"]');
    if (!form) return;
    e.preventDefault();
    const v = parseFloat(String(form.querySelector("input").value).replace(",", "."));
    if (window.logWeight && window.logWeight(v)) refreshAfter(() => {});
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });

  // ------------------------------------------------ Overview's button

  function renderCheckinCta() {
    const label = document.getElementById("overview-checkin-label");
    const detail = document.getElementById("overview-checkin-detail");
    const btn = document.getElementById("overview-checkin-btn");
    if (!label || !btn) return;
    const today = todayKey();
    const done = doneToday();
    btn.classList.toggle("is-done", done);
    label.textContent = done ? "Check-in done" : "Start daily check-in";
    if (!done) {
      detail.textContent = "Sleep, weight, water, habits — about a minute";
      return;
    }
    const bits = [];
    const rec = window.recoveryEntry ? window.recoveryEntry(today) : null;
    if (rec && rec.sleep) bits.push(`${fmtHours(rec.sleep)} sleep`);
    const kg = window.weightOn ? window.weightOn(today) : null;
    if (kg) bits.push(`${kg.toFixed(1)} kg`);
    if (typeof habits !== "undefined" && habits.length) {
      const n = habits.filter((h) => (window.habitSatisfied ? window.habitSatisfied(h, today) : h.history[today])).length;
      bits.push(`${n}/${habits.length} habits`);
    }
    detail.textContent = bits.length ? `${bits.join(" · ")} — tap to edit` : "Tap to edit";
  }

  document.getElementById("overview-checkin-btn")?.addEventListener("click", open);

  window.openCheckin = open;
  window.renderCheckinCta = renderCheckinCta;
  window.checkinDoneToday = doneToday;
  renderCheckinCta();
})();
