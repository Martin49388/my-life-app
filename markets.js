// Markets: stock search (Finnhub, free tier — see config.js) plus a
// persistent "portfolio" watchlist. Searching looks up matching symbols
// and their live price right there in the results; adding one just saves
// its symbol/name (the portfolio list re-fetches live prices on its own,
// so there's nothing here to go stale). Each row links out to Yahoo
// Finance for the full picture — this app only ever shows a quick glance.

const PORTFOLIO_KEY = "markets-portfolio";

function loadPortfolio() {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  return raw ? JSON.parse(raw) : [];
}

function savePortfolio(list) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
}

let portfolio = loadPortfolio();

function finnhubKey() {
  return window.APP_CONFIG && window.APP_CONFIG.FINNHUB_API_KEY;
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
const searchResults = document.getElementById("stock-search-results");

async function searchStocks(query) {
  const key = finnhubKey();
  if (!key) {
    searchResults.innerHTML = `<li class="stock-search-empty">No Finnhub key set in config.js — add FINNHUB_API_KEY there first.</li>`;
    searchResults.hidden = false;
    return;
  }

  searchResults.innerHTML = `<li class="stock-search-empty">Searching…</li>`;
  searchResults.hidden = false;

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const matches = (data.result || []).filter((m) => m.type === "Common Stock").slice(0, 5);

    if (matches.length === 0) {
      searchResults.innerHTML = `<li class="stock-search-empty">No matches.</li>`;
      return;
    }

    searchResults.innerHTML = matches
      .map(
        (m) => `
        <li class="stock-search-item" data-symbol="${m.symbol}">
          <div class="stock-search-item-body">
            <p class="stock-search-name"></p>
            <p class="stock-search-price">Loading…</p>
          </div>
          <button type="button" class="stock-add-btn" data-symbol="${m.symbol}" data-name="${m.description}">+ Add</button>
        </li>`
      )
      .join("");

    searchResults.querySelectorAll(".stock-search-item").forEach((li, i) => {
      const m = matches[i];
      li.querySelector(".stock-search-name").textContent = `${m.symbol} — ${m.description}`;
    });

    matches.forEach((m, i) => {
      const priceEl = searchResults.querySelectorAll(".stock-search-price")[i];
      fetchQuote(m.symbol)
        .then((q) => {
          const { price, change, down } = formatQuote(q);
          priceEl.textContent = `${price} ${change}`;
          priceEl.classList.toggle("stock-down", down);
        })
        .catch(() => {
          priceEl.textContent = "Price unavailable";
        });
    });
  } catch (err) {
    searchResults.innerHTML = `<li class="stock-search-empty">Search failed — try again.</li>`;
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

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".stock-add-btn");
  if (!btn) return;
  addToPortfolio(btn.dataset.symbol, btn.dataset.name);
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

renderPortfolio();
