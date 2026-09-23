// Notes — "anything that doesn't have a home yet", so it's built as an
// inbox rather than a log: capture in one box (multi-line, #tags parsed
// out of the text), then triage — pin it, edit it, archive it, or send it
// to the section it actually belongs to (a thought to Mindset, a thesis
// to Markets, a line to Blueprint, or straight into a new habit).
//
// Storage: localStorage "notes" = [{ id, text, tags: [], pinned, archived,
// at, updated }]. The old free-text log (journal-notes) is imported once,
// with ids derived from the original timestamps so a re-import can never
// duplicate anything.
//
// One IIFE (shared global scope — see reading.js). Exports
// window.renderNotes, window.notesSummary and window.notesInRange
// (Review counts the week's captures with it).
(function () {
  "use strict";

  const KEY = "notes";
  const LEGACY_KEY = "journal-notes";
  const TAG_RE = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
  const VIEWS = [
    { id: "inbox", label: "Inbox" },
    { id: "pinned", label: "Pinned" },
    { id: "archive", label: "Archive" },
    { id: "all", label: "All" },
  ];
  // Where a note can be filed from here. Everything but "habit" is a
  // journal-backed section (journal.js); habit goes through addHabit()
  // in script.js.
  const SEND_TARGETS = [
    { id: "blueprint", label: "Blueprint" },
    { id: "review", label: "Review" },
    { id: "recovery", label: "Recovery" },
    { id: "markets", label: "Markets" },
    { id: "reading", label: "Reading" },
    { id: "habit", label: "New habit" },
  ];

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function loadNotes() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  let notes = loadNotes();
  let view = "inbox";
  let query = "";
  let tagFilter = null;
  let editingId = null;
  let menuId = null;
  let status = "";
  let statusTimer = null;
  const expanded = new Set();

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(notes));
  }

  function parseTags(text) {
    const out = [];
    for (const match of String(text).matchAll(TAG_RE)) {
      const tag = match[1].toLowerCase();
      if (!out.includes(tag)) out.push(tag);
    }
    return out;
  }

  // The old journal-notes entries become real notes once, keyed by their
  // original timestamp — running this twice can't duplicate them. The old
  // key is emptied (not deleted) so sync.js pushes the emptying too.
  function migrateLegacy() {
    let changed = false;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const old = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(old) || !old.length) return;
      for (const entry of old) {
        if (!entry || !entry.text) continue;
        const id = `j${entry.at}`;
        if (notes.some((n) => n.id === id)) continue;
        notes.push({
          id,
          text: entry.text,
          tags: parseTags(entry.text),
          pinned: false,
          archived: false,
          at: entry.at,
          updated: entry.at,
        });
        changed = true;
      }
      localStorage.setItem(LEGACY_KEY, "[]");
    } catch {
      // A corrupt legacy key just means nothing to import.
    }
    if (changed) persist();
  }

  migrateLegacy();

  // Mindset was folded into Notes (2026-09-23): its journal entries become
  // notes tagged #mindset, once, keyed by timestamp so re-running or a
  // sync pull can't duplicate them.
  function migrateMindset() {
    let changed = false;
    try {
      const raw = localStorage.getItem("journal-mindset");
      const old = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(old) || !old.length) return;
      for (const entry of old) {
        if (!entry || !entry.text) continue;
        const id = `m${entry.at}`;
        if (notes.some((n) => n.id === id)) continue;
        const text = /#mindset\b/i.test(entry.text) ? entry.text : `${entry.text} #mindset`;
        notes.push({ id, text, tags: parseTags(text), pinned: false, archived: false, at: entry.at, updated: entry.at });
        changed = true;
      }
      localStorage.setItem("journal-mindset", "[]");
    } catch {
      // Nothing to import.
    }
    if (changed) persist();
  }

  migrateMindset();

  // ---------------------------------------------------------------------
  // Data helpers

  function sortNotes(list) {
    return list.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.at || 0) - (a.at || 0);
    });
  }

  function visible() {
    let list = notes;
    if (view === "inbox") list = list.filter((n) => !n.archived);
    else if (view === "pinned") list = list.filter((n) => n.pinned && !n.archived);
    else if (view === "archive") list = list.filter((n) => n.archived);
    if (tagFilter) list = list.filter((n) => (n.tags || []).includes(tagFilter));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((n) => n.text.toLowerCase().includes(q));
    }
    return sortNotes(list);
  }

  function tagCounts() {
    const counts = {};
    for (const n of notes) {
      if (view !== "archive" && n.archived) continue;
      for (const t of n.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function counts() {
    const open = notes.filter((n) => !n.archived);
    const weekAgo = Date.now() - 7 * 86400000;
    return {
      open: open.length,
      pinned: open.filter((n) => n.pinned).length,
      archived: notes.filter((n) => n.archived).length,
      week: notes.filter((n) => (n.at || 0) >= weekAgo).length,
      tags: tagCounts().length,
      last: notes.length ? Math.max(...notes.map((n) => n.at || 0)) : null,
    };
  }

  function isToday(ts) {
    return new Date(ts).toDateString() === new Date().toDateString();
  }

  function timeAgoShort(ts) {
    const diff = Date.now() - ts;
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24 && isToday(ts)) return `${hours}h ago`;
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  }

  function setStatus(text) {
    status = text;
    const el = document.getElementById("nt-status");
    if (el) el.textContent = text;
    clearTimeout(statusTimer);
    if (text) {
      statusTimer = setTimeout(() => {
        status = "";
        const later = document.getElementById("nt-status");
        if (later) later.textContent = "";
      }, 5000);
    }
  }

  // ---------------------------------------------------------------------
  // Mutations

  function addNote(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    notes.unshift({
      id: (crypto.randomUUID && crypto.randomUUID()) || `n${Date.now()}`,
      text: trimmed,
      tags: parseTags(trimmed),
      pinned: false,
      archived: false,
      at: Date.now(),
      updated: Date.now(),
    });
    persist();
    renderNotes();
    if (window.renderOverview) window.renderOverview();
  }

  function patchNote(id, patch) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    Object.assign(note, patch, { updated: Date.now() });
    if (patch.text != null) note.tags = parseTags(patch.text);
    persist();
    renderNotes();
    if (window.renderOverview) window.renderOverview();
  }

  function removeNote(id) {
    notes = notes.filter((n) => n.id !== id);
    persist();
    renderNotes();
    if (window.renderOverview) window.renderOverview();
  }

  function sendNote(id, targetId) {
    const note = notes.find((n) => n.id === id);
    const target = SEND_TARGETS.find((t) => t.id === targetId);
    if (!note || !target) return;
    if (targetId === "habit") {
      const name = note.text.split("\n")[0].replace(TAG_RE, "").trim().slice(0, 60);
      if (!name || typeof addHabit !== "function") return;
      addHabit(name);
      setStatus(`"${name}" is a habit now — note archived.`);
    } else {
      if (typeof addJournalEntry !== "function") return;
      addJournalEntry(targetId, note.text.replace(/\n+/g, " ").trim());
      setStatus(`Sent to ${target.label} — note archived. Undo by restoring it from Archive.`);
    }
    menuId = null;
    patchNote(id, { archived: true, pinned: false });
  }

  // ---------------------------------------------------------------------
  // Rendering

  let confirmId = null;

  // Escape first, then light up links and #tags — never the other way
  // round, or a note containing markup would render it. The inline tags
  // are the filter control too (the click handler looks for
  // data-nt-tag), so a card doesn't repeat its tags in a second row.
  function renderText(text) {
    return esc(text)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="nt-link">$1</a>')
      .replace(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (m, lead, tag) => `${lead}<span class="nt-tag-inline" data-nt-tag="${tag.toLowerCase()}" role="button" tabindex="0">#${tag}</span>`)
      .replace(/\n/g, "<br />");
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = `${Math.max(48, el.scrollHeight)}px`;
  }

  function renderHeader() {
    const c = counts();
    const countEl = document.getElementById("nt-count");
    if (!countEl) return;
    countEl.textContent = String(c.open);
    document.getElementById("nt-caption").textContent = c.open
      ? `${c.open === 1 ? "note" : "notes"} in the inbox`
      : notes.length
        ? "inbox clear — everything filed"
        : "nothing captured yet";

    document.getElementById("nt-stats").innerHTML = [
      ["Last 7 days", String(c.week)],
      ["Pinned", String(c.pinned)],
      ["Tags", String(c.tags)],
      ["Archived", String(c.archived)],
    ]
      .map(
        ([label, value]) => `
        <div class="dash-stat">
          <span class="stat-label">${label}</span>
          <span class="dash-stat-value">${value}</span>
        </div>`
      )
      .join("");

    const pill = document.getElementById("nt-pill");
    const label = document.getElementById("nt-pill-label");
    const detail = document.getElementById("nt-pill-detail");
    if (!pill) return;
    if (c.last && isToday(c.last)) {
      pill.dataset.state = "live";
      label.textContent = `Last capture ${timeAgoShort(c.last)}`;
      detail.textContent = "";
    } else if (c.last) {
      pill.dataset.state = "idle";
      label.textContent = `Last capture ${timeAgoShort(c.last)}`;
      detail.textContent = "";
    } else {
      pill.dataset.state = "next";
      label.textContent = "Empty inbox";
      detail.textContent = "write the first one";
    }
  }

  function renderTabs() {
    const tabs = document.getElementById("nt-tabs");
    if (!tabs) return;
    const c = counts();
    const n = { inbox: c.open, pinned: c.pinned, archive: c.archived, all: notes.length };
    tabs.innerHTML = VIEWS.map(
      (v) =>
        `<button type="button" class="nt-tab${v.id === view ? " is-on" : ""}" data-nt-view="${v.id}" role="tab" aria-selected="${v.id === view}">${v.label}<span class="nt-tab-count">${n[v.id]}</span></button>`
    ).join("");
  }

  function renderTagbar() {
    const bar = document.getElementById("nt-tagbar");
    if (!bar) return;
    const tags = tagCounts();
    if (!tags.length) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML =
      `<button type="button" class="nt-chip${tagFilter ? "" : " is-on"}" data-nt-tag="">All</button>` +
      tags
        .map(
          ([tag, n]) =>
            `<button type="button" class="nt-chip${tagFilter === tag ? " is-on" : ""}" data-nt-tag="${esc(tag)}">#${esc(tag)}<span class="nt-chip-count">${n}</span></button>`
        )
        .join("");
  }

  function emptyText() {
    if (query) return `Nothing matches “${query}”.`;
    if (tagFilter) return `Nothing tagged #${tagFilter} here.`;
    if (view === "archive") return "Archive is empty.";
    if (view === "pinned") return "Nothing pinned. Pin a note to keep it at the top.";
    if (notes.length) return "Inbox clear — everything's been filed.";
    return "Write anything in the box above. #tag it and it files itself.";
  }

  function cardHtml(note) {
    const editing = editingId === note.id;
    const menuOpen = menuId === note.id;
    const classes = ["nt-card"];
    if (note.pinned) classes.push("is-pinned");
    if (note.archived) classes.push("is-archived");
    if (expanded.has(note.id)) classes.push("is-expanded");

    if (editing) {
      return `
      <li class="${classes.join(" ")}" data-note="${note.id}">
        <textarea class="nt-edit" data-nt-edit-input="${note.id}" rows="4"></textarea>
        <div class="nt-card-foot">
          <span class="nt-card-time">Editing</span>
          <span class="nt-card-acts">
            <button type="button" class="nt-act is-primary" data-nt-save="${note.id}">Save</button>
            <button type="button" class="nt-act" data-nt-cancel="1">Cancel</button>
          </span>
        </div>
      </li>`;
    }

    return `
    <li class="${classes.join(" ")}" data-note="${note.id}">
      <div class="nt-card-text" data-nt-expand="${note.id}">${renderText(note.text)}</div>
      <div class="nt-card-foot">
        <span class="nt-card-time">${note.pinned ? "Pinned · " : ""}${esc(timeAgoShort(note.at))}</span>
        <span class="nt-card-acts">
          <button type="button" class="nt-act" data-nt-pin="${note.id}">${note.pinned ? "Unpin" : "Pin"}</button>
          <button type="button" class="nt-act" data-nt-edit="${note.id}">Edit</button>
          ${note.archived ? "" : `<button type="button" class="nt-act" data-nt-menu="${note.id}" aria-expanded="${menuOpen}">Send</button>`}
          <button type="button" class="nt-act" data-nt-archive="${note.id}">${note.archived ? "Restore" : "Archive"}</button>
          <button type="button" class="nt-act nt-act-del${confirmId === note.id ? " is-armed" : ""}" data-nt-delete="${note.id}">${confirmId === note.id ? "Sure?" : "✕"}</button>
        </span>
      </div>
      ${
        menuOpen
          ? `<div class="nt-menu">
              <span class="stat-label">Send this to</span>
              <div class="nt-menu-items">
                ${SEND_TARGETS.map((t) => `<button type="button" class="nt-menu-item" data-nt-send="${note.id}|${t.id}">${t.label}</button>`).join("")}
              </div>
            </div>`
          : ""
      }
    </li>`;
  }

  function renderList() {
    const list = document.getElementById("nt-list");
    if (!list) return;
    const items = visible();
    if (!items.length) {
      list.innerHTML = `<li class="empty-state nt-empty">${esc(emptyText())}</li>`;
      return;
    }
    list.innerHTML = items.map(cardHtml).join("");
    if (editingId) {
      const area = list.querySelector(`[data-nt-edit-input="${editingId}"]`);
      const note = notes.find((n) => n.id === editingId);
      if (area && note) {
        area.value = note.text;
        autoGrow(area);
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      }
    }
  }

  function renderCapture() {
    const input = document.getElementById("nt-input");
    const save = document.getElementById("nt-save");
    const preview = document.getElementById("nt-capture-tags");
    if (!input || !save || !preview) return;
    const text = input.value.trim();
    save.disabled = !text;
    const tags = parseTags(text);
    preview.innerHTML = tags.length ? tags.map((t) => `<span class="nt-tag-inline">#${esc(t)}</span>`).join(" ") : "";
  }

  function renderNotes() {
    if (!document.getElementById("nt-list")) return;
    renderHeader();
    renderTabs();
    renderTagbar();
    renderList();
    renderCapture();
    const statusEl = document.getElementById("nt-status");
    if (statusEl) statusEl.textContent = status;
  }
  window.renderNotes = renderNotes;
  window.addNote = addNote;

  // ---------------------------------------------------------------------
  // Interaction

  const section = document.getElementById("notes-section");
  const form = document.getElementById("nt-form");
  const input = document.getElementById("nt-input");
  const search = document.getElementById("nt-search");

  if (form && input) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      input.value = "";
      input.style.height = "";
      addNote(text);
      renderCapture();
      input.focus();
    });

    input.addEventListener("input", () => {
      autoGrow(input);
      renderCapture();
    });

    // Enter makes a new line (these are notes, not chat); ⌘/Ctrl+Enter files it.
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
  }

  if (search) {
    search.addEventListener("input", () => {
      query = search.value.trim();
      renderList();
      renderTabs();
    });
  }

  if (section) {
    section.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return; // links inside a note stay links

      const tag = ev.target.closest("[data-nt-tag]");
      if (tag) {
        const wanted = tag.dataset.ntTag || null;
        tagFilter = tagFilter === wanted ? null : wanted;
        renderNotes();
        return;
      }

      const viewBtn = ev.target.closest("[data-nt-view]");
      if (viewBtn) {
        view = viewBtn.dataset.ntView;
        menuId = null;
        editingId = null;
        renderNotes();
        return;
      }

      const pin = ev.target.closest("[data-nt-pin]");
      if (pin) {
        const note = notes.find((n) => n.id === pin.dataset.ntPin);
        if (note) patchNote(note.id, { pinned: !note.pinned });
        return;
      }

      const edit = ev.target.closest("[data-nt-edit]");
      if (edit) {
        editingId = edit.dataset.ntEdit;
        menuId = null;
        renderList();
        return;
      }

      const save = ev.target.closest("[data-nt-save]");
      if (save) {
        const area = section.querySelector(`[data-nt-edit-input="${save.dataset.ntSave}"]`);
        const text = area ? area.value.trim() : "";
        editingId = null;
        if (text) patchNote(save.dataset.ntSave, { text });
        else renderList();
        return;
      }

      if (ev.target.closest("[data-nt-cancel]")) {
        editingId = null;
        renderList();
        return;
      }

      const menu = ev.target.closest("[data-nt-menu]");
      if (menu) {
        menuId = menuId === menu.dataset.ntMenu ? null : menu.dataset.ntMenu;
        renderList();
        return;
      }

      const send = ev.target.closest("[data-nt-send]");
      if (send) {
        const [id, target] = send.dataset.ntSend.split("|");
        sendNote(id, target);
        return;
      }

      const archive = ev.target.closest("[data-nt-archive]");
      if (archive) {
        const note = notes.find((n) => n.id === archive.dataset.ntArchive);
        if (note) patchNote(note.id, { archived: !note.archived, pinned: false });
        return;
      }

      const del = ev.target.closest("[data-nt-delete]");
      if (del) {
        const id = del.dataset.ntDelete;
        if (confirmId === id) {
          confirmId = null;
          removeNote(id);
        } else {
          confirmId = id;
          renderList();
          setTimeout(() => {
            if (confirmId !== id) return;
            confirmId = null;
            renderList();
          }, 3000);
        }
        return;
      }

      const expand = ev.target.closest("[data-nt-expand]");
      if (expand) {
        const id = expand.dataset.ntExpand;
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        renderList();
      }
    });
  }

  // Tapping anywhere else closes an open "send" menu — but not the button
  // that just opened it, whose own handler already ran.
  document.addEventListener("click", (ev) => {
    if (!menuId) return;
    if (ev.target.closest(".nt-menu") || ev.target.closest("[data-nt-menu]")) return;
    menuId = null;
    renderList();
  });

  // ---------------------------------------------------------------------
  // What the rest of the app reads

  window.notesInRange = function notesInRange(from, to) {
    return notes.filter((n) => (n.at || 0) >= from && (n.at || 0) < to).length;
  };

  window.notesSummary = function notesSummary() {
    const c = counts();
    return {
      open: c.open,
      pinned: c.pinned,
      archived: c.archived,
      week: c.week,
      total: notes.length,
      short: c.open ? `${c.open} in inbox` : notes.length ? "Inbox clear" : "Empty",
      line: `Notes: ${c.open} in the inbox, ${c.week} captured in the last 7 days${c.pinned ? `, ${c.pinned} pinned` : ""}`,
    };
  };

  window.TODAY_LOG_SOURCES = window.TODAY_LOG_SOURCES || [];
  window.TODAY_LOG_SOURCES.push(() =>
    notes
      .filter((n) => isToday(n.at))
      .map((n) => ({ key: "notes", section: "Notes", text: n.text.replace(/\n+/g, " "), at: n.at }))
  );

  renderNotes();
})();
