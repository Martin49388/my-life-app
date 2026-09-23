// News: one live timeline across four public RSS feeds, converted to JSON
// via rss2json.com (a free CORS-friendly proxy — no API key, since a plain
// static page can't call most news sites' RSS directly due to CORS).
//
// Layout (see #news-section in index.html): a live/updated pill; a lead
// story (with its image when the feed has one); stats (stories in the
// last 24h, new since your last visit, newest); a 24-hour activity chart;
// region filter chips with counts; then every story as one timeline,
// grouped by day.
//
// Timestamps: rss2json returns pubDate as "YYYY-MM-DD HH:MM:SS" in UTC
// (checked against the raw BBC feed's GMT pubDate). That string has no
// zone marker, so `new Date(it)` reads it as LOCAL time in Chrome (two
// hours off in Prague) and older Safari rejects the format outright —
// parseNewsDate() parses it explicitly as UTC.
//
// Images: BBC puts one in `thumbnail`, ORF and iRozhlas in `enclosure`;
// tagesschau has none, so its stories get a text placeholder tile.

const NEWS_SOURCES = [
  { id: "world", region: "World", code: "W", source: "BBC News", lang: "en", feed: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "germany", region: "Germany", code: "DE", source: "tagesschau", lang: "de", feed: "https://www.tagesschau.de/inland/index~rss2.xml" },
  { id: "austria", region: "Austria", code: "AT", source: "ORF", lang: "de", feed: "https://rss.orf.at/oesterreich.xml" },
  { id: "czechia", region: "Czechia", code: "CZ", source: "iRozhlas", lang: "cs", feed: "https://www.irozhlas.cz/rss/irozhlas" },
];

const NEWS_MAX_AGE_HOURS = 48;
const NEWS_STALE_MS = 5 * 60 * 1000;
const NEWS_LAST_SEEN_KEY = "news-last-seen";

let newsItems = []; // all sources merged, newest first
const newsSourceState = {}; // source id -> "loading" | "ok" | "error"
let newsLoadedAt = 0;
let newsLoading = false;
let newsFilter = "all";
let newsPrevSeen = 0; // "new" = newer than your previous visit to News

function newsEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Feed text arrives with HTML entities / tags mixed in — decode to plain text.
function newsPlainText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function parseNewsDate(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function timeAgo(ts) {
  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function newsDayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

async function fetchNewsSource(source) {
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.feed)}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "ok") throw new Error(data.message || "feed error");

  const cutoff = Date.now() - NEWS_MAX_AGE_HOURS * 3600000;
  return (data.items || [])
    .map((item) => {
      const time = parseNewsDate(item.pubDate);
      const link = safeHttpUrl(item.link);
      const enclosure = item.enclosure || {};
      const enclosureImage = enclosure.link && (!enclosure.type || String(enclosure.type).startsWith("image")) ? enclosure.link : null;
      const image = safeHttpUrl(item.thumbnail || enclosure.thumbnail || enclosureImage || "");
      return {
        key: link || `${source.id}:${item.title}`,
        title: newsPlainText(item.title),
        snippet: newsPlainText(item.description || item.content).slice(0, 240),
        link,
        time,
        image: image && image.startsWith("https:") ? image : null,
        source,
      };
    })
    .filter((it) => it.title && it.link && it.time != null && it.time >= cutoff);
}

function filteredNews() {
  return newsFilter === "all" ? newsItems : newsItems.filter((it) => it.source.id === newsFilter);
}

function isNewStory(item) {
  return newsPrevSeen > 0 && item.time > newsPrevSeen;
}

// ---------------------------------------------------------------------------
// Rendering

function renderNewsPill() {
  const pill = document.getElementById("news-pill");
  if (!pill) return;
  const failed = NEWS_SOURCES.filter((s) => newsSourceState[s.id] === "error").length;
  let state = "idle";
  let label = "Not loaded";
  let detail = "";
  if (newsLoading) {
    state = "loading";
    label = "Updating";
  } else if (newsLoadedAt && failed === NEWS_SOURCES.length) {
    state = "error";
    label = "Offline";
    detail = "Couldn't reach the feeds";
  } else if (newsLoadedAt) {
    state = "live";
    label = "Live";
    detail = `Updated ${timeAgo(newsLoadedAt)}${failed ? ` · ${failed} ${failed === 1 ? "feed" : "feeds"} down` : ""}`;
  }
  pill.dataset.state = state;
  document.getElementById("news-pill-label").textContent = label;
  document.getElementById("news-pill-detail").textContent = detail;
}

function loadThumb(holder, url) {
  if (!url || !holder) return;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onload = () => {
    if (!holder.isConnected) return;
    holder.replaceChildren(img);
    holder.classList.add("has-image");
  };
  img.src = url;
}

function renderNewsLead(lead) {
  const wrap = document.getElementById("news-lead");
  if (!wrap) return;
  if (!lead) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  wrap.href = lead.link;
  wrap.className = `news-lead${lead.image ? "" : " no-media"}`;
  wrap.innerHTML = `
    <span class="news-lead-media news-region-${lead.source.id}"><span class="news-placeholder">${newsEsc(lead.source.code)}</span></span>
    <span class="news-lead-body">
      <span class="news-meta">
        <span class="news-tag">${newsEsc(lead.source.region)}</span>
        <span>${newsEsc(lead.source.source)}</span>
        <span>·</span>
        <span>${timeAgo(lead.time)}</span>
        ${isNewStory(lead) ? `<span class="news-new-label">New</span>` : ""}
      </span>
      <span class="news-lead-title" lang="${lead.source.lang}">${newsEsc(lead.title)}</span>
      ${lead.snippet ? `<span class="news-lead-snippet" lang="${lead.source.lang}">${newsEsc(lead.snippet)}</span>` : ""}
    </span>`;
  if (lead.image) loadThumb(wrap.querySelector(".news-lead-media"), lead.image);
}

function renderNewsStats() {
  const dayAgo = Date.now() - 24 * 3600000;
  const last24 = newsItems.filter((it) => it.time >= dayAgo).length;
  const fresh = newsItems.filter(isNewStory).length;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText("news-stat-24h", newsItems.length ? String(last24) : "—");
  setText("news-stat-new", newsItems.length ? (newsPrevSeen ? String(fresh) : "—") : "—");
  setText("news-stat-newest", newsItems.length ? timeAgo(newsItems[0].time) : "—");
}

// Stories per hour over the last 24h, oldest hour on the left.
function renderNewsPulse(items) {
  const wrap = document.getElementById("news-pulse");
  if (!wrap) return;
  const now = Date.now();
  const buckets = new Array(24).fill(0);
  for (const it of items) {
    const hoursAgo = Math.floor((now - it.time) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 24) buckets[23 - hoursAgo]++;
  }
  const max = Math.max(...buckets, 1);
  const hourLabel = (i) => {
    const d = new Date(now - (23 - i) * 3600000);
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  };
  wrap.innerHTML = buckets
    .map(
      (n, i) =>
        `<span class="news-pulse-bar${n ? "" : " is-zero"}${i === 23 ? " is-now" : ""}" style="--h:${(n / max).toFixed(3)}" title="${hourLabel(i)} · ${n} ${n === 1 ? "story" : "stories"}"></span>`
    )
    .join("");
  const total = buckets.reduce((a, b) => a + b, 0);
  const caption = document.getElementById("news-pulse-caption");
  if (caption) caption.textContent = `${total} ${total === 1 ? "story" : "stories"} · busiest ${hourLabel(buckets.indexOf(max))}`;
}

function renderNewsFilters() {
  const wrap = document.getElementById("news-filters");
  if (!wrap) return;
  const chips = [{ id: "all", label: "All", count: newsItems.length, state: "ok" }].concat(
    NEWS_SOURCES.map((s) => ({
      id: s.id,
      label: s.region,
      count: newsItems.filter((it) => it.source.id === s.id).length,
      state: newsSourceState[s.id],
    }))
  );
  wrap.innerHTML = chips
    .map(
      (c) => `
      <button type="button" class="news-chip${c.id === newsFilter ? " is-active" : ""}${c.state === "error" ? " is-error" : ""}" data-filter="${c.id}" aria-pressed="${c.id === newsFilter}">
        ${newsEsc(c.label)}
        <span class="news-chip-count">${c.state === "error" ? "!" : c.state === "loading" && !c.count ? "…" : c.count}</span>
      </button>`
    )
    .join("");
  wrap.querySelectorAll(".news-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      newsFilter = chip.dataset.filter;
      renderNews();
    });
  });
}

function renderNewsList(items) {
  const list = document.getElementById("news-list");
  if (!list) return;

  if (!items.length) {
    const failed = newsFilter !== "all" && newsSourceState[newsFilter] === "error";
    list.innerHTML = newsLoading
      ? newsSkeleton(5)
      : `<li class="empty-state">${failed ? "Couldn't load this feed right now." : newsLoadedAt ? "No other recent stories here right now." : "Loading headlines…"}</li>`;
    return;
  }

  let lastDay = "";
  const html = [];
  for (const it of items) {
    const day = newsDayLabel(it.time);
    if (day !== lastDay) {
      html.push(`<li class="news-day">${newsEsc(day)}</li>`);
      lastDay = day;
    }
    const exact = new Date(it.time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    html.push(`
      <li class="news-row${isNewStory(it) ? " is-new" : ""}">
        <a class="news-row-link" href="${newsEsc(it.link)}" target="_blank" rel="noopener noreferrer">
          <span class="news-thumb news-region-${it.source.id}" data-image="${newsEsc(it.image || "")}"><span class="news-placeholder">${newsEsc(it.source.code)}</span></span>
          <span class="news-row-body">
            <span class="news-row-title" lang="${it.source.lang}">${newsEsc(it.title)}</span>
            <span class="news-meta">
              <span class="news-tag">${newsEsc(it.source.code)}</span>
              <span>${newsEsc(it.source.source)}</span>
              <span>·</span>
              <span title="${newsEsc(exact)}">${timeAgo(it.time)}</span>
            </span>
          </span>
          ${isNewStory(it) ? `<span class="news-new-dot" aria-label="New since your last visit"></span>` : ""}
        </a>
      </li>`);
  }
  list.innerHTML = html.join("");
  list.querySelectorAll(".news-thumb[data-image]").forEach((thumb) => {
    if (thumb.dataset.image) loadThumb(thumb, thumb.dataset.image);
  });
}

function newsSkeleton(n) {
  return Array.from(
    { length: n },
    () => `
    <li class="news-row news-skeleton" aria-hidden="true">
      <span class="news-row-link">
        <span class="news-thumb"></span>
        <span class="news-row-body"><span class="skeleton-line"></span><span class="skeleton-line short"></span></span>
      </span>
    </li>`
  ).join("");
}

function renderNews() {
  renderNewsPill();
  if (!document.getElementById("news-list")) return;
  const items = filteredNews();
  renderNewsLead(items[0]);
  renderNewsStats();
  renderNewsPulse(items);
  renderNewsFilters();
  renderNewsList(items.slice(1));
}

// ---------------------------------------------------------------------------
// Loading

window.loadNews = async function loadNews(force) {
  if (newsLoading) return;
  if (!force && Date.now() - newsLoadedAt < NEWS_STALE_MS) {
    renderNews();
    return;
  }
  newsLoading = true;
  NEWS_SOURCES.forEach((s) => (newsSourceState[s.id] = "loading"));
  renderNews();

  const results = await Promise.allSettled(NEWS_SOURCES.map(fetchNewsSource));
  const merged = new Map();
  results.forEach((result, i) => {
    const source = NEWS_SOURCES[i];
    if (result.status === "fulfilled") {
      newsSourceState[source.id] = "ok";
      result.value.forEach((it) => merged.set(it.key, it));
    } else {
      newsSourceState[source.id] = "error";
      // Keep whatever this feed gave us last time rather than blanking it.
      newsItems.filter((it) => it.source.id === source.id).forEach((it) => merged.set(it.key, it));
    }
  });
  newsItems = [...merged.values()].sort((a, b) => b.time - a.time);
  newsLoading = false;
  newsLoadedAt = Date.now();
  renderNews();
  if (window.renderBriefing) window.renderBriefing();
};

// Opening the News section: remember when you were last here (so stories
// published since then get marked "new"), then load/refresh.
window.openNews = function openNews() {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(NEWS_LAST_SEEN_KEY)) || 0;
    localStorage.setItem(NEWS_LAST_SEEN_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — just no "new" markers.
  }
  newsPrevSeen = stored;
  window.loadNews();
};

window.newsSnapshot = () => ({
  items: newsItems,
  loadedAt: newsLoadedAt,
  lastSeen: Number(localStorage.getItem(NEWS_LAST_SEEN_KEY)) || 0,
});

document.getElementById("refresh-news").addEventListener("click", () => window.loadNews(true));

// While News is on screen: keep "x min ago" labels honest, and refresh
// once the data is older than five minutes.
setInterval(() => {
  const section = document.getElementById("briefing-section");
  if (!section || section.hidden || document.hidden) return;
  if (Date.now() - newsLoadedAt >= NEWS_STALE_MS) window.loadNews();
  else renderNews();
}, 60 * 1000);

renderNews();
