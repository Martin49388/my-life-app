// Markets: stock search (Finnhub, free tier) plus a persistent "portfolio"
// watchlist. Searching resolves the query to a stock and drops it straight
// into the portfolio below — no separate pick-a-result step. Portfolio
// only ever stores symbol/name; live price is re-fetched fresh every
// render, so there's nothing here to go stale. Tapping a stock in the
// portfolio opens a modal with its price, basic info, and a price chart —
// no need to leave the app; the Yahoo Finance link is still there inside
// the modal for anyone who wants the full site.
//
// Two API keys, both entered in Settings -> "Markets stock lookup" and
// stored per device in localStorage (same pattern as Cross-device sync's
// fields) — NOT in config.js. config.js is gitignored, so it only ever
// exists on whichever machine someone happens to edit it on; a key that
// only lives there is invisible on every other device (a phone opening
// the live GitHub Pages link, for instance), which is why an earlier
// version of this feature "didn't work" for Martin even after adding a
// real key. config.js is still checked as a fallback, purely for local
// dev convenience.
//   - Finnhub: search + live quotes. Its free tier also covers company
//     profile info (exchange, industry, market cap) but NOT historical
//     candles — that endpoint 403s on the free plan (confirmed directly),
//     so it can't draw a chart on its own.
//   - Twelve Data: daily price history for the chart only. Free tier,
//     and unlike Finnhub/most providers it explicitly serves CORS headers
//     for direct browser use (confirmed directly), so no proxy needed.

const PORTFOLIO_KEY = "markets-portfolio";
const FINNHUB_KEY_STORAGE = "finnhub-api-key";
const TWELVEDATA_KEY_STORAGE = "twelvedata-api-key";

function loadPortfolio() {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  return raw ? JSON.parse(raw) : [];
}

function savePortfolio(list) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
}

let portfolio = loadPortfolio();

function finnhubKey() {
  return localStorage.getItem(FINNHUB_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.FINNHUB_API_KEY) || "";
}

function twelveDataKey() {
  return localStorage.getItem(TWELVEDATA_KEY_STORAGE) || (window.APP_CONFIG && window.APP_CONFIG.TWELVEDATA_API_KEY) || "";
}

function yahooUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

async function fetchQuote(symbol) {
  const key = finnhubKey();
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Finnhub returns all-zero fields for a symbol it has no data for,
  // rather than an error — treat that as "no data" too.
  if (data.c == null || (data.c === 0 && data.pc === 0)) throw new Error("No data for this symbol");
  return data; // { c: price, d: change, dp: percent change, pc: previous close }
}

function formatQuote(q) {
  const sign = q.d > 0 ? "+" : "";
  return { price: `$${q.c.toFixed(2)}`, change: `${sign}${q.d.toFixed(2)} (${sign}${q.dp.toFixed(2)}%)`, down: q.d < 0 };
}

async function fetchCompanyProfile(symbol) {
  const key = finnhubKey();
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !data.name) throw new Error("No profile for this symbol");
  return data;
}

function formatMarketCap(millions) {
  if (!millions) return null;
  if (millions >= 1e6) return `$${(millions / 1e6).toFixed(2)}T`;
  if (millions >= 1e3) return `$${(millions / 1e3).toFixed(2)}B`;
  return `$${Math.round(millions)}M`;
}

// Oldest-to-newest daily closes for the last ~30 trading days.
async function fetchDailySeries(symbol) {
  const key = twelveDataKey();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=30&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error" || !Array.isArray(data.values)) throw new Error(data.message || "No chart data");
  return data.values.map((v) => parseFloat(v.close)).reverse();
}

// Plain SVG sparkline — no chart library, matches the app's existing
// inline-SVG pattern (see the Overview ring). Colored red only when the
// period closed lower than it opened, same "down" signal as elsewhere in
// Markets (.stock-down); otherwise the app's normal accent color.
function buildSparklineSvg(closes) {
  const w = 400;
  const h = 120;
  const pad = 6;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (closes.length - 1 || 1);

  const points = closes
    .map((c, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (c - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const down = closes[closes.length - 1] < closes[0];
  const color = down ? "var(--danger)" : "var(--accent)";

  return `
    <svg viewBox="0 0 ${w} ${h}" class="stock-sparkline" preserveAspectRatio="none">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`;
}

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
// portfolio. A query that mixes both, like "GM general motors", finds
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
      setSearchStatus(`${match.symbol} is already in your portfolio.`);
      return;
    }

    addToPortfolio(match.symbol, match.description);
    setSearchStatus(`Added ${match.symbol} — ${match.description} to your portfolio.`);
    searchInput.value = "";
  } catch (err) {
    setSearchStatus("Search failed — try again.");
  }
}

searchBtn.addEventListener("click", () => {
  const query = searchInput.value.trim();
  if (query) searchStocks(query);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query) searchStocks(query);
  }
});

function addToPortfolio(symbol, name) {
  if (portfolio.some((p) => p.symbol === symbol)) return;
  portfolio.push({ symbol, name });
  savePortfolio(portfolio);
  renderPortfolio();
}

function removeFromPortfolio(symbol) {
  portfolio = portfolio.filter((p) => p.symbol !== symbol);
  savePortfolio(portfolio);
  renderPortfolio();
}

const stockModalOverlay = document.getElementById("stock-modal-overlay");
const stockModalTitle = document.getElementById("stock-modal-title");
const stockModalPrice = document.getElementById("stock-modal-price");
const stockModalChart = document.getElementById("stock-modal-chart");
const stockModalInfo = document.getElementById("stock-modal-info");
const stockModalYahooLink = document.getElementById("stock-modal-yahoo-link");

function closeStockModal() {
  stockModalOverlay.hidden = true;
}

document.getElementById("stock-modal-close").addEventListener("click", closeStockModal);
stockModalOverlay.addEventListener("click", (e) => {
  if (e.target.id === "stock-modal-overlay") closeStockModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !stockModalOverlay.hidden) closeStockModal();
});

function openStockModal(symbol, name) {
  stockModalTitle.textContent = `${symbol} — ${name}`;
  stockModalPrice.textContent = "Loading…";
  stockModalPrice.classList.remove("stock-down");
  stockModalChart.innerHTML = "";
  stockModalInfo.innerHTML = "";
  stockModalYahooLink.href = yahooUrl(symbol);
  stockModalOverlay.hidden = false;

  if (!finnhubKey()) {
    stockModalPrice.textContent = "No Finnhub key set — add one in Settings.";
    return;
  }

  fetchQuote(symbol)
    .then((q) => {
      const { price, change, down } = formatQuote(q);
      stockModalPrice.textContent = `${price} ${change}`;
      stockModalPrice.classList.toggle("stock-down", down);
    })
    .catch(() => {
      stockModalPrice.textContent = "Price unavailable";
    });

  fetchCompanyProfile(symbol)
    .then((profile) => {
      const rows = [];
      if (profile.exchange) rows.push(["Exchange", profile.exchange]);
      if (profile.finnhubIndustry) rows.push(["Industry", profile.finnhubIndustry]);
      const cap = formatMarketCap(profile.marketCapitalization);
      if (cap) rows.push(["Market cap", cap]);
      stockModalInfo.innerHTML = rows
        .map(([label, value]) => `<li class="journal-row"><p class="journal-text">${label}</p><p class="journal-time"></p></li>`)
        .join("");
      stockModalInfo.querySelectorAll(".journal-row").forEach((row, i) => {
        row.querySelector(".journal-time").textContent = rows[i][1];
      });
    })
    .catch(() => {
      // No profile data for this symbol — leave the info list empty, not an error.
    });

  if (!twelveDataKey()) {
    stockModalChart.innerHTML = `<p class="stock-search-status-link stock-modal-chart-status" id="stock-modal-chart-status">No Twelve Data key set — tap here to add one in Settings for the price chart.</p>`;
    document.getElementById("stock-modal-chart-status").addEventListener("click", () => {
      closeStockModal();
      window.switchSection && window.switchSection("settings");
    });
    return;
  }

  stockModalChart.innerHTML = `<p class="stock-modal-chart-status">Loading chart…</p>`;
  fetchDailySeries(symbol)
    .then((closes) => {
      stockModalChart.innerHTML = buildSparklineSvg(closes);
    })
    .catch(() => {
      stockModalChart.innerHTML = `<p class="stock-modal-chart-status">Chart unavailable.</p>`;
    });
}

function renderPortfolio() {
  const list = document.getElementById("portfolio-list");
  if (!list) return;

  if (portfolio.length === 0) {
    list.innerHTML = `<li class="empty-state">Nothing on your watchlist yet — add one from the search above.</li>`;
    return;
  }

  list.innerHTML = portfolio
    .map(
      (p) => `
      <li class="journal-row portfolio-row" data-symbol="${p.symbol}">
        <div class="journal-row-body">
          <button type="button" class="portfolio-symbol"></button>
          <p class="journal-time portfolio-price">Loading…</p>
        </div>
        <button type="button" class="delete-btn portfolio-remove" data-symbol="${p.symbol}" aria-label="Remove from portfolio">&#10005;</button>
      </li>`
    )
    .join("");

  list.querySelectorAll(".portfolio-row").forEach((row, i) => {
    const { symbol, name } = portfolio[i];
    const symbolBtn = row.querySelector(".portfolio-symbol");
    symbolBtn.textContent = `${symbol} — ${name}`;
    symbolBtn.addEventListener("click", () => openStockModal(symbol, name));
  });

  list.querySelectorAll(".portfolio-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeFromPortfolio(btn.dataset.symbol));
  });

  if (!finnhubKey()) {
    list.querySelectorAll(".portfolio-price").forEach((el) => (el.textContent = "No key configured"));
    return;
  }

  portfolio.forEach((p) => {
    const row = list.querySelector(`.portfolio-row[data-symbol="${CSS.escape(p.symbol)}"]`);
    const priceEl = row?.querySelector(".portfolio-price");
    if (!priceEl) return;
    fetchQuote(p.symbol)
      .then((q) => {
        const { price, change, down } = formatQuote(q);
        priceEl.textContent = `${price} ${change}`;
        priceEl.classList.toggle("stock-down", down);
      })
      .catch(() => {
        priceEl.textContent = "Price unavailable";
      });
  });
}

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
    renderPortfolio(); // prices were showing "no key" — refresh now that one's set
  });
  renderFinnhubKeyStatus();
}

renderPortfolio();
