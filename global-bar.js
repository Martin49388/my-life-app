// Persistent bottom bar, visible across every section. It's just a second
// front door into Alfred (alfred.js) — same log, same Gemini call, same
// daily-context building. Asking here jumps to the Alfred section so the
// reply is visible in the conversation, same as asking from there directly.

const globalBarForm = document.getElementById("global-bar");
const globalBarInput = document.getElementById("global-bar-input");

globalBarForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = globalBarInput.value.trim();
  if (!question) return;
  globalBarInput.value = "";

  if (window.switchSection) window.switchSection("alfred");
  if (window.handleAlfredQuestion) window.handleAlfredQuestion(question);
});
