// Generic timestamped note log, shared by every section that's just "write
// a short entry, see past entries" — Blueprint, Review, Recovery, Mindset,
// Reading, Markets, Notes. One localStorage key per section, newest entry
// first. Deliberately simple: these sections don't have real targets/data
// yet (unlike Habits/Goals/Fitness/Food/Water), so this is a placeholder
// worth using until each one gets real structure.

const JOURNAL_KEYS = ["blueprint", "review", "recovery", "mindset", "reading", "markets", "notes"];

function loadJournal(key) {
  const raw = localStorage.getItem(`journal-${key}`);
  return raw ? JSON.parse(raw) : [];
}

function saveJournal(key, entries) {
  localStorage.setItem(`journal-${key}`, JSON.stringify(entries.slice(0, 200)));
}

function formatJournalTime(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

function renderJournal(key) {
  const list = document.getElementById(`${key}-journal-list`);
  if (!list) return;
  const entries = loadJournal(key);
  if (entries.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing logged yet.</li>`;
    return;
  }
  list.innerHTML = entries
    .map(
      (e, i) => `
      <li class="journal-row" data-index="${i}">
        <div class="journal-row-body">
          <p class="journal-text"></p>
          <p class="journal-time">${formatJournalTime(e.at)}</p>
        </div>
        <button type="button" class="delete-btn journal-delete" data-key="${key}" data-index="${i}" aria-label="Delete entry">&#10005;</button>
      </li>`
    )
    .join("");
  // Set text via textContent (not the template above) to avoid HTML injection.
  list.querySelectorAll(".journal-row").forEach((row, i) => {
    row.querySelector(".journal-text").textContent = entries[i].text;
  });
}

function addJournalEntry(key, text) {
  const entries = loadJournal(key);
  entries.unshift({ text, at: Date.now() });
  saveJournal(key, entries);
  renderJournal(key);
}

function deleteJournalEntry(key, index) {
  const entries = loadJournal(key);
  entries.splice(index, 1);
  saveJournal(key, entries);
  renderJournal(key);
}

document.querySelectorAll(".journal-form").forEach((form) => {
  const key = form.dataset.journal;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector(".journal-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addJournalEntry(key, text);
  });
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".journal-delete");
  if (!btn) return;
  deleteJournalEntry(btn.dataset.key, Number(btn.dataset.index));
});

JOURNAL_KEYS.forEach(renderJournal);
