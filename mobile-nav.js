// Phone navigation (<= 640px wide). Desktop keeps the sidebar; everything
// here is hidden there by CSS.
//
//   - Header (#m-header): current section name + sync badge. Tap the title
//     to scroll to the top.
//   - Tab bar (#m-tabbar): Home, two sections of your choice, a center
//     "Ask Alfred" button, and More. The two choices are stored in
//     localStorage ("nav-tabs"), so they follow you across devices.
//   - More sheet (#m-more-sheet): every section as a tile, grouped like
//     the sidebar, each with a live one-line status. "Edit tabs" switches
//     tiles to picking what goes in the tab bar.
//   - Ask sheet: the same #global-bar form the desktop shows as a bottom
//     bar, restyled as a sheet that sits above the keyboard (positioned
//     with the visualViewport API — iOS doesn't resize the page for the
//     keyboard).
// Sheets close on scrim tap, Escape, or swiping down on their handle.

const MNAV_QUERY = window.matchMedia("(max-width: 640px)");
const MNAV_TABS_KEY = "nav-tabs";
const MNAV_DEFAULT_TABS = ["habits", "blueprint"];
const MNAV_GROUPS = ["Daily", "Body", "Mind", "System"];

const MNAV_SECTIONS = [
  { id: "overview", label: "Overview", group: "Daily", icon: "home" },
  { id: "habits", label: "Habits", group: "Daily", icon: "habits" },
  { id: "goals", label: "Goals", group: "Daily", icon: "goals" },
  { id: "alfred", label: "Alfred", group: "Daily", icon: "alfred" },
  { id: "blueprint", label: "Blueprint", group: "Daily", icon: "blueprint" },
  { id: "review", label: "Review", group: "Daily", icon: "review" },
  { id: "fitness", label: "Fitness", group: "Body", icon: "fitness" },
  { id: "food", label: "Food", group: "Body", icon: "food" },
  { id: "water", label: "Water", group: "Body", icon: "water" },
  { id: "recovery", label: "Recovery", group: "Body", icon: "recovery" },
  { id: "mindset", label: "Mindset", group: "Mind", icon: "mindset" },
  { id: "reading", label: "Reading", group: "Mind", icon: "reading" },
  { id: "news", label: "News", group: "System", icon: "news" },
  { id: "markets", label: "Markets", group: "System", icon: "markets" },
  { id: "notes", label: "Notes", group: "System", icon: "notes" },
  { id: "settings", label: "Settings", group: "System", icon: "settings" },
];

// 24×24 line icons, drawn for this app (stroke = currentColor).
const MNAV_ICONS = {
  home: '<path d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  habits: '<circle cx="12" cy="12" r="8"/><path d="m8.4 12.2 2.5 2.5 4.8-5"/>',
  goals: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.2" class="m-icon-fill"/>',
  alfred: '<path d="M11 3.8l1.8 4.9 4.9 1.8-4.9 1.8L11 17.2l-1.8-4.9-4.9-1.8 4.9-1.8z"/><path d="M18 14.6l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z"/>',
  blueprint: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><rect x="7.5" y="13" width="5.5" height="3.2" rx="0.8"/>',
  review: '<path d="M4.6 12A7.4 7.4 0 1 0 6.8 6.8"/><path d="M4.4 4.2v3.4h3.4"/><path d="M12 8.4V12l2.6 1.6"/>',
  fitness: '<path d="M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  food: '<path d="M6.5 3.5v5.5a2.25 2.25 0 0 0 4.5 0V3.5M8.75 11.25v9.25M17 20.5V3.5c-2.1 1.3-3.2 3.9-3.2 7.5H17"/>',
  water: '<path d="M12 3.8c3.1 3.7 5.6 6.8 5.6 10.1a5.6 5.6 0 0 1-11.2 0c0-3.3 2.5-6.4 5.6-10.1z"/><path d="M9.3 14.4a2.8 2.8 0 0 0 2.4 2.6"/>',
  recovery: '<path d="M19.4 14.4A7.6 7.6 0 0 1 9.6 4.6a7.6 7.6 0 1 0 9.8 9.8z"/>',
  mindset: '<path d="M9.2 17.2h5.6M10.2 20.2h3.6"/><path d="M12 3.6a6 6 0 0 0-3.6 10.8c.6.5.9 1.1.9 1.8v1h5.4v-1c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3.6z"/>',
  reading: '<path d="M12 6.6C10 5.1 7.2 4.6 4 5.1v13c3.2-.5 6 0 8 1.5 2-1.5 4.8-2 8-1.5v-13c-3.2-.5-6 0-8 1.5zM12 6.6v13"/>',
  news: '<rect x="3.5" y="5" width="13.5" height="14.5" rx="1.5"/><path d="M17 9h3.5v8.5a2 2 0 0 1-2 2H17M7 9h6.5M7 12.5h6.5M7 16h4"/>',
  markets: '<path d="M3.5 17.5l5.2-5.2 3.6 3.6 7.7-7.7"/><path d="M15 8.2h5v5"/>',
  notes: '<path d="M14.8 5.2l4 4L9.2 18.8H5.2v-4z"/><path d="M12.6 7.4l4 4"/>',
  settings: '<path d="M4 7.5h9.5M18.5 7.5H20M4 16.5h3.5M12.5 16.5H20"/><circle cx="16" cy="7.5" r="2.3"/><circle cx="10" cy="16.5" r="2.3"/>',
  more: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
};

function mnavIcon(name) {
  return `<svg class="m-icon" viewBox="0 0 24 24" aria-hidden="true">${MNAV_ICONS[name] || ""}</svg>`;
}

function mnavEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function mnavSection(id) {
  return MNAV_SECTIONS.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// Tab choices

function mnavLoadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(MNAV_TABS_KEY));
    if (Array.isArray(saved)) {
      const valid = saved.filter((id) => id !== "overview" && mnavSection(id));
      if (valid.length === 2 && valid[0] !== valid[1]) return valid;
    }
  } catch {
    // fall through to defaults
  }
  return [...MNAV_DEFAULT_TABS];
}

let mnavTabs = mnavLoadTabs();
let mnavEditing = false;

function mnavSaveTabs() {
  try {
    localStorage.setItem(MNAV_TABS_KEY, JSON.stringify(mnavTabs));
  } catch {
    // Not fatal — the choice just won't persist.
  }
}

// ---------------------------------------------------------------------------
// Live one-liners for the More sheet. Every source is optional.

function mnavTodayJournalCount(key) {
  if (typeof loadJournal !== "function") return null;
  const entries = loadJournal(key);
  const today = new Date().toDateString();
  const n = entries.filter((e) => new Date(e.at).toDateString() === today).length;
  if (n) return `${n} today`;
  if (!entries.length) return "Empty";
  const days = Math.max(1, Math.round((Date.now() - entries[0].at) / 86400000));
  return `Last ${days}d ago`;
}

function mnavSubtitle(id) {
  try {
    switch (id) {
      case "overview": {
        const s = overviewStandards();
        return { text: `${s.filter((x) => x.met).length}/${s.length} banked` };
      }
      case "habits": {
        const done = habits.filter((h) => h.history[todayKey()]).length;
        return { text: habits.length ? `${done}/${habits.length} today` : "No habits yet" };
      }
      case "goals": {
        const active = goals.filter((g) => g.current < g.target).length;
        return { text: goals.length ? `${active} in progress` : "None yet" };
      }
      case "alfred":
        return { text: "Ask anything" };
      case "blueprint": {
        const entries = sortedDayEntries(loadWeekPlan(), todayDayKey());
        const now = planNowMinutes();
        const st = planDayStatus(entries, now, loadPlanDone(todayKey()));
        if (st.current) return { text: `Now · ${st.current.title}` };
        if (st.next) return { text: `Next ${st.next.start}` };
        return { text: st.total ? `${st.doneCount}/${st.total} done` : "Free today" };
      }
      case "fitness":
        return { text: `${trainedThisWeek()}/${TRAIN_TARGET} this week` };
      case "food": {
        const kcal = entriesFor(todayKey()).reduce((sum, e) => sum + e.kcal, 0);
        return { text: `${kcal.toLocaleString()} kcal` };
      }
      case "water":
        return { text: `${(waterToday() / 1000).toFixed(2)}L of ${(water.target / 1000).toFixed(1)}L` };
      case "news": {
        const n = window.newsSnapshot && window.newsSnapshot();
        if (!n || !n.items.length) return { text: "Headlines" };
        const fresh = n.lastSeen ? n.items.filter((it) => it.time > n.lastSeen).length : 0;
        return { text: fresh ? `${fresh} new` : `${n.items.length} stories` };
      }
      case "markets": {
        const m = window.marketsSummary && window.marketsSummary();
        if (!m || !m.watching) return { text: "No watchlist" };
        if (m.avg == null) return { text: `${m.watching} watched` };
        return { text: `${m.signed(m.avg)}% today`, tone: m.tone(m.avg) };
      }
      case "settings": {
        const badge = document.querySelector(".m-sync-badge");
        return { text: badge && !badge.hidden ? "Synced" : "Sync & keys" };
      }
      default:
        return { text: mnavTodayJournalCount(id) || "" };
    }
  } catch {
    return { text: "" };
  }
}

// ---------------------------------------------------------------------------
// Rendering

const mnavHeader = document.getElementById("m-header");
const mnavTabbar = document.getElementById("m-tabbar");
const mnavScrim = document.getElementById("m-scrim");
const mnavMoreSheet = document.getElementById("m-more-sheet");
const mnavMoreBody = document.getElementById("m-more-body");
const mnavAskSheet = document.getElementById("global-bar");
const mnavAskInput = document.getElementById("global-bar-input");

function mnavCurrent() {
  return window.currentSection || "overview";
}

function renderMobileHeader() {
  const section = mnavSection(mnavCurrent());
  document.getElementById("m-header-label").textContent = section ? section.label : "Batcave";
}

function renderTabbar() {
  if (!mnavTabbar) return;
  const current = mnavCurrent();
  const tab = (id, label, icon) => `
    <button type="button" class="m-tab${current === id ? " is-active" : ""}" data-nav-goto="${id}"${current === id ? ' aria-current="page"' : ""}>
      ${mnavIcon(icon)}<span class="m-tab-label">${label}</span>
    </button>`;
  const [left, right] = mnavTabs.map(mnavSection);
  const onMore = !["overview", ...mnavTabs].includes(current);
  mnavTabbar.innerHTML = `
    ${tab("overview", "Home", "home")}
    ${tab(left.id, left.label, left.icon)}
    <button type="button" class="m-tab-ask" id="m-ask-btn" aria-label="Ask Alfred">
      <span class="m-tab-ask-circle">${mnavIcon("alfred")}</span>
    </button>
    ${tab(right.id, right.label, right.icon)}
    <button type="button" class="m-tab${onMore ? " is-active" : ""}" id="m-more-btn" aria-haspopup="dialog" aria-controls="m-more-sheet">
      ${mnavIcon("more")}<span class="m-tab-label">More</span>
    </button>`;
}

function renderMoreSheet() {
  const current = mnavCurrent();
  mnavMoreSheet.classList.toggle("is-editing", mnavEditing);
  document.getElementById("m-more-edit").textContent = mnavEditing ? "Done" : "Edit tabs";
  document.getElementById("m-more-title").textContent = mnavEditing ? "Tab bar" : "All sections";
  document.getElementById("m-more-hint").hidden = !mnavEditing;

  mnavMoreBody.innerHTML = MNAV_GROUPS.map((group) => {
    const tiles = MNAV_SECTIONS.filter((s) => s.group === group)
      .map((s) => {
        const sub = mnavSubtitle(s.id);
        const pinned = mnavTabs.includes(s.id);
        const classes = ["m-tile"];
        if (s.id === current) classes.push("is-current");
        if (pinned) classes.push("is-pinned");
        const locked = mnavEditing && s.id === "overview";
        return `
          <button type="button" class="${classes.join(" ")}" data-nav-tile="${s.id}"${locked ? " disabled" : ""}>
            <span class="m-tile-top">
              <span class="m-tile-icon">${mnavIcon(s.icon)}</span>
              <span class="m-tile-pin" aria-hidden="true">${s.id === "overview" ? "Home" : pinned ? "In tab bar" : "+"}</span>
            </span>
            <span class="m-tile-label">${s.label}</span>
            <span class="m-tile-sub${sub.tone ? ` tone-${sub.tone}` : ""}">${mnavEsc(sub.text)}</span>
          </button>`;
      })
      .join("");
    return `<div class="m-group"><p class="eyebrow">${group}</p><div class="m-grid">${tiles}</div></div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Sheets

let mnavOpenSheet = null;
let mnavScrimTimer = null;

function showSheet(sheet) {
  if (mnavOpenSheet && mnavOpenSheet !== sheet) hideSheet(mnavOpenSheet, { keepScrim: true });
  clearTimeout(mnavScrimTimer);
  sheet.inert = false;
  sheet.style.transform = "";
  sheet.classList.add("is-open");
  mnavScrim.hidden = false;
  requestAnimationFrame(() => mnavScrim.classList.add("is-visible"));
  document.body.classList.add("m-sheet-open");
  mnavOpenSheet = sheet;
}

function hideSheet(sheet, { keepScrim = false } = {}) {
  if (sheet === mnavAskSheet && document.activeElement === mnavAskInput) mnavAskInput.blur();
  sheet.classList.remove("is-open");
  sheet.style.transform = "";
  if (MNAV_QUERY.matches) sheet.inert = true;
  if (mnavOpenSheet === sheet) mnavOpenSheet = null;
  if (sheet === mnavMoreSheet && mnavEditing) {
    mnavEditing = false;
  }
  if (!keepScrim) {
    mnavScrim.classList.remove("is-visible");
    document.body.classList.remove("m-sheet-open");
    mnavScrimTimer = setTimeout(() => {
      if (!mnavOpenSheet) mnavScrim.hidden = true;
    }, 260);
  }
}

function openMoreSheet() {
  mnavEditing = false;
  renderMoreSheet();
  showSheet(mnavMoreSheet);
  mnavMoreBody.scrollTop = 0;
}

window.openAskSheet = function openAskSheet() {
  if (!MNAV_QUERY.matches) {
    mnavAskInput.focus();
    return;
  }
  showSheet(mnavAskSheet);
  // Must happen inside the tap for iOS to raise the keyboard.
  mnavAskInput.focus({ preventScroll: true });
};

window.closeAskSheet = function closeAskSheet() {
  if (mnavOpenSheet === mnavAskSheet) hideSheet(mnavAskSheet);
};

// Swipe down on a sheet's handle to dismiss it.
function enableSwipeToClose(sheet, handleSelector) {
  let startY = null;
  let dy = 0;
  sheet.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !MNAV_QUERY.matches || e.target.closest("button, input")) return;
    startY = e.clientY;
    dy = 0;
    handle.setPointerCapture?.(e.pointerId);
    sheet.classList.add("is-dragging");
  });
  sheet.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY == null) return;
    startY = null;
    sheet.classList.remove("is-dragging");
    if (dy > 80) hideSheet(sheet);
    else sheet.style.transform = "";
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
}

enableSwipeToClose(mnavMoreSheet, ".sheet-handle, .m-sheet-head");
enableSwipeToClose(mnavAskSheet, ".global-bar-handle, .global-bar-head");

// iOS keeps the layout viewport full height when the keyboard opens, so a
// bottom-anchored sheet would sit behind it. Track the keyboard's height
// and lift the Ask sheet by that much.
function updateKeyboardOffset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty("--kb", `${kb}px`);
  document.documentElement.classList.toggle("kb-open", kb > 80);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateKeyboardOffset);
  window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
}

// ---------------------------------------------------------------------------
// Events

document.addEventListener("click", (e) => {
  const goto = e.target.closest("[data-nav-goto]");
  if (goto && window.switchSection) {
    window.switchSection(goto.dataset.navGoto);
    return;
  }
  if (e.target.closest("#m-ask-btn")) {
    window.openAskSheet();
    return;
  }
  if (e.target.closest("#m-more-btn")) {
    if (mnavOpenSheet === mnavMoreSheet) hideSheet(mnavMoreSheet);
    else openMoreSheet();
  }
});

mnavScrim.addEventListener("click", () => {
  if (mnavOpenSheet) hideSheet(mnavOpenSheet);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mnavOpenSheet) hideSheet(mnavOpenSheet);
});

document.getElementById("m-more-edit").addEventListener("click", () => {
  mnavEditing = !mnavEditing;
  renderMoreSheet();
});

mnavMoreBody.addEventListener("click", (e) => {
  const tile = e.target.closest("[data-nav-tile]");
  if (!tile) return;
  const id = tile.dataset.navTile;
  if (mnavEditing) {
    if (id === "overview" || mnavTabs.includes(id)) return;
    // The newest pick goes on the right; the older of the two drops off.
    mnavTabs = [mnavTabs[1], id];
    mnavSaveTabs();
    renderTabbar();
    renderMoreSheet();
    return;
  }
  hideSheet(mnavMoreSheet);
  if (window.switchSection) window.switchSection(id);
});

document.getElementById("m-header-title").addEventListener("click", () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
});

window.addEventListener(
  "scroll",
  () => mnavHeader.classList.toggle("is-scrolled", window.scrollY > 4),
  { passive: true }
);

window.onSectionChange = function onSectionChange() {
  renderMobileHeader();
  renderTabbar();
  if (mnavOpenSheet && mnavOpenSheet !== mnavAskSheet) hideSheet(mnavOpenSheet);
};

function applyNavMode() {
  if (MNAV_QUERY.matches) {
    if (mnavOpenSheet !== mnavAskSheet) mnavAskSheet.inert = true;
  } else {
    if (mnavOpenSheet) hideSheet(mnavOpenSheet);
    mnavAskSheet.inert = false;
    mnavMoreSheet.inert = true;
  }
}
MNAV_QUERY.addEventListener("change", applyNavMode);

renderMobileHeader();
renderTabbar();
applyNavMode();
updateKeyboardOffset();
