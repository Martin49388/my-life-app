// Body weight — one number a day, shown as a trend on the Fuel page.
//
// Stored under its own key ("weight") as { log: { "YYYY-MM-DD": kg } },
// so it syncs and backs up like everything else. Logging a weight also
// updates food.body.weight, so the maintenance estimator and the protein
// goal always use the latest number without asking twice.
//
// The trend line is a 7-day moving average: day-to-day weight swings by a
// kilo or more on water alone, so the raw points are drawn faint and the
// average is what's worth reading.

const WEIGHT_KEY = "weight";

function loadWeight() {
  try {
    const raw = JSON.parse(localStorage.getItem(WEIGHT_KEY) || "{}");
    return {
      log: raw.log && typeof raw.log === "object" ? raw.log : {},
      times: raw.times && typeof raw.times === "object" ? raw.times : {},
    };
  } catch {
    return { log: {}, times: {} };
  }
}

let weightData = loadWeight();

function saveWeight() {
  localStorage.setItem(WEIGHT_KEY, JSON.stringify(weightData));
}

function weightOn(date) {
  const v = Number(weightData.log[date]);
  return v > 0 ? v : null;
}

function weightDates() {
  return Object.keys(weightData.log).filter((d) => weightOn(d)).sort();
}

function latestWeight() {
  const dates = weightDates();
  if (!dates.length) return null;
  const date = dates[dates.length - 1];
  return { date, kg: weightOn(date) };
}

// Average of the logged weights in the 7 days ending on `date`.
function weightAvg7(date) {
  const vals = [];
  for (let i = 0; i < 7; i++) {
    const v = weightOn(addDays(date, -i));
    if (v) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function logWeight(kg, date = todayKey()) {
  const value = Math.round(Number(kg) * 10) / 10;
  if (!(value >= 25 && value <= 350)) return false;
  weightData.log[date] = value;
  weightData.times[date] = Date.now();
  saveWeight();
  // Keep the estimator's body weight current with the newest entry.
  const latest = latestWeight();
  if (typeof food !== "undefined" && latest && latest.date === date) {
    food.body.weight = value;
    if (typeof saveFood === "function") saveFood();
  }
  renderWeight();
  if (window.renderFood) window.renderFood();
  return true;
}

function fmtKg(v) {
  return `${v.toFixed(1)} kg`;
}

function weightChartSvg(days) {
  const today = todayKey();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const raw = dates.map((d) => weightOn(d));
  const avg = dates.map((d) => (weightOn(d) || dates.indexOf(d) > 0 ? weightAvg7(d) : null));
  const vals = [...raw, ...avg].filter((v) => v != null);
  if (vals.length < 2) return "";
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 2) {
    const mid = (hi + lo) / 2;
    lo = mid - 1;
    hi = mid + 1;
  }
  const W = 600;
  const H = 120;
  const pad = 8;
  const x = (i) => pad + (i / (days - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const dots = raw
    // Zero-length round-capped lines rather than circles: the SVG stretches
    // to the card's width (preserveAspectRatio none), which would squash
    // circles into ellipses; a non-scaling stroke stays round.
    .map((v, i) => {
      if (v == null) return "";
      const cx = x(i).toFixed(1);
      const cy = y(v).toFixed(1);
      return `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy}" class="weight-dot" vector-effect="non-scaling-stroke" />`;
    })
    .join("");
  const line = avg
    .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${line}" class="weight-line" vector-effect="non-scaling-stroke" />
      ${dots}
    </svg>
    <div class="weight-axis"><span>${hi.toFixed(1)}</span><span>${lo.toFixed(1)}</span></div>`;
}

function renderWeight() {
  const latestEl = document.getElementById("weight-latest");
  if (!latestEl) return;
  const latest = latestWeight();
  const input = document.getElementById("weight-input");
  const chart = document.getElementById("weight-chart");
  const caption = document.getElementById("weight-caption");
  const date = typeof fuelDate === "function" ? fuelDate() : todayKey();
  const onDay = weightOn(date);

  latestEl.textContent = latest ? fmtKg(latest.kg) : "—";
  if (input && document.activeElement !== input) {
    input.value = onDay ? onDay.toFixed(1) : "";
    input.placeholder = latest ? latest.kg.toFixed(1) : "kg";
  }
  const submit = document.getElementById("weight-submit");
  if (submit) submit.textContent = onDay ? "Update" : "Log weight";

  const count = weightDates().length;
  // Window: from the first entry (so a new log isn't squeezed into the
  // right third of the chart), at least 14 days, at most 90.
  const first = weightDates()[0];
  const span = first ? Math.round((new Date(`${todayKey()}T00:00:00`) - new Date(`${first}T00:00:00`)) / 86400000) + 1 : 14;
  chart.innerHTML = weightChartSvg(Math.max(14, Math.min(90, span)));
  chart.hidden = !chart.innerHTML;

  if (!count) {
    caption.textContent = "Log your weight each morning to see the trend here.";
    return;
  }
  const today = todayKey();
  const nowAvg = weightAvg7(today);
  const thenAvg = weightAvg7(addDays(today, -30));
  const bits = [];
  if (nowAvg) bits.push(`7-day average ${fmtKg(nowAvg)}`);
  if (nowAvg && thenAvg) {
    const delta = nowAvg - thenAvg;
    bits.push(`${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} kg in 30 days`);
  } else if (count < 3) {
    bits.push("a few more days and the trend line appears");
  }
  caption.textContent = bits.join(" · ");
}
window.renderWeight = renderWeight;
window.latestWeight = latestWeight;
window.logWeight = logWeight;
window.weightOn = weightOn;

document.getElementById("weight-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("weight-input");
  const value = parseFloat(String(input.value).replace(",", "."));
  const date = typeof fuelDate === "function" ? fuelDate() : todayKey();
  if (logWeight(value, date)) input.blur();
});

// Overview's "Logged today" feed.
window.TODAY_LOG_SOURCES = window.TODAY_LOG_SOURCES || [];
window.TODAY_LOG_SOURCES.push(() => {
  const kg = weightOn(todayKey());
  return kg ? [{ key: "fuel", section: "Weight", text: fmtKg(kg), at: weightData.times[todayKey()] || Date.now() }] : [];
});

renderWeight();
