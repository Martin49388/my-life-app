// Cross-device sync via Supabase. Deliberately simple: every other file
// in this app keeps reading and writing localStorage exactly as before —
// nothing about habits.js/food.js/etc changes. This file just monkey-
// patches localStorage.setItem so any write, from any module, gets
// mirrored (debounced) to one JSON blob per signed-in user in Supabase.
// Signing in on a second device pulls that same blob down and reloads.
//
// This trades away real conflict resolution for simplicity — last write
// wins, same tradeoff already made for client-side API keys elsewhere in
// this app (see decisions log). Fine for one person using two devices;
// not fine for two people editing at once.
//
// Requires a Supabase table (see the SQL Martin was given separately):
//   app_state(user_id uuid primary key, data jsonb, updated_at timestamptz)
// with row-level security limiting each user to their own row.

const SUPA_URL = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL;
const SUPA_KEY = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY;

const supa = SUPA_URL && SUPA_KEY && window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;

let syncUser = null;
let pushTimer = null;
let applyingRemote = false; // guards against re-pushing what we just pulled

function dumpLocalStorage() {
  const obj = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    obj[key] = localStorage.getItem(key);
  }
  return obj;
}

function setSyncStatus(text) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = text;
}

function schedulePush() {
  if (!supa || !syncUser || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToSupabase, 1500);
}

async function pushToSupabase() {
  if (!supa || !syncUser) return;
  setSyncStatus("Syncing…");
  const { error } = await supa
    .from("app_state")
    .upsert({ user_id: syncUser.id, data: dumpLocalStorage(), updated_at: new Date().toISOString() });
  setSyncStatus(error ? `Sync failed: ${error.message}` : `Synced ${new Date().toLocaleTimeString()}`);
}

async function pullFromSupabase() {
  if (!supa || !syncUser) return;
  setSyncStatus("Checking for updates…");
  const { data: row, error } = await supa
    .from("app_state")
    .select("data")
    .eq("user_id", syncUser.id)
    .maybeSingle();

  if (error) {
    setSyncStatus(`Sync failed: ${error.message}`);
    return;
  }
  if (!row || !row.data) {
    setSyncStatus("No synced data yet — this device's data will upload on the next change.");
    return;
  }

  const remote = JSON.stringify(row.data);
  const local = JSON.stringify(dumpLocalStorage());
  if (remote === local) {
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
    return;
  }

  // Different device, or this one's behind — take the remote copy and
  // reload so every module re-reads fresh state from localStorage.
  applyingRemote = true;
  localStorage.clear();
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
  schedulePush();
};

function renderAccountUI() {
  const signedOut = document.getElementById("account-signed-out");
  const signedIn = document.getElementById("account-signed-in");
  if (!signedOut || !signedIn) return;
  signedOut.hidden = !!syncUser;
  signedIn.hidden = !syncUser;
  if (syncUser) document.getElementById("account-email-display").textContent = syncUser.email;
}

function setAccountStatus(text) {
  const el = document.getElementById("account-status");
  if (el) el.textContent = text;
}

async function initSync() {
  if (!supa) {
    setAccountStatus("Sync isn't configured (missing Supabase keys in config.js).");
    return;
  }

  const {
    data: { session },
  } = await supa.auth.getSession();
  syncUser = session ? session.user : null;
  renderAccountUI();
  if (syncUser) await pullFromSupabase();

  supa.auth.onAuthStateChange(async (_event, session) => {
    syncUser = session ? session.user : null;
    renderAccountUI();
    if (syncUser) await pullFromSupabase();
  });

  const form = document.getElementById("account-signin-form");
  const signupBtn = document.getElementById("account-signup-btn");
  const signoutBtn = document.getElementById("account-signout-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("account-email").value.trim();
    const password = document.getElementById("account-password").value;
    setAccountStatus("Signing in…");
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setAccountStatus(error ? error.message : "");
  });

  signupBtn.addEventListener("click", async () => {
    const email = document.getElementById("account-email").value.trim();
    const password = document.getElementById("account-password").value;
    if (!email || !password) {
      setAccountStatus("Enter an email and password first.");
      return;
    }
    setAccountStatus("Creating account…");
    const { error } = await supa.auth.signUp({ email, password });
    setAccountStatus(error ? error.message : "Check your email to confirm, then sign in.");
  });

  signoutBtn.addEventListener("click", async () => {
    await supa.auth.signOut();
  });

  if (sessionStorage.getItem("just-synced")) {
    sessionStorage.removeItem("just-synced");
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
  }
}

initSync();
