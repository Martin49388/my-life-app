// Markets: stock search (Finnhub, free tier) plus a persistent "portfolio"
// watchlist. Searching resolves the query to a stock and drops it straight
// into the portfolio below — no separate pick-a-result step. Portfolio
// only ever stores symbol/name; live price is re-fetched fresh every
// render, so there's nothing here to go stale. Each row links out to
// Yahoo Finance for the full picture — this app only ever shows a quick
// glance.
//
// The Finnhub key lives in Settings -> "Markets stock lookup", stored per
// device in localStorage (same pattern as Cross-device sync's fields) —
// NOT in config.js. config.js is gitignored, so it only ever exists on
// whichever machine someone happens to edit it on; a key that only lives
// there is invisible on every other device (a phone opening the live
// GitHub Pages link, for instance), which is why an earlier version of
// this feature "didn't work" for Martin even after adding a real key.
// config.js is still checked as a fallback, purely for local dev
// convenience.

const PORTFOLIO_KEY = "markets-portfolio";
const FINNHUB_KEY_STORAGE = "finnhub-api-key";

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
          <a class="portfolio-symbol" href="${yahooUrl(p.symbol)}" target="_blank" rel="noopener noreferrer"></a>
          <p class="journal-time portfolio-price">Loading…</p>
        </div>
        <button type="button" class="delete-btn portfolio-remove" data-symbol="${p.symbol}" aria-label="Remove from portfolio">&#10005;</button>
      </li>`
    )
    .join("");

  list.querySelectorAll(".portfolio-row").forEach((row, i) => {
    row.querySelector(".portfolio-symbol").textContent = `${portfolio[i].symbol} — ${portfolio[i].name}`;
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
const finnhubKeyStatus = document.getElementById("finnhub-key-status");

function renderFinnhubKeyStatus() {
  const key = localStorage.getItem(FINNHUB_KEY_STORAGE);
  finnhubInput.value = key || "";
  finnhubKeyStatus.textContent = key ? "Key saved on this device." : "Not set on this device";
}

if (finnhubForm) {
  finnhubForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = finnhubInput.value.trim();
    if (value) {
      localStorage.setItem(FINNHUB_KEY_STORAGE, value);
    } else {
      localStorage.removeItem(FINNHUB_KEY_STORAGE);
    }
    renderFinnhubKeyStatus();
    renderPortfolio(); // prices were showing "no key" — refresh now that one's set
  });
  renderFinnhubKeyStatus();
}

renderPortfolio();
