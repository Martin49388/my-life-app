// Jarvis: reads today's real data across the app and answers via the
// Gemini API. Blunt tone (Martin's choice) — state what did/didn't
// happen, don't cushion it. Client-side key, see config.js for why.

const JARVIS_LOG_KEY = "jarvis-log";

function loadJarvisLog() {
  const raw = localStorage.getItem(JARVIS_LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveJarvisLog(log) {
  // Keep the log from growing forever — last 20 exchanges is plenty.
  localStorage.setItem(JARVIS_LOG_KEY, JSON.stringify(log.slice(-40)));
}

let jarvisLog = loadJarvisLog();

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

async function askJarvis(question) {
  const key = window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY;
  if (!key) {
    return "No Gemini key set in config.js — add GEMINI_API_KEY there first.";
  }

  const systemInstruction =
    "You are Jarvis, a blunt personal check-in assistant inside Martin's " +
    "tracking app (Batcave). State what did and didn't happen plainly, no " +
    "cushioning — e.g. 'missed 2 of 5 training days, goal X is behind " +
    "schedule.' Use only the data given below; don't invent numbers. Keep " +
    "answers short — a few sentences, not a report.";

  const prompt = `${systemInstruction}\n\n${buildDailyContext()}\n\nQuestion: ${question}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;

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
    return `Couldn't reach Jarvis: ${err.message}`;
  }
}

function renderJarvisLog() {
  const log = document.getElementById("jarvis-log");
  if (jarvisLog.length === 0) {
    log.innerHTML = `<p class="jarvis-empty">Ask how your week's going, or anything else — Jarvis reads today's habits, goals, fitness, food and water and answers straight, no cushioning.</p>`;
    return;
  }
  log.innerHTML = jarvisLog
    .map(
      (entry) => `
      <div class="jarvis-entry jarvis-you"><span class="jarvis-role">You</span>${escapeHtml(entry.question)}</div>
      <div class="jarvis-entry jarvis-reply"><span class="jarvis-role">Jarvis</span>${escapeHtml(entry.answer)}</div>`
    )
    .join("");
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function handleJarvisQuestion(question) {
  const log = document.getElementById("jarvis-log");
  log.innerHTML += `<div class="jarvis-entry jarvis-you"><span class="jarvis-role">You</span>${escapeHtml(question)}</div>
    <div class="jarvis-entry jarvis-reply jarvis-loading" id="jarvis-pending"><span class="jarvis-role">Jarvis</span>…</div>`;
  log.scrollTop = log.scrollHeight;

  const answer = await askJarvis(question);
  jarvisLog.push({ question, answer, at: Date.now() });
  saveJarvisLog(jarvisLog);
  renderJarvisLog();
}

window.handleJarvisQuestion = handleJarvisQuestion;

document.getElementById("jarvis-checkin-btn").addEventListener("click", () => {
  handleJarvisQuestion("How's my week going?");
});

document.getElementById("jarvis-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("jarvis-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  handleJarvisQuestion(question);
});

renderJarvisLog();
