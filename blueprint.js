// Blueprint: the weekly plan (one schedule of time blocks per weekday) plus
// the section's free-text notes (journal.js).
//
// Layout (see #blueprint-section in index.html): a live now/next pill and
// the week's total planned time as the hero number; a week strip of seven
// tiles (each with its own mini timeline, tinted by how full the day is —
// tap one to select it); then the selected day as a timeline track plus a
// list of blocks, and the add-block form.
//
// Everything below the "Shared plan helpers" line is also used by
// Overview (overview.js, loaded later) — globals, since this app has no
// module system: DAY_KEYS, loadWeekPlan, sortedDayEntries, todayDayKey,
// loadPlanDone, togglePlanDone, planMinutes, planEntryEnd,
// planEntryDuration, formatPlanDuration, planNowMinutes, planDayStatus,
// planStatusText, planRange, buildDayTrack, planBlockRowHtml, setLivePill,
// planEsc.

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PLAN_DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const PLAN_DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const WEEK_PLAN_KEY = "week-plan";
// The plan is a weekly template, but whether you actually did Tuesday's
// 07:30 block is specific to *this* Tuesday — stored per date.
const PLAN_DONE_PREFIX = "plan-done-";

// ---------------------------------------------------------------------------
// Shared plan helpers

// Date#getDay() is 0=Sunday..6=Saturday; DAY_KEYS is Monday-first to match
// the rest of the app's week handling (see fitness.js's weekDatesSoFar).
function todayDayKey() {
  const jsDay = new Date().getDay();
  return DAY_KEYS[(jsDay + 6) % 7];
}

function loadWeekPlan() {
  const raw = localStorage.getItem(WEEK_PLAN_KEY);
  const parsed = raw ? JSON.parse(raw) : {};
  for (const d of DAY_KEYS) if (!parsed[d]) parsed[d] = [];
  return parsed;
}

function saveWeekPlan(plan) {
  localStorage.setItem(WEEK_PLAN_KEY, JSON.stringify(plan));
}

function sortedDayEntries(plan, day) {
  return [...plan[day]].sort((a, b) => a.start.localeCompare(b.start));
}

function loadPlanDone(dateKey) {
  const raw = localStorage.getItem(`${PLAN_DONE_PREFIX}${dateKey}`);
  return raw ? JSON.parse(raw) : {};
}

function togglePlanDone(dateKey, entryId) {
  const done = loadPlanDone(dateKey);
  done[entryId] = !done[entryId];
  localStorage.setItem(`${PLAN_DONE_PREFIX}${dateKey}`, JSON.stringify(done));
  if (window.renderOverview) window.renderOverview();
  if (window.renderBlueprint) window.renderBlueprint();
}

function planEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// "07:30" -> 450; anything else (including the empty end time of an
// open-ended block) -> null. An empty string must NOT become 0, or
// "22:30 – (no end)" reads as running until midnight.
function planMinutes(hhmm) {
  const match = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// End in minutes, or null for a block with no (usable) end time. An end
// earlier than the start is read as running past midnight.
function planEntryEnd(entry) {
  const start = planMinutes(entry.start);
  const end = planMinutes(entry.end);
  if (start == null || end == null || end === start) return null;
  return end < start ? end + 1440 : end;
}

function planEntryDuration(entry) {
  const end = planEntryEnd(entry);
  return end == null ? 0 : end - planMinutes(entry.start);
}

function formatPlanDuration(mins) {
  if (!mins || mins < 0) return "";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function planNowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function planDayStatus(entries, nowMin, done = {}) {
  const current = entries.find((e) => {
    const start = planMinutes(e.start);
    const end = planEntryEnd(e);
    return end != null && start <= nowMin && nowMin < end;
  });
  const next = entries.find((e) => planMinutes(e.start) > nowMin);
  const doneCount = entries.filter((e) => done[e.id]).length;
  return { current, next, doneCount, total: entries.length };
}

// Text for a live pill: { state: "live" | "next" | "idle", label, detail }.
function planStatusText(status, nowMin) {
  if (status.current) {
    const end = planEntryEnd(status.current);
    return {
      state: "live",
      label: `Now · ${status.current.title}`,
      detail: `${formatPlanDuration(end - nowMin)} left`,
    };
  }
  if (status.next) {
    return {
      state: "next",
      label: `Next · ${status.next.title}`,
      detail: `${status.next.start} · in ${formatPlanDuration(planMinutes(status.next.start) - nowMin)}`,
    };
  }
  if (status.total) {
    return { state: "idle", label: "Day wrapped", detail: `${status.doneCount}/${status.total} done` };
  }
  return { state: "idle", label: "Nothing planned today", detail: "" };
}

// The hour window every track is drawn on — covers the whole week's
// blocks so tracks are comparable day to day. Defaults to 06:00–22:00.
function planRange(plan) {
  let min = 6 * 60;
  let max = 22 * 60;
  for (const d of DAY_KEYS) {
    for (const e of plan[d]) {
      const start = planMinutes(e.start);
      if (start == null) continue;
      const end = planEntryEnd(e) ?? start + 30;
      min = Math.min(min, start);
      max = Math.max(max, Math.min(1440, end));
    }
  }
  return { start: Math.floor(min / 60) * 60, end: Math.min(1440, Math.ceil(max / 60) * 60) };
}

function buildDayTrack(entries, range, { nowMin = null, done = {}, compact = false } = {}) {
  const span = range.end - range.start || 1;
  const pct = (m) => Math.min(100, Math.max(0, ((m - range.start) / span) * 100));
  const status = nowMin == null ? null : planDayStatus(entries, nowMin, done);

  const marks = entries
    .map((e) => {
      const start = planMinutes(e.start);
      if (start == null) return "";
      const end = planEntryEnd(e);
      const left = pct(start);
      const states = [];
      if (done[e.id]) states.push("is-done");
      if (status && status.current === e) states.push("is-now");
      const label = planEsc(`${e.start}${e.end ? `–${e.end}` : ""} ${e.title}`);
      if (end == null) {
        return `<span class="day-track-point ${states.join(" ")}" style="left:${left}%" title="${label}"></span>`;
      }
      const width = Math.max(0.8, pct(end) - left);
      return `<span class="day-track-block ${states.join(" ")}" style="left:${left}%;width:${width}%" title="${label}"></span>`;
    })
    .join("");

  const nowMark =
    nowMin != null && nowMin >= range.start && nowMin <= range.end
      ? `<span class="day-track-now" style="left:${pct(nowMin)}%"></span>`
      : "";

  let scale = "";
  if (!compact) {
    const hours = span / 60;
    const step = hours > 12 ? 3 : hours > 6 ? 2 : 1;
    const ticks = [];
    for (let m = range.start; m <= range.end; m += step * 60) {
      ticks.push(`<span class="day-track-tick" style="left:${pct(m)}%">${String(Math.floor(m / 60) % 24).padStart(2, "0")}</span>`);
    }
    scale = `<div class="day-track-scale">${ticks.join("")}</div>`;
  }

  return `
    <div class="day-track${compact ? " day-track-compact" : ""}" aria-hidden="true">
      <div class="day-track-bar">${marks}${nowMark}</div>
      ${scale}
    </div>`;
}

// One block row — used by Blueprint's day list and Overview's "Today's
// plan". Only today's rows get a live state and a done checkbox.
function planBlockRowHtml(e, { isToday = false, status = null, done = {}, now = 0, deletable = false } = {}) {
  const start = planMinutes(e.start);
  const end = planEntryEnd(e);
  const duration = planEntryDuration(e);
  const classes = ["plan-block"];
  let badge = "";
  let progress = "";
  if (isToday && status) {
    if (done[e.id]) {
      classes.push("is-done");
      badge = `<span class="plan-badge">Done</span>`;
    } else if (status.current === e) {
      classes.push("is-now");
      const pctDone = Math.round(((now - start) / (end - start)) * 100);
      badge = `<span class="plan-badge plan-badge-live">Now · ${formatPlanDuration(end - now)} left</span>`;
      progress = `<span class="plan-progress"><span style="width:${pctDone}%"></span></span>`;
    } else if (status.next === e) {
      classes.push("is-next");
      badge = `<span class="plan-badge">Up next · in ${formatPlanDuration(start - now)}</span>`;
    } else if ((end ?? start) <= now) {
      classes.push("is-past");
    }
  }
  return `
      <li class="${classes.join(" ")}" data-id="${planEsc(e.id)}">
        <span class="plan-block-time">
          <span>${planEsc(e.start)}</span>
          ${e.end ? `<span class="plan-block-end">${planEsc(e.end)}</span>` : ""}
        </span>
        <span class="plan-block-rail" aria-hidden="true"></span>
        <span class="plan-block-body">
          <span class="plan-block-title">${planEsc(e.title)}</span>
          <span class="plan-block-meta">
            ${duration ? `<span>${formatPlanDuration(duration)}</span>` : ""}
            ${badge}
          </span>
          ${progress}
        </span>
        ${isToday ? `<input type="checkbox" class="plan-check" data-id="${planEsc(e.id)}" ${done[e.id] ? "checked" : ""} aria-label="Mark ${planEsc(e.title)} done" />` : ""}
        ${deletable ? `<button type="button" class="delete-btn plan-delete" data-id="${planEsc(e.id)}" aria-label="Delete ${planEsc(e.title)}">&#10005;</button>` : ""}
      </li>`;
}

// Shared by Blueprint and Overview: fills the ids <prefix>-pill,
// <prefix>-pill-label, <prefix>-pill-detail.
function setLivePill(prefix, text) {
  const pill = document.getElementById(`${prefix}-pill`);
  if (!pill) return;
  pill.dataset.state = text.state;
  document.getElementById(`${prefix}-pill-label`).textContent = text.label;
  document.getElementById(`${prefix}-pill-detail`).textContent = text.detail;
}

// ---------------------------------------------------------------------------
// Blueprint section

let weekPlan = loadWeekPlan();
let selectedPlanDay = todayDayKey();

function weekTotals(plan) {
  const perDay = {};
  for (const d of DAY_KEYS) {
    perDay[d] = { count: plan[d].length, minutes: plan[d].reduce((sum, e) => sum + planEntryDuration(e), 0) };
  }
  const total = DAY_KEYS.reduce((sum, d) => sum + perDay[d].minutes, 0);
  const blocks = DAY_KEYS.reduce((sum, d) => sum + perDay[d].count, 0);
  const busiest = DAY_KEYS.reduce((best, d) => (perDay[d].minutes > perDay[best].minutes ? d : best), DAY_KEYS[0]);
  return { perDay, total, blocks, busiest };
}

function renderBlueprintHeader(totals) {
  const today = todayDayKey();
  const entries = sortedDayEntries(weekPlan, today);
  const now = planNowMinutes();
  const done = loadPlanDone(todayKey());
  setLivePill("blueprint", planStatusText(planDayStatus(entries, now, done), now));

  const hero = document.getElementById("blueprint-hero-number");
  if (!hero) return;
  hero.textContent = totals.total ? formatPlanDuration(totals.total) : "—";
  document.getElementById("blueprint-hero-caption").textContent = totals.blocks
    ? `planned this week · ${totals.blocks} ${totals.blocks === 1 ? "block" : "blocks"}`
    : "Nothing planned yet — pick a day below and add your first block";

  const todayTotals = totals.perDay[today];
  document.getElementById("blueprint-stat-today").textContent = todayTotals.count
    ? `${formatPlanDuration(todayTotals.minutes) || `${todayTotals.count} blocks`}`
    : "—";
  document.getElementById("blueprint-stat-done").textContent = entries.length
    ? `${entries.filter((e) => done[e.id]).length}/${entries.length}`
    : "—";
  document.getElementById("blueprint-stat-busiest").textContent = totals.perDay[totals.busiest].minutes
    ? `${PLAN_DAY_LABELS[totals.busiest]} · ${formatPlanDuration(totals.perDay[totals.busiest].minutes)}`
    : "—";
}

function renderPlanWeekStrip(totals, range) {
  const wrap = document.getElementById("week-plan-days");
  if (!wrap) return;
  const today = todayDayKey();
  const now = planNowMinutes();
  const maxMinutes = Math.max(...DAY_KEYS.map((d) => totals.perDay[d].minutes), 1);

  wrap.innerHTML = DAY_KEYS.map((d) => {
    const { count, minutes } = totals.perDay[d];
    const isToday = d === today;
    const classes = ["week-tile"];
    if (isToday) classes.push("is-today");
    if (d === selectedPlanDay) classes.push("is-selected");
    if (!count) classes.push("is-empty");
    const hours = minutes ? formatPlanDuration(minutes) : count ? `${count}×` : "—";
    return `
      <button type="button" class="${classes.join(" ")}" data-day="${d}" style="--load:${(minutes / maxMinutes).toFixed(3)}" aria-pressed="${d === selectedPlanDay}" aria-label="${PLAN_DAY_NAMES[d]}: ${count} blocks">
        <span class="week-tile-head">
          <span class="week-tile-day">${PLAN_DAY_LABELS[d]}</span>
          ${isToday ? `<span class="week-tile-today">Today</span>` : ""}
        </span>
        <span class="week-tile-hours">${hours}</span>
        <span class="week-tile-count">${count ? `${count} ${count === 1 ? "block" : "blocks"}` : "Free"}</span>
        ${buildDayTrack(sortedDayEntries(weekPlan, d), range, {
          compact: true,
          nowMin: isToday ? now : null,
          done: isToday ? loadPlanDone(todayKey()) : {},
        })}
      </button>`;
  }).join("");

  wrap.querySelectorAll(".week-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPlanDay = btn.dataset.day;
      renderBlueprint();
    });
  });

  // On the phone the strip scrolls sideways — start it at the selected day.
  const selected = wrap.querySelector(".is-selected");
  if (selected && !wrap.dataset.scrolled && wrap.scrollWidth > wrap.clientWidth) {
    const offset = selected.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
    wrap.scrollLeft = Math.max(0, offset - 16);
    wrap.dataset.scrolled = "1";
  }
}

function renderPlanDay(totals, range) {
  const list = document.getElementById("week-plan-list");
  if (!list) return;
  const day = selectedPlanDay;
  const isToday = day === todayDayKey();
  const entries = sortedDayEntries(weekPlan, day);
  const now = planNowMinutes();
  const done = isToday ? loadPlanDone(todayKey()) : {};
  const status = isToday ? planDayStatus(entries, now, done) : null;

  document.getElementById("plan-day-title").textContent = isToday ? `Today · ${PLAN_DAY_NAMES[day]}` : PLAN_DAY_NAMES[day];
  const { count, minutes } = totals.perDay[day];
  document.getElementById("plan-day-summary").textContent = count
    ? `${count} ${count === 1 ? "block" : "blocks"}${minutes ? ` · ${formatPlanDuration(minutes)}` : ""}`
    : "";
  document.getElementById("plan-day-track").innerHTML = entries.length
    ? buildDayTrack(entries, range, { nowMin: isToday ? now : null, done })
    : "";
  document.getElementById("plan-add-btn").textContent = `Add to ${PLAN_DAY_LABELS[day]}`;

  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing planned for ${PLAN_DAY_NAMES[day]} yet — add a block below.</li>`;
    return;
  }

  list.innerHTML = entries.map((e) => planBlockRowHtml(e, { isToday, status, done, now, deletable: true })).join("");

  list.querySelectorAll(".plan-check").forEach((box) => {
    box.addEventListener("change", () => togglePlanDone(todayKey(), box.dataset.id));
  });
}

function renderBlueprint() {
  weekPlan = loadWeekPlan();
  const totals = weekTotals(weekPlan);
  const range = planRange(weekPlan);
  renderBlueprintHeader(totals);
  renderPlanWeekStrip(totals, range);
  renderPlanDay(totals, range);
}
window.renderBlueprint = renderBlueprint;

function addPlanEntry(day, start, end, title) {
  weekPlan[day].push({ id: crypto.randomUUID(), start, end: end || "", title });
  saveWeekPlan(weekPlan);
  renderBlueprint();
  const row = document.querySelector(`#week-plan-list .plan-block[data-id="${CSS.escape(weekPlan[day][weekPlan[day].length - 1].id)}"]`);
  if (row) row.classList.add("plan-block-enter");
  if (window.renderOverview) window.renderOverview();
}

function deletePlanEntry(day, id) {
  weekPlan[day] = weekPlan[day].filter((e) => e.id !== id);
  saveWeekPlan(weekPlan);
  renderBlueprint();
  if (window.renderOverview) window.renderOverview();
}

const planForm = document.getElementById("plan-entry-form");
if (planForm) {
  planForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const start = document.getElementById("plan-start").value;
    const end = document.getElementById("plan-end").value;
    const title = document.getElementById("plan-title").value.trim();
    if (!start || !title) return;
    addPlanEntry(selectedPlanDay, start, end, title);
    document.getElementById("plan-title").value = "";
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".plan-delete");
  if (!btn) return;
  deletePlanEntry(selectedPlanDay, btn.dataset.id);
});

// Keep "now" honest: re-render once a minute while Blueprint is on screen.
let blueprintLastMinute = -1;
setInterval(() => {
  const section = document.getElementById("blueprint-section");
  if (!section || section.hidden || document.hidden) return;
  const minute = planNowMinutes();
  if (minute === blueprintLastMinute) return;
  blueprintLastMinute = minute;
  renderBlueprint();
}, 15 * 1000);

renderBlueprint();
