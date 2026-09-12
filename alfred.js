// Alfred: reads today's real data across the app and answers via the
// Gemini API. Blunt tone (Martin's choice) — state what did/didn't
// happen, don't cushion it. Client-side key, see config.js for why.

const ALFRED_LOG_KEY = "alfred-log";

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

  return [
    `Today is ${today}.`,
    "Habits:",
    ...habitLines.map((l) => `- ${l}`),
    "Goals:",
    ...(goalLines.length ? goalLines.map((l) => `- ${l}`) : ["- none set"]),
    `- ${fitnessLine}`,
    `- ${foodLine}`,
    `- ${waterLine}`,
  ].join("\n");
}

async function askAlfred(question) {
  const key = window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY;
  if (!key) {
    return "No Gemini key set in config.js — add GEMINI_API_KEY there first.";
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
