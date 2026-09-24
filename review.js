// Review — was a plain note log; now the weekly review, and most of it
// writes itself. The app already knows what happened: habits checked,
// days trained, water hit, kcal on target, plan blocks done, readiness
// logged. Review scores that week out of 100, lays it out day by day,
// and only then asks the three questions a person actually has to answer
// (what worked, what dragged, one thing for next week) — with last
// week's answer carried forward so the loop closes.
//
// Storage: localStorage "reviews" =
//   { "2026-W38": { rating 0-5, wins, drags, focus, focusHit, at, updated } }
// ISO week keys, so the calendar year boundary behaves.
//
// One IIFE (shared global scope — see reading.js's comment). Only
// window.renderReview and window.reviewSummary are exported.
(function () {
  "use strict";

  const KEY = "reviews";
  const PROMPTS = [
    { id: "wins", label: "What worked", placeholder: "The thing worth doing again." },
    { id: "drags", label: "What dragged", placeholder: "Where the week leaked time, sleep or attention." },
    { id: "focus", label: "One thing for next week", placeholder: "One change. It shows up at the top of next week." },
  ];

  function loadReviews() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  let reviews = loadReviews();
  let viewMonday = null; // set after mondayOf is defined
  let writeupWeek = null; // which week's write-up is currently in the DOM
  let saveTimer = null;

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(reviews));
  }

  // ---------------------------------------------------------------------
  // Dates and ISO weeks

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function mondayOf(date) {
    const jsDay = new Date(`${date}T00:00:00`).getDay();
    return addDays(date, -((jsDay + 6) % 7));
  }

  // ISO-8601: the week belongs to the year its Thursday falls in, and
  // week 1 is the week containing 4 January.
  function weekKeyOf(monday) {
    const thursday = new Date(`${addDays(monday, 3)}T00:00:00`);
    const year = thursday.getFullYear();
    const jan4 = new Date(year, 0, 4);
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const week = Math.round((thursday - firstMonday) / (7 * 86400000)) + 1;
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  function weekNumber(monday) {
    return Number(weekKeyOf(monday).slice(-2));
  }

  function dayName(date, opts) {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, opts || { weekday: "short", day: "numeric", month: "short" });
  }

  function weekRange(monday) {
    const start = new Date(`${monday}T00:00:00`);
    const end = new Date(`${addDays(monday, 6)}T00:00:00`);
    const sameMonth = start.getMonth() === end.getMonth();
    const fmt = (d, withMonth) => d.toLocaleDateString(undefined, withMonth ? { day: "numeric", month: "short" } : { day: "numeric" });
    return `${fmt(start, !sameMonth)} – ${fmt(end, true)}`;
  }

  function isCurrentWeek(monday) {
    return monday === mondayOf(todayKey());
  }

  function elapsedCount(monday) {
    const today = todayKey();
    if (addDays(monday, 6) <= today) return 7;
    let n = 0;
    for (let i = 0; i < 7; i++) if (addDays(monday, i) <= today) n++;
    return Math.max(1, n);
  }

  function average(values) {
    const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  // ---------------------------------------------------------------------
  // The week, computed from what every other section already stores.
  // Each metric gives a per-day ratio (null = nothing to measure that
  // day) plus a week summary. `limit` exists so an unfinished week can be
  // compared against the same slice of the week before it.

  function weekData(monday, limit) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const span = limit || elapsedCount(monday);
    const counted = days.slice(0, span);
    const today = todayKey();
    const dayKeys = typeof DAY_KEYS !== "undefined" ? DAY_KEYS : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const weekPlan = typeof loadWeekPlan === "function" ? loadWeekPlan() : null;
    const metrics = [];
    const cells = {};

    const future = (d) => d > today;

    // Habits ------------------------------------------------------------
    const habitCount = typeof habits !== "undefined" ? habits.length : 0;
    cells.habits = days.map((d) => {
      if (!habitCount || future(d)) return { ratio: null, text: habitCount ? "still to come" : "no habits set" };
      const done = habits.filter((h) => (window.habitSatisfied ? window.habitSatisfied(h, d) : h.history[d])).length;
      return { ratio: done / habitCount, text: `${done}/${habitCount} habits` };
    });
    const habitDone = counted.reduce((sum, d) => sum + (habitCount ? habits.filter((h) => (window.habitSatisfied ? window.habitSatisfied(h, d) : h.history[d])).length : 0), 0);
    const habitTotal = habitCount * counted.length;
    metrics.push({
      id: "habits",
      label: "Habits",
      section: "habits",
      value: habitTotal ? `${habitDone}/${habitTotal}` : "—",
      detail: habitTotal ? `${Math.round((habitDone / habitTotal) * 100)}% of checks` : "no habits set",
      ratio: habitTotal ? habitDone / habitTotal : null,
    });

    // Training ----------------------------------------------------------
    const hasFitness = typeof plan !== "undefined" && plan && plan.log;
    const target = typeof TRAIN_TARGET !== "undefined" ? TRAIN_TARGET : 5;
    cells.training = days.map((d) => {
      if (!hasFitness || future(d)) return { ratio: null, text: "still to come" };
      const n = (plan.log[d] || []).length;
      return { ratio: n ? 1 : 0, text: n ? `${n} exercises done` : "no training" };
    });
    const trainedDays = hasFitness ? counted.filter((d) => (plan.log[d] || []).length > 0).length : 0;
    metrics.push({
      id: "training",
      label: "Training",
      section: "fitness",
      value: hasFitness ? `${trainedDays}/${target}` : "—",
      detail: "days this week",
      ratio: hasFitness ? Math.min(1, trainedDays / target) : null,
    });

    // Water -------------------------------------------------------------
    const hasWater = typeof water !== "undefined" && typeof waterOn === "function" && water.target > 0;
    cells.water = days.map((d) => {
      if (!hasWater || future(d)) return { ratio: null, text: "still to come" };
      const ml = waterOn(d);
      return { ratio: Math.min(1, ml / water.target), text: `${(ml / 1000).toFixed(2)}L` };
    });
    const waterMet = hasWater ? counted.filter((d) => waterOn(d) >= water.target).length : 0;
    const waterAvg = hasWater ? average(counted.map((d) => waterOn(d))) : null;
    metrics.push({
      id: "water",
      label: "Water",
      section: "fuel",
      value: hasWater ? `${waterMet}/${counted.length}` : "—",
      detail: waterAvg != null ? `days at target · ${(waterAvg / 1000).toFixed(2)}L avg` : "days at target",
      ratio: hasWater ? waterMet / counted.length : null,
    });

    // Fuel --------------------------------------------------------------
    const hasFood = typeof food !== "undefined" && typeof entriesFor === "function" && food.target > 0;
    const kcalOn = (d) => entriesFor(d).reduce((sum, e) => sum + e.kcal, 0);
    cells.fuel = days.map((d) => {
      if (!hasFood || future(d)) return { ratio: null, text: "still to come" };
      const kcal = kcalOn(d);
      return { ratio: Math.min(1, kcal / food.target), text: kcal ? `${kcal.toLocaleString()} kcal` : "nothing logged" };
    });
    const fuelMet = hasFood ? counted.filter((d) => window.kcalStatus(kcalOn(d)).met).length : 0;
    const kcalAvg = hasFood ? average(counted.map(kcalOn).filter((k) => k > 0)) : null;
    metrics.push({
      id: "fuel",
      label: "Fuel",
      section: "fuel",
      value: hasFood ? `${fuelMet}/${counted.length}` : "—",
      detail: kcalAvg != null ? `days on target · ${Math.round(kcalAvg).toLocaleString()} kcal avg` : "days on target",
      ratio: hasFood ? fuelMet / counted.length : null,
    });

    // Plan --------------------------------------------------------------
    const planBlocks = (d) => {
      if (!weekPlan) return [];
      const key = dayKeys[(new Date(`${d}T00:00:00`).getDay() + 6) % 7];
      return weekPlan[key] || [];
    };
    cells.plan = days.map((d) => {
      const blocks = planBlocks(d);
      if (!blocks.length || future(d)) return { ratio: null, text: blocks.length ? "still to come" : "nothing planned" };
      const done = typeof loadPlanDone === "function" ? loadPlanDone(d) : {};
      const doneCount = blocks.filter((b) => done[b.id]).length;
      return { ratio: doneCount / blocks.length, text: `${doneCount}/${blocks.length} blocks` };
    });
    let planDone = 0;
    let planTotal = 0;
    counted.forEach((d) => {
      const blocks = planBlocks(d);
      if (!blocks.length) return;
      const done = typeof loadPlanDone === "function" ? loadPlanDone(d) : {};
      planTotal += blocks.length;
      planDone += blocks.filter((b) => done[b.id]).length;
    });
    metrics.push({
      id: "plan",
      label: "Plan",
      section: "blueprint",
      value: planTotal ? `${planDone}/${planTotal}` : "—",
      detail: planTotal ? "blocks checked off" : "no week plan yet",
      ratio: planTotal ? planDone / planTotal : null,
    });

    // Recovery ----------------------------------------------------------
    const scoreOn = (d) => (window.recoveryScoreOn ? window.recoveryScoreOn(d) : null);
    cells.recovery = days.map((d) => {
      if (future(d)) return { ratio: null, text: "still to come" };
      const score = scoreOn(d);
      return score == null ? { ratio: null, text: "no check-in" } : { ratio: score / 100, text: `readiness ${score}` };
    });
    const recScores = counted.map(scoreOn).filter((v) => v != null);
    const recAvg = average(recScores);
    metrics.push({
      id: "recovery",
      label: "Recovery",
      section: "recovery",
      value: recAvg == null ? "—" : String(Math.round(recAvg)),
      detail: recScores.length ? `readiness avg · ${recScores.length} check-ins` : "no check-ins",
      ratio: recAvg == null ? null : recAvg / 100,
    });

    const scored = metrics.map((m) => m.ratio).filter((r) => r != null);
    const score = scored.length ? Math.round(average(scored) * 100) : null;

    return { monday, days, counted, span, metrics, cells, score };
  }

  // ---------------------------------------------------------------------
  // Reviews (the written half)

  const RATING_WORDS = ["Rough", "Off", "Fine", "Strong", "Excellent"];

  function reviewFor(key) {
    return reviews[key] || null;
  }

  function hasContent(r) {
    return !!(r && (r.rating || (r.wins || "").trim() || (r.drags || "").trim() || (r.focus || "").trim()));
  }

  function mondayFromKey(key) {
    const [year, week] = key.split("-W").map(Number);
    const jan4 = new Date(year, 0, 4);
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const d = new Date(firstMonday);
    d.setDate(firstMonday.getDate() + (week - 1) * 7);
    return dateKey(d);
  }

  function writeReview(key, patch) {
    const existing = reviews[key] || { rating: 0, wins: "", drags: "", focus: "", focusHit: null, at: Date.now() };
    reviews[key] = { ...existing, ...patch, monday: existing.monday || mondayFromKey(key), updated: Date.now() };
    persist();
  }

  function reviewedStreak() {
    let cursor = mondayOf(todayKey());
    // An unreviewed current week doesn't break a streak that's otherwise live.
    if (!hasContent(reviewFor(weekKeyOf(cursor)))) cursor = addDays(cursor, -7);
    let n = 0;
    while (hasContent(reviewFor(weekKeyOf(cursor))) && n < 520) {
      n++;
      cursor = addDays(cursor, -7);
    }
    return n;
  }

  // ---------------------------------------------------------------------
  // Highlights — the lines worth reading before writing anything.

  function weekLogCount(days) {
    const from = new Date(`${days[0]}T00:00:00`).getTime();
    const to = new Date(`${days[6]}T00:00:00`).getTime() + 86400000;
    const perSection = {};
    if (typeof JOURNAL_KEYS !== "undefined" && typeof loadJournal === "function") {
      for (const key of JOURNAL_KEYS) {
        const n = loadJournal(key).filter((e) => e.at >= from && e.at < to).length;
        if (n) perSection[key] = n;
      }
    }
    if (typeof window.notesInRange === "function") {
      const n = window.notesInRange(from, to);
      if (n) perSection.notes = (perSection.notes || 0) + n;
    }
    const total = Object.values(perSection).reduce((a, b) => a + b, 0);
    const top = Object.entries(perSection).sort((a, b) => b[1] - a[1])[0];
    return { total, top, sections: Object.keys(perSection).length };
  }

  function highlights(data) {
    const out = [];
    const counted = data.counted;

    // Best day across everything that was measurable that day.
    const dayScores = data.days
      .map((d, i) => {
        const ratios = data.metrics.map((m) => data.cells[m.id][i].ratio).filter((r) => r != null);
        return ratios.length >= 2 ? { date: d, score: average(ratios) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (dayScores.length && dayScores[0].score > 0) {
      const best = dayScores[0];
      out.push(`Best day: ${dayName(best.date, { weekday: "long" })} — ${Math.round(best.score * 100)}% across everything tracked.`);
      const worst = dayScores[dayScores.length - 1];
      if (dayScores.length > 2 && best.score - worst.score > 0.25) {
        out.push(`Weakest: ${dayName(worst.date, { weekday: "long" })} at ${Math.round(worst.score * 100)}%.`);
      }
    }

    // Habits: who carried the week, who didn't.
    if (typeof habits !== "undefined" && habits.length) {
      const per = habits.map((h) => ({ name: h.name, done: counted.filter((d) => h.history[d]).length }));
      const perfect = per.filter((p) => p.done === counted.length).map((p) => p.name);
      const worst = per.slice().sort((a, b) => a.done - b.done)[0];
      if (perfect.length) {
        out.push(`Every single day: ${perfect.join(", ")}.`);
      }
      if (worst && worst.done < counted.length) {
        out.push(`${worst.name} missed ${counted.length - worst.done} of ${counted.length} days.`);
      }
    }

    // Plan adherence, in words rather than a bar.
    const planMetric = data.metrics.find((m) => m.id === "plan");
    if (planMetric && planMetric.ratio != null) {
      out.push(`Checked off ${Math.round(planMetric.ratio * 100)}% of the blocks you planned (${planMetric.value}).`);
    }

    // Recovery's shape over the week.
    const recCells = data.cells.recovery.map((c, i) => ({ ratio: c.ratio, date: data.days[i] })).filter((c) => c.ratio != null);
    if (recCells.length >= 3) {
      const top = recCells.slice().sort((a, b) => b.ratio - a.ratio)[0];
      const low = recCells.slice().sort((a, b) => a.ratio - b.ratio)[0];
      out.push(`Readiness peaked ${dayName(top.date, { weekday: "long" })} (${Math.round(top.ratio * 100)}) and bottomed out ${dayName(low.date, { weekday: "long" })} (${Math.round(low.ratio * 100)}).`);
    }

    // What you wrote down, anywhere in the app.
    const logs = weekLogCount(data.days);
    if (logs.total) {
      const label = logs.top ? logs.top[0].charAt(0).toUpperCase() + logs.top[0].slice(1) : "";
      out.push(`${logs.total} ${logs.total === 1 ? "entry" : "entries"} logged across ${logs.sections} ${logs.sections === 1 ? "section" : "sections"}${logs.top ? ` — mostly ${label} (${logs.top[1]})` : ""}.`);
    }

    return out.slice(0, 5);
  }

  // ---------------------------------------------------------------------
  // Rendering

  function renderNav(data) {
    document.getElementById("rev-week").textContent = `Week ${weekNumber(data.monday)}`;
    document.getElementById("rev-range").textContent = weekRange(data.monday);
    const next = document.getElementById("rev-next");
    if (next) next.disabled = isCurrentWeek(data.monday);
    const chip = document.getElementById("rev-this-week");
    if (chip) chip.hidden = isCurrentWeek(data.monday);
  }

  function renderPill(data, record) {
    const pill = document.getElementById("rev-pill");
    if (!pill) return;
    const label = document.getElementById("rev-pill-label");
    const detail = document.getElementById("rev-pill-detail");
    const reviewed = hasContent(record);
    if (!isCurrentWeek(data.monday)) {
      pill.dataset.state = reviewed ? "live" : "idle";
      label.textContent = reviewed ? "Reviewed" : "Never reviewed";
      detail.textContent = reviewed && record.updated ? new Date(record.updated).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
      return;
    }
    if (reviewed) {
      pill.dataset.state = "live";
      label.textContent = "Reviewed";
      detail.textContent = `${7 - data.span} ${7 - data.span === 1 ? "day" : "days"} left in the week`;
      if (data.span === 7) detail.textContent = "week closed";
      return;
    }
    const dow = new Date(`${todayKey()}T00:00:00`).getDay(); // 0 = Sunday
    if (dow === 0 || dow === 6) {
      pill.dataset.state = "next";
      label.textContent = "Review due";
      detail.textContent = dow === 0 ? "today" : "tomorrow";
    } else {
      pill.dataset.state = "idle";
      label.textContent = "Week in progress";
      detail.textContent = `${data.span} of 7 days`;
    }
  }

  function renderHero(data, record, previous) {
    const scoreEl = document.getElementById("rev-score");
    scoreEl.textContent = data.score == null ? "—" : String(data.score);

    // No point saying "+0 vs last week" when neither week has anything in it.
    const comparable = data.score != null && previous && previous.score != null && (data.score > 0 || previous.score > 0);
    const delta = comparable ? data.score - previous.score : null;
    const caption = document.getElementById("rev-caption");
    if (data.score == null) {
      caption.textContent = "Week score · nothing tracked this week yet";
    } else {
      const bits = [`Week score · ${data.metrics.filter((m) => m.ratio != null).length} of ${data.metrics.length} areas tracked`];
      if (delta != null) bits.push(`${delta >= 0 ? "+" : "−"}${Math.abs(delta)} vs last week`);
      caption.textContent = bits.join(" · ");
    }

    // "Strongest: Training" is meaningless when every area sits at zero.
    const ranked = data.metrics.filter((m) => m.ratio != null && m.ratio > 0).sort((a, b) => b.ratio - a.ratio);
    const rating = record && record.rating ? record.rating : 0;
    document.getElementById("rev-stats").innerHTML = [
      ["Days counted", `${data.span}/7`],
      ["Strongest", ranked.length ? ranked[0].label : "—"],
      ["Weakest", ranked.length ? ranked[ranked.length - 1].label : "—"],
      ["Your rating", rating ? `${rating}/5` : "—"],
    ]
      .map(
        ([label, value]) => `
        <div class="dash-stat">
          <span class="stat-label">${label}</span>
          <span class="dash-stat-value">${esc(value)}</span>
        </div>`
      )
      .join("");

    document.getElementById("rev-compare").textContent =
      comparable
        ? data.span < 7
          ? `vs the same ${data.span} ${data.span === 1 ? "day" : "days"} last week`
          : "vs last week"
        : "";
  }

  function renderScorecard(data, previous) {
    const list = document.getElementById("rev-scorecard");
    if (!list) return;
    list.innerHTML = data.metrics
      .map((m) => {
        const before = previous ? previous.metrics.find((p) => p.id === m.id) : null;
        const delta = m.ratio != null && before && before.ratio != null ? Math.round((m.ratio - before.ratio) * 100) : null;
        const dir = delta == null ? "none" : delta > 1 ? "up" : delta < -1 ? "down" : "flat";
        const deltaText = delta == null ? "" : dir === "flat" ? "±0" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
        return `
        <li class="rev-row${m.ratio == null ? "" : m.ratio >= 0.8 ? " is-good" : m.ratio < 0.5 ? " is-warn" : ""}" data-goto="${m.section}" role="link" tabindex="0">
          <span class="rev-row-label">${m.label}</span>
          <span class="rev-row-bar"><span style="width:${m.ratio == null ? 0 : Math.round(m.ratio * 100)}%"></span></span>
          <span class="rev-row-value">${esc(m.value)}</span>
          <span class="rev-row-delta" data-dir="${dir}">${deltaText}</span>
          <span class="rev-row-detail">${esc(m.detail)}</span>
        </li>`;
      })
      .join("");
  }

  function renderGrid(data) {
    const grid = document.getElementById("rev-grid");
    if (!grid) return;
    const today = todayKey();
    const head = [`<span class="rev-grid-corner"></span>`]
      .concat(
        data.days.map((d) => {
          const date = new Date(`${d}T00:00:00`);
          const classes = ["rev-grid-day"];
          if (d === today) classes.push("is-today");
          if (d > today) classes.push("is-future");
          return `<span class="${classes.join(" ")}"><b>${date.toLocaleDateString(undefined, { weekday: "narrow" })}</b><i>${date.getDate()}</i></span>`;
        })
      )
      .join("");

    const rows = data.metrics
      .map((m) => {
        const cells = data.cells[m.id]
          .map((cell, i) => {
            const d = data.days[i];
            const classes = ["rev-cell"];
            if (cell.ratio == null) classes.push("is-empty");
            if (d > today) classes.push("is-future");
            if (d === today) classes.push("is-today");
            const fill = cell.ratio == null ? "" : `<span class="rev-cell-fill" style="opacity:${(0.13 + 0.67 * cell.ratio).toFixed(2)}"></span>`;
            return `<span class="${classes.join(" ")}" title="${esc(`${dayName(d)} · ${m.label} · ${cell.text}`)}">${fill}</span>`;
          })
          .join("");
        return `<span class="rev-grid-label">${m.label}</span>${cells}`;
      })
      .join("");

    grid.innerHTML = head + rows;
  }

  function renderHighlights(data) {
    const list = document.getElementById("rev-highlights");
    if (!list) return;
    const lines = highlights(data);
    list.innerHTML = lines.length
      ? lines.map((l) => `<li class="rev-highlight"><span class="rec-signal-dot" aria-hidden="true"></span><span>${esc(l)}</span></li>`).join("")
      : `<li class="empty-state">Nothing tracked this week yet — the app fills this in as you use it.</li>`;
  }

  // ---------------------------------------------------------------------
  // The written half: rating, three prompts, last week's carry-over.
  // Rebuilt only when the viewed week changes — otherwise a re-render
  // mid-sentence would take the caret with it.

  function ratingHtml(record) {
    const rating = record && record.rating ? record.rating : 0;
    return `
      <span class="stat-label">How the week felt</span>
      <div class="rec-pips" role="group" aria-label="Week rating">
        ${RATING_WORDS.map(
          (word, i) =>
            `<button type="button" class="rec-pip${rating >= i + 1 ? " is-on" : ""}${rating === i + 1 ? " is-current" : ""}" data-rev-rating="${i + 1}" title="${word}" aria-label="${word}" aria-pressed="${rating === i + 1}"></button>`
        ).join("")}
      </div>
      <span class="rev-field-note${rating ? " is-set" : ""}">${rating ? RATING_WORDS[rating - 1] : "—"}</span>`;
  }

  function renderRating(record) {
    const el = document.getElementById("rev-rating");
    if (el) el.innerHTML = ratingHtml(record);
  }

  function renderSaved(record) {
    const el = document.getElementById("rev-saved");
    if (!el) return;
    el.textContent = hasContent(record)
      ? `Saved ${new Date(record.updated || record.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "Saves as you type";
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = `${Math.max(56, el.scrollHeight)}px`;
  }

  function renderWriteup(data, record) {
    const wrap = document.getElementById("rev-writeup");
    if (!wrap) return;
    const key = weekKeyOf(data.monday);
    if (writeupWeek === key) {
      renderRating(record);
      renderSaved(record);
      return;
    }
    writeupWeek = key;

    const prevKey = weekKeyOf(addDays(data.monday, -7));
    const prev = reviewFor(prevKey);
    const carried = prev && (prev.focus || "").trim();

    wrap.innerHTML = `
      ${
        carried
          ? `<div class="rev-carry" data-hit="${prev.focusHit === true ? "yes" : prev.focusHit === false ? "no" : ""}">
              <span class="stat-label">Last week's one thing</span>
              <p class="rev-carry-text">${esc(carried)}</p>
              <div class="rev-carry-actions">
                <button type="button" class="rev-chip${prev.focusHit === true ? " is-on" : ""}" data-rev-focus="hit">Did it</button>
                <button type="button" class="rev-chip${prev.focusHit === false ? " is-on" : ""}" data-rev-focus="miss">Didn't</button>
              </div>
            </div>`
          : ""
      }
      <div class="rev-rating" id="rev-rating">${ratingHtml(record)}</div>
      ${PROMPTS.map(
        (p) => `
        <label class="rev-field">
          <span class="stat-label">${p.label}</span>
          <textarea class="rev-input" data-rev-prompt="${p.id}" rows="2" placeholder="${esc(p.placeholder)}"></textarea>
        </label>`
      ).join("")}`;

    PROMPTS.forEach((p) => {
      const input = wrap.querySelector(`[data-rev-prompt="${p.id}"]`);
      if (!input) return;
      input.value = record ? record[p.id] || "" : "";
      autoGrow(input);
    });
    renderSaved(record);
  }

  function renderPast() {
    const list = document.getElementById("rev-past");
    if (!list) return;
    const currentKey = weekKeyOf(viewMonday);
    const rows = Object.keys(reviews)
      .filter((k) => hasContent(reviews[k]) && k !== currentKey)
      .sort()
      .reverse()
      .slice(0, 12);

    const streak = reviewedStreak();
    const streakEl = document.getElementById("rev-streak");
    if (streakEl) streakEl.textContent = streak ? `${streak} ${streak === 1 ? "week" : "weeks"} in a row` : "";

    if (!rows.length) {
      list.innerHTML = `<li class="empty-state">No past reviews yet — this list fills up one Sunday at a time.</li>`;
      return;
    }

    list.innerHTML = rows
      .map((k) => {
        const r = reviews[k];
        const monday = r.monday || mondayFromKey(k);
        const focus = (r.focus || "").trim();
        return `
        <li class="rev-past-row" data-rev-week="${k}" role="link" tabindex="0">
          <span class="rev-past-week">Week ${Number(k.slice(-2))}</span>
          <span class="rev-past-range">${esc(weekRange(monday))}</span>
          <span class="rev-past-rating">${r.rating ? "●".repeat(r.rating) + "○".repeat(5 - r.rating) : "—"}</span>
          <span class="rev-past-focus">${esc(focus || (r.wins || "").trim() || "—")}</span>
          ${r.focusHit === true ? `<span class="rev-past-hit">hit</span>` : r.focusHit === false ? `<span class="rev-past-hit is-miss">missed</span>` : ""}
        </li>`;
      })
      .join("");
  }

  // ---------------------------------------------------------------------
  // Render everything

  // ---------------------------------------------------------------------
  // Alfred's take — a short written summary of the week from Gemini,
  // stored on the week's record ({ai: {text, at}}) so it syncs and never
  // has to be generated twice. Written automatically for last week (and
  // for this week from Sunday on) the first time Review is opened with a
  // Gemini key; otherwise on the button.

  const aiInFlight = new Set();
  const aiFailed = {};

  function hasGeminiKey() {
    return typeof geminiKey === "function" && Boolean(geminiKey());
  }

  function aiPrompt(data, record, previous) {
    const lines = data.metrics.map((m) => `- ${m.label}: ${m.value} (${m.detail})`);
    const hl = highlights(data).map((l) => `- ${l}`);
    const written = record
      ? [
          record.wins ? `What worked (his words): ${record.wins}` : "",
          record.drags ? `What dragged (his words): ${record.drags}` : "",
          record.focus ? `His one thing for next week: ${record.focus}` : "",
        ].filter(Boolean)
      : [];
    return [
      "You are Alfred, the blunt check-in assistant in Martin's personal tracking app.",
      `Write his summary of ${weekRange(data.monday)} (${data.span} of 7 days counted so far).`,
      "3-5 short sentences, plain text, no headings or bullet points, no cushioning:",
      "what went well, what slipped (use the numbers), and one concrete focus for next week.",
      "Use only the data below — don't invent anything.",
      "",
      `Week score: ${data.score ?? "n/a"}/100${previous && previous.score != null ? ` (previous week, same days: ${previous.score})` : ""}`,
      ...lines,
      ...(hl.length ? ["Highlights:", ...hl] : []),
      ...written,
    ].join("\n");
  }

  async function generateAi(monday) {
    const key = weekKeyOf(monday);
    if (aiInFlight.has(key) || !window.callGemini) return;
    aiInFlight.add(key);
    delete aiFailed[key];
    renderReview();
    try {
      const data = weekData(monday);
      const previous = weekData(addDays(monday, -7), data.span);
      const text = await window.callGemini(aiPrompt(data, reviewFor(key), previous));
      if (text) writeReview(key, { ai: { text, at: Date.now() } });
      else aiFailed[key] = "Empty reply";
    } catch (err) {
      aiFailed[key] = err.message;
    }
    aiInFlight.delete(key);
    renderReview();
  }

  function renderAi(data, record) {
    const el = document.getElementById("rev-ai");
    const btn = document.getElementById("rev-ai-btn");
    if (!el) return;
    const key = weekKeyOf(data.monday);
    const ai = record && record.ai;
    const keyOk = hasGeminiKey();
    if (btn) {
      btn.hidden = !keyOk || aiInFlight.has(key);
      btn.textContent = ai ? "Rewrite" : "Write it";
    }
    if (aiInFlight.has(key)) {
      el.innerHTML = `<p class="rev-ai-text is-loading">Alfred is reading your week…</p>`;
      return;
    }
    if (ai && ai.text) {
      el.innerHTML = `<p class="rev-ai-text">${esc(ai.text)}</p>`;
      return;
    }
    if (!keyOk) {
      el.innerHTML = `<p class="rev-ai-text is-empty">Add a Gemini key in Settings → Alfred (AI) and Alfred writes a short summary of every week here.</p>`;
      return;
    }
    if (aiFailed[key]) {
      el.innerHTML = `<p class="rev-ai-text is-empty">Couldn't write it (${esc(aiFailed[key])}). Try "Write it" again.</p>`;
      return;
    }
    el.innerHTML = `<p class="rev-ai-text is-empty">No summary for this week yet.</p>`;

    // Auto: last week once it's over, and this week from Sunday on.
    const thisMonday = mondayOf(todayKey());
    const isLastWeek = data.monday === addDays(thisMonday, -7);
    const isSunday = new Date().getDay() === 0;
    if (isLastWeek || (data.monday === thisMonday && isSunday)) generateAi(data.monday);
  }

  function renderReview() {
    if (!document.getElementById("rev-scorecard")) return;
    if (!viewMonday) viewMonday = mondayOf(todayKey());
    const data = weekData(viewMonday);
    const previous = weekData(addDays(viewMonday, -7), data.span);
    const record = reviewFor(weekKeyOf(viewMonday));

    renderNav(data);
    renderPill(data, record);
    renderHero(data, record, previous);
    renderScorecard(data, previous);
    renderGrid(data);
    renderHighlights(data);
    renderAi(data, record);
    renderWriteup(data, record);
    renderPast();
  }
  window.renderReview = renderReview;

  function goToWeek(monday) {
    viewMonday = monday;
    writeupWeek = null; // force the write-up to follow the week
    renderReview();
  }

  // ---------------------------------------------------------------------
  // Interaction

  const section = document.getElementById("review-section");

  if (section) {
    section.addEventListener("click", (ev) => {
      const nav = ev.target.closest("[data-rev-nav]");
      if (nav) {
        const step = Number(nav.dataset.revNav) * 7;
        const next = addDays(viewMonday, step);
        if (next > mondayOf(todayKey())) return;
        goToWeek(next);
        return;
      }

      const action = ev.target.closest("[data-rev-action]");
      if (action && action.dataset.revAction === "this-week") {
        goToWeek(mondayOf(todayKey()));
        return;
      }
      if (action && action.dataset.revAction === "ai") {
        generateAi(viewMonday);
        return;
      }

      const star = ev.target.closest("[data-rev-rating]");
      if (star) {
        const key = weekKeyOf(viewMonday);
        const value = Number(star.dataset.revRating);
        const current = reviewFor(key);
        writeReview(key, { rating: current && current.rating === value ? 0 : value });
        renderReview();
        if (window.renderOverview) window.renderOverview();
        return;
      }

      const focus = ev.target.closest("[data-rev-focus]");
      if (focus) {
        const prevKey = weekKeyOf(addDays(viewMonday, -7));
        const prev = reviewFor(prevKey);
        if (!prev) return;
        const wanted = focus.dataset.revFocus === "hit";
        writeReview(prevKey, { focusHit: prev.focusHit === wanted ? null : wanted });
        writeupWeek = null;
        renderReview();
        return;
      }

      const past = ev.target.closest("[data-rev-week]");
      if (past) {
        const r = reviews[past.dataset.revWeek];
        goToWeek((r && r.monday) || mondayFromKey(past.dataset.revWeek));
        document.getElementById("review-section").scrollIntoView({
          behavior: typeof prefersReducedMotion !== "undefined" && prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
        return;
      }

      const goto = ev.target.closest("[data-goto]");
      if (goto && window.switchSection) window.switchSection(goto.dataset.goto);
    });

    section.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const link = ev.target.closest('[role="link"]');
      if (!link || ev.target !== link) return;
      ev.preventDefault();
      link.click();
    });

    section.addEventListener("input", (ev) => {
      const field = ev.target.closest("[data-rev-prompt]");
      if (!field) return;
      autoGrow(field);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        writeReview(weekKeyOf(viewMonday), { [field.dataset.revPrompt]: field.value });
        renderSaved(reviewFor(weekKeyOf(viewMonday)));
        renderPast();
        if (window.renderOverview) window.renderOverview();
      }, 500);
    });
  }

  // ---------------------------------------------------------------------
  // What the rest of the app reads

  window.reviewSummary = function reviewSummary() {
    const monday = mondayOf(todayKey());
    const data = weekData(monday);
    const record = reviewFor(weekKeyOf(monday));
    const prevRecord = reviewFor(weekKeyOf(addDays(monday, -7)));
    const focus = prevRecord && (prevRecord.focus || "").trim();
    return {
      week: weekNumber(monday),
      score: data.score,
      reviewed: hasContent(record),
      rating: record ? record.rating || 0 : 0,
      streak: reviewedStreak(),
      focus: focus || "",
      short: data.score == null ? "Not scored yet" : `Week ${weekNumber(monday)} · ${data.score}`,
      line:
        `Review: week ${weekNumber(monday)} scores ${data.score == null ? "n/a" : `${data.score}/100`} so far` +
        `${data.metrics.filter((m) => m.ratio != null).map((m) => `, ${m.label.toLowerCase()} ${m.value}`).join("")}` +
        `${focus ? `. Last week's stated focus: "${focus}"` : ""}` +
        `${hasContent(record) ? ". This week already has a write-up." : ""}`,
    };
  };

  window.TODAY_LOG_SOURCES = window.TODAY_LOG_SOURCES || [];
  window.TODAY_LOG_SOURCES.push(() => {
    const key = weekKeyOf(mondayOf(todayKey()));
    const r = reviewFor(key);
    if (!hasContent(r) || !r.updated) return [];
    return [{ key: "review", section: "Review", text: `Week ${Number(key.slice(-2))} review${r.rating ? ` · rated ${r.rating}/5` : ""}`, at: r.updated }];
  });

  viewMonday = mondayOf(todayKey());
  renderReview();
})();
