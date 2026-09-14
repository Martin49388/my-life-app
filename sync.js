// Cross-device sync via Supabase — no login. Instead of email/password
// accounts (which kept breaking: unconfirmed emails, password resets
// pointing at localhost, "invalid credentials" typos across devices),
// every device just pastes the same three values into Settings: your
// Supabase project's URL, its anon/publishable key, and a shared "Sync
// ID" you generate once and copy to every other device. All devices
// using that Sync ID read and write the same row.
//
// See SUPABASE.md for the one-time project setup (the app_state table
// and its policies).
//
// Security tradeoff, on purpose: there's no real per-user auth here —
// anyone who has your anon key AND happens to know your Sync ID could
// read or write that row. Fine for one person's own devices, same class
// of tradeoff already accepted for the app's other client-side API keys
// (see decisions log). Don't publish your Sync ID anywhere public.

const SYNC_CONFIG_KEY = "batcave-sync-config";

function loadSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSyncConfig(cfg) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(cfg));
}

let config = loadSyncConfig();
let supa = null;
let pushTimer = null;
let applyingRemote = false; // guards against re-pushing what we just pulled

function buildClient() {
  supa = config.url && config.key && window.supabase ? window.supabase.createClient(config.url, config.key) : null;
}
buildClient();

function dumpLocalStorage() {
  const obj = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === SYNC_CONFIG_KEY) continue; // never sync this device's own connection settings
    obj[key] = localStorage.getItem(key);
  }
  return obj;
}

function setSyncStatus(text) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = text;
}

// Postgres's jsonb column type does not preserve object key order (it
// decomposes into its own canonical binary form), so a plain
// JSON.stringify() comparison between what we pushed and what comes back
// almost never matches even when the data is identical — that false
// mismatch was wiping localStorage and reloading on every single open.
// Sorting keys before comparing makes the check order-independent.
function stableStringify(obj) {
  return JSON.stringify(Object.keys(obj).sort().map((key) => [key, obj[key]]));
}

function schedulePush() {
  if (!supa || !config.id || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToSupabase, 1500);
}

async function pushToSupabase() {
  if (!supa || !config.id) return;
  setSyncStatus("Syncing…");
  const { error } = await supa
    .from("app_state")
    .upsert({ sync_id: config.id, data: dumpLocalStorage(), updated_at: new Date().toISOString() });
  setSyncStatus(error ? `Sync failed: ${error.message}` : `Synced ${new Date().toLocaleTimeString()}`);
}

async function pullFromSupabase() {
  if (!supa || !config.id) return;
  setSyncStatus("Checking for updates…");
  const { data: row, error } = await supa.from("app_state").select("data").eq("sync_id", config.id).maybeSingle();

  if (error) {
    setSyncStatus(`Sync failed: ${error.message}`);
    return;
  }
  if (!row || !row.data) {
    setSyncStatus("No synced data yet under this Sync ID — this device's data will upload shortly.");
    schedulePush();
    return;
  }

  const remote = stableStringify(row.data);
  const local = stableStringify(dumpLocalStorage());
  if (remote === local) {
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
    return;
  }

  // Different device, or this one's behind — take the remote copy and
  // reload so every module re-reads fresh state from localStorage. This
  // device's own connection config survives the wipe.
  applyingRemote = true;
  const keepConfig = config;
  localStorage.clear();
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(keepConfig));
  for (const [key, value] of Object.entries(row.data)) {
    localStorage.setItem(key, value);
  }
  sessionStorage.setItem("just-synced", "1");
  location.reload();
}

// Every other file's localStorage.setItem calls (habits.js's saveHabits,
// food.js, journal.js, blueprint.js, all of it) flow through here too,
// since this is the same global localStorage object everyone shares.
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (key, value) {
  _origSetItem(key, value);
  if (key !== SYNC_CONFIG_KEY) schedulePush();
};

function renderSyncForm() {
  const urlEl = document.getElementById("sync-url");
  const keyEl = document.getElementById("sync-key");
  const idEl = document.getElementById("sync-id");
  if (!urlEl) return;
  urlEl.value = config.url || "";
  keyEl.value = config.key || "";
  idEl.value = config.id || "";
}

function initSync() {
  renderSyncForm();

  if (!window.supabase) {
    setSyncStatus("Supabase library failed to load — check your connection.");
  } else if (config.url && config.key && config.id) {
    setSyncStatus("Connecting…");
    pullFromSupabase();
  } else {
    setSyncStatus("Not connected yet — paste your Supabase project's URL, key, and a Sync ID below.");
  }

  const form = document.getElementById("sync-config-form");
  const generateBtn = document.getElementById("sync-generate-btn");
  if (!form || !generateBtn) return;

  generateBtn.addEventListener("click", () => {
    document.getElementById("sync-id").value = `bc-${crypto.randomUUID()}`;
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const next = {
      url: document.getElementById("sync-url").value.trim(),
      key: document.getElementById("sync-key").value.trim(),
      id: document.getElementById("sync-id").value.trim(),
    };
    if (!next.url || !next.key || !next.id) {
      setSyncStatus("Fill in all three fields (use Generate for the Sync ID on the first device).");
      return;
    }
    config = next;
    saveSyncConfig(config);
    buildClient();
    setSyncStatus("Connecting…");
    pullFromSupabase();
  });

  if (sessionStorage.getItem("just-synced")) {
    sessionStorage.removeItem("just-synced");
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
  }
}

initSync();
