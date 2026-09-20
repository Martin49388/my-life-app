// Recovery — was a plain note log; now the readiness layer of the app.
// A 20-second daily check-in (sleep, sleep quality, energy, soreness)
// rolls into one readiness number, a scrubbable trend, a sore-area map,
// and a few honest lines about what it means for today's training
// (pulled from fitness.js's real session log, not guessed).
//
// Storage: localStorage "recovery" =
//   { sleepTarget: <minutes>,
//     log: { "YYYY-MM-DD": { sleep, quality 1-5, energy 1-5, soreness 1-5,
//                            areas: [], rest: bool, at, updated } } }
// Syncs like everything else — sync.js patches localStorage.setItem.
//
// Whole file is one IIFE: every <script> shares one global scope here and
// short names (entry, load, save, AREAS, stats) collide fast. Only
// window.renderRecovery and window.recoverySummary are exported.
(function () {
  "use strict";

  const KEY = "recovery";
  const DEFAULT_TARGET = 480; // 8h, in minutes
  const AREAS = ["Legs", "Back", "Chest", "Shoulders", "Arms", "Core", "Neck", "Knees"];
  const SCALES = [
    { id: "quality", label: "Sleep quality", words: ["Broken", "Restless", "OK", "Solid", "Deep"] },
    { id: "energy", label: "Energy", words: ["Empty", "Low", "OK", "Good", "Charged"] },
    { id: "soreness", label: "Soreness", words: ["None", "Light", "Noticeable", "Heavy", "Wrecked"], inverse: true },
  ];
  // What each part of the check-in is worth. Only the parts actually
  // filled in count toward the score (see readiness) — half a check-in
  // shouldn't read as a bad day, it should read as half a check-in.
  const WEIGHTS = { sleep: 40, quality: 20, energy: 25, soreness: 15 };
  const METRICS = [
    { id: "readiness", label: "Readiness" },
    { id: "sleep", label: "Sleep" },
    { id: "energy", label: "Energy" },
    { id: "soreness", label: "Soreness" },
  ];
  const RANGES = [14, 30, 90];
  const SLEEP_PRESETS = [360, 420, 450, 480, 510];

  function loadRecovery() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        sleepTarget: Number(raw.sleepTarget) > 0 ? Number(raw.sleepTarget) : DEFAULT_TARGET,
        log: raw.log && typeof raw.log === "object" ? raw.log : {},
      };
    } catch {
      return { sleepTarget: DEFAULT_TARGET, log: {} };
    }
  }

  let rec = loadRecovery();
  let activeDate = null; // null = today; set by tapping a day in the trend
  let metric = "readiness";
  let range = 30;

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(rec));
  }

  // ---------------------------------------------------------------------
  // Small helpers

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function fmtSleep(min) {
    if (!min) return "—";
    const h = Math.floor(Math.abs(min) / 60);
    const m = Math.abs(min) % 60;
    const sign = min < 0 ? "−" : "";
    if (!h) return `${sign}${m}m`;
    return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
  }

  function fmtSleepShort(min) {
    const h = min / 60;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
  }

  function fmtSigned(min) {
    if (!min) return "0";
    return `${min > 0 ? "+" : "−"}${fmtSleep(Math.abs(min)).replace("−", "")}`;
  }

  function dayName(date, opts = { weekday: "short", day: "numeric", month: "short" }) {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, opts);
  }

  function lastDates(n, end) {
    const last = end || todayKey();
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(addDays(last, -i));
    return out;
  }

  function isLogged(e) {
    return !!e && (e.sleep > 0 || e.quality > 0 || e.energy > 0 || e.soreness > 0 || e.rest === true);
  }

  function entryFor(date) {
    return rec.log[date] || null;
  }

  // Creates the day's entry on first touch so every control can just
  // write into it.
  function touch(date) {
    if (!rec.log[date]) {
      rec.log[date] = { sleep: 0, quality: 0, energy: 0, soreness: 0, areas: [], rest: false, at: Date.now() };
    }
    rec.log[date].updated = Date.now();
    return rec.log[date];
  }

  // Readiness, 0-100. Each filled-in part scores against its own weight
  // and the total is normalised by the weights actually available, so a
  // check-in with only sleep in it still reads honestly.
  function readiness(e) {
    if (!isLogged(e)) return null;
    let got = 0;
    let of = 0;
    if (e.sleep > 0) {
      got += Math.min(1, e.sleep / (rec.sleepTarget || DEFAULT_TARGET)) * WEIGHTS.sleep;
      of += WEIGHTS.sleep;
    }
    if (e.quality > 0) {
      got += ((e.quality - 1) / 4) * WEIGHTS.quality;
      of += WEIGHTS.quality;
    }
    if (e.energy > 0) {
      got += ((e.energy - 1) / 4) * WEIGHTS.energy;
      of += WEIGHTS.energy;
    }
    if (e.soreness > 0) {
      got += ((5 - e.soreness) / 4) * WEIGHTS.soreness;
      of += WEIGHTS.soreness;
    }
    if (!of) return null;
    return Math.round((got / of) * 100);
  }

  function filledCount(e) {
    if (!e) return 0;
    return [e.sleep > 0, e.quality > 0, e.energy > 0, e.soreness > 0].filter(Boolean).length;
  }

  function band(score) {
    if (score == null) return { id: "none", label: "Not logged" };
    if (score >= 80) return { id: "primed", label: "Primed" };
    if (score >= 65) return { id: "good", label: "Good" };
    if (score >= 50) return { id: "ok", label: "Manageable" };
    if (score >= 35) return { id: "low", label: "Run down" };
    return { id: "flat", label: "Depleted" };
  }

  function loggedEntries(dates) {
    return dates.map(entryFor).filter(isLogged);
  }

  function average(values) {
    const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  // Training days in a row ending today (or yesterday, so an untrained
  // "today" doesn't wipe a streak that's still live). Reads fitness.js's
  // plan.log directly — same source the Fitness section counts from.
  function trainingStreak() {
    if (typeof plan === "undefined" || !plan || !plan.log) return null;
    let cursor = todayKey();
    if (!(plan.log[cursor] || []).length) cursor = addDays(cursor, -1);
    let n = 0;
    while ((plan.log[cursor] || []).length) {
      n++;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  function lastRestDate() {
    if (typeof plan === "undefined" || !plan || !plan.log) return null;
    let cursor = todayKey();
    for (let i = 0; i < 60; i++) {
      if (!(plan.log[cursor] || []).length) return cursor;
      cursor = addDays(cursor, -1);
    }
    return null;
  }

  function plannedToday() {
    if (typeof plan === "undefined" || !plan || !plan.days) return 0;
    const index = (new Date().getDay() + 6) % 7;
    return (plan.days[index] && plan.days[index].exercises.length) || 0;
  }

  // ---------------------------------------------------------------------
  // Stats

  function stats() {
    const t = todayKey();
    const todayEntry = entryFor(t);
    const week = loggedEntries(lastDates(7));
    const sleepWeek = week.filter((e) => e.sleep > 0);
    const target = rec.sleepTarget || DEFAULT_TARGET;
    return {
      today: todayEntry,
      score: readiness(todayEntry),
      lastNight: todayEntry && todayEntry.sleep ? todayEntry.sleep : null,
      avgSleep: sleepWeek.length ? Math.round(average(sleepWeek.map((e) => e.sleep))) : null,
      debt: sleepWeek.length ? Math.round(sleepWeek.reduce((sum, e) => sum + (e.sleep - target), 0)) : null,
      nights: sleepWeek.length,
      avgScore: week.length ? Math.round(average(week.map(readiness))) : null,
      logged7: week.length,
      streak: trainingStreak(),
    };
  }

  // ---------------------------------------------------------------------
  // Header

  function renderPill(s) {
    const pill = document.getElementById("rec-pill");
    if (!pill) return;
    const label = document.getElementById("rec-pill-label");
    const detail = document.getElementById("rec-pill-detail");
    if (isLogged(s.today)) {
      pill.dataset.state = "live";
      label.textContent = `Checked in ${new Date(s.today.updated || s.today.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      detail.textContent = band(s.score).label;
    } else {
      pill.dataset.state = "next";
      label.textContent = "No check-in today";
      detail.textContent = "20 seconds";
    }
  }

  function renderHero(s) {
    const scoreEl = document.getElementById("rec-score");
    if (!scoreEl) return;
    scoreEl.textContent = s.score == null ? "—" : String(s.score);
    scoreEl.dataset.band = band(s.score).id;

    const filled = filledCount(s.today);
    const caption = document.getElementById("rec-caption");
    if (s.score == null) {
      caption.textContent = "Readiness · nothing logged today yet";
    } else {
      const bits = [`Readiness · ${band(s.score).label}`];
      if (s.avgScore != null && s.logged7 > 1) {
        const d = s.score - s.avgScore;
        bits.push(d === 0 ? "level with your 7-day average" : `${d > 0 ? "+" : "−"}${Math.abs(d)} vs 7-day avg`);
      }
      if (filled < 4) bits.push(`${filled}/4 filled in`);
      caption.textContent = bits.join(" · ");
    }

    document.getElementById("rec-stats").innerHTML = [
      ["Last night", s.lastNight ? fmtSleep(s.lastNight) : "—"],
      ["7-night avg", s.avgSleep ? fmtSleep(s.avgSleep) : "—"],
      ["Sleep debt", s.debt == null ? "—" : fmtSigned(s.debt)],
      ["Readiness avg", s.avgScore == null ? "—" : String(s.avgScore)],
    ]
      .map(
        ([label, value]) => `
        <div class="dash-stat">
          <span class="stat-label">${label}</span>
          <span class="dash-stat-value">${esc(value)}</span>
        </div>`
      )
      .join("");
  }

  // ---------------------------------------------------------------------
  // Trend

  function metricValue(e, id) {
    if (!isLogged(e)) return null;
    if (id === "readiness") return readiness(e);
    if (id === "sleep") return e.sleep || null;
    if (id === "energy") return e.energy || null;
    if (id === "soreness") return e.soreness || null;
    return null;
  }

  function metricMax(dates) {
    if (metric === "readiness") return 100;
    if (metric === "sleep") {
      const longest = Math.max(rec.sleepTarget || DEFAULT_TARGET, ...dates.map((d) => (entryFor(d) || {}).sleep || 0));
      return Math.ceil(longest / 60) * 60;
    }
    return 5;
  }

  function metricText(e) {
    const v = metricValue(e, metric);
    if (v == null) return "not logged";
    if (metric === "sleep") return fmtSleep(v);
    if (metric === "readiness") return `readiness ${v}`;
    const scale = SCALES.find((s) => s.id === metric);
    return `${scale.label.toLowerCase()} ${scale.words[v - 1]}`;
  }

  function barTitle(date, e) {
    return `${dayName(date)} · ${metricText(e)}${e && e.rest ? " · rest day" : ""}`;
  }

  function renderTrend() {
    const chart = document.getElementById("rec-chart");
    if (!chart) return;
    const dates = lastDates(range);
    const max = metricMax(dates);
    const selected = activeDate || todayKey();
    const target = rec.sleepTarget || DEFAULT_TARGET;

    document.getElementById("rec-metrics").innerHTML = METRICS.map(
      (m) => `<button type="button" class="rec-tab${m.id === metric ? " is-on" : ""}" data-rec-metric="${m.id}" role="tab" aria-selected="${m.id === metric}">${m.label}</button>`
    ).join("");
    document.getElementById("rec-ranges").innerHTML = RANGES.map(
      (r) => `<button type="button" class="rec-range${r === range ? " is-on" : ""}" data-rec-range="${r}">${r}d</button>`
    ).join("");

    const bars = dates
      .map((d) => {
        const e = entryFor(d);
        const value = metricValue(e, metric);
        const ratio = value == null ? 0 : Math.max(0.05, Math.min(1, value / max));
        const classes = ["rec-bar"];
        if (value == null) classes.push("is-empty");
        if (d === todayKey()) classes.push("is-today");
        if (d === selected) classes.push("is-selected");
        if (e && e.rest) classes.push("is-rest");
        const opacity = value == null ? "1" : (0.38 + 0.62 * Math.min(1, value / max)).toFixed(2);
        const title = esc(barTitle(d, e));
        return `<button type="button" class="${classes.join(" ")}" data-rec-day="${d}" title="${title}" aria-label="${title}"><span class="rec-bar-fill" style="height:${(ratio * 100).toFixed(1)}%;opacity:${opacity}"></span></button>`;
      })
      .join("");

    const targetLine =
      metric === "sleep"
        ? `<span class="rec-target-line" style="bottom:${((target / max) * 100).toFixed(1)}%"><span>${fmtSleepShort(target)} target</span></span>`
        : "";

    const logged = dates.map(entryFor).filter(isLogged);

    // An empty chart is just a void — say so instead of drawing 30 stubs.
    chart.innerHTML = logged.length
      ? `
      <div class="rec-bars" data-count="${dates.length}">${bars}${targetLine}</div>
      <div class="rec-axis">
        <span>${esc(dayName(dates[0], { day: "numeric", month: "short" }))}</span>
        <span>today</span>
      </div>`
      : `<p class="empty-state">No check-ins in the last ${range} days — the trend starts with your first one.</p>`;

    const values = logged.map((e) => metricValue(e, metric)).filter((v) => v != null);
    const avg = values.length ? average(values) : null;
    let avgText = "no data yet";
    if (avg != null) {
      if (metric === "sleep") avgText = `avg ${fmtSleep(Math.round(avg))}`;
      else if (metric === "readiness") avgText = `avg ${Math.round(avg)}`;
      else avgText = `avg ${avg.toFixed(1)} / 5`;
    }
    document.getElementById("rec-chart-summary").textContent = `Last ${range} days · ${logged.length} logged · ${avgText}`;

    renderReadout(selected);
  }

  function renderReadout(date) {
    const box = document.getElementById("rec-readout");
    if (!box) return;
    const e = entryFor(date);
    const isToday = date === todayKey();
    if (!isLogged(e)) {
      box.hidden = false;
      box.innerHTML = `
        <span class="rec-readout-day">${esc(dayName(date))}</span>
        <span class="rec-readout-empty">${isToday ? "Not logged yet — the check-in below is for today." : "Nothing logged. The check-in below fills this day in."}</span>`;
      return;
    }
    const score = readiness(e);
    const bits = [];
    if (e.sleep) bits.push(fmtSleep(e.sleep));
    SCALES.forEach((s) => {
      if (e[s.id]) bits.push(`${s.words[e[s.id] - 1].toLowerCase()} ${s.label.toLowerCase().replace("sleep ", "")}`);
    });
    if (e.areas && e.areas.length) bits.push(`sore: ${e.areas.join(", ").toLowerCase()}`);
    if (e.rest) bits.push("rest day");
    box.hidden = false;
    box.innerHTML = `
      <span class="rec-readout-day">${esc(dayName(date))}</span>
      <span class="rec-readout-score" data-band="${band(score).id}">${score}</span>
      <span class="rec-readout-bits">${esc(bits.join(" · "))}</span>`;
  }

  // ---------------------------------------------------------------------
  // Check-in

  function scaleHtml(scale, e) {
    const value = e ? e[scale.id] || 0 : 0;
    return `
      <div class="rec-field">
        <div class="rec-field-head">
          <span class="stat-label">${scale.label}</span>
          <span class="rec-field-note${value ? " is-set" : ""}">${value ? scale.words[value - 1] : "—"}</span>
        </div>
        <div class="rec-pips${scale.inverse ? " is-inverse" : ""}" role="group" aria-label="${scale.label}">
          ${scale.words
            .map(
              (word, i) =>
                `<button type="button" class="rec-pip${value >= i + 1 ? " is-on" : ""}${value === i + 1 ? " is-current" : ""}" data-rec-scale="${scale.id}" data-value="${i + 1}" title="${word}" aria-label="${scale.label}: ${word}" aria-pressed="${value === i + 1}"></button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  function renderCheckin() {
    const wrap = document.getElementById("rec-checkin");
    if (!wrap) return;
    const date = activeDate || todayKey();
    const e = entryFor(date);
    const sleep = e ? e.sleep || 0 : 0;
    const target = rec.sleepTarget || DEFAULT_TARGET;
    const pct = Math.round(Math.min(1, sleep / target) * 100);

    document.getElementById("rec-checkin-title").textContent = activeDate ? dayName(date) : "Today's check-in";
    const backBtn = document.getElementById("rec-today-btn");
    if (backBtn) backBtn.hidden = !activeDate;
    const saved = document.getElementById("rec-saved");
    if (saved) {
      saved.textContent = isLogged(e)
        ? `Saved ${new Date(e.updated || e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "Saves as you tap";
    }

    wrap.innerHTML = `
      <div class="rec-field">
        <div class="rec-field-head">
          <span class="stat-label">Sleep</span>
          <span class="rec-field-note">
            <input type="number" id="rec-target-input" class="rec-target-input" min="3" max="14" step="0.25" value="${(target / 60).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}" aria-label="Sleep target, hours" />h target
          </span>
        </div>
        <div class="rec-sleep-row">
          <button type="button" class="rec-step" data-rec-sleep="-15" aria-label="15 minutes less">−</button>
          <span class="rec-sleep-value">${sleep ? esc(fmtSleep(sleep)) : "—"}</span>
          <button type="button" class="rec-step" data-rec-sleep="15" aria-label="15 minutes more">+</button>
          <span class="rec-sleep-bar"><span style="width:${pct}%"></span></span>
        </div>
        <div class="rec-chips">
          ${SLEEP_PRESETS.map((m) => `<button type="button" class="rec-chip${sleep === m ? " is-on" : ""}" data-rec-sleep-set="${m}">${fmtSleepShort(m)}</button>`).join("")}
        </div>
      </div>
      ${SCALES.map((s) => scaleHtml(s, e)).join("")}
      <div class="rec-field">
        <div class="rec-field-head">
          <span class="stat-label">Sore where</span>
          <span class="rec-field-note">${e && e.areas && e.areas.length ? esc(e.areas.join(", ")) : "optional"}</span>
        </div>
        <div class="rec-chips">
          ${AREAS.map((a) => `<button type="button" class="rec-chip${e && (e.areas || []).includes(a) ? " is-on" : ""}" data-rec-area="${esc(a)}">${a}</button>`).join("")}
        </div>
      </div>
      <div class="rec-field rec-field-flags">
        <button type="button" class="rec-chip rec-chip-flag${e && e.rest ? " is-on" : ""}" data-rec-rest="1">Rest day</button>
        ${isLogged(e) ? `<button type="button" class="dash-link" data-rec-clear="1">Clear this day</button>` : ""}
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Signal — a few honest lines, each one computed from data that's
  // actually there. Nothing here is generic advice.

  // Sleep against energy is the one correlation worth showing: readiness
  // already contains sleep, so comparing it to sleep would just be
  // circular. Energy is logged independently.
  function sleepEnergySplit() {
    const high = [];
    const low = [];
    for (const d of lastDates(60)) {
      const e = entryFor(d);
      if (!e || !e.sleep || !e.energy) continue;
      (e.sleep >= (rec.sleepTarget || DEFAULT_TARGET) ? high : low).push(e.energy);
    }
    if (high.length < 3 || low.length < 3) return null;
    const h = average(high);
    const l = average(low);
    if (h - l < 0.4) return null;
    return { high: h.toFixed(1), low: l.toFixed(1), nights: high.length + low.length };
  }

  function soreRepeat() {
    const counts = {};
    for (const d of lastDates(14)) {
      const e = entryFor(d);
      if (!e || !e.areas) continue;
      for (const a of e.areas) counts[a] = (counts[a] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 4 ? { area: top[0], days: top[1] } : null;
  }

  function signalLines(s) {
    const lines = [];
    const planned = plannedToday();

    if (!isLogged(s.today)) {
      lines.push("No check-in today — every number here stops at yesterday.");
    }

    if (s.score != null && planned > 0) {
      if (s.score < 55) {
        lines.push(`Readiness ${s.score} with ${planned} ${planned === 1 ? "exercise" : "exercises"} on today's plan — cut the volume or move the session.`);
      } else if (s.score >= 80) {
        lines.push(`Readiness ${s.score} and a session on today's plan — this is the day to push it.`);
      }
    }

    if (s.streak != null && s.streak >= 4) {
      const rest = lastRestDate();
      lines.push(`${s.streak} training days in a row${rest ? ` — last full rest day was ${dayName(rest)}` : ""}.`);
    }

    if (s.debt != null && s.nights >= 3) {
      if (s.debt <= -60) lines.push(`Sleep debt ${fmtSigned(s.debt)} across ${s.nights} logged nights.`);
      else if (s.debt >= 60) lines.push(`${fmtSigned(s.debt)} over target across ${s.nights} logged nights — you're banking sleep.`);
    }

    const split = sleepEnergySplit();
    if (split) {
      lines.push(`Energy averages ${split.high}/5 after ${fmtSleepShort(rec.sleepTarget || DEFAULT_TARGET)}+ nights and ${split.low}/5 after shorter ones (${split.nights} nights logged).`);
    }

    const sore = soreRepeat();
    if (sore) lines.push(`${sore.area} has been sore on ${sore.days} of the last 14 days.`);

    if (lines.length < 2 && s.logged7 < 4) {
      lines.push("Check in every morning — after a week the trend, the sleep debt and the sleep/energy link all start to mean something.");
    }

    return lines.slice(0, 4);
  }

  function renderSignal(s) {
    const list = document.getElementById("rec-signal");
    if (!list) return;
    const lines = signalLines(s);
    list.innerHTML = lines.length
      ? lines.map((l) => `<li class="rec-signal-row"><span class="rec-signal-dot" aria-hidden="true"></span><span>${esc(l)}</span></li>`).join("")
      : `<li class="empty-state">Nothing worth flagging.</li>`;
  }

  function renderAreas() {
    const block = document.getElementById("rec-areas-block");
    const list = document.getElementById("rec-areas-chart");
    if (!block || !list) return;
    const counts = {};
    for (const d of lastDates(14)) {
      const e = entryFor(d);
      if (!e || !e.areas) continue;
      for (const a of e.areas) counts[a] = (counts[a] || 0) + 1;
    }
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    block.hidden = rows.length === 0;
    if (!rows.length) return;
    const max = rows[0][1];
    list.innerHTML = rows
      .map(
        ([area, n]) => `
        <li class="rec-area-row">
          <span class="rec-area-name">${esc(area)}</span>
          <span class="rec-area-bar"><span style="width:${Math.round((n / max) * 100)}%"></span></span>
          <span class="rec-area-count">${n}×</span>
        </li>`
      )
      .join("");
  }

  // ---------------------------------------------------------------------
  // Render everything

  function renderRecovery() {
    if (!document.getElementById("rec-checkin")) return;
    const s = stats();
    renderPill(s);
    renderHero(s);
    renderTrend();
    renderCheckin();
    renderSignal(s);
    renderAreas();
  }
  window.renderRecovery = renderRecovery;

  // ---------------------------------------------------------------------
  // Interaction — one delegated listener, every control writes straight
  // through to storage (no save button anywhere).

  function update(mutate) {
    const date = activeDate || todayKey();
    const e = touch(date);
    mutate(e);
    // A day toggled back to empty shouldn't leave a husk behind.
    if (!isLogged(e) && !(e.areas || []).length) delete rec.log[date];
    persist();
    renderRecovery();
    if (window.renderOverview) window.renderOverview();
  }

  const section = document.getElementById("recovery-section");

  if (section) {
    section.addEventListener("click", (ev) => {
      const step = ev.target.closest("[data-rec-sleep]");
      if (step) {
        const delta = Number(step.dataset.recSleep);
        return update((e) => {
          e.sleep = Math.max(0, Math.min(16 * 60, (e.sleep || 0) + delta));
        });
      }

      const preset = ev.target.closest("[data-rec-sleep-set]");
      if (preset) {
        const value = Number(preset.dataset.recSleepSet);
        return update((e) => {
          e.sleep = e.sleep === value ? 0 : value;
        });
      }

      const pip = ev.target.closest("[data-rec-scale]");
      if (pip) {
        const field = pip.dataset.recScale;
        const value = Number(pip.dataset.value);
        return update((e) => {
          e[field] = e[field] === value ? 0 : value;
        });
      }

      const area = ev.target.closest("[data-rec-area]");
      if (area) {
        const name = area.dataset.recArea;
        return update((e) => {
          const current = e.areas || [];
          e.areas = current.includes(name) ? current.filter((a) => a !== name) : [...current, name];
        });
      }

      if (ev.target.closest("[data-rec-rest]")) {
        return update((e) => {
          e.rest = !e.rest;
        });
      }

      if (ev.target.closest("[data-rec-clear]")) {
        delete rec.log[activeDate || todayKey()];
        persist();
        renderRecovery();
        if (window.renderOverview) window.renderOverview();
        return;
      }

      const day = ev.target.closest("[data-rec-day]");
      if (day) {
        const date = day.dataset.recDay;
        activeDate = date === todayKey() ? null : date;
        renderRecovery();
        return;
      }

      const m = ev.target.closest("[data-rec-metric]");
      if (m) {
        metric = m.dataset.recMetric;
        renderTrend();
        return;
      }

      const r = ev.target.closest("[data-rec-range]");
      if (r) {
        range = Number(r.dataset.recRange);
        renderTrend();
        return;
      }

      const action = ev.target.closest("[data-rec-action]");
      if (action) {
        if (action.dataset.recAction === "today") {
          activeDate = null;
          renderRecovery();
        } else if (action.dataset.recAction === "focus") {
          document.getElementById("rec-checkin")?.scrollIntoView({
            behavior: typeof prefersReducedMotion !== "undefined" && prefersReducedMotion ? "auto" : "smooth",
            block: "center",
          });
        }
      }
    });

    // `change` rather than `input`: the field is inside markup that gets
    // rebuilt on every render, so re-rendering mid-keystroke would steal
    // focus.
    section.addEventListener("change", (ev) => {
      if (ev.target.id !== "rec-target-input") return;
      const hours = Number(ev.target.value);
      if (!(hours >= 3 && hours <= 14)) {
        renderCheckin();
        return;
      }
      rec.sleepTarget = Math.round((hours * 60) / 15) * 15;
      persist();
      renderRecovery();
      if (window.renderOverview) window.renderOverview();
    });
  }

  // ---------------------------------------------------------------------
  // What the rest of the app reads

  window.recoveryScoreOn = function recoveryScoreOn(date) {
    return readiness(entryFor(date));
  };

  window.recoverySummary = function recoverySummary() {
    const s = stats();
    const b = band(s.score);
    return {
      logged: isLogged(s.today),
      score: s.score,
      band: b.label,
      sleep: s.lastNight,
      avgScore: s.avgScore,
      debt: s.debt,
      nights: s.nights,
      streak: s.streak,
      short: s.score == null ? "Not logged" : `Readiness ${s.score}`,
      line:
        s.score == null
          ? `Recovery: no check-in today${s.avgScore != null ? `, 7-day readiness average ${s.avgScore}` : ""}`
          : `Recovery: readiness ${s.score}/100 (${b.label})` +
            `${s.lastNight ? `, slept ${fmtSleep(s.lastNight)}` : ""}` +
            `${s.avgScore != null ? `, 7-day avg ${s.avgScore}` : ""}` +
            `${s.debt != null ? `, sleep ${s.debt < 0 ? "debt" : "surplus"} ${fmtSigned(s.debt)} over ${s.nights} nights` : ""}` +
            `${s.streak ? `, ${s.streak} training days in a row` : ""}`,
    };
  };

  // Overview's "Logged today" feed picks this up (see TODAY_LOG_SOURCES
  // in overview.js).
  window.TODAY_LOG_SOURCES = window.TODAY_LOG_SOURCES || [];
  window.TODAY_LOG_SOURCES.push(() => {
    const e = entryFor(todayKey());
    if (!isLogged(e)) return [];
    const bits = [`Readiness ${readiness(e)}`];
    if (e.sleep) bits.push(`${fmtSleep(e.sleep)} sleep`);
    if (e.rest) bits.push("rest day");
    return [{ key: "recovery", section: "Recovery", text: bits.join(" · "), at: e.updated || e.at }];
  });

  renderRecovery();
})();
