// Overview: the home screen. Pulls live from every tracked area — all
// globals defined in files loaded before this one (script.js habits,
// water.js, food.js, fitness.js, goals.js, blueprint.js week plan,
// journal.js, alfred.js, markets.js, news.js).
//
// Layout (see #overview-section in index.html):
//   - Header: date, a live pill for what's on the week plan right now /
//     next (tap -> Blueprint), a greeting, and a segmented ring — one
//     segment per standard, filling with progress and solid once banked.
//   - Standards: four tiles (habits, water, food, training) with progress
//     bars; water has its own +250 ml button, training shows this week's
//     days. Tap a tile to open that section.
//   - Left column: today's plan (timeline + check-off list, same rows as
//     Blueprint) and everything logged today.
//   - Right column: quote of the day, a briefing (watchlist move + latest
//     headline), and goals in motion.
// Also renders the condensed "mini-overview" bar shown above every other
// section (#mini-overview, toggled by switchSection in script.js).

const OVERVIEW_DATE_FMT = { weekday: "long", month: "long", day: "numeric" };

function bestStreak() {
  return habits.length ? Math.max(...habits.map(currentStreak)) : 0;
}

function trainingWeekDots() {
  if (typeof plan === "undefined" || !plan.log) return [];
  const today = todayKey();
  const monday = addDays(today, -((new Date().getDay() + 6) % 7));
  return ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => {
    const date = addDays(monday, i);
    let state = "future";
    if ((plan.log[date] || []).length) state = "done";
    else if (date === today) state = "today";
    else if (date < today) state = "missed";
    return { label, state };
  });
}

function overviewStandards() {
  const today = todayKey();
  const habitsDone = habits.filter((h) => h.history[today]).length;
  const habitsTotal = habits.length;

  const waterMl = typeof waterToday === "function" ? waterToday() : 0;
  const waterTarget = typeof water !== "undefined" ? water.target : 0;

  const foodToday = typeof entriesFor === "function" ? entriesFor(today) : [];
  const kcalToday = foodToday.reduce((sum, e) => sum + e.kcal, 0);
  const proteinToday = foodToday.reduce((sum, e) => sum + (e.protein || 0), 0);
  const kcalTarget = typeof food !== "undefined" ? food.target : 0;

  const trained = typeof trainedThisWeek === "function" ? trainedThisWeek() : 0;
  const trainTarget = typeof TRAIN_TARGET !== "undefined" ? TRAIN_TARGET : 0;

  const ratio = (a, b) => (b > 0 ? Math.min(1, a / b) : 0);

  return [
    {
      id: "habits",
      label: "Habits",
      section: "habits",
      value: `${habitsDone}/${habitsTotal}`,
      sub: habitsTotal === 0 ? "Add your first habit" : habitsDone === habitsTotal ? "All done today" : `${habitsTotal - habitsDone} to go`,
      progress: ratio(habitsDone, habitsTotal),
      met: habitsTotal > 0 && habitsDone === habitsTotal,
    },
    {
      id: "water",
      label: "Water",
      section: "water",
      value: `${(waterMl / 1000).toFixed(2)}L`,
      sub: `of ${(waterTarget / 1000).toFixed(1)}L`,
      progress: ratio(waterMl, waterTarget),
      met: waterMl >= waterTarget,
      action: { id: "water", label: "+250 ml" },
    },
    {
      id: "food",
      label: "Food",
      section: "fuel",
      value: kcalToday.toLocaleString(),
      sub: `of ${kcalTarget.toLocaleString()} kcal · ${proteinToday}g protein`,
      progress: ratio(kcalToday, kcalTarget),
      met: kcalToday > 0 && kcalToday <= kcalTarget,
      over: kcalToday > kcalTarget,
    },
    {
      id: "training",
      label: "Training",
      section: "fitness",
      value: `${trained}/${trainTarget}`,
      sub: "days this week",
      progress: ratio(trained, trainTarget),
      met: trained >= trainTarget,
      week: trainingWeekDots(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Header

function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// One arc per standard, with a gap between each: a faint full-length
// track plus a fill whose length follows that standard's progress.
function renderOverviewRing(standards) {
  const svg = document.getElementById("overview-ring");
  if (!svg) return;
  const n = standards.length;
  const r = 50;
  const c = 2 * Math.PI * r;
  const gap = 16; // > stroke width, so round caps don't touch
  const seg = c / n - gap;

  if (Number(svg.dataset.segments) !== n) {
    svg.innerHTML = `<g transform="rotate(-90 60 60)">${standards
      .map(
        (s) => `
        <circle class="ov-ring-track" cx="60" cy="60" r="${r}"></circle>
        <circle class="ov-ring-fill" data-id="${s.id}" cx="60" cy="60" r="${r}"></circle>`
      )
      .join("")}</g>`;
    svg.dataset.segments = String(n);
  }

  const tracks = svg.querySelectorAll(".ov-ring-track");
  const fills = svg.querySelectorAll(".ov-ring-fill");
  standards.forEach((s, i) => {
    const offset = -(i * (c / n) + gap / 2);
    tracks[i].style.strokeDasharray = `${seg} ${c - seg}`;
    tracks[i].style.strokeDashoffset = `${offset}`;
    const len = s.met ? seg : seg * s.progress;
    fills[i].style.strokeDasharray = `${Math.max(0.001, len)} ${c}`;
    fills[i].style.strokeDashoffset = `${offset}`;
    fills[i].style.opacity = len < 1 ? "0" : "";
    fills[i].classList.toggle("is-met", s.met);
  });
}

function renderPlanPill() {
  if (typeof loadWeekPlan !== "function") return null;
  const entries = sortedDayEntries(loadWeekPlan(), todayDayKey());
  const now = planNowMinutes();
  const text = planStatusText(planDayStatus(entries, now, loadPlanDone(todayKey())), now);
  setLivePill("overview", text);
  return text;
}

// ---------------------------------------------------------------------------
// Standards tiles — built once, then updated in place so bars animate.

const CHECK_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const overviewPrevMet = {};

function renderStandardTiles(standards) {
  const wrap = document.getElementById("overview-standards");
  if (!wrap) return;

  if (wrap.dataset.built !== standards.map((s) => s.id).join(",")) {
    wrap.innerHTML = standards
      .map(
        (s) => `
        <div class="ov-tile" data-id="${s.id}" data-goto="${s.section}" role="link" tabindex="0" aria-label="Open ${s.label}">
          <div class="ov-tile-head">
            <span class="stat-label">${s.label}</span>
            <span class="ov-tile-check">${CHECK_SVG}</span>
            ${s.action ? `<button type="button" class="ov-tile-action" data-overview-action="${s.action.id}">${s.action.label}</button>` : ""}
          </div>
          <div class="ov-tile-value"></div>
          <div class="ov-tile-sub"></div>
          ${s.week ? `<div class="ov-week-dots"></div>` : ""}
          <div class="ov-tile-bar"><span></span></div>
        </div>`
      )
      .join("");
    wrap.dataset.built = standards.map((s) => s.id).join(",");
  }

  standards.forEach((s) => {
    const tile = wrap.querySelector(`.ov-tile[data-id="${s.id}"]`);
    if (!tile) return;
    tile.classList.toggle("is-met", s.met);
    tile.classList.toggle("is-over", Boolean(s.over));
    tile.querySelector(".ov-tile-value").textContent = s.value;
    tile.querySelector(".ov-tile-sub").textContent = s.sub;
    tile.querySelector(".ov-tile-bar span").style.width = `${Math.round((s.met ? 1 : s.progress) * 100)}%`;
    const dots = tile.querySelector(".ov-week-dots");
    if (dots && s.week) {
      dots.innerHTML = s.week.map((d) => `<span class="ov-dot is-${d.state}" title="${d.state}">${d.label}</span>`).join("");
    }
    if (overviewPrevMet[s.id] === false && s.met && typeof prefersReducedMotion !== "undefined" && !prefersReducedMotion) {
      tile.classList.remove("ov-tile-banked");
      void tile.offsetWidth;
      tile.classList.add("ov-tile-banked");
    }
    overviewPrevMet[s.id] = s.met;
  });
}

// ---------------------------------------------------------------------------
// Today's plan

function renderTodaysPlan() {
  const planList = document.getElementById("overview-plan");
  if (!planList) return;
  const summaryEl = document.getElementById("overview-plan-summary");
  const trackEl = document.getElementById("overview-plan-track");
  if (typeof loadWeekPlan !== "function") {
    planList.innerHTML = `<li class="empty-state">Set up a week plan in Blueprint first.</li>`;
    return;
  }

  const weekly = loadWeekPlan();
  const entries = sortedDayEntries(weekly, todayDayKey());
  const done = loadPlanDone(todayKey());
  const now = planNowMinutes();
  const status = planDayStatus(entries, now, done);

  if (entries.length === 0) {
    summaryEl.textContent = "";
    trackEl.innerHTML = "";
    planList.innerHTML = `<li class="empty-state">Nothing planned for today yet — add it in Blueprint.</li>`;
    return;
  }

  const minutes = entries.reduce((sum, e) => sum + planEntryDuration(e), 0);
  summaryEl.textContent = `${status.doneCount}/${entries.length} done${minutes ? ` · ${formatPlanDuration(minutes)} planned` : ""}`;
  trackEl.innerHTML = buildDayTrack(entries, planRange(weekly), { nowMin: now, done });
  planList.innerHTML = entries.map((e) => planBlockRowHtml(e, { isToday: true, status, done, now })).join("");
  planList.querySelectorAll(".plan-check").forEach((box) => {
    box.addEventListener("change", () => togglePlanDone(todayKey(), box.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// Logged today

// Section labels for the combined "Logged today" feed below.
const TODAY_LOG_LABELS = {
  blueprint: "Blueprint",
  review: "Review",
  recovery: "Recovery",
  mindset: "Mindset",
  reading: "Reading",
  markets: "Markets",
  notes: "Notes",
  alfred: "Alfred",
};

function isToday(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

// Pulls every timestamped entry logged today from every journal-backed
// section (journal.js) plus Alfred's check-in log (alfred.js), so
// Overview shows what actually happened today across the whole app.
function todaysLoggedEntries() {
  const entries = [];

  if (typeof JOURNAL_KEYS !== "undefined" && typeof loadJournal === "function") {
    for (const key of JOURNAL_KEYS) {
      for (const e of loadJournal(key)) {
        if (isToday(e.at)) entries.push({ key, section: TODAY_LOG_LABELS[key] || key, text: e.text, at: e.at });
      }
    }
  }

  if (typeof alfredLog !== "undefined") {
    for (const e of alfredLog) {
      if (isToday(e.at)) entries.push({ key: "alfred", section: "Alfred", text: e.question, at: e.at });
    }
  }

  // Sections that store something richer than a journal entry (Recovery's
  // check-in, Review's write-up, Notes' captures) register a function here
  // rather than each one being hand-wired into this file.
  if (Array.isArray(window.TODAY_LOG_SOURCES)) {
    for (const source of window.TODAY_LOG_SOURCES) {
      try {
        const extra = source();
        if (Array.isArray(extra)) entries.push(...extra);
      } catch {
        // One broken source shouldn't empty the whole feed.
      }
    }
  }

  return entries.sort((a, b) => b.at - a.at);
}

function renderTodaysLog(entries) {
  const list = document.getElementById("overview-today-log");
  if (!list) return;
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing logged yet today — use the bar below to log or ask anything.</li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e) => `
      <li class="ov-log-row">
        <span class="ov-log-time">${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="ov-log-body">
          <button type="button" class="ov-log-tag" data-goto="${e.key}">${e.section}</button>
          <span class="ov-log-text"></span>
        </span>
      </li>`
    )
    .join("");
  list.querySelectorAll(".ov-log-text").forEach((el, i) => {
    el.textContent = entries[i].text;
  });
}

// ---------------------------------------------------------------------------
// Briefing (Markets + News) and goals

function overviewEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderBriefing() {
  const marketsEl = document.getElementById("overview-brief-markets");
  const newsEl = document.getElementById("overview-brief-news");
  if (!marketsEl || !newsEl) return;

  const m = window.marketsSummary ? window.marketsSummary() : null;
  if (!m) {
    marketsEl.hidden = true;
  } else {
    marketsEl.hidden = false;
    let body;
    if (!m.watching) {
      body = `<span class="ov-brief-empty">Build a watchlist to see today's move here.</span>`;
    } else if (!m.hasKey) {
      body = `<span class="ov-brief-empty">Add a Finnhub key in Settings for live prices.</span>`;
    } else if (m.avg == null) {
      body = `<span class="ov-brief-empty">Loading prices…</span>`;
    } else {
      const bits = [`${m.up} up · ${m.down} down`];
      if (m.best) bits.push(`${overviewEsc(m.best.symbol)} ${m.signed(m.best.dp)}%`);
      body = `
        <span class="ov-brief-number tone-${m.tone(m.avg)}">${m.signed(m.avg)}%</span>
        <span class="ov-brief-sub">watchlist avg · ${bits.join(" · ")}</span>`;
    }
    marketsEl.innerHTML = `
      <span class="ov-brief-head">
        <span class="stat-label">Markets</span>
        <span class="ov-brief-state" data-state="${m.session.state}">${overviewEsc(m.session.label)}</span>
      </span>
      ${body}`;
  }

  const n = window.newsSnapshot ? window.newsSnapshot() : null;
  if (!n) {
    newsEl.hidden = true;
    return;
  }
  newsEl.hidden = false;
  const latest = n.items[0];
  const fresh = n.lastSeen ? n.items.filter((it) => it.time > n.lastSeen).length : 0;
  let body;
  if (!latest) {
    body = `<span class="ov-brief-empty">${n.loadedAt ? "No recent headlines right now." : "Loading headlines…"}</span>`;
  } else {
    body = `
      <span class="ov-brief-headline" lang="${latest.source.lang}">${overviewEsc(latest.title)}</span>
      <span class="ov-brief-sub">${overviewEsc(latest.source.region)} · ${overviewEsc(latest.source.source)} · ${timeAgo(latest.time)}</span>`;
  }
  newsEl.innerHTML = `
    <span class="ov-brief-head">
      <span class="stat-label">News</span>
      ${fresh ? `<span class="ov-brief-state" data-state="new">${fresh} new</span>` : ""}
    </span>
    ${body}`;
}
window.renderBriefing = renderBriefing;

function renderOverviewGoals() {
  const list = document.getElementById("overview-goals");
  if (!list) return;
  if (typeof goals === "undefined" || goals.length === 0) {
    list.innerHTML = `<li class="empty-state">No goals yet — set one in Goals.</li>`;
    return;
  }
  const active = goals
    .filter((g) => g.current < g.target)
    .sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return b.current / b.target - a.current / a.target;
    })
    .slice(0, 4);
  if (!active.length) {
    list.innerHTML = `<li class="empty-state">Every goal is complete — time to set a new one.</li>`;
    return;
  }
  list.innerHTML = active
    .map((g) => {
      const pct = Math.round((g.current / g.target) * 100);
      const due = g.deadline && typeof deadlineLabel === "function" ? deadlineLabel(g.deadline) : null;
      return `
      <li class="ov-goal" data-goto="goals" role="link" tabindex="0">
        <span class="ov-goal-top">
          <span class="ov-goal-name">${overviewEsc(g.name)}</span>
          <span class="ov-goal-pct">${pct}%</span>
        </span>
        <span class="ov-goal-bar"><span style="width:${pct}%"></span></span>
        <span class="ov-goal-meta">
          <span>${overviewEsc(g.current)} / ${overviewEsc(g.target)} ${overviewEsc(g.unit)}</span>
          <span class="ov-goal-term">${g.term === "long" ? "Long-term" : "Short-term"}</span>
          ${due ? `<span class="${due.overdue ? "tone-down" : ""}">${overviewEsc(due.text)}</span>` : ""}
        </span>
      </li>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Everything

function renderOverview() {
  const dateEl = document.getElementById("overview-date");
  if (!dateEl) return;
  const now = new Date();
  dateEl.textContent = now.toLocaleDateString(undefined, OVERVIEW_DATE_FMT);

  const standards = overviewStandards();
  const banked = standards.filter((s) => s.met).length;
  const total = standards.length;
  const streak = bestStreak();
  const logged = todaysLoggedEntries();

  document.getElementById("overview-greeting").textContent = `${greetingFor(now)}.`;
  document.getElementById("overview-banked").textContent = `${banked}/${total}`;
  document.getElementById("overview-best-streak").textContent = `${streak}d`;
  document.getElementById("overview-perfect").textContent =
    typeof perfectDaysThisMonth === "function" ? String(perfectDaysThisMonth()) : "—";
  document.getElementById("overview-logged-count").textContent = String(logged.length);

  const open = standards.filter((s) => !s.met);
  document.getElementById("overview-status").textContent =
    open.length === 0
      ? "Everything's banked today. Keep it that way."
      : open.length === total
        ? "Nothing banked yet — start with whatever's quickest."
        : `Still open: ${open.map((s) => s.label.toLowerCase()).join(", ")}.`;

  renderOverviewRing(standards);
  renderStandardTiles(standards);
  const planText = renderPlanPill();
  renderTodaysPlan();
  renderTodaysLog(logged);
  renderBriefing();
  renderOverviewGoals();
  renderMiniOverview(banked, total, streak, planText);
}
window.renderOverview = renderOverview;

// The slim header shown above every other section — the numbers worth
// carrying around, plus what's on the plan right now.
function renderMiniOverview(banked, total, streak, planText) {
  const bar = document.getElementById("mini-overview");
  if (!bar) return;
  // Blueprint shows the same pill in its own header — don't repeat it.
  const onBlueprint = document.getElementById("blueprint-section")?.hidden === false;
  const plan =
    planText && planText.state !== "idle" && !onBlueprint
      ? `<button type="button" class="mini-overview-plan" data-state="${planText.state}" data-goto="blueprint">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="mini-overview-plan-label">${overviewEsc(planText.label)}</span>
          <span class="mini-overview-plan-detail">${overviewEsc(planText.detail)}</span>
        </button>`
      : "";
  bar.innerHTML = `
    <span class="mini-overview-item"><strong>${banked}/${total}</strong> banked today</span>
    <span class="mini-overview-item"><strong>${streak}d</strong> best streak</span>
    ${plan}
  `;
}

// ---------------------------------------------------------------------------
// Interaction: tiles, tags, cards and links navigate via data-goto; quick
// actions via data-overview-action.

function overviewNavigate(target) {
  if (target && window.switchSection) window.switchSection(target);
}

function handleOverviewClick(e) {
  const action = e.target.closest("[data-overview-action]");
  if (action) {
    e.stopPropagation();
    const kind = action.dataset.overviewAction;
    if (kind === "water" && typeof addWater === "function") addWater(250);
    if (kind === "alfred") overviewNavigate("alfred");
    return;
  }
  if (e.target.closest(".plan-check")) return;
  const link = e.target.closest("[data-goto]");
  if (link) overviewNavigate(link.dataset.goto);
}

function handleOverviewKey(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  const link = e.target.closest('[data-goto][role="link"]');
  if (!link || e.target !== link) return;
  e.preventDefault();
  overviewNavigate(link.dataset.goto);
}

document.getElementById("overview-section")?.addEventListener("click", handleOverviewClick);
document.getElementById("overview-section")?.addEventListener("keydown", handleOverviewKey);
document.getElementById("mini-overview")?.addEventListener("click", handleOverviewClick);

// Keep the clock-driven bits (greeting, now/next, plan timeline) current.
let overviewLastMinute = -1;
setInterval(() => {
  if (document.hidden) return;
  const minute = planNowMinutes();
  if (minute === overviewLastMinute) return;
  overviewLastMinute = minute;
  renderOverview();
}, 15 * 1000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderOverview();
});

renderOverview();
// Overview is the landing page, so warm up the headlines for its briefing.
if (window.loadNews) window.loadNews();
