// Reading — a log of books: what you've read, what you're reading now and
// what's next. Cover, author, year, pages, subjects and a blurb come from
// Open Library (free, no key, CORS-enabled); a short summary + key ideas
// come from Gemini through the same key Alfred and the daily quote use
// (geminiKey() in alfred.js, which loads first).
//
// Data lives in one localStorage key, "books", so it syncs across devices
// like everything else (sync.js). Each book:
//   { id, title, author, year, pages, cover (Open Library cover id),
//     olKey ("/works/OL…W"), subjects, description,
//     status: "read" | "reading" | "want", rating (0–5),
//     started, finished — "YYYY-MM" or just "YYYY" (a pasted list often
//       only knows the year) or "" when unknown,
//     page (current page while reading), notes,
//     ai: { summary, ideas, forWho } | { unknown: true } | null,
//     addedAt }
// The old free-text reading notes (journal.js, key "journal-reading") stay
// as the Notes block at the bottom of the section.

// Everything is wrapped in one function scope: every <script> here shares
// the page's global scope, and names like searchInput already exist in
// other files. Only window.renderReading / window.readingSummary leak out.
(() => {
  const BOOKS_KEY = "books";
  const READ_VIEW_KEY = "reading-view";
  const OL_BASE = "https://openlibrary.org";
  const OL_COVERS = "https://covers.openlibrary.org/b/id";
  // editions.* returns the edition that matched the query best, so a Czech
  // title ("Malý princ") finds the work ("Le petit prince") and can still be
  // shown under the title that was typed.
  const OL_FIELDS = [
    "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,subject",
    "readinglog_count,edition_count,editions,editions.title,editions.cover_i",
  ].join(",");
  const READ_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const READ_STATUS = [
    { id: "read", label: "Read" },
    { id: "reading", label: "Reading" },
    { id: "want", label: "Want to read" },
  ];

  function loadBooks() {
    try {
      const list = JSON.parse(localStorage.getItem(BOOKS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  let books = loadBooks();

  function saveBooks() {
    localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
  }

  function bookById(id) {
    return books.find((b) => b.id === id);
  }

  function readEsc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function readThisYear() {
    return String(new Date().getFullYear());
  }

  function readMonthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function finishedYear(b) {
    return (b.finished || "").slice(0, 4);
  }

  function formatReadDate(value) {
    if (!value) return "";
    const [y, m] = value.split("-");
    return m ? `${READ_MONTHS[Number(m) - 1]} ${y}` : y;
  }

  // Loose comparison key: case, accents and punctuation don't matter.
  function normText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function findExisting(candidate) {
    return books.find(
      (b) =>
        (candidate.olKey && b.olKey === candidate.olKey) ||
        (normText(b.title) === normText(candidate.title) && normText(b.author) === normText(candidate.author))
    );
  }

  function hashText(value) {
    let h = 0;
    for (const ch of String(value)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h;
  }

  // ---------------------------------------------------------------------------
  // Open Library

  function cleanSubjects(list) {
    // Library-catalogue noise: BISAC codes ("A / B"), inverted headings
    // ("Athletes, biography", "X -- Fiction"), qualifiers ("Dune (Imaginary
    // place)"), machine tags ("series:Harry_Potter"), list tags.
    const junk = /[\/,(:_]|--|bestseller|new york times|accessible book|protected daisy|in library|large type|reading level|nyt:|open library|staff picks|overdrive|long now|^general$/i;
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
      const s = String(raw).trim().replace(/\.$/, "");
      if (!s || s.length > 26 || junk.test(s)) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s.charAt(0).toUpperCase() + s.slice(1));
      if (out.length >= 4) break;
    }
    return out;
  }

  // How well a title answers what was typed: exact 6, prefix 3, contains 1.
  function titleScore(title, wanted) {
    const t = normText(title);
    const w = normText(wanted);
    if (!t || !w) return 0;
    if (t === w) return 6;
    if (t.startsWith(w) || w.startsWith(t)) return 3;
    if (t.includes(w) || w.includes(t)) return 1;
    return 0;
  }

  function olDocToBook(doc, wantedTitle) {
    const workTitle = String(doc.title || "").trim();
    const edition = doc.editions && doc.editions.docs && doc.editions.docs[0];
    const edTitle = edition ? String(edition.title || "").trim() : "";
    // Matched through a translation/edition title → show that title (and
    // that edition's cover), keep the original for reference.
    const useEdition = edTitle && wantedTitle && titleScore(edTitle, wantedTitle) > titleScore(workTitle, wantedTitle);
    const cover = useEdition && edition.cover_i > 0 ? edition.cover_i : doc.cover_i;
    return {
      title: useEdition ? edTitle : workTitle,
      origTitle: useEdition ? workTitle : "",
      author: (doc.author_name || [])[0] || "",
      year: doc.first_publish_year || null,
      pages: doc.number_of_pages_median || null,
      cover: cover > 0 ? cover : null,
      olKey: doc.key || "",
      subjects: cleanSubjects(doc.subject),
      // Tie-breaker between same-titled works: how many people log it.
      pop: 0.5 * Math.log10(1 + (doc.readinglog_count || 0)) + 0.5 * Math.log10(1 + (doc.edition_count || 0)),
    };
  }

  async function olSearch(query, limit = 8, wantedTitle = query) {
    const url = `${OL_BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=${OL_FIELDS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
    const data = await res.json();
    return (data.docs || []).filter((d) => d.title).map((d) => olDocToBook(d, wantedTitle));
  }

  // Search hits carry a couple of ranking-only fields; strip them before saving.
  function bookFields(hit) {
    const { pop, ...fields } = hit;
    return { ...fields, subjects: [...(hit.subjects || [])] };
  }

  // Work descriptions are free text, often with a trailing "----------" source
  // list or markdown links — keep just the readable part.
  function cleanDescription(raw) {
    let text = typeof raw === "string" ? raw : raw && raw.value ? raw.value : "";
    text = text
      .split(/\n-{3,}|\n\s*\[\d+\]:/)[0]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\(\[source\]\[\d+\]\)/gi, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length > 900) {
      const cut = text.slice(0, 900);
      const stop = cut.lastIndexOf(". ");
      text = `${stop > 400 ? cut.slice(0, stop + 1) : cut.trimEnd()}…`;
    }
    return text;
  }

  async function olWork(olKey) {
    if (!/^\/works\/OL\w+$/.test(olKey || "")) return null;
    const res = await fetch(`${OL_BASE}${olKey}.json`);
    if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
    const data = await res.json();
    return { description: cleanDescription(data.description), subjects: cleanSubjects(data.subjects) };
  }

  const enriching = new Set();

  // Fill in the blurb (and subjects, if search didn't have any) after a book
  // is added — in the background, so adding never waits on it.
  async function enrichBook(id) {
    const book = bookById(id);
    if (!book || !book.olKey || book.description || enriching.has(id)) return;
    enriching.add(id);
    try {
      const work = await olWork(book.olKey);
      const fresh = bookById(id);
      if (work && fresh) {
        fresh.description = work.description || "";
        if (!fresh.subjects || !fresh.subjects.length) fresh.subjects = work.subjects;
        saveBooks();
        if (bookModalId === id) renderBookModal();
      }
    } catch {
      // No blurb this time — it'll be retried next time the book is opened.
    } finally {
      enriching.delete(id);
    }
  }

  // Scores a search hit against what was typed: exact title beats partial,
  // the right author helps, and summaries/workbooks *about* the book lose
  // unless that's what was asked for.
  function matchScore(hit, wantTitle, wantAuthor) {
    let score = Math.max(titleScore(hit.title, wantTitle), titleScore(hit.origTitle, wantTitle));
    const derivative = /summary|workbook|journal|study guide|sparknotes|cliffs? ?notes|analysis|companion|notebook|coloring|adaptation/i;
    if (derivative.test(hit.title) && !derivative.test(wantTitle)) score -= 6;
    if (wantAuthor && hit.author) {
      const a = normText(hit.author);
      const wa = normText(wantAuthor);
      const lastName = (s) => s.split(" ").pop();
      if (a.includes(wa) || wa.includes(a) || lastName(a) === lastName(wa)) score += 4;
      else score -= 2;
    }
    if (hit.cover) score += 1;
    if (hit.author) score += 1;
    if (hit.pages) score += 0.5;
    return score + (hit.pop || 0);
  }

  function pickBest(hits, title, author) {
    let best = null;
    let bestScore = -Infinity;
    for (const hit of hits) {
      // Popularity alone never makes a match — the title has to overlap.
      if (!Math.max(titleScore(hit.title, title), titleScore(hit.origTitle, title))) continue;
      const s = matchScore(hit, title, author);
      if (s > bestScore) {
        best = hit;
        bestScore = s;
      }
    }
    return bestScore >= 3 ? best : null;
  }

  async function bestMatch(title, author) {
    const hits = await olSearch(author ? `${title} ${author}` : title, 10, title);
    const best = pickBest(hits, title, author);
    if (best || !author) return best;
    // A misspelt author can sink the combined search — retry on the title.
    return pickBest(await olSearch(title, 10, title), title, author);
  }

  // ---------------------------------------------------------------------------
  // Adding / changing books

  function createBook(fields, status, finished) {
    const book = {
      id: crypto.randomUUID(),
      title: "",
      origTitle: "",
      author: "",
      year: null,
      pages: null,
      cover: null,
      olKey: "",
      subjects: [],
      description: "",
      status,
      rating: 0,
      started: status === "reading" ? readMonthKey() : "",
      finished: status === "read" ? finished || "" : "",
      page: 0,
      notes: "",
      ai: null,
      addedAt: Date.now(),
      ...fields,
    };
    books.unshift(book);
    saveBooks();
    enrichBook(book.id);
    return book;
  }

  function setBookStatus(book, status) {
    if (book.status === status) return;
    book.status = status;
    if (status === "reading" && !book.started) book.started = readMonthKey();
    if (status === "read" && !book.finished) book.finished = readMonthKey();
    if (status === "read" && book.pages) book.page = book.pages;
  }

  function finishBook(id) {
    const book = bookById(id);
    if (!book) return;
    book.status = "read";
    book.finished = readMonthKey();
    if (book.pages) book.page = book.pages;
    saveBooks();
    readTab = "read";
    renderReading();
    openBook(id); // straight to rating + notes
  }

  function deleteBook(id) {
    books = books.filter((b) => b.id !== id);
    saveBooks();
    closeBookModal();
    renderReading();
  }

  // ---------------------------------------------------------------------------
  // Gemini: summary + key ideas

  const aiPending = new Set();
  const aiErrors = new Map();

  function readExtractJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end < start) throw new Error("No JSON in the reply");
    return JSON.parse(text.slice(start, end + 1));
  }

  async function generateBookAi(id, { force = false } = {}) {
    const book = bookById(id);
    if (!book || aiPending.has(id) || (book.ai && !force)) return;
    const key = typeof geminiKey === "function" ? geminiKey() : "";
    if (!key) return;

    aiPending.add(id);
    aiErrors.delete(id);
    if (bookModalId === id) renderBookAi();

    const prompt = [
      `Book: "${book.title}"${book.author ? ` by ${book.author}` : ""}${book.year ? ` (first published ${book.year})` : ""}.`,
      "Respond with ONLY a JSON object, no markdown, no code fences, in exactly this shape:",
      '{"summary": "2-3 sentences: what the book is about and its core idea or premise, no major spoilers", "ideas": ["3 to 5 key ideas or takeaways, one short sentence each"], "forWho": "one short sentence on who gets the most out of it"}',
      'If you do not recognise this specific book, respond with {"unknown": true} instead of guessing.',
      "Write in English.",
    ].join("\n");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      const parsed = readExtractJson(raw);
      const fresh = bookById(id);
      if (fresh) {
        fresh.ai = parsed.unknown
          ? { unknown: true, at: Date.now() }
          : {
              summary: String(parsed.summary || "").trim(),
              ideas: (Array.isArray(parsed.ideas) ? parsed.ideas : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5),
              forWho: String(parsed.forWho || "").trim(),
              at: Date.now(),
            };
        saveBooks();
      }
    } catch (err) {
      aiErrors.set(id, err.message);
    } finally {
      aiPending.delete(id);
      if (bookModalId === id) renderBookAi();
      renderShelf();
    }
  }

  // ---------------------------------------------------------------------------
  // Section rendering

  let readTab = "read";
  let readSort = "recent";
  let readFilter = "";
  let readView = (() => {
    try {
      return localStorage.getItem(READ_VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  })();

  function readingGoal() {
    if (typeof goals === "undefined") return null;
    return goals.find((g) => /^read/i.test(g.name || "")) || null;
  }

  function coverHtml(book, size = "M") {
    const tint = hashText(book.title) % 5;
    const img = book.cover
      ? `<img src="${OL_COVERS}/${encodeURIComponent(book.cover)}-${size}.jpg?default=false" alt="" loading="lazy" decoding="async" />`
      : "";
    return `<span class="book-cover tint-${tint}" aria-hidden="true">
        <span class="book-ph"><span class="book-ph-title">${readEsc(book.title)}</span><span class="book-ph-author">${readEsc(book.author)}</span></span>
        ${img}
      </span>`;
  }

  function starsHtml(rating, cls = "") {
    if (!rating) return "";
    return `<span class="book-stars ${cls}" aria-label="${rating} of 5 stars">${"★".repeat(rating)}<span class="book-stars-off">${"★".repeat(5 - rating)}</span></span>`;
  }

  function renderReadHero() {
    const year = readThisYear();
    const read = books.filter((b) => b.status === "read");
    const thisYear = read.filter((b) => finishedYear(b) === year);
    const rated = read.filter((b) => b.rating);
    const pages = read.reduce((sum, b) => sum + (Number(b.pages) || 0), 0);

    document.getElementById("read-year-count").textContent = String(thisYear.length);
    document.getElementById("read-year-caption").textContent = `${thisYear.length === 1 ? "book" : "books"} finished in ${year}`;

    const avg = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : "—";
    document.getElementById("read-stats").innerHTML = `
      <div class="read-stat"><span class="stat-label">All time</span><span class="read-stat-value">${read.length}</span></div>
      <div class="read-stat"><span class="stat-label">Pages</span><span class="read-stat-value">${pages.toLocaleString()}</span></div>
      <div class="read-stat"><span class="stat-label">Avg rating</span><span class="read-stat-value">${avg}${rated.length ? "★" : ""}</span></div>`;

    const goal = readingGoal();
    const goalEl = document.getElementById("read-goal");
    goalEl.hidden = !goal;
    if (goal) {
      const due = goal.deadline && typeof deadlineLabel === "function" ? ` · ${deadlineLabel(goal.deadline).text}` : "";
      goalEl.innerHTML = `${readEsc(goal.name)} goal <strong>${readEsc(goal.current)}/${readEsc(goal.target)}</strong>${readEsc(due)} &rarr;`;
    }

    // Books finished per month this year.
    const counts = Array(12).fill(0);
    for (const b of thisYear) {
      const m = Number((b.finished || "").slice(5, 7));
      if (m) counts[m - 1] += 1;
    }
    const max = Math.max(1, ...counts);
    const nowMonth = new Date().getMonth();
    document.getElementById("read-year-strip").innerHTML = counts
      .map(
        (n, i) => `
        <span class="read-month${i === nowMonth ? " is-now" : ""}${i > nowMonth ? " is-future" : ""}" title="${READ_MONTHS[i]}: ${n}">
          <span class="read-month-n">${n || ""}</span>
          <span class="read-month-bar"><span style="height:${Math.round((n / max) * 100)}%"></span></span>
          <span class="read-month-label">${READ_MONTHS[i][0]}</span>
        </span>`
      )
      .join("");
  }

  function renderReadingNow() {
    const now = books.filter((b) => b.status === "reading");
    const block = document.getElementById("read-now-block");
    block.hidden = now.length === 0;
    document.getElementById("read-now").innerHTML = now
      .map((b) => {
        const pages = Number(b.pages) || 0;
        const page = Math.min(Number(b.page) || 0, pages || Infinity);
        const pct = pages ? Math.round((page / pages) * 100) : 0;
        return `
        <li class="now-card">
          <button type="button" class="now-cover" data-book="${b.id}" aria-label="Open ${readEsc(b.title)}">${coverHtml(b)}</button>
          <div class="now-body">
            <button type="button" class="now-title" data-book="${b.id}">${readEsc(b.title)}</button>
            <p class="now-author">${readEsc(b.author || "Unknown author")}${b.started ? ` · since ${readEsc(formatReadDate(b.started))}` : ""}</p>
            <div class="now-progress"><span style="width:${pct}%"></span></div>
            <p class="now-meta">
              <label>p. <input type="number" class="now-page" data-page-for="${b.id}" value="${page || ""}" placeholder="0" min="0" ${pages ? `max="${pages}"` : ""} inputmode="numeric" /></label>
              ${pages ? `<span>of ${pages} · ${pct}%</span>` : ""}
            </p>
            <button type="button" class="fuel-head-btn now-finish" data-finish="${b.id}">Finished &#10003;</button>
          </div>
        </li>`;
      })
      .join("");
  }

  function sortedShelf() {
    const q = normText(readFilter);
    let list = books.filter((b) => b.status === readTab);
    if (q) list = list.filter((b) => normText(`${b.title} ${b.author} ${(b.subjects || []).join(" ")}`).includes(q));
    const byTitle = (a, b) => a.title.localeCompare(b.title);
    if (readSort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b));
    else if (readSort === "title") list.sort(byTitle);
    else if (readSort === "author") list.sort((a, b) => (a.author || "~").localeCompare(b.author || "~") || byTitle(a, b));
    else if (readTab === "read") list.sort((a, b) => (b.finished || "").localeCompare(a.finished || "") || b.addedAt - a.addedAt);
    else list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }

  function shelfItemHtml(b) {
    if (readView === "list") {
      const facts = [b.author || "Unknown author", b.year, b.pages ? `${b.pages} p` : ""].filter(Boolean).join(" · ");
      const snippet = b.notes || (b.ai && b.ai.summary) || b.description || "";
      const when = b.status === "read" ? formatReadDate(b.finished) : "";
      return `
        <li>
          <button type="button" class="shelf-row" data-book="${b.id}">
            ${coverHtml(b)}
            <span class="shelf-row-body">
              <span class="shelf-title">${readEsc(b.title)}</span>
              <span class="shelf-meta">${readEsc(facts)}</span>
              ${b.rating || when ? `<span class="shelf-row-foot">${starsHtml(b.rating)}${when ? `<span>${readEsc(when)}</span>` : ""}</span>` : ""}
              ${snippet ? `<span class="shelf-snippet">${readEsc(snippet)}</span>` : ""}
            </span>
          </button>
        </li>`;
    }
    return `
      <li>
        <button type="button" class="shelf-card" data-book="${b.id}">
          ${coverHtml(b)}
          <span class="shelf-title">${readEsc(b.title)}</span>
          <span class="shelf-author">${readEsc(b.author)}</span>
          ${starsHtml(b.rating, "is-small")}
        </button>
      </li>`;
  }

  function renderShelf() {
    const shelf = document.getElementById("read-shelf");
    if (!shelf) return;
    const counts = Object.fromEntries(READ_STATUS.map((s) => [s.id, books.filter((b) => b.status === s.id).length]));

    document.getElementById("read-tabs").innerHTML = ["read", "want"]
      .map((id) => {
        const s = READ_STATUS.find((x) => x.id === id);
        return `<button type="button" class="read-tab${readTab === id ? " is-active" : ""}" data-read-tab="${id}" role="tab" aria-selected="${readTab === id}">${s.label}<span class="read-tab-n">${counts[id]}</span></button>`;
      })
      .join("");
    document.getElementById("read-sort").value = readSort;
    document.querySelectorAll("[data-read-view]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.readView === readView);
      btn.setAttribute("aria-pressed", String(btn.dataset.readView === readView));
    });

    const filterEl = document.getElementById("read-filter");
    filterEl.hidden = counts[readTab] < 12 && !readFilter;

    shelf.className = `read-shelf is-${readView}`;
    const list = sortedShelf();

    if (!counts[readTab]) {
      shelf.innerHTML =
        readTab === "read"
          ? `<li class="read-empty">
              <p class="read-empty-title">Your shelf is empty.</p>
              <p class="read-empty-text">Add the books you've read — search one at a time, or paste your whole list and the covers, authors and details fill in by themselves.</p>
              <span class="read-empty-actions">
                <button type="button" class="read-primary-btn" data-read-add="paste">Paste a list</button>
                <button type="button" class="fuel-head-btn" data-read-add="search">Search a book</button>
              </span>
            </li>`
          : `<li class="read-empty"><p class="read-empty-text">Nothing queued. Add books you want to read next.</p>
              <span class="read-empty-actions"><button type="button" class="fuel-head-btn" data-read-add="search">Add a book</button></span></li>`;
      return;
    }
    if (!list.length) {
      shelf.innerHTML = `<li class="empty-state">No books match “${readEsc(readFilter)}”.</li>`;
      return;
    }

    // Recent read books are grouped by the year they were finished.
    if (readTab === "read" && readSort === "recent") {
      const groups = new Map();
      for (const b of list) {
        const y = finishedYear(b) || "Earlier";
        if (!groups.has(y)) groups.set(y, []);
        groups.get(y).push(b);
      }
      shelf.innerHTML = [...groups]
        .map(
          ([year, items]) => `
          <li class="shelf-group">
            <p class="shelf-group-head"><span>${readEsc(year)}</span><span>${items.length} ${items.length === 1 ? "book" : "books"}</span></p>
            <ul class="shelf-items">${items.map(shelfItemHtml).join("")}</ul>
          </li>`
        )
        .join("");
      return;
    }
    shelf.innerHTML = `<li class="shelf-group"><ul class="shelf-items">${list.map(shelfItemHtml).join("")}</ul></li>`;
  }

  function renderReading() {
    if (!document.getElementById("reading-section")) return;
    renderReadHero();
    renderReadingNow();
    renderShelf();
  }
  window.renderReading = renderReading;

  // Used by the phone "More" sheet and by Alfred's daily context.
  window.readingSummary = function readingSummary() {
    const now = books.filter((b) => b.status === "reading");
    const year = readThisYear();
    const finished = books.filter((b) => b.status === "read" && finishedYear(b) === year).length;
    return {
      reading: now.map((b) => ({ title: b.title, author: b.author, page: b.page || 0, pages: b.pages || null })),
      finishedThisYear: finished,
      total: books.filter((b) => b.status === "read").length,
    };
  };

  // ---------------------------------------------------------------------------
  // Book detail sheet

  let bookModalId = null;
  const bookOverlay = document.getElementById("book-modal-overlay");
  const bookBody = document.getElementById("book-modal-body");

  function segHtml(name, options, current) {
    return `<div class="read-seg" data-seg="${name}" role="radiogroup">${options
      .map(
        (o) =>
          `<button type="button" class="read-seg-btn${o.id === current ? " is-active" : ""}" data-seg-value="${o.id}" role="radio" aria-checked="${o.id === current}">${readEsc(o.label)}</button>`
      )
      .join("")}</div>`;
  }

  function renderBookAi() {
    const el = document.getElementById("book-ai");
    const book = bookById(bookModalId);
    if (!el || !book) return;
    const hasKey = typeof geminiKey === "function" && Boolean(geminiKey());
    let html;
    if (aiPending.has(book.id)) {
      html = `<p class="book-ai-status"><span class="book-spinner" aria-hidden="true"></span>Reading up on it…</p>`;
    } else if (book.ai && book.ai.unknown) {
      html = `<p class="book-ai-status">Alfred doesn't know this one well enough to summarise it without guessing.</p>`;
    } else if (book.ai) {
      html = `
        ${book.ai.summary ? `<p class="book-ai-summary">${readEsc(book.ai.summary)}</p>` : ""}
        ${book.ai.ideas && book.ai.ideas.length ? `<ol class="book-ideas">${book.ai.ideas.map((i) => `<li>${readEsc(i)}</li>`).join("")}</ol>` : ""}
        ${book.ai.forWho ? `<p class="book-ai-for"><span class="stat-label">Best for</span> ${readEsc(book.ai.forWho)}</p>` : ""}`;
    } else if (aiErrors.has(book.id)) {
      html = `<p class="book-ai-status">Couldn't get a summary (${readEsc(aiErrors.get(book.id))}).</p>`;
    } else if (!hasKey) {
      html = `<p class="book-ai-status">Add a Gemini key in Settings → Alfred (AI) and a short summary with the key ideas shows up here.</p>`;
    } else {
      html = `<p class="book-ai-status">No summary yet.</p>`;
    }
    const canRefresh = hasKey && !aiPending.has(book.id);
    el.innerHTML = html;
    const btn = document.getElementById("book-ai-refresh");
    if (btn) {
      btn.hidden = !canRefresh;
      btn.textContent = book.ai ? "Redo" : "Summarise";
    }
  }

  function renderBookModal() {
    const book = bookById(bookModalId);
    if (!book) return closeBookModal();
    const facts = [book.year, book.pages ? `${book.pages} pages` : "", book.origTitle ? `orig. ${book.origTitle}` : ""]
      .filter(Boolean)
      .join(" · ");
    const yearOnlyFinished = book.finished && book.finished.length === 4;
    const olLink = book.olKey ? `${OL_BASE}${book.olKey}` : `${OL_BASE}/search?q=${encodeURIComponent(`${book.title} ${book.author}`)}`;

    bookBody.innerHTML = `
      <div class="book-detail-top">
        ${coverHtml(book, "L")}
        <div class="book-detail-id">
          <textarea class="book-title-input" id="book-modal-title" data-field="title" rows="1" aria-label="Title">${readEsc(book.title)}</textarea>
          <input class="book-author-input" data-field="author" value="${readEsc(book.author)}" placeholder="Add author" aria-label="Author" />
          ${facts ? `<p class="book-facts">${readEsc(facts)}</p>` : ""}
          ${book.subjects && book.subjects.length ? `<p class="book-chips">${book.subjects.map((s) => `<span>${readEsc(s)}</span>`).join("")}</p>` : ""}
          <div class="book-rate" role="radiogroup" aria-label="Your rating">
            ${[1, 2, 3, 4, 5]
              .map((n) => `<button type="button" class="book-rate-star${n <= (book.rating || 0) ? " is-on" : ""}" data-rate="${n}" role="radio" aria-checked="${n === book.rating}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`)
              .join("")}
          </div>
        </div>
      </div>

      ${segHtml("status", READ_STATUS, book.status)}

      <div class="book-fields">
        ${
          book.status !== "want"
            ? `<label class="book-field"><span class="stat-label">Started</span><input type="month" data-field="started" value="${book.started && book.started.length === 7 ? readEsc(book.started) : ""}" /></label>`
            : ""
        }
        ${
          book.status === "read"
            ? `<label class="book-field"><span class="stat-label">Finished${yearOnlyFinished ? ` · ${readEsc(book.finished)}` : ""}</span><input type="month" data-field="finished" value="${book.finished && book.finished.length === 7 ? readEsc(book.finished) : ""}" /></label>`
            : ""
        }
        ${
          book.status === "reading"
            ? `<label class="book-field"><span class="stat-label">On page</span><input type="number" data-field="page" value="${book.page || ""}" min="0" inputmode="numeric" placeholder="0" /></label>`
            : ""
        }
        <label class="book-field"><span class="stat-label">Pages</span><input type="number" data-field="pages" value="${book.pages || ""}" min="0" inputmode="numeric" placeholder="—" /></label>
      </div>

      <div class="book-section">
        <div class="book-section-head"><p class="eyebrow">Key ideas</p><button type="button" class="book-link-btn" id="book-ai-refresh" hidden>Summarise</button></div>
        <div id="book-ai"></div>
      </div>

      ${
        book.description
          ? `<div class="book-section"><p class="eyebrow">About</p><p class="book-desc">${readEsc(book.description)}</p></div>`
          : enriching.has(book.id)
            ? `<div class="book-section"><p class="eyebrow">About</p><p class="book-ai-status">Loading…</p></div>`
            : ""
      }

      <div class="book-section">
        <p class="eyebrow">Your notes</p>
        <textarea class="book-notes" data-field="notes" rows="4" placeholder="What stuck with you? A line worth keeping?">${readEsc(book.notes)}</textarea>
      </div>

      <div class="book-detail-foot">
        <a class="external-link" href="${readEsc(olLink)}" target="_blank" rel="noopener noreferrer">Open Library &#8599;</a>
        <button type="button" class="book-delete" id="book-delete">Remove book</button>
      </div>`;

    renderBookAi();
    sizeTitleInput();
  }

  function sizeTitleInput() {
    const t = document.getElementById("book-modal-title");
    if (!t || bookOverlay.hidden) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }

  function openBook(id) {
    const book = bookById(id);
    if (!book) return;
    bookModalId = id;
    renderBookModal();
    bookOverlay.hidden = false;
    document.body.classList.add("book-sheet-open");
    bookOverlay.querySelector(".modal-card").scrollTop = 0;
    sizeTitleInput(); // needs the sheet visible to measure
    if (!book.description && book.olKey) enrichBook(id).then(() => bookModalId === id && renderBookModal());
    generateBookAi(id);
  }

  function closeBookModal() {
    bookModalId = null;
    bookOverlay.hidden = true;
    if (addOverlay.hidden) document.body.classList.remove("book-sheet-open");
  }

  let notesTimer = null;

  function applyBookField(book, field, el) {
    const value = el.value;
    if (field === "title") {
      const t = value.replace(/\s*\n\s*/g, " ").trim();
      if (t) book.title = t;
    } else if (field === "author") book.author = value.trim();
    else if (field === "notes") book.notes = value;
    else if (field === "pages") book.pages = Math.max(0, parseInt(value, 10) || 0) || null;
    else if (field === "page") book.page = Math.max(0, parseInt(value, 10) || 0);
    else if (field === "started" || field === "finished") book[field] = value || (field === "finished" && book.finished.length === 4 ? book.finished : "");
  }

  bookBody.addEventListener("input", (e) => {
    const el = e.target.closest("[data-field]");
    const book = bookById(bookModalId);
    if (!el || !book) return;
    if (el.dataset.field === "title") sizeTitleInput();
    applyBookField(book, el.dataset.field, el);
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      saveBooks();
      renderReading();
    }, 400);
  });

  bookBody.addEventListener("keydown", (e) => {
    if (e.target.matches(".book-title-input") && e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
    }
  });

  bookBody.addEventListener("click", (e) => {
    const book = bookById(bookModalId);
    if (!book) return;

    const star = e.target.closest("[data-rate]");
    if (star) {
      const n = Number(star.dataset.rate);
      book.rating = book.rating === n ? 0 : n; // tap the same star again to clear
      saveBooks();
      renderBookModal();
      renderReading();
      return;
    }

    const seg = e.target.closest("[data-seg='status'] [data-seg-value]");
    if (seg) {
      setBookStatus(book, seg.dataset.segValue);
      saveBooks();
      renderBookModal();
      renderReading();
      return;
    }

    if (e.target.closest("#book-ai-refresh")) {
      generateBookAi(book.id, { force: true });
      return;
    }

    const del = e.target.closest("#book-delete");
    if (del) {
      if (del.dataset.armed) return deleteBook(book.id);
      del.dataset.armed = "1";
      del.textContent = "Tap again to remove";
      setTimeout(() => {
        if (!del.isConnected) return;
        delete del.dataset.armed;
        del.textContent = "Remove book";
      }, 3000);
    }
  });

  document.getElementById("book-modal-close").addEventListener("click", closeBookModal);
  bookOverlay.addEventListener("click", (e) => {
    if (e.target === bookOverlay) closeBookModal();
  });

  // ---------------------------------------------------------------------------
  // Add sheet: search one book, or paste a whole list

  const addOverlay = document.getElementById("book-add-overlay");
  const searchInput = document.getElementById("book-search-input");
  const searchStatus = document.getElementById("book-search-status");
  const resultsEl = document.getElementById("book-results");
  const pasteInput = document.getElementById("book-paste-input");
  const pasteStatus = document.getElementById("book-paste-status");
  const pasteBtn = document.getElementById("book-paste-go");

  let addMode = "search";
  let addStatus = "read";
  let addWhen = "";
  let searchHits = [];
  let searchSeq = 0;
  let pasting = false;

  function whenOptions() {
    const y = new Date().getFullYear();
    return [
      { id: readMonthKey(), label: "This month" },
      { id: String(y), label: String(y) },
      { id: String(y - 1), label: String(y - 1) },
      { id: "", label: "Earlier" },
    ];
  }

  function renderAddSheet() {
    document.getElementById("book-add-mode").innerHTML = segHtml(
      "mode",
      [
        { id: "search", label: "Search" },
        { id: "paste", label: "Paste a list" },
      ],
      addMode
    );
    document.getElementById("book-add-status").innerHTML = segHtml("add-status", READ_STATUS, addStatus);
    const whenWrap = document.getElementById("book-add-when-wrap");
    whenWrap.hidden = addStatus !== "read";
    document.getElementById("book-add-when").innerHTML = segHtml("when", whenOptions(), addWhen);
    document.getElementById("book-add-search").hidden = addMode !== "search";
    document.getElementById("book-add-paste").hidden = addMode !== "paste";
    renderPasteButton();
    renderResults();
  }

  function renderPasteButton() {
    const n = parsePasteList(pasteInput.value).length;
    pasteBtn.disabled = pasting || n === 0;
    if (!pasting) pasteBtn.textContent = n ? `Add ${n} ${n === 1 ? "book" : "books"}` : "Add books";
  }

  function renderResults() {
    if (!searchHits.length) {
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.innerHTML = searchHits
      .map((hit, i) => {
        const existing = findExisting(hit);
        const facts = [hit.author || "Unknown author", hit.year, hit.pages ? `${hit.pages} p` : ""].filter(Boolean).join(" · ");
        return `
        <li>
          <button type="button" class="book-result${existing ? " is-added" : ""}" data-hit="${i}">
            ${coverHtml(hit)}
            <span class="book-result-body">
              <span class="shelf-title">${readEsc(hit.title)}</span>
              <span class="shelf-meta">${readEsc(facts)}</span>
            </span>
            <span class="book-result-add">${existing ? `${readEsc(READ_STATUS.find((s) => s.id === existing.status).label)} &#10003;` : "+ Add"}</span>
          </button>
        </li>`;
      })
      .join("");
  }

  function openAddSheet(mode = "search") {
    addMode = mode;
    renderAddSheet();
    addOverlay.hidden = false;
    document.body.classList.add("book-sheet-open");
    setTimeout(() => (mode === "search" ? searchInput : pasteInput).focus({ preventScroll: true }), 50);
  }

  function closeAddSheet() {
    addOverlay.hidden = true;
    if (bookOverlay.hidden) document.body.classList.remove("book-sheet-open");
    renderReading();
  }

  async function runSearch(query) {
    const q = query.trim();
    if (!q) return;
    const seq = ++searchSeq;
    searchStatus.textContent = "Searching Open Library…";
    try {
      const hits = await olSearch(q, 12);
      if (seq !== searchSeq) return;
      // Drop summaries/workbooks about a book unless nothing else came back.
      const derivative = /summary of|workbook|study guide|sparknotes|cliffs? ?notes|analysis of|companion|notebook|journal$|\(adaptation\)/i;
      const clean = hits.filter((h) => !derivative.test(h.title) && !derivative.test(h.origTitle || ""));
      const pool = clean.length ? clean : hits;
      // Same-titled works: the one people actually read first.
      searchHits = pool
        .map((hit, i) => ({ hit, rank: titleScore(hit.title, q) + (hit.pop || 0) - i * 0.3 }))
        .sort((a, b) => b.rank - a.rank)
        .map((x) => x.hit)
        .slice(0, 8);
      searchStatus.innerHTML = searchHits.length
        ? `Tap a book to add it. Not there? <button type="button" class="book-link-btn" data-manual="1">Add “${readEsc(q)}” by hand</button>`
        : `Nothing found. <button type="button" class="book-link-btn" data-manual="1">Add “${readEsc(q)}” by hand</button>`;
    } catch (err) {
      if (seq !== searchSeq) return;
      searchHits = [];
      searchStatus.innerHTML = `Search failed (${readEsc(err.message)}). <button type="button" class="book-link-btn" data-manual="1">Add “${readEsc(q)}” by hand</button>`;
    }
    renderResults();
  }

  document.getElementById("book-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    searchInput.blur();
    runSearch(searchInput.value);
  });

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    if (searchInput.value.trim().length < 3) return;
    searchTimer = setTimeout(() => runSearch(searchInput.value), 500);
  });

  // "Title", "Title - Author", "Title — Author" or "Title by Author", with
  // list bullets/numbers stripped.
  function parsePasteList(text) {
    return text
      .split(/\n/)
      .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(.+?)\s+(?:[—–-]|by)\s+(.+)$/i);
        return m ? { title: m[1].trim(), author: m[2].trim() } : { title: line, author: "" };
      });
  }

  async function runPaste() {
    const items = parsePasteList(pasteInput.value);
    if (!items.length || pasting) return;
    pasting = true;
    renderPasteButton();
    let added = 0;
    let skipped = 0;
    const byHand = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      pasteBtn.textContent = `Looking up ${i + 1} of ${items.length}…`;
      let match = null;
      try {
        match = await bestMatch(item.title, item.author);
      } catch {
        match = null;
      }
      const fields = match ? bookFields(match) : { title: item.title, author: item.author };
      if (findExisting(fields) || (!match && findExisting({ title: item.title, author: item.author }))) {
        skipped++;
        continue;
      }
      createBook(fields, addStatus, addWhen);
      added++;
      if (!match) byHand.push(item.title);
      renderReading();
    }
    pasting = false;
    pasteInput.value = "";
    renderPasteButton();
    const bits = [`Added ${added} ${added === 1 ? "book" : "books"}.`];
    if (skipped) bits.push(`${skipped} already on your shelf.`);
    if (byHand.length) bits.push(`No match found for ${byHand.map((t) => `“${t}”`).join(", ")} — added as typed, tap to fill in.`);
    pasteStatus.textContent = bits.join(" ");
    readTab = addStatus === "want" ? "want" : "read";
    renderReading();
  }

  addOverlay.addEventListener("click", (e) => {
    if (e.target === addOverlay) return closeAddSheet();

    const seg = e.target.closest("[data-seg] [data-seg-value]");
    if (seg) {
      const group = seg.closest("[data-seg]").dataset.seg;
      const value = seg.dataset.segValue;
      if (group === "mode") addMode = value;
      if (group === "add-status") addStatus = value;
      if (group === "when") addWhen = value;
      renderAddSheet();
      if (group === "mode") (addMode === "search" ? searchInput : pasteInput).focus({ preventScroll: true });
      return;
    }

    if (e.target.closest("[data-manual]")) {
      const title = searchInput.value.trim();
      if (!title) return;
      const book = createBook({ title }, addStatus, addWhen);
      closeAddSheet();
      openBook(book.id);
      return;
    }

    const hitBtn = e.target.closest("[data-hit]");
    if (hitBtn) {
      const hit = searchHits[Number(hitBtn.dataset.hit)];
      if (!hit) return;
      const existing = findExisting(hit);
      if (existing) {
        closeAddSheet();
        openBook(existing.id);
        return;
      }
      createBook(bookFields(hit), addStatus, addWhen);
      readTab = addStatus === "want" ? "want" : "read";
      renderResults();
      renderReading();
    }
  });

  pasteInput.addEventListener("input", renderPasteButton);
  pasteBtn.addEventListener("click", runPaste);
  document.getElementById("book-add-close").addEventListener("click", closeAddSheet);

  // ---------------------------------------------------------------------------
  // Section events

  const readingSection = document.getElementById("reading-section");

  readingSection.addEventListener("click", (e) => {
    const add = e.target.closest("[data-read-add]");
    if (add) return openAddSheet(add.dataset.readAdd);

    const finish = e.target.closest("[data-finish]");
    if (finish) return finishBook(finish.dataset.finish);

    const open = e.target.closest("[data-book]");
    if (open) return openBook(open.dataset.book);

    const tab = e.target.closest("[data-read-tab]");
    if (tab) {
      readTab = tab.dataset.readTab;
      readFilter = "";
      document.getElementById("read-filter").value = "";
      return renderShelf();
    }

    const view = e.target.closest("[data-read-view]");
    if (view) {
      readView = view.dataset.readView;
      try {
        localStorage.setItem(READ_VIEW_KEY, readView);
      } catch {
        // Just won't be remembered.
      }
      renderShelf();
    }
  });

  readingSection.addEventListener("change", (e) => {
    const pageInput = e.target.closest("[data-page-for]");
    if (pageInput) {
      const book = bookById(pageInput.dataset.pageFor);
      if (!book) return;
      const n = Math.max(0, parseInt(pageInput.value, 10) || 0);
      book.page = book.pages ? Math.min(n, book.pages) : n;
      saveBooks();
      renderReading();
    }
  });

  document.getElementById("read-sort").addEventListener("change", (e) => {
    readSort = e.target.value;
    renderShelf();
  });

  document.getElementById("read-filter").addEventListener("input", (e) => {
    readFilter = e.target.value;
    renderShelf();
  });

  // Broken or missing covers fall back to the drawn placeholder underneath.
  document.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName === "IMG" && e.target.parentElement?.classList.contains("book-cover")) e.target.remove();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!bookOverlay.hidden) closeBookModal();
    else if (!addOverlay.hidden) closeAddSheet();
  });

  renderReading();
})();
