// Batcave smoke test — runs on every push (.github/workflows/test.yml),
// or locally: npm install && npx playwright install chromium && npm test
//
// Serves the repo, opens it in headless Chromium at desktop and phone
// size with a realistic data set, and fails on any page error, any
// section that doesn't render, any file the service worker would cache
// but can't fetch, or any broken core rule (calorie target, goal pace,
// linked goals, planner parsing).
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".md": "text/plain" };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

const D = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fixture = {
  habits: [{ id: "h1", name: "Meditate", history: { [D(0)]: true, [D(-1)]: true }, perWeek: 7 }],
  goals: [
    { id: "g1", name: "Read 12 books", term: "long", target: 12, unit: "books", current: 0, deadline: `${new Date().getFullYear()}-12-31`, created: `${new Date().getFullYear()}-01-01`, start: 0, source: { type: "books", from: `${new Date().getFullYear()}-01-01` } },
    { id: "g2", name: "Bench 100 kg", term: "short", target: 100, unit: "kg", current: 80, deadline: D(40), created: D(-50), start: 75, step: 2.5 },
    { id: "g3", name: "Get down to 80 kg", term: "short", target: 80, unit: "kg", current: 90, deadline: D(60), created: D(-30), start: 92 },
  ],
  books: [{ id: "b1", title: "Atomic Habits", status: "read", finished: D(0).slice(0, 7), pages: 300 }],
  food: { target: 3500, goal: "bulk", days: { [D(0)]: [{ id: "f1", name: "Oats", kcal: 3400, protein: 30, meal: "Breakfast" }] } },
  "week-plan": { mon: [{ id: "p1", start: "09:00", end: "17:00", title: "Work" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  weight: { log: { [D(-1)]: 86 }, times: {} },
};
const SECTIONS = ["overview", "habits", "goals", "blueprint", "review", "fitness", "fuel", "recovery", "reading", "briefing", "notes", "settings", "alfred"];

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const browser = await chromium.launch();
for (const [label, opts] of [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext(opts);
  // Only the app itself: CDNs and APIs are not part of the test.
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((x) => {
    localStorage.clear();
    for (const k in x) localStorage.setItem(k, JSON.stringify(x[k]));
  }, fixture);
  await page.reload();
  await page.waitForTimeout(600);

  for (const s of SECTIONS) {
    await page.evaluate((id) => window.switchSection(id), s);
    await page.waitForTimeout(120);
    const shown = await page.evaluate((id) => {
      const el = document.getElementById(`${id}-section`);
      return !!el && !el.hidden && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 100;
    }, s);
    check(shown, `${label}: ${s} renders`);
  }

  // Every file the service worker precaches must exist.
  const missing = await page.evaluate(async () => {
    const sw = await (await fetch("sw.js")).text();
    const list = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== "config.js");
    const bad = [];
    for (const f of list) if (!(await fetch(f)).ok) bad.push(f);
    return bad;
  });
  check(missing.length === 0, `${label}: every precached file exists${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);

  // Every stylesheet in index.html loaded and parsed.
  const sheets = await page.evaluate(() => [...document.styleSheets].filter((s) => s.href && s.href.includes("/css/")).map((s) => s.cssRules.length));
  check(sheets.length >= 20 && sheets.every((n) => n > 0), `${label}: ${sheets.length} stylesheets loaded`);

  // Core rules.
  const rules = await page.evaluate(() => ({
    bulkMet: window.kcalStatus(3400).met,
    bulkUnder: window.kcalStatus(800).met,
    books: goals.find((g) => g.id === "g1").current,
    weightDir: window.goalDir(goals.find((g) => g.id === "g3")),
    weightPct: Math.round(window.goalPct(goals.find((g) => g.id === "g3"))),
    benchStatus: window.goalStatus(goals.find((g) => g.id === "g2")).status,
    plan: window.alfredPlanner.parseDraft(JSON.stringify({ days: { mon: [{ start: "7:00", end: "08:00", title: "Gym" }, { start: "25:00", title: "bad" }] } })).days.mon.length,
  }));
  check(rules.bulkMet === true && rules.bulkUnder === false, `${label}: calorie target rule (bulk)`);
  check(rules.books === 1, `${label}: linked goal counts finished books`);
  check(rules.weightDir === -1 && rules.weightPct === 17, `${label}: countdown goal progress (${rules.weightPct}%)`);
  check(rules.benchStatus === "behind", `${label}: goal pace status`);
  check(rules.plan === 1, `${label}: planner drops invalid blocks`);

  // Add a goal through the sheet.
  await page.evaluate(() => window.switchSection("goals"));
  await page.click(".read-topline [data-goal-new]");
  await page.fill("#goal-sheet [name=name]", "Smoke test goal");
  await page.fill("#goal-sheet [name=target]", "5");
  await page.click("#goal-sheet-submit");
  const added = await page.evaluate(() => goals.some((g) => g.name === "Smoke test goal"));
  check(added, `${label}: add a goal through the sheet`);

  check(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors.join(" | ")})` : ""}`);
  await ctx.close();
}
await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
