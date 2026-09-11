// News is fetched client-side from each outlet's public RSS feed, converted
// to JSON via rss2json.com (a free CORS-friendly proxy — no API key, since a
// plain static page can't call most news sites' RSS directly due to CORS).
const NEWS_SOURCES = [
  { id: "world", listId: "news-world", loadingText: "Loading…", feed: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { id: "germany", listId: "news-germany", loadingText: "Wird geladen…", feed: "https://www.tagesschau.de/inland/index~rss2.xml" },
  { id: "austria", listId: "news-austria", loadingText: "Wird geladen…", feed: "https://rss.orf.at/oesterreich.xml" },
  { id: "czechia", listId: "news-czechia", loadingText: "Načítání…", feed: "https://www.irozhlas.cz/rss/irozhlas" },
];

const MAX_AGE_HOURS = 48;
const MAX_ITEMS = 8;
let newsLoadedAt = 0;

function timeAgo(pubDate) {
  const diffMs = Date.now() - new Date(pubDate).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchSource(source) {
  const list = document.getElementById(source.listId);
  list.innerHTML = `<li class="news-loading">${source.loadingText}</li>`;

  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.feed)}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok") throw new Error(data.message || "feed error");

    const cutoff = Date.now() - MAX_AGE_HOURS * 3600000;
    const items = data.items
      .filter((item) => new Date(item.pubDate).getTime() >= cutoff)
      .slice(0, MAX_ITEMS);

    if (items.length === 0) {
      list.innerHTML = `<li class="news-empty">No recent headlines right now.</li>`;
      return;
    }

    list.innerHTML = items
      .map(
        (item) => `
        <li class="news-item">
          <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>
          <span class="news-time">${timeAgo(item.pubDate)}</span>
        </li>`
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<li class="news-empty">Couldn't load this feed right now.</li>`;
  }
}

window.loadNews = function loadNews(force) {
  const staleAfterMs = 5 * 60000;
  if (!force && Date.now() - newsLoadedAt < staleAfterMs) return;
  newsLoadedAt = Date.now();
  NEWS_SOURCES.forEach(fetchSource);
};

document.getElementById("refresh-news").addEventListener("click", () => window.loadNews(true));
