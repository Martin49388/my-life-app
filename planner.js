// Alfred plans the week (Blueprint).
//
// Blueprint's week plan is a weekly template (one list of time blocks per
// weekday, key "week-plan"). Alfred drafts a revised template from what
// the rest of the app knows: the current template, goals and their pace
// (behind ones first), last week's review (rating, what worked, what
// dragged, the one thing for this week), habits and how often they're
// due, the training target and Fitness's day titles, recovery, and an
// optional note ("exams Wednesday"). Nothing is written until Martin
// ticks the days he wants and taps Apply; Apply keeps a one-step undo.
//
// One IIFE — every classic script shares the global scope. Uses the
// globals DAY_KEYS / loadWeekPlan / saveWeekPlan / renderBlueprint
// (blueprint.js) and window.callGemini (alfred.js).
(function () {
  const UNDO_KEY = "week-plan-undo";
  const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  const MAX_BLOCKS = 12;
  let draft = null; // { summary, reasons, days: { mon: [...] } }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function isoWeekKey(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    const monday = addDays(dateStr, -((d.getDay() + 6) % 7));
    const thursday = new Date(`${addDays(monday, 3)}T00:00:00`);
    const year = thursday.getFullYear();
    const jan4 = new Date(year, 0, 4);
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const week = Math.round((thursday - firstMonday) / (7 * 86400000)) + 1;
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  // ---------------------------------------------------------------------
  // What Alfred gets told

  function templateLines(plan) {
    return DAY_KEYS.map((d) => {
      const blocks = sortedDayEntries(plan, d);
      return `${DAY_NAMES[d]}: ${blocks.length ? blocks.map((b) => `${b.start}${b.end ? `-${b.end}` : ""} ${b.title}`).join("; ") : "(empty)"}`;
    });
  }

  function lastReviewLines() {
    const reviews = readJson("reviews", {});
    const today = todayKey();
    const dow = (new Date(`${today}T00:00:00`).getDay() + 6) % 7; // Mon=0
    // On a weekend this week's review is the fresh one; otherwise last week's.
    const keys = dow >= 5 ? [isoWeekKey(today), isoWeekKey(addDays(today, -7))] : [isoWeekKey(addDays(today, -7))];
    for (const key of keys) {
      const r = reviews[key];
      if (!r) continue;
      const lines = [];
      if (r.rating) lines.push(`rated the week ${r.rating}/5`);
      if ((r.wins || "").trim()) lines.push(`what worked: ${r.wins.trim()}`);
      if ((r.drags || "").trim()) lines.push(`what dragged: ${r.drags.trim()}`);
      if ((r.focus || "").trim()) lines.push(`the one thing to change: ${r.focus.trim()}`);
      if (r.ai && r.ai.text) lines.push(`Alfred's take then: ${String(r.ai.text).slice(0, 400)}`);
      if (lines.length) return [`Review ${key}: ${lines.join(" | ")}`];
    }
    return ["No written review for last week."];
  }

  function buildPrompt(note) {
    const plan = loadWeekPlan();
    const goalsNow = window.activeGoals ? window.activeGoals() : [];
    const goalLines = goalsNow.map((g) => `${g.name} (${g.term}-term): ${g.current}/${g.target} ${g.unit}${g.deadline ? `, due ${g.deadline}` : ""} — ${window.goalPaceText ? window.goalPaceText(g) : ""}`);
    const habitLines = (typeof habits !== "undefined" ? habits : []).map((h) => {
      const freq = window.habitFreq ? window.habitFreq(h) : 7;
      return `${h.name}: ${freq === 7 ? "every day" : `${freq}x a week`}`;
    });
    const fitness = readJson("fitness", { days: [] });
    const trainDays = (fitness.days || [])
      .map((d, i) => (d && (d.title || (d.exercises || []).length) ? `${DAY_NAMES[DAY_KEYS[i]]}: ${d.title || "session"} (${(d.exercises || []).length} exercises)` : null))
      .filter(Boolean);
    const trainTarget = typeof TRAIN_TARGET !== "undefined" ? TRAIN_TARGET : 5;
    const recovery = window.recoverySummary ? window.recoverySummary() : null;
    const kcalGoal = window.foodGoal ? window.foodGoal() : null;

    return [
      "You are Alfred, a blunt but practical planning assistant inside Martin's personal tracking app.",
      "Draft Martin's weekly schedule TEMPLATE (the same blocks repeat every week) as time blocks per weekday.",
      "",
      `Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
      "",
      "CURRENT TEMPLATE:",
      ...templateLines(plan),
      "",
      "GOALS (worst pace first):",
      ...(goalLines.length ? goalLines : ["none set"]),
      "",
      "HABITS:",
      ...(habitLines.length ? habitLines : ["none set"]),
      "",
      `TRAINING: target ${trainTarget} training days a week.${trainDays.length ? ` Fitness template: ${trainDays.join("; ")}.` : ""}`,
      recovery && recovery.line ? `RECOVERY: ${recovery.line}` : "",
      kcalGoal ? `NUTRITION: calorie goal is ${kcalGoal}.` : "",
      "",
      "LAST REVIEW:",
      ...lastReviewLines(),
      "",
      note ? `MARTIN'S NOTE FOR THIS WEEK: ${note}` : "",
      "",
      "RULES:",
      "- Keep fixed commitments already in the template (work, school, classes, commutes) unless the note says otherwise. Improve around them.",
      `- Schedule exactly ${trainTarget} training blocks across the week (45-90 min), not on consecutive heavy days if avoidable.`,
      "- Give goals that are behind or overdue concrete blocks, named after the goal (e.g. 'Reading — 30 pages').",
      "- Act on 'what dragged' and 'the one thing to change' from the review.",
      "- Realistic: at most 8 blocks a day, leave real breaks, nothing before 06:00 or after 23:00, keep sleep protected.",
      "- Titles short (max 40 characters), plain, no emojis.",
      "- Times as 24h HH:MM. end is optional but preferred.",
      "",
      'Reply as JSON only: {"summary": "one or two sentences on the idea of this week", "reasons": ["short line per important change, max 5"], "days": {"mon": [{"start": "07:00", "end": "08:00", "title": "..."}], "tue": [], "wed": [], "thu": [], "fri": [], "sat": [], "sun": []}}',
    ]
      .filter((l) => l !== "")
      .join("\n");
  }

  // ---------------------------------------------------------------------
  // Reading Alfred's answer — never trusted as-is.

  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  function cleanTime(t) {
    const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    const v = `${m[1].padStart(2, "0")}:${m[2]}`;
    return HHMM.test(v) ? v : "";
  }

  function parseDraft(text) {
    let data;
    try {
      data = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error("Alfred's answer wasn't readable. Try again.");
    }
    if (!data || typeof data.days !== "object") throw new Error("Alfred didn't return a week. Try again.");
    const days = {};
    let total = 0;
    for (const d of DAY_KEYS) {
      const list = Array.isArray(data.days[d]) ? data.days[d] : [];
      days[d] = list
        .map((b) => {
          const start = cleanTime(b && b.start);
          let end = cleanTime(b && b.end);
          const title = String((b && b.title) || "").replace(/\s+/g, " ").trim().slice(0, 60);
          if (!start || !title) return null;
          if (end && end <= start) end = "";
          return { start, end, title };
        })
        .filter(Boolean)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, MAX_BLOCKS);
      total += days[d].length;
    }
    if (!total) throw new Error("Alfred's draft came back empty. Try again, maybe with a note.");
    return {
      summary: String(data.summary || "").slice(0, 400),
      reasons: (Array.isArray(data.reasons) ? data.reasons : []).map((r) => String(r).slice(0, 200)).filter(Boolean).slice(0, 5),
      days,
    };
  }

  // Same start + title as a block already there -> keep that block (and
  // its id, so today's done-ticks survive).
  function diffDay(current, proposed) {
    const key = (b) => `${b.start}|${b.title.toLowerCase()}`;
    const currentKeys = new Map(current.map((b) => [key(b), b]));
    const proposedKeys = new Set(proposed.map(key));
    const rows = proposed.map((b) => {
      const same = currentKeys.get(key(b));
      return { ...b, id: same ? same.id : null, state: same ? (same.end === b.end ? "kept" : "changed") : "new" };
    });
    const removed = current.filter((b) => !proposedKeys.has(key(b))).map((b) => ({ ...b, state: "removed" }));
    const changed = rows.some((r) => r.state !== "kept") || removed.length > 0;
    return { rows, removed, changed };
  }

  // ---------------------------------------------------------------------
  // UI

  const card = document.getElementById("alfred-plan");
  if (!card) return;
  const noteInput = document.getElementById("ap-note");
  const goBtn = document.getElementById("ap-go");
  const status = document.getElementById("ap-status");
  const overlay = document.getElementById("ap-overlay");
  const body = document.getElementById("ap-body");
  const applyBtn = document.getElementById("ap-apply");

  function setStatus(html, tone = "") {
    status.innerHTML = html;
    status.dataset.tone = tone;
    status.hidden = !html;
  }

  function renderUndo() {
    const undo = readJson(UNDO_KEY, null);
    if (undo && undo.at && Date.now() - undo.at < 7 * 86400000) {
      setStatus(`Applied Alfred's draft ${new Date(undo.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}. <button type="button" class="ap-link" id="ap-undo">Undo</button>`, "good");
    }
  }

  function renderDraft() {
    const plan = loadWeekPlan();
    const sections = DAY_KEYS.map((d) => {
      const diff = diffDay(sortedDayEntries(plan, d), draft.days[d]);
      const rows = [...diff.rows, ...diff.removed].sort((a, b) => a.start.localeCompare(b.start));
      const list = rows.length
        ? rows
            .map(
              (b) => `<li class="ap-block" data-state="${b.state}">
                <span class="ap-time">${esc(b.start)}${b.end ? `–${esc(b.end)}` : ""}</span>
                <span class="ap-title">${esc(b.title)}</span>
                ${b.state !== "kept" ? `<span class="ap-tag">${{ new: "new", changed: "moved", removed: "removed" }[b.state]}</span>` : ""}
              </li>`
            )
            .join("")
        : `<li class="ap-block ap-empty">Free day</li>`;
      return `<section class="ap-day${diff.changed ? "" : " is-same"}">
          <label class="ap-day-head">
            <input type="checkbox" data-ap-day="${d}" ${diff.changed ? "checked" : "disabled"} />
            <span class="ap-day-name">${DAY_NAMES[d]}</span>
            <span class="ap-day-note">${diff.changed ? `${draft.days[d].length} ${draft.days[d].length === 1 ? "block" : "blocks"}` : "no change"}</span>
          </label>
          <ul class="ap-blocks">${list}</ul>
        </section>`;
    }).join("");

    body.innerHTML = `
      ${draft.summary ? `<p class="ap-summary">${esc(draft.summary)}</p>` : ""}
      ${draft.reasons.length ? `<ul class="ap-reasons">${draft.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      <div class="ap-days">${sections}</div>`;
    syncApplyLabel();
  }

  function checkedDays() {
    return [...body.querySelectorAll("[data-ap-day]:checked")].map((c) => c.dataset.apDay);
  }

  function syncApplyLabel() {
    const n = checkedDays().length;
    applyBtn.disabled = n === 0;
    applyBtn.textContent = n === 0 ? "Pick a day" : n === 7 ? "Apply the whole week" : `Apply ${n} ${n === 1 ? "day" : "days"}`;
  }

  function openSheet() {
    overlay.hidden = false;
    document.body.classList.add("goal-sheet-open");
    overlay.querySelector(".modal-card").scrollTop = 0;
  }

  function closeSheet() {
    overlay.hidden = true;
    document.body.classList.remove("goal-sheet-open");
  }

  async function makeDraft() {
    if (!window.callGemini) return;
    goBtn.disabled = true;
    goBtn.textContent = "Alfred is planning…";
    setStatus("");
    try {
      const text = await window.callGemini(buildPrompt(noteInput.value.trim()), { json: true });
      draft = parseDraft(text);
      renderDraft();
      openSheet();
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (/No Gemini key/i.test(msg)) {
        setStatus(`Alfred needs a Gemini key for this. <button type="button" class="ap-link" data-ap-settings>Add one in Settings</button>`, "warn");
      } else {
        setStatus(esc(msg), "warn");
      }
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = "Draft my week";
    }
  }

  function applyDraft() {
    const days = checkedDays();
    if (!draft || !days.length) return;
    const plan = loadWeekPlan();
    localStorage.setItem(UNDO_KEY, JSON.stringify({ at: Date.now(), plan }));
    const next = JSON.parse(JSON.stringify(plan));
    for (const d of days) {
      const diff = diffDay(sortedDayEntries(plan, d), draft.days[d]);
      next[d] = diff.rows.map((b) => ({ id: b.id || crypto.randomUUID(), start: b.start, end: b.end || "", title: b.title }));
    }
    saveWeekPlan(next);
    closeSheet();
    if (window.renderBlueprint) window.renderBlueprint();
    if (window.renderOverview) window.renderOverview();
    renderUndo();
  }

  function undo() {
    const saved = readJson(UNDO_KEY, null);
    if (!saved || !saved.plan) return;
    saveWeekPlan(saved.plan);
    localStorage.removeItem(UNDO_KEY);
    setStatus("Back to your previous plan.", "");
    if (window.renderBlueprint) window.renderBlueprint();
    if (window.renderOverview) window.renderOverview();
  }

  goBtn.addEventListener("click", makeDraft);
  noteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      makeDraft();
    }
  });
  applyBtn.addEventListener("click", applyDraft);
  document.getElementById("ap-discard").addEventListener("click", closeSheet);
  document.getElementById("ap-close").addEventListener("click", closeSheet);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSheet();
  });
  body.addEventListener("change", (e) => {
    if (e.target.matches("[data-ap-day]")) syncApplyLabel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeSheet();
  });
  card.addEventListener("click", (e) => {
    if (e.target.closest("#ap-undo")) undo();
    if (e.target.closest("[data-ap-settings]") && window.switchSection) window.switchSection("settings");
  });

  renderUndo();

  // Exposed for tests and for Alfred's chat to reuse later.
  window.alfredPlanner = { buildPrompt, parseDraft, makeDraft };
})();
