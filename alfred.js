// Alfred: reads today's real data across the app and answers via the
// Gemini API. Blunt tone (Martin's choice) — state what did/didn't
// happen, don't cushion it. Client-side key, see config.js for why.
//
// The Gemini key lives in Settings -> "Alfred (AI)", stored per device in
// localStorage — NOT config.js. config.js is gitignored, so a key pasted
// there only ever exists on whichever single machine someone edited it
// on, invisible to any other device (a phone opening the live GitHub
// Pages link, for instance). Same reasoning, same fix, as Markets' keys —
// see CLAUDE.md for the fuller story. quotes.js reads GEMINI_API_KEY the
// same way, via geminiKey() below (this file loads first).

const ALFRED_LOG_KEY = "alfred-log";
const GEMINI_KEY_STORAGE = "gemini-api-key";

function geminiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || "";
}

function loadAlfredLog() {
  const raw = localStorage.getItem(ALFRED_LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveAlfredLog(log) {
  // Keep the log from growing forever — last 20 exchanges is plenty.
  localStorage.setItem(ALFRED_LOG_KEY, JSON.stringify(log.slice(-40)));
}

let alfredLog = loadAlfredLog();

// Pulls today's real numbers from every other module. All of these are
// globals from script.js/goals.js/fitness.js/food.js/water.js, loaded
// before this file.
function buildDailyContext() {
  const today = todayKey();

  const habitLines = habits.map((h) => {
    const doneToday = !!h.history[today];
    return `${h.name}: ${doneToday ? "done" : "not done"} today, ${currentStreak(h)}d streak`;
  });

  const goalLines = goals.map(
    (g) => `${g.name} (${g.term}-term): ${g.current}/${g.target} ${g.unit}${g.deadline ? `, due ${g.deadline}` : ""}`
  );

  const trainedCount = typeof trainedThisWeek === "function" ? trainedThisWeek() : null;
  const fitnessLine = trainedCount != null ? `Fitness: trained ${trainedCount}/${TRAIN_TARGET} days this week` : "Fitness: no data";

  const foodEntries = entriesFor(today);
  const kcalToday = foodEntries.reduce((sum, e) => sum + e.kcal, 0);
  const proteinToday = foodEntries.reduce((sum, e) => sum + (e.protein || 0), 0);
  const foodLine = `Food today: ${kcalToday}/${food.target} kcal, ${proteinToday}g protein`;

  const waterMl = waterToday();
  const waterLine = `Water today: ${(waterMl / 1000).toFixed(2)}L of ${(water.target / 1000).toFixed(1)}L target`;

  const reading = window.readingSummary ? window.readingSummary() : null;
  const readingLine = reading
    ? `Reading: ${
        reading.reading.length
          ? reading.reading.map((b) => `"${b.title}"${b.pages ? ` (p. ${b.page}/${b.pages})` : ""}`).join(", ")
          : "nothing in progress"
      }; ${reading.finishedThisYear} books finished this year, ${reading.total} all time`
    : null;

  // Recovery's readiness check-in, the running week's review score and
  // the notes inbox — each section exposes one summary line rather than
  // this file reaching into their storage (see recovery.js/review.js/
  // notes.js).
  const extraLines = [window.recoverySummary, window.reviewSummary, window.notesSummary]
    .map((fn) => {
      try {
        return fn ? fn().line : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return [
    `Today is ${today}.`,
    "Habits:",
    ...habitLines.map((l) => `- ${l}`),
    "Goals:",
    ...(goalLines.length ? goalLines.map((l) => `- ${l}`) : ["- none set"]),
    `- ${fitnessLine}`,
    `- ${foodLine}`,
    `- ${waterLine}`,
    ...(readingLine ? [`- ${readingLine}`] : []),
    ...extraLines.map((l) => `- ${l}`),
  ].join("\n");
}

async function askAlfred(question) {
  const key = geminiKey();
  if (!key) {
    return "No Gemini key set — add one in Settings under Alfred (AI).";
  }

  const systemInstruction =
    "You are Alfred, a blunt personal check-in assistant inside Martin's " +
    "tracking app (Batcave). State what did and didn't happen plainly, no " +
    "cushioning — e.g. 'missed 2 of 5 training days, goal X is behind " +
    "schedule.' Use only the data given below; don't invent numbers. Keep " +
    "answers short — a few sentences, not a report.";

  const prompt = `${systemInstruction}\n\n${buildDailyContext()}\n\nQuestion: ${question}`;

  // Google retired gemini-2.0-flash (404'd live — see decisions log);
  // gemini-3.6-flash is what its own error message named as the
  // replacement.
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
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "(no response)";
    return text.trim();
  } catch (err) {
    return `Couldn't reach Alfred: ${err.message}`;
  }
}

function renderAlfredLog() {
  const log = document.getElementById("alfred-log");
  if (alfredLog.length === 0) {
    log.innerHTML = `<p class="alfred-empty">Ask how your week's going, or anything else — Alfred reads today's habits, goals, fitness, food and water and answers straight, no cushioning.</p>`;
    return;
  }
  log.innerHTML = alfredLog
    .map(
      (entry) => `
      <div class="alfred-entry alfred-you"><span class="alfred-role">You</span>${escapeHtml(entry.question)}</div>
      <div class="alfred-entry alfred-reply"><span class="alfred-role">Alfred</span>${escapeHtml(entry.answer)}</div>`
    )
    .join("");
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function handleAlfredQuestion(question) {
  const log = document.getElementById("alfred-log");
  log.innerHTML += `<div class="alfred-entry alfred-you"><span class="alfred-role">You</span>${escapeHtml(question)}</div>
    <div class="alfred-entry alfred-reply alfred-loading" id="alfred-pending"><span class="alfred-role">Alfred</span>…</div>`;
  log.scrollTop = log.scrollHeight;

  const answer = await askAlfred(question);
  alfredLog.push({ question, answer, at: Date.now() });
  saveAlfredLog(alfredLog);
  renderAlfredLog();
}

window.handleAlfredQuestion = handleAlfredQuestion;

document.getElementById("alfred-checkin-btn").addEventListener("click", () => {
  handleAlfredQuestion("How's my week going?");
});

document.getElementById("alfred-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("alfred-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  handleAlfredQuestion(question);
});

renderAlfredLog();

const geminiForm = document.getElementById("gemini-config-form");
const geminiInput = document.getElementById("gemini-key-input");
const geminiKeyStatus = document.getElementById("gemini-key-status");

function renderGeminiKeyStatus() {
  const key = localStorage.getItem(GEMINI_KEY_STORAGE);
  geminiInput.value = key || "";
  geminiKeyStatus.textContent = key ? "Key saved on this device." : "Not set on this device";
}

if (geminiForm) {
  geminiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = geminiInput.value.trim();
    if (value) localStorage.setItem(GEMINI_KEY_STORAGE, value);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
    renderGeminiKeyStatus();
  });
  renderGeminiKeyStatus();
}
