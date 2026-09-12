// Accent/tint/intensity picking was removed: the app now uses a fixed
// black-and-grey palette (see style.css :root), so there is nothing left
// to choose. This file only owns the settings panel's open/close chrome.

const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsBtn.classList.toggle("on", open);
  settingsBtn.setAttribute("aria-expanded", String(open));
}

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setSettingsOpen(settingsPanel.hidden);
});

document.addEventListener("click", (e) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(e.target)) setSettingsOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsPanel.hidden) setSettingsOpen(false);
});
