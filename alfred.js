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
    const freq = habitFreq(h);
    const weekly = freq < 7 ? ` (${freq}x/week, ${habitWeekCount(h, today)} done this week)` : "";
    return `${h.name}${weekly}: ${doneToday ? "done" : "not done"} today, ${habitStreakText(h)}`;
  });

  if (window.refreshLinkedGoals) window.refreshLinkedGoals();
  const goalLines = goals.map(
    (g) =>
      `${g.name} (${g.term}-term): ${g.current}/${g.target} ${g.unit}${g.deadline ? `, due ${g.deadline}` : ""}` +
      (window.goalPaceText && !(window.goalIsDone ? window.goalIsDone(g) : g.current >= g.target) ? ` — ${window.goalPaceText(g)}` : "")
  );

  const trainedCount = typeof trainedThisWeek === "function" ? trainedThisWeek() : null;
  const fitnessLine = trainedCount != null ? `Fitness: trained ${trainedCount}/${TRAIN_TARGET} days this week` : "Fitness: no data";

  const foodEntries = entriesFor(today);
  const kcalToday = foodEntries.reduce((sum, e) => sum + e.kcal, 0);
  const proteinToday = foodEntries.reduce((sum, e) => sum + (e.protein || 0), 0);
  const pGoal = typeof proteinTarget === "function" ? proteinTarget() : null;
  const kcalGoal = window.foodGoal ? window.foodGoal() : null;
  const kcalGoalNote = { bulk: " (bulking: the target is a minimum to reach, going over is fine)", maintain: " (maintaining: aim to land within ~7% of it)", cut: " (cutting: the target is a ceiling)" }[kcalGoal] || "";
  const foodLine = `Food today: ${kcalToday}/${food.target} kcal${kcalGoalNote}, ${proteinToday}${pGoal ? `/${pGoal}` : ""}g protein`;
  const latestKg = window.latestWeight ? window.latestWeight() : null;
  const weightLine = latestKg ? `Body weight: ${latestKg.kg.toFixed(1)} kg (logged ${latestKg.date})` : null;

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
    ...(weightLine ? [`- ${weightLine}`] : []),
    ...(readingLine ? [`- ${readingLine}`] : []),
    ...extraLines.map((l) => `- ${l}`),
  ].join("\n");
}

// One Gemini call, shared with review.js (weekly summary). Returns the
// response text, or throws with a readable message.
async function callGemini(prompt, { json = false } = {}) {
  const key = geminiKey();
  if (!key) throw new Error("No Gemini key set — add one in Settings under Alfred (AI).");
  // Google retired gemini-2.0-flash (404'd live — see decisions log);
  // gemini-3.6-flash is what its own error message named as the
  // replacement.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };
  if (json) body.generationConfig = { responseMimeType: "application/json" };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}
window.callGemini = callGemini;

const ALFRED_ACTIONS_SPEC = [
  "You can also change the app when Martin asks you to log or record something.",
  "Allowed actions (JSON objects):",
  '- {"type":"water","ml":500}',
  '- {"type":"food","name":"Chicken rice bowl","kcal":780,"protein":55,"meal":"Lunch"} (meal: Breakfast|Lunch|Dinner|Snacks; estimate kcal/protein sensibly if not given)',
  '- {"type":"habit","name":"<an existing habit name>"} (marks it done today)',
  '- {"type":"weight","kg":82.4}',
  '- {"type":"sleep","hours":7.5,"quality":4,"energy":3,"soreness":2} (1-5 scales, all optional except what he said)',
  '- {"type":"training"} (marks today\'s planned session done)',
  '- {"type":"note","text":"..."}',
  '- {"type":"goal","name":"<an existing goal name>","delta":5}',
  "Only include actions he clearly asked for. Never invent data. You cannot delete anything.",
  'Respond with JSON only, exactly: {"reply": "...", "actions": [...]}. If you logged something, the reply confirms it in one short line; otherwise it answers the question.',
].join("\n");

const ALFRED_LOCAL_HELP =
  "I can log without a key — try “drank 500ml”, “weight 82.4”, “slept 7.5h”, “done meditate”, “oats 450 kcal 20g protein”, “trained” or “note: …”. For questions about your week, add a Gemini key in Settings → Alfred (AI).";

// Returns { answer, actions } where actions are the human lines of what
// was actually changed in the app.
async function askAlfred(question) {
  // 1. Plain logging commands are handled here — instant, offline, no key.
  const local = window.appActions ? window.appActions.parseLocal(question) : null;
  if (local) {
    const actions = window.appActions.apply(local);
    return { answer: actions.length ? "Logged." : "Couldn't match that to anything in the app.", actions };
  }

  if (!geminiKey()) return { answer: ALFRED_LOCAL_HELP, actions: [] };

  const systemInstruction =
    "You are Alfred, a blunt personal check-in assistant inside Martin's " +
    "tracking app (Batcave). State what did and didn't happen plainly, no " +
    "cushioning — e.g. 'missed 2 of 5 training days, goal X is behind " +
    "schedule.' Use only the data given below; don't invent numbers. Keep " +
    "answers short — a few sentences, not a report.";

  const prompt = `${systemInstruction}\n\n${ALFRED_ACTIONS_SPEC}\n\n${buildDailyContext()}\n\nMessage: ${question}`;

  try {
    const text = await callGemini(prompt, { json: true });
    let parsed = null;
    try {
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      parsed = null;
    }
    if (!parsed) return { answer: text || "(no response)", actions: [] };
    const actions = window.appActions ? window.appActions.apply(parsed.actions) : [];
    return { answer: String(parsed.reply || (actions.length ? "Logged." : "(no response)")), actions };
  } catch (err) {
    return { answer: `Couldn't reach Alfred: ${err.message}`, actions: [] };
  }
}

const ALFRED_SUGGESTIONS = ["How's my week going?", "What's still open today?", "drank 500ml", "slept 7.5h", "What should I eat to hit protein?"];

function renderAlfredLog() {
  const log = document.getElementById("alfred-log");
  if (alfredLog.length === 0) {
    log.innerHTML = `<div class="alfred-empty">
        <p class="alfred-empty-title">Ask, or just tell Alfred what you did.</p>
        <p>He reads today's habits, goals, training, food, water and recovery, answers straight — and logs things for you: “drank 500ml”, “weight 82.4”, “done meditate”, “chicken bowl 780 kcal 55g protein”.</p>
      </div>`;
    return;
  }
  log.innerHTML = alfredLog
    .map(
      (entry) => `
      <div class="alfred-entry alfred-you"><span class="alfred-role">You</span>${escapeHtml(entry.question)}</div>
      <div class="alfred-entry alfred-reply"><span class="alfred-role">Alfred</span>${escapeHtml(entry.answer)}${
        entry.actions && entry.actions.length
          ? `<span class="alfred-actions">${entry.actions.map((a) => `<span class="alfred-action">${escapeHtml(a)}</span>`).join("")}</span>`
          : ""
      }</div>`
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
  if (!alfredLog.length) log.innerHTML = "";
  log.innerHTML += `<div class="alfred-entry alfred-you"><span class="alfred-role">You</span>${escapeHtml(question)}</div>
    <div class="alfred-entry alfred-reply alfred-loading" id="alfred-pending"><span class="alfred-role">Alfred</span>…</div>`;
  log.scrollTop = log.scrollHeight;

  const { answer, actions } = await askAlfred(question);
  alfredLog.push({ question, answer, actions, at: Date.now() });
  saveAlfredLog(alfredLog);
  renderAlfredLog();
}

window.handleAlfredQuestion = handleAlfredQuestion;

const alfredQuick = document.getElementById("alfred-quick");
if (alfredQuick) {
  alfredQuick.innerHTML = ALFRED_SUGGESTIONS.map((q) => `<button type="button" class="alfred-suggest">${escapeHtml(q)}</button>`).join("");
  alfredQuick.addEventListener("click", (e) => {
    const b = e.target.closest(".alfred-suggest");
    if (b) handleAlfredQuestion(b.textContent);
  });
}

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
