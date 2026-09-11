const ACCENT_KEY = "accent";

// Each palette carries a light and a dark value, because one hex can't serve
// both grounds — a deep violet that reads well on white disappears on near
// black, and vice versa.
const PALETTES = [
  { id: "violet", name: "Violet", light: "#4b2e83", dark: "#9b6fe0", lightSoft: "#ece4f7", darkSoft: "#33254e" },
  { id: "blue", name: "Blue", light: "#1d4ed8", dark: "#7aa2f7", lightSoft: "#e2e8fb", darkSoft: "#1e2a4a" },
  { id: "teal", name: "Teal", light: "#0e6f7a", dark: "#5fd0de", lightSoft: "#dcf0f2", darkSoft: "#14343a" },
  { id: "emerald", name: "Emerald", light: "#0f6b4f", dark: "#5fd3a3", lightSoft: "#ddf0e7", darkSoft: "#143528" },
  { id: "amber", name: "Amber", light: "#b5622f", dark: "#e08a4f", lightSoft: "#f6e3d4", darkSoft: "#3a2a1c" },
  { id: "crimson", name: "Crimson", light: "#a11d33", dark: "#f2778e", lightSoft: "#f8dfe3", darkSoft: "#3d1922" },
  { id: "pink", name: "Pink", light: "#9d2b6e", dark: "#ec7ab8", lightSoft: "#f9e0ef", darkSoft: "#3b1c30" },
  { id: "vanilla", name: "Vanilla", light: "#8a6520", dark: "#e8cf9a", lightSoft: "#f6ecd6", darkSoft: "#3a3121" },
  { id: "gray", name: "Gray", light: "#4a4a52", dark: "#a9a9b5", lightSoft: "#e8e8ec", darkSoft: "#2e2e36" },
  { id: "mono", name: "Black & white", light: "#000000", dark: "#ffffff", lightSoft: "#e6e6e6", darkSoft: "#333333" },
  { id: "stealth", name: "Black on black", light: "#1a1a1a", dark: "#3d3d44", lightSoft: "#dedede", darkSoft: "#232329" },
];

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function currentPalette() {
  const savedId = localStorage.getItem(ACCENT_KEY);
  return PALETTES.find((p) => p.id === savedId) || PALETTES[0];
}

// The greys aren't neutral — they carry a faint tint of the accent's hue, which
// is what stops the app looking like coloured controls dropped onto grey chrome.
// Saturation and lightness are fixed per token so contrast never changes; only
// the hue swings with the palette.
const NEUTRAL_RAMP = {
  dark: {
    "--bg": [22, 9],
    "--surface": [25, 12],
    "--surface-2": [25, 15],
    "--border": [22, 23],
    "--track": [22, 18],
    "--text": [38, 94],
    "--text-dim": [21, 68],
    "--text-faint": [13, 48],
  },
  // Both ramps must declare the same tokens. Inline properties persist on the
  // element, so a token missing from one ramp keeps the other theme's value
  // when the system switches — which rendered light-mode cards near-black.
  light: {
    "--bg": [33, 98],
    "--surface": [0, 100],
    "--surface-2": [27, 94],
    "--border": [27, 88],
    "--track": [38, 91],
    "--text": [21, 14],
    "--text-dim": [9, 43],
    "--text-faint": [15, 65],
  },
};

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = (((g - b) / delta) % 6 + 6) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  return { h: h * 60, s: s * 100, l: l * 100 };
}

function relativeLuminance(hex) {
  const channel = (v) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Text on an accent-coloured background pairs with black wherever black is
// legible. Only the genuinely dark accents fall back to white, since black on
// a near-black fill would be unreadable.
function inkFor(hex) {
  return relativeLuminance(hex) > 0.18 ? "#0c0c0e" : "#ffffff";
}

// Inline custom properties on <html> beat every stylesheet rule, so this
// overrides the accent in both the light block and the dark media query
// without needing a rule per palette per theme.
function applyPalette(palette) {
  const dark = prefersDark();
  const accent = dark ? palette.dark : palette.light;
  const root = document.documentElement;

  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-soft", dark ? palette.darkSoft : palette.lightSoft);
  root.style.setProperty("--accent-ink", inkFor(accent));

  // Grey, black & white and black-on-black have no hue worth carrying, so their
  // neutrals go properly neutral instead of picking up a phantom tint.
  const { h, s } = hexToHsl(accent);
  const achromatic = s < 12;

  const ramp = NEUTRAL_RAMP[dark ? "dark" : "light"];
  for (const [token, [sat, light]] of Object.entries(ramp)) {
    root.style.setProperty(token, `hsl(${h.toFixed(0)} ${achromatic ? 0 : sat}% ${light}%)`);
  }
}

function renderSwatches() {
  const grid = document.getElementById("swatch-grid");
  const active = currentPalette();
  grid.innerHTML = "";

  for (const palette of PALETTES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch" + (palette.id === active.id ? " selected" : "");
    btn.setAttribute("aria-label", palette.name);
    btn.setAttribute("aria-pressed", String(palette.id === active.id));

    const dot = document.createElement("span");
    dot.className = "swatch-dot";
    // Split fill shows how the palette reads on a light and a dark ground.
    dot.style.background = `linear-gradient(135deg, ${palette.light} 0 50%, ${palette.dark} 50% 100%)`;

    const label = document.createElement("span");
    label.className = "swatch-name";
    label.textContent = palette.name;

    btn.append(dot, label);
    btn.addEventListener("click", (e) => {
      // Re-rendering detaches this button, so the outside-click check below
      // would see a detached target and close the panel. Stop it here instead
      // and let people try several colours in a row.
      e.stopPropagation();
      localStorage.setItem(ACCENT_KEY, palette.id);
      applyPalette(palette);
      renderSwatches();
    });

    grid.appendChild(btn);
  }
}

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

// The chosen palette has a value per theme, so re-resolve it if the system
// switches between light and dark while the app is open.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyPalette(currentPalette());
});

applyPalette(currentPalette());
renderSwatches();
