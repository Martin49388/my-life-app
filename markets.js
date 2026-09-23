// Markets: a live watchlist dashboard.
//
// Layout, top to bottom (see #markets-section in index.html):
//   - Header: US market session (open / pre-market / after hours / closed,
//     computed locally from New York time — no API call, and market
//     holidays are NOT accounted for), and one hero number — the average
//     day move across the whole watchlist — with breadth / top mover /
//     laggard beside it.
//   - Heatmap: one tile per stock, tinted green/red by how far it moved
//     today. Tap a tile to open its detail modal.
//   - Watchlist: search-to-add, then one row per stock with its company
//     logo, a 30-day sparkline, live price and a day-change pill.
//   - Notes: the section's original free-text journal (journal.js).
//
// While the section is on screen and the market is in session (incl. pre-
// market and after hours), quotes refresh every minute; prices tween to
// their new value and flash green/red on a tick.
//
// The watchlist ("portfolio" in storage, kept for compatibility) only
// stores symbol/name; live price is always re-fetched, never cached across
// sessions, so nothing here can go stale.
//
// Two API keys, both entered in Settings -> "Markets stock lookup" and
// stored per device in localStorage (same pattern as the other client-side
// keys) — NOT in config.js. config.js is gitignored, so a key that only
// lives there is invisible on every other device (a phone opening the live
// GitHub Pages link, for instance). config.js is still checked as a
// fallback, purely for local dev convenience.
//   - Finnhub: search, live quotes, company profile (logo, exchange,
//     industry, market cap). Free tier: 60 calls/min. Does NOT serve
//     historical candles on the free plan (403s, confirmed directly).
//   - Twelve Data: daily closes for the sparklines and the modal chart.
//     Free tier serves CORS headers (confirmed directly) but is capped at
//     8 calls/min, so every call goes through tdThrottle() below, and
//     results are cached per browser session.
//
// Caches (profiles, price series) live in sessionStorage on purpose, not
// localStorage: sync.js pushes every localStorage key to Supabase, and
// there's no reason to sync throwaway API responses across devices.

const PORTFOLIO_KEY = "markets-portfolio";
const FINNHUB_KEY_STORAGE = "finnhub-api-key";
const TWELVEDATA_KEY_STORAGE = "twelvedata-api-key";
const MKT_REFRESH_MS = 60 * 1000;
const MKT_SERIES_TTL_MS = 30 * 60 * 1000;
const MKT_HEAT_FULL_AT = 3; // a 3% move (either way) gets the strongest tile tint

// script.js already declares a top-level `prefersReducedMotion`; classic
// scripts share one global scope, so this file needs its own name.
const mktReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function loadPortfolio() {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  return raw ? JSON.parse(raw) : [];
}

function savePortfolio(list) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
}

let portfolio = loadPortfolio();
const mktQuotes = new Map(); // symbol -> latest Finnhub quote, this page load only
let mktLastUpdated = null;
let mktJustAdded = null;

function finnhubKey() {
  return localStorage.getItem(FINNHUB_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.FINNHUB_API_KEY) || "";
}

function twelveDataKey() {
  return localStorage.getItem(TWELVEDATA_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.TWELVEDATA_API_KEY) || "";
}

function yahooUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

// ---------------------------------------------------------------------------
// Small helpers

function mktEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function mktUsd(n) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function mktSigned(n, digits = 2) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}`;
}

function mktTone(n) {
  if (!Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function setTone(el, tone) {
  el.classList.remove("tone-up", "tone-down", "tone-flat");
  if (tone) el.classList.add(`tone-${tone}`);
}

function mktCacheGet(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    if (ttlMs && Date.now() - at > ttlMs) return null;
    return value;
  } catch {
    return null;
  }
}

function mktCacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Storage full or unavailable — caching is only an optimisation.
  }
}

// Tweens a number element from the value it last showed to a new one.
// Tracks the raw number in data-value (formatted text like "−1.20%" or
// "$1,204.50" is awkward to parse back reliably).
function mktTween(el, to, format, duration = 500) {
  const from = parseFloat(el.dataset.value);
  el.dataset.value = String(to);
  const token = (el._mktTween = (el._mktTween || 0) + 1);
  if (mktReducedMotion || !Number.isFinite(from) || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  requestAnimationFrame(function tick(now) {
    if (el._mktTween !== token) return; // a newer tween took over
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  });
}

function mktFlash(el, tone) {
  if (mktReducedMotion || !el) return;
  el.classList.remove("flash-up", "flash-down");
  void el.offsetWidth; // restart the animation
  el.classList.add(tone === "down" ? "flash-down" : "flash-up");
}

// ---------------------------------------------------------------------------
// US market session, from New York wall-clock time. Regular hours
// 9:30–16:00 ET, pre-market from 4:00, after hours until 20:00. Holidays
// aren't known here, so on one it will claim the market is open.

function mktDuration(mins) {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

function marketSession(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = get("weekday");
  const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const PRE = 4 * 60;
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  const POST = 20 * 60;

  if (day === "Sat" || day === "Sun") {
    return { state: "closed", label: "Market closed", detail: "Opens Monday 9:30 ET" };
  }
  if (mins >= OPEN && mins < CLOSE) {
    return { state: "open", label: "Market open", detail: `Closes in ${mktDuration(CLOSE - mins)}` };
  }
  if (mins >= PRE && mins < OPEN) {
    return { state: "pre", label: "Pre-market", detail: `Opens in ${mktDuration(OPEN - mins)}` };
  }
  if (mins >= CLOSE && mins < POST) {
    return { state: "post", label: "After hours", detail: "Closed at 16:00 ET" };
  }
  if (mins < PRE) {
    return { state: "closed", label: "Market closed", detail: `Opens in ${mktDuration(OPEN - mins)}` };
  }
  return { state: "closed", label: "Market closed", detail: day === "Fri" ? "Opens Monday 9:30 ET" : "Opens 9:30 ET" };
}

function renderMarketStatus() {
  const wrap = document.getElementById("market-status");
  if (!wrap) return;
  const session = marketSession();
  wrap.dataset.state = session.state;
  document.getElementById("market-status-label").textContent = session.label;
  document.getElementById("market-status-detail").textContent = session.detail;
}

// ---------------------------------------------------------------------------
// Data: Finnhub

async function fetchQuote(symbol) {
  const key = finnhubKey();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Finnhub returns all-zero fields for a symbol it has no data for,
  // rather than an error — treat that as "no data" too.
  if (data.c == null || (data.c === 0 && data.pc === 0)) throw new Error("No data for this symbol");
  return data; // { c: price, d: change, dp: % change, h: day high, l: day low, o: open, pc: prev close }
}

async function fetchCompanyProfile(symbol) {
  const key = finnhubKey();
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Many ETFs etc. simply have no profile — remember that, don't retry.
  return data && data.name ? data : { none: true };
}

const mktProfileInflight = new Map();
function getProfile(symbol) {
  const cacheKey = `mkt-profile:${symbol}`;
  const cached = mktCacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);
  if (!finnhubKey()) return Promise.reject(new Error("No Finnhub key"));
  if (mktProfileInflight.has(symbol)) return mktProfileInflight.get(symbol);
  const pending = fetchCompanyProfile(symbol)
    .then((profile) => {
      mktCacheSet(cacheKey, profile);
      return profile;
    })
    .finally(() => mktProfileInflight.delete(symbol));
  mktProfileInflight.set(symbol, pending);
  return pending;
}

function formatMarketCap(millions) {
  if (!millions) return null;
  if (millions >= 1e6) return `$${(millions / 1e6).toFixed(2)}T`;
  if (millions >= 1e3) return `$${(millions / 1e3).toFixed(2)}B`;
  return `$${Math.round(millions)}M`;
}

// ---------------------------------------------------------------------------
// Data: Twelve Data (daily closes), rate-limited to its free tier.

const mktTdCalls = [];
async function tdThrottle() {
  for (;;) {
    const now = Date.now();
    while (mktTdCalls.length && now - mktTdCalls[0] > 61000) mktTdCalls.shift();
    if (mktTdCalls.length < 8) {
      mktTdCalls.push(now);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 61000 - (now - mktTdCalls[0]) + 50));
  }
}

// Oldest-to-newest [{ date: "YYYY-MM-DD", close }] for the last ~30 trading days.
async function fetchDailySeries(symbol) {
  const key = twelveDataKey();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=30&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error" || !Array.isArray(data.values)) throw new Error(data.message || "No chart data");
  const points = data.values
    .map((v) => ({ date: String(v.datetime).slice(0, 10), close: parseFloat(v.close) }))
    .filter((p) => Number.isFinite(p.close))
    .reverse();
  if (points.length < 2) throw new Error("Not enough chart data");
  return points;
}

const mktSeriesInflight = new Map();
function getSeries(symbol) {
  const cacheKey = `mkt-series:${symbol}`;
  const cached = mktCacheGet(cacheKey, MKT_SERIES_TTL_MS);
  if (cached) return Promise.resolve(cached);
  if (!twelveDataKey()) return Promise.reject(new Error("No Twelve Data key"));
  if (mktSeriesInflight.has(symbol)) return mktSeriesInflight.get(symbol);
  const pending = (async () => {
    await tdThrottle();
    const points = await fetchDailySeries(symbol);
    mktCacheSet(cacheKey, points);
    return points;
  })().finally(() => mktSeriesInflight.delete(symbol));
  mktSeriesInflight.set(symbol, pending);
  return pending;
}

// ---------------------------------------------------------------------------
// Sparklines — plain inline SVG, no chart library (same approach as the
// Overview ring). Stroke stays crisp at any stretch thanks to
// vector-effect; color comes from CSS via currentColor (.spark-up/down).

function sparkGeometry(closes, w, h, pad) {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (closes.length - 1 || 1);
  const coords = closes.map((c, i) => [pad + i * stepX, pad + (1 - (c - min) / range) * (h - pad * 2)]);
  return { min, max, stepX, coords };
}

function buildSparklineSvg(points, { w = 400, h = 140, pad = 6, className = "stock-sparkline" } = {}) {
  const closes = points.map((p) => p.close);
  const { coords } = sparkGeometry(closes, w, h, pad);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lastX = coords[coords.length - 1][0].toFixed(1);
  const area = `${pad},${h} ${line} ${lastX},${h}`;
  const tone = closes[closes.length - 1] < closes[0] ? "down" : "up";
  return `
    <svg viewBox="0 0 ${w} ${h}" class="${className} spark-${tone}" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="spark-area" points="${area}" />
      <polyline class="spark-line" points="${line}" vector-effect="non-scaling-stroke" />
    </svg>`;
}

// ---------------------------------------------------------------------------
// Search (adds straight to the watchlist)

const searchInput = document.getElementById("stock-search-input");
const searchBtn = document.getElementById("stock-search-btn");
const searchStatus = document.getElementById("stock-search-status");

function setSearchStatus(text, { gotoSettings = false } = {}) {
  searchStatus.textContent = text;
  searchStatus.hidden = !text;
  searchStatus.classList.toggle("stock-search-status-link", gotoSettings);
  searchStatus.onclick = gotoSettings ? () => window.switchSection && window.switchSection("settings") : null;
}

// Resolves the query to a single stock via Finnhub's search endpoint (its
// top match is reliably the right one for a plain ticker or company name —
// see e.g. searching "GM" or "general motors") and adds it straight to the
// watchlist. A query that mixes both, like "GM general motors", finds
// nothing on Finnhub's end either — that's reported explicitly instead of
// failing silently.
async function searchStocks(query) {
  const key = finnhubKey();
  if (!key) {
    setSearchStatus("No Finnhub key set — tap here to add one in Settings.", { gotoSettings: true });
    return;
  }

  setSearchStatus("Searching…");

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const match = (data.result || []).find((m) => m.type === "Common Stock");

    if (!match) {
      setSearchStatus(`No match found for "${query}" — try just the ticker or company name.`);
      return;
    }

    if (portfolio.some((p) => p.symbol === match.symbol)) {
      setSearchStatus(`${match.symbol} is already on your watchlist.`);
      return;
    }

    addToPortfolio(match.symbol, match.description);
    setSearchStatus(`Added ${match.symbol} — ${match.description}.`);
    searchInput.value = "";
  } catch (err) {
    setSearchStatus("Search failed — try again.");
  }
}

function submitSearch() {
  const query = searchInput.value.trim();
  if (query) searchStocks(query);
}

searchBtn.addEventListener("click", submitSearch);
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitSearch();
  }
});

function addToPortfolio(symbol, name) {
  if (portfolio.some((p) => p.symbol === symbol)) return;
  portfolio.push({ symbol, name });
  savePortfolio(portfolio);
  mktJustAdded = symbol;
  renderPortfolio();
}

function removeFromPortfolio(symbol) {
  portfolio = portfolio.filter((p) => p.symbol !== symbol);
  mktQuotes.delete(symbol);
  savePortfolio(portfolio);
  renderPortfolio();
}

// ---------------------------------------------------------------------------
// Logos: load the image off-DOM first and only swap it in once it has
// actually loaded, so a missing/blocked logo just leaves the monogram.

function hydrateLogo(logoEl, symbol) {
  if (!logoEl) return;
  getProfile(symbol)
    .then((profile) => {
      if (!profile.logo) return;
      const img = new Image();
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        if (!logoEl.isConnected) return;
        logoEl.replaceChildren(img);
        logoEl.classList.add("has-logo");
      };
      img.src = profile.logo;
    })
    .catch(() => {});
}

function logoHtml(symbol, extraClass = "") {
  return `<span class="stock-logo ${extraClass}" aria-hidden="true"><span class="stock-monogram">${mktEsc(symbol.charAt(0))}</span></span>`;
}

// ---------------------------------------------------------------------------
// Hero (header) summary

function renderHero() {
  const numberEl = document.getElementById("markets-hero-number");
  if (!numberEl) return;
  const captionEl = document.getElementById("markets-hero-caption");
  const breadthEl = document.getElementById("markets-breadth");
  const bestEl = document.getElementById("markets-best");
  const worstEl = document.getElementById("markets-worst");

  const moves = portfolio
    .map((p) => ({ symbol: p.symbol, dp: mktQuotes.get(p.symbol)?.dp }))
    .filter((m) => Number.isFinite(m.dp));

  captionEl.onclick = null;
  captionEl.classList.remove("stock-search-status-link");

  if (!moves.length) {
    numberEl.textContent = "—";
    numberEl.dataset.value = "";
    setTone(numberEl, null);
    breadthEl.textContent = "—";
    bestEl.textContent = "—";
    worstEl.textContent = "—";
    setTone(bestEl, null);
    setTone(worstEl, null);
    if (!portfolio.length) {
      captionEl.textContent = "Add a stock below to start tracking";
    } else if (!finnhubKey()) {
      captionEl.textContent = "Add a Finnhub key in Settings for live prices";
      captionEl.classList.add("stock-search-status-link");
      captionEl.onclick = () => window.switchSection && window.switchSection("settings");
    } else {
      captionEl.textContent = "Loading prices…";
    }
    return;
  }

  const avg = moves.reduce((sum, m) => sum + m.dp, 0) / moves.length;
  mktTween(numberEl, avg, (n) => `${mktSigned(n)}%`);
  setTone(numberEl, mktTone(avg));
  captionEl.textContent = `Avg. move today · ${moves.length} ${moves.length === 1 ? "stock" : "stocks"}`;

  const up = moves.filter((m) => m.dp > 0).length;
  const down = moves.filter((m) => m.dp < 0).length;
  breadthEl.textContent = `${up} up · ${down} down`;

  const sorted = [...moves].sort((a, b) => b.dp - a.dp);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  bestEl.textContent = `${best.symbol} ${mktSigned(best.dp)}%`;
  setTone(bestEl, mktTone(best.dp));
  if (moves.length > 1) {
    worstEl.textContent = `${worst.symbol} ${mktSigned(worst.dp)}%`;
    setTone(worstEl, mktTone(worst.dp));
  } else {
    worstEl.textContent = "—";
    setTone(worstEl, null);
  }
}

function renderUpdatedLabel() {
  const el = document.getElementById("markets-updated");
  if (!el) return;
  if (!mktLastUpdated || !portfolio.length) {
    el.textContent = "";
    return;
  }
  const time = mktLastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const live = marketSession().state !== "closed";
  el.textContent = live ? `Updated ${time} · refreshes every minute` : `Updated ${time}`;
}

// ---------------------------------------------------------------------------
// Heatmap tiles

function renderHeatmap() {
  const wrap = document.getElementById("markets-heatmap");
  if (!wrap) return;
  wrap.hidden = portfolio.length === 0;
  wrap.innerHTML = portfolio
    .map(
      (p) => `
      <button type="button" class="heat-tile" data-symbol="${mktEsc(p.symbol)}" aria-label="${mktEsc(p.symbol)} details">
        <span class="heat-ticker">${mktEsc(p.symbol)}</span>
        <span class="heat-change">—</span>
      </button>`
    )
    .join("");
  wrap.querySelectorAll(".heat-tile").forEach((tile, i) => {
    const { symbol, name } = portfolio[i];
    tile.addEventListener("click", () => openStockModal(symbol, name));
    const q = mktQuotes.get(symbol);
    if (q) paintTile(tile, q);
  });
}

function paintTile(tile, q) {
  const dp = Number.isFinite(q.dp) ? q.dp : 0;
  const tone = mktTone(dp);
  tile.classList.remove("heat-up", "heat-down");
  if (tone !== "flat") tile.classList.add(`heat-${tone}`);
  tile.style.setProperty("--heat", Math.min(1, Math.abs(dp) / MKT_HEAT_FULL_AT).toFixed(3));
  tile.querySelector(".heat-change").textContent = `${mktSigned(dp)}%`;
}

// ---------------------------------------------------------------------------
// Watchlist rows

function rowFor(symbol) {
  return document.querySelector(`#portfolio-list .stock-row[data-symbol="${CSS.escape(symbol)}"]`);
}

function tileFor(symbol) {
  return document.querySelector(`#markets-heatmap .heat-tile[data-symbol="${CSS.escape(symbol)}"]`);
}

function paintRowQuote(symbol, q, prev) {
  const row = rowFor(symbol);
  if (!row) return;
  const priceEl = row.querySelector(".stock-price");
  const chipEl = row.querySelector(".stock-chip");
  mktTween(priceEl, q.c, mktUsd);
  const dp = Number.isFinite(q.dp) ? q.dp : 0;
  chipEl.textContent = `${mktSigned(dp)}%`;
  setTone(chipEl, mktTone(dp));
  if (prev && prev.c !== q.c) {
    mktFlash(row.querySelector(".stock-quote"), q.c < prev.c ? "down" : "up");
  }
}

function paintRowMessage(symbol, text) {
  const row = rowFor(symbol);
  if (!row) return;
  const priceEl = row.querySelector(".stock-price");
  priceEl.textContent = "—";
  priceEl.dataset.value = "";
  const chipEl = row.querySelector(".stock-chip");
  chipEl.textContent = text;
  setTone(chipEl, null);
}

function hydrateRowSpark(symbol) {
  const row = rowFor(symbol);
  const slot = row?.querySelector(".stock-spark");
  if (!slot || !twelveDataKey()) return;
  getSeries(symbol)
    .then((points) => {
      if (!slot.isConnected) return;
      slot.innerHTML = buildSparklineSvg(points, { w: 120, h: 36, pad: 3, className: "row-sparkline" });
    })
    .catch(() => {
      // Rate-limited or unsupported symbol — the row just goes without one.
    });
}

function renderPortfolio() {
  const list = document.getElementById("portfolio-list");
  if (!list) return;

  renderHeatmap();

  if (portfolio.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing on your watchlist yet — add a ticker above.</li>`;
    renderHero();
    renderUpdatedLabel();
    return;
  }

  list.innerHTML = portfolio
    .map(
      (p) => `
      <li class="stock-row${p.symbol === mktJustAdded ? " stock-row-enter" : ""}" data-symbol="${mktEsc(p.symbol)}">
        <button type="button" class="stock-row-main" aria-label="${mktEsc(p.symbol)} details">
          ${logoHtml(p.symbol)}
          <span class="stock-id">
            <span class="stock-ticker">${mktEsc(p.symbol)}</span>
            <span class="stock-name">${mktEsc(p.name)}</span>
          </span>
          <span class="stock-spark"></span>
          <span class="stock-quote">
            <span class="stock-price">—</span>
            <span class="stock-chip">…</span>
          </span>
        </button>
        <button type="button" class="delete-btn portfolio-remove" data-symbol="${mktEsc(p.symbol)}" aria-label="Remove ${mktEsc(p.symbol)} from watchlist">&#10005;</button>
      </li>`
    )
    .join("");
  mktJustAdded = null;

  list.querySelectorAll(".stock-row").forEach((row, i) => {
    const { symbol, name } = portfolio[i];
    row.querySelector(".stock-row-main").addEventListener("click", () => openStockModal(symbol, name));
    row.querySelector(".portfolio-remove").addEventListener("click", () => removeFromPortfolio(symbol));
    hydrateLogo(row.querySelector(".stock-logo"), symbol);
    const known = mktQuotes.get(symbol);
    if (known) paintRowQuote(symbol, known);
    else if (!finnhubKey()) paintRowMessage(symbol, "No key");
    hydrateRowSpark(symbol);
  });

  renderHero();
  refreshQuotes();
}

let mktRefreshing = false;
async function refreshQuotes() {
  renderMarketStatus();
  if (mktRefreshing || !finnhubKey() || portfolio.length === 0) {
    renderHero();
    renderUpdatedLabel();
    return;
  }
  mktRefreshing = true;
  let anySucceeded = false;
  await Promise.allSettled(
    portfolio.map((p) =>
      fetchQuote(p.symbol).then(
        (q) => {
          anySucceeded = true;
          const prev = mktQuotes.get(p.symbol);
          mktQuotes.set(p.symbol, q);
          paintRowQuote(p.symbol, q, prev);
          const tile = tileFor(p.symbol);
          if (tile) {
            paintTile(tile, q);
            if (prev && prev.c !== q.c) mktFlash(tile, q.c < prev.c ? "down" : "up");
          }
          renderHero();
        },
        () => {
          if (!mktQuotes.has(p.symbol)) paintRowMessage(p.symbol, "No price");
        }
      )
    )
  );
  mktRefreshing = false;
  if (anySucceeded) mktLastUpdated = new Date();
  renderHero();
  renderUpdatedLabel();
  if (window.renderBriefing) window.renderBriefing();
}

// Read-only summary for Overview's briefing card (overview.js).
window.marketsSummary = function marketsSummary() {
  const moves = portfolio
    .map((p) => ({ symbol: p.symbol, dp: mktQuotes.get(p.symbol)?.dp }))
    .filter((m) => Number.isFinite(m.dp))
    .sort((a, b) => b.dp - a.dp);
  const avg = moves.length ? moves.reduce((sum, m) => sum + m.dp, 0) / moves.length : null;
  return {
    watching: portfolio.length,
    priced: moves.length,
    avg,
    up: moves.filter((m) => m.dp > 0).length,
    down: moves.filter((m) => m.dp < 0).length,
    best: moves[0] || null,
    worst: moves.length > 1 ? moves[moves.length - 1] : null,
    session: marketSession(),
    hasKey: Boolean(finnhubKey()),
    signed: mktSigned,
    tone: mktTone,
  };
};

// Live refresh: once a minute, only while Markets is actually on screen,
// the tab is visible, and US trading (incl. pre/after hours) is happening.
setInterval(() => {
  renderMarketStatus();
  const section = document.getElementById("markets-section");
  if (!section || section.closest("[hidden]") || document.hidden) return;
  if (marketSession().state === "closed") {
    renderUpdatedLabel();
    return;
  }
  refreshQuotes();
}, MKT_REFRESH_MS);

document.addEventListener("visibilitychange", () => {
  const section = document.getElementById("markets-section");
  if (!document.hidden && section && !section.closest("[hidden]")) refreshQuotes();
});

// Called by script.js's switchSection() whenever Markets is opened.
window.refreshMarkets = refreshQuotes;

// ---------------------------------------------------------------------------
// Detail modal

const stockModalOverlay = document.getElementById("stock-modal-overlay");
const stockModalLogo = document.getElementById("stock-modal-logo");
const stockModalTitle = document.getElementById("stock-modal-title");
const stockModalName = document.getElementById("stock-modal-name");
const stockModalPrice = document.getElementById("stock-modal-price");
const stockModalChange = document.getElementById("stock-modal-change");
const stockModalChartHead = document.getElementById("stock-modal-chart-head");
const stockModalChart = document.getElementById("stock-modal-chart");
const stockModalRange = document.getElementById("stock-modal-range");
const stockModalInfo = document.getElementById("stock-modal-info");
const stockModalYahooLink = document.getElementById("stock-modal-yahoo-link");

let modalSymbol = null;
let modalStats = {};

function closeStockModal() {
  stockModalOverlay.hidden = true;
  modalSymbol = null;
}

document.getElementById("stock-modal-close").addEventListener("click", closeStockModal);
stockModalOverlay.addEventListener("click", (e) => {
  if (e.target.id === "stock-modal-overlay") closeStockModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !stockModalOverlay.hidden) closeStockModal();
});

const MODAL_STAT_ORDER = ["Open", "Prev close", "Market cap", "Industry", "Exchange", "IPO"];

function renderModalStats() {
  const entries = MODAL_STAT_ORDER.filter((label) => modalStats[label]);
  stockModalInfo.replaceChildren(
    ...entries.map((label) => {
      const cell = document.createElement("div");
      cell.className = "stock-stat";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = modalStats[label];
      cell.append(dt, dd);
      return cell;
    })
  );
}

function renderModalRange(q) {
  if (!Number.isFinite(q.h) || !Number.isFinite(q.l) || q.h <= q.l) {
    stockModalRange.hidden = true;
    return;
  }
  const pos = Math.min(100, Math.max(0, ((q.c - q.l) / (q.h - q.l)) * 100));
  document.getElementById("stock-range-low").textContent = mktUsd(q.l);
  document.getElementById("stock-range-high").textContent = mktUsd(q.h);
  document.getElementById("stock-range-marker").style.left = `${pos}%`;
  stockModalRange.hidden = false;
}

function paintModalQuote(q) {
  mktTween(stockModalPrice, q.c, mktUsd);
  const d = Number.isFinite(q.d) ? q.d : 0;
  const dp = Number.isFinite(q.dp) ? q.dp : 0;
  stockModalChange.textContent = `${mktSigned(d)} (${mktSigned(dp)}%) today`;
  setTone(stockModalChange, mktTone(dp));
  stockModalChange.hidden = false;
  renderModalRange(q);
  if (Number.isFinite(q.o) && q.o) modalStats.Open = mktUsd(q.o);
  if (Number.isFinite(q.pc) && q.pc) modalStats["Prev close"] = mktUsd(q.pc);
  renderModalStats();
}

function setChartStatus(text, onClick) {
  stockModalChartHead.hidden = true;
  stockModalChart.innerHTML = "";
  const p = document.createElement("p");
  p.className = "stock-modal-chart-status";
  p.textContent = text;
  if (onClick) {
    p.classList.add("stock-search-status-link");
    p.addEventListener("click", onClick);
  }
  stockModalChart.append(p);
}

function renderModalChart(points) {
  const closes = points.map((p) => p.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = ((last - first) / first) * 100;

  stockModalChartHead.hidden = false;
  document.getElementById("stock-chart-period").textContent = `${points.length} trading days`;
  const changeEl = document.getElementById("stock-chart-change");
  changeEl.textContent = `${mktSigned(change)}%`;
  setTone(changeEl, mktTone(change));
  document.getElementById("stock-chart-extremes").textContent = `H ${mktUsd(Math.max(...closes))} · L ${mktUsd(Math.min(...closes))}`;

  const W = 400;
  const H = 140;
  const PAD = 6;
  stockModalChart.innerHTML = `
    ${buildSparklineSvg(points, { w: W, h: H, pad: PAD })}
    <span class="chart-cursor" hidden></span>
    <span class="chart-dot" hidden></span>
    <span class="chart-tip" hidden></span>`;

  // Scrub: drag/hover across the chart to read any day's close.
  const svg = stockModalChart.querySelector("svg");
  const cursor = stockModalChart.querySelector(".chart-cursor");
  const dot = stockModalChart.querySelector(".chart-dot");
  const tip = stockModalChart.querySelector(".chart-tip");
  const { coords, stepX } = sparkGeometry(closes, W, H, PAD);

  function show(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const vx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((vx - PAD) / stepX)));
    const [x, y] = coords[i];
    const left = (x / W) * 100;
    const top = (y / H) * 100;
    cursor.style.left = `${left}%`;
    dot.style.left = `${left}%`;
    dot.style.top = `${top}%`;
    tip.style.left = `${Math.min(84, Math.max(16, left))}%`;
    const date = new Date(`${points[i].date}T00:00:00`);
    const dateText = Number.isNaN(date.getTime()) ? points[i].date : date.toLocaleDateString([], { month: "short", day: "numeric" });
    tip.textContent = `${dateText} · ${mktUsd(points[i].close)}`;
    cursor.hidden = dot.hidden = tip.hidden = false;
  }

  function hide() {
    cursor.hidden = dot.hidden = tip.hidden = true;
  }

  svg.addEventListener("pointermove", (e) => show(e.clientX));
  svg.addEventListener("pointerdown", (e) => show(e.clientX));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("pointercancel", hide);
}

function openStockModal(symbol, name) {
  modalSymbol = symbol;
  modalStats = {};
  const stillOpen = () => modalSymbol === symbol && !stockModalOverlay.hidden;

  stockModalLogo.className = "stock-logo stock-logo-lg";
  stockModalLogo.innerHTML = `<span class="stock-monogram">${mktEsc(symbol.charAt(0))}</span>`;
  stockModalTitle.textContent = symbol;
  stockModalName.textContent = name || "";
  stockModalPrice.textContent = "—";
  stockModalPrice.dataset.value = "";
  stockModalChange.hidden = true;
  stockModalRange.hidden = true;
  stockModalChartHead.hidden = true;
  stockModalChart.innerHTML = "";
  stockModalInfo.replaceChildren();
  stockModalYahooLink.href = yahooUrl(symbol);
  stockModalOverlay.hidden = false;

  if (!finnhubKey()) {
    setChartStatus("No Finnhub key set — tap here to add one in Settings.", () => {
      closeStockModal();
      window.switchSection && window.switchSection("settings");
    });
    return;
  }

  const known = mktQuotes.get(symbol);
  if (known) paintModalQuote(known);
  fetchQuote(symbol)
    .then((q) => {
      mktQuotes.set(symbol, q);
      if (stillOpen()) paintModalQuote(q);
    })
    .catch(() => {
      if (stillOpen() && !known) stockModalPrice.textContent = "Price unavailable";
    });

  hydrateLogo(stockModalLogo, symbol);
  getProfile(symbol)
    .then((profile) => {
      if (!stillOpen() || profile.none) return;
      if (!name && profile.name) stockModalName.textContent = profile.name;
      const cap = formatMarketCap(profile.marketCapitalization);
      if (cap) modalStats["Market cap"] = cap;
      if (profile.finnhubIndustry) modalStats.Industry = profile.finnhubIndustry;
      // "NASDAQ NMS - GLOBAL MARKET" -> "NASDAQ"; "NEW YORK STOCK EXCHANGE, INC." -> "NEW YORK STOCK EXCHANGE"
      if (profile.exchange) modalStats.Exchange = profile.exchange.replace(/,.*$/, "").replace(/\s+NMS\b.*$/, "");
      if (profile.ipo) modalStats.IPO = String(profile.ipo).slice(0, 4);
      renderModalStats();
    })
    .catch(() => {});

  if (!twelveDataKey()) {
    setChartStatus("No Twelve Data key set — tap here to add one in Settings for the price chart.", () => {
      closeStockModal();
      window.switchSection && window.switchSection("settings");
    });
    return;
  }

  setChartStatus("Loading chart…");
  getSeries(symbol)
    .then((points) => {
      if (stillOpen()) renderModalChart(points);
    })
    .catch(() => {
      if (stillOpen()) setChartStatus("Chart unavailable for this symbol right now.");
    });
}

// ---------------------------------------------------------------------------
// Settings -> "Markets stock lookup"

const finnhubForm = document.getElementById("finnhub-config-form");
const finnhubInput = document.getElementById("finnhub-key-input");
const twelveDataInput = document.getElementById("twelvedata-key-input");
const finnhubKeyStatus = document.getElementById("finnhub-key-status");

function renderFinnhubKeyStatus() {
  const finnKey = localStorage.getItem(FINNHUB_KEY_STORAGE);
  const tdKey = localStorage.getItem(TWELVEDATA_KEY_STORAGE);
  finnhubInput.value = finnKey || "";
  twelveDataInput.value = tdKey || "";
  if (finnKey && tdKey) finnhubKeyStatus.textContent = "Both keys saved on this device.";
  else if (finnKey) finnhubKeyStatus.textContent = "Finnhub key saved — no Twelve Data key yet (charts won't load).";
  else if (tdKey) finnhubKeyStatus.textContent = "Twelve Data key saved — no Finnhub key yet (search/prices won't load).";
  else finnhubKeyStatus.textContent = "Not set on this device";
}

if (finnhubForm) {
  finnhubForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const finnValue = finnhubInput.value.trim();
    const tdValue = twelveDataInput.value.trim();
    if (finnValue) localStorage.setItem(FINNHUB_KEY_STORAGE, finnValue);
    else localStorage.removeItem(FINNHUB_KEY_STORAGE);
    if (tdValue) localStorage.setItem(TWELVEDATA_KEY_STORAGE, tdValue);
    else localStorage.removeItem(TWELVEDATA_KEY_STORAGE);
    renderFinnhubKeyStatus();
    renderPortfolio(); // rows were showing "no key" — refresh now that one's set
  });
  renderFinnhubKeyStatus();
}

renderMarketStatus();
renderPortfolio();
