// The "ask Alfred" front door, visible from every section. On desktop it's
// a persistent bottom bar; on the phone the same form is the "Ask" sheet
// opened from the tab bar (see mobile-nav.js). Either way it's just a
// second way into Alfred (alfred.js) — same log, same Gemini call, same
// daily-context building. Asking jumps to the Alfred section so the reply
// is visible in the conversation.

const globalBarForm = document.getElementById("global-bar");
const globalBarInput = document.getElementById("global-bar-input");

function askFromGlobalBar(question) {
  const text = question.trim();
  if (!text) return;
  globalBarInput.value = "";
  if (window.closeAskSheet) window.closeAskSheet();
  if (window.switchSection) window.switchSection("alfred");
  if (window.handleAlfredQuestion) window.handleAlfredQuestion(text);
}

globalBarForm.addEventListener("submit", (e) => {
  e.preventDefault();
  askFromGlobalBar(globalBarInput.value);
});

// Suggested prompts (shown in the phone sheet).
globalBarForm.querySelectorAll(".global-bar-prompt").forEach((btn) => {
  btn.addEventListener("click", () => askFromGlobalBar(btn.textContent));
});
