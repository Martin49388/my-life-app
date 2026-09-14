// Quote of the day: one new real quote (with author + a short note on why
// it's worth reading) generated automatically the first time the app is
// opened each day — no button, no prompt, it just appears. Every quote
// generated this way is kept permanently in the Mindset section's list, so
// the collection just grows over time. Uses the same Gemini setup as Alfred
// (see alfred.js) and the same config.js API key.
//
// Design choice: this only ever ensures *today* has a quote. If the app
// isn't opened on a given day, that day is simply skipped rather than
// backfilled — simpler, and the point is "a quote each time you show up,"
// not a perfect daily calendar.

const QUOTES_KEY = "quotes-log";

function loadQuotes() {
  const raw = localStorage.getItem(QUOTES_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveQuotes(list) {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(list));
}

let quotesLog = loadQuotes();
let generatingQuote = false;

function todaysQuote() {
  const today = todayKey();
  return quotesLog.find((q) => q.date === today);
}

// Best-effort extraction of a JSON object from a Gemini response — it's
// asked to return raw JSON, but sometimes wraps it in a ```json fence
// anyway, so pull out the {...} rather than assume the whole text parses.
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end + 1));
}

async function generateTodayQuote() {
  if (generatingQuote || todaysQuote()) return;
  generatingQuote = true;
  renderQuoteOfDay();

  const key = window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY;
  if (!key) {
    generatingQuote = false;
    renderQuoteOfDay("No Gemini key set in config.js — add GEMINI_API_KEY there first.");
    return;
  }

  const usedList = quotesLog
    .slice(-100)
    .map((q) => `- "${q.text}" — ${q.author}`)
    .join("\n");

  const prompt = [
    "Give me one real, correctly-attributed quote from a real historical or",
    "notable figure, on the theme of mindset, discipline, growth, resilience,",
    "focus, or wisdom. Do not invent a quote or an author. Do not repeat any",
    "quote or author already used below, and prefer variety in who it's",
    "attributed to.",
    "",
    usedList ? `Already used:\n${usedList}` : "None used yet.",
    "",
    'Respond with ONLY a JSON object, no markdown, no code fences, no extra',
    'text, in exactly this shape:',
    '{"quote": "...", "author": "...", "info": "1-2 sentences of interesting context or meaning behind the quote"}',
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    const parsed = extractJson(raw);
    if (!parsed.quote || !parsed.author) throw new Error("Response missing quote or author");

    // Re-check in case two calls raced while this one was in flight.
    if (!todaysQuote()) {
      quotesLog.push({
        date: todayKey(),
        text: String(parsed.quote).trim(),
        author: String(parsed.author).trim(),
        info: String(parsed.info || "").trim(),
      });
      saveQuotes(quotesLog);
    }
    generatingQuote = false;
    renderQuoteOfDay();
    renderMindsetQuotes();
  } catch (err) {
    generatingQuote = false;
    renderQuoteOfDay(`Couldn't generate today's quote: ${err.message}`);
  }
}

function openQuoteModal(entry) {
  document.getElementById("quote-modal-text").textContent = entry.text;
  document.getElementById("quote-modal-author").textContent = `— ${entry.author}`;
  document.getElementById("quote-modal-info").textContent = entry.info || "No extra info for this one.";
  document.getElementById("quote-modal-overlay").hidden = false;
}

function closeQuoteModal() {
  document.getElementById("quote-modal-overlay").hidden = true;
}

document.getElementById("quote-modal-close").addEventListener("click", closeQuoteModal);
document.getElementById("quote-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "quote-modal-overlay") closeQuoteModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("quote-modal-overlay").hidden) closeQuoteModal();
});

// errorText is only passed while there's no quote for today yet (loading
// or failed) — once one exists it always wins.
function renderQuoteOfDay(errorText) {
  const textEl = document.getElementById("overview-quote-text");
  const authorEl = document.getElementById("overview-quote-author");
  const btn = document.getElementById("overview-quote-btn");
  if (!textEl) return;

  const entry = todaysQuote();
  if (entry) {
    textEl.textContent = entry.text;
    authorEl.textContent = `— ${entry.author}`;
    btn.onclick = () => openQuoteModal(entry);
    return;
  }

  textEl.textContent = errorText || (generatingQuote ? "Generating today's quote…" : "Loading…");
  authorEl.textContent = "";
  btn.onclick = errorText ? () => generateTodayQuote() : null;
}

function renderMindsetQuotes() {
  const list = document.getElementById("mindset-quotes-list");
  if (!list) return;
  if (quotesLog.length === 0) {
    list.innerHTML = `<li class="empty-state">Today's quote will show up here shortly.</li>`;
    return;
  }
  const ordered = [...quotesLog].reverse(); // newest first
  list.innerHTML = ordered
    .map(
      (_, i) => `
      <li class="journal-row quote-row" data-index="${i}" tabindex="0" role="button">
        <div class="journal-row-body">
          <p class="journal-text"></p>
          <p class="journal-time"></p>
        </div>
      </li>`
    )
    .join("");
  list.querySelectorAll(".quote-row").forEach((row, i) => {
    const entry = ordered[i];
    row.querySelector(".journal-text").textContent = entry.text;
    row.querySelector(".journal-time").textContent = `— ${entry.author}`;
    row.addEventListener("click", () => openQuoteModal(entry));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openQuoteModal(entry);
      }
    });
  });
}

renderQuoteOfDay();
renderMindsetQuotes();
generateTodayQuote();
