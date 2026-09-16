// Cross-device sync via Supabase Auth — email only, no password.
//
// Settings -> "Cross-device sync" asks for just an email address. Supabase
// emails a 6-digit one-time code; typing it back in signs you in (and
// creates the account on first use — no separate "sign up" step). Every
// device signed in with the same email reads/writes the same row.
//
// This app has no backend, so the Supabase project URL and anon/publishable
// key below are committed and public-by-design (that's how every
// client-side Supabase app works) — the anon key alone can't reach another
// user's data because of the row-level-security policies in SUPABASE.md,
// which key access off the authenticated user's id (auth.uid()), not off
// this key. See SUPABASE.md for the one-time project setup.
//
// This replaces two earlier versions:
//   1. Email/password via Supabase Auth — dropped after real friction:
//      unconfirmed-email accounts, "invalid credentials" from password
//      typos across devices, and password-reset links pointing at
//      localhost instead of the live app.
//   2. A no-login "Sync ID" scheme (paste URL + anon key + a shared random
//      ID into every device) — worked, but every device needed the project
//      URL and key hand-copied, and the shared row had no real per-user
//      access control.
// This version keeps password-reset/typo problems off the table entirely
// (there's no password) by using a typed-in code instead of a clickable
// magic link, which also sidesteps the old redirect-URL problem — there's
// no redirect at all, verifyOtp() below takes the code straight from the
// email.

const SUPABASE_URL = "https://yzlrkxtgsozkoqkkyqxg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kWUfqWgNz9p38M8gwzem9w_fWmmEXIf";

// Keys the Supabase client itself uses to persist the session — never sync
// or wipe these, or every pull would sign the device back out.
function isSupabaseInternalKey(key) {
  return key.startsWith("sb-");
}

let supa = null;
if (window.supabase && !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("YOUR-ANON")) {
  // Explicit rather than relying on the library's defaults (which are the
  // same values) — this only rules out ambiguity about where the session
  // lives, it does not change iOS's own decisions about when it evicts a
  // home-screen web app's storage, which is the actual cause of getting
  // signed out on iOS after fully closing the app.
  supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  });
}

let session = null;
let pushTimer = null;
let applyingRemote = false; // guards against re-pushing what we just pulled

// A brand-new sign-in kicks off an async pull (a network round trip) to
// fetch whatever's already synced. Until that first pull actually
// resolves, this device's own localStorage may still hold its own
// pre-merge state (its previous local-only data, or defaults other
// modules write in on page load) — not yet reconciled with the server.
// If a push were allowed to fire during that window (it only takes the
// 1.5s debounce below, often faster than the pull's round trip), it
// would upload that unmerged state and silently clobber whatever the
// other device had already synced. This gate blocks every push until
// the first pull after sign-in has completed and confirmed the local
// and remote copies actually agree (or seeded the remote row itself).
let syncReady = false;

function dumpLocalStorage() {
  const obj = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (isSupabaseInternalKey(key)) continue; // never sync auth session tokens
    obj[key] = localStorage.getItem(key);
  }
  return obj;
}

function setSyncStatus(text) {
  const el = document.getElementById("sync-status");
  if (el) el.textContent = text;
}

// Every .sync-badge: the sidebar's (desktop) and the phone header's.
function setSynced(isSynced) {
  document.querySelectorAll(".sync-badge").forEach((badge) => {
    badge.hidden = !isSynced;
  });
}

// Postgres's jsonb column type does not preserve object key order (it
// decomposes into its own canonical binary form), so a plain
// JSON.stringify() comparison between what we pushed and what comes back
// almost never matches even when the data is identical. Sorting keys
// before comparing makes the check order-independent.
function stableStringify(obj) {
  return JSON.stringify(Object.keys(obj).sort().map((key) => [key, obj[key]]));
}

function schedulePush() {
  if (!supa || !session || applyingRemote || !syncReady) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToSupabase, 1500);
}

async function pushToSupabase() {
  if (!supa || !session) return;
  setSyncStatus("Syncing…");
  setSynced(false);
  const { error } = await supa
    .from("app_state")
    .upsert({ user_id: session.user.id, data: dumpLocalStorage(), updated_at: new Date().toISOString() });
  setSyncStatus(error ? `Sync failed: ${error.message}` : `Synced ${new Date().toLocaleTimeString()}`);
  setSynced(!error);
}

async function pullFromSupabase() {
  if (!supa || !session) return;
  setSyncStatus("Checking for updates…");
  setSynced(false);
  const { data: row, error } = await supa
    .from("app_state")
    .select("data")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    setSyncStatus(`Sync failed: ${error.message}`);
    return;
  }
  if (!row || !row.data) {
    setSyncStatus("No synced data yet for this account — this device's data will upload shortly.");
    syncReady = true;
    schedulePush();
    return;
  }

  const remote = stableStringify(row.data);
  const local = stableStringify(dumpLocalStorage());
  if (remote === local) {
    syncReady = true;
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
    setSynced(true);
    return;
  }

  // Different device, or this one's behind — take the remote copy and
  // reload so every module re-reads fresh state from localStorage. This
  // device's own Supabase session survives the wipe.
  applyingRemote = true;
  const keepEntries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (isSupabaseInternalKey(key)) keepEntries.push([key, localStorage.getItem(key)]);
  }
  localStorage.clear();
  // Write straight through the original, unpatched setItem here — not the
  // wrapped one below. Every other module (quotes.js's Gemini call,
  // news.js, markets.js, ...) can still have an async write in flight from
  // before this pull started, working off its own now-stale in-memory
  // copy of the data. If one of those lands on the wrapped setItem while
  // we're mid-restore, it silently clobbers the remote copy we're about to
  // reload with, and since the reload just re-reads whatever is currently
  // in localStorage, that stale write becomes the new "local" state --
  // which then reads as different from remote all over again, restarting
  // this exact process. That's the infinite reload loop ("bugging") this
  // guards against: it only ever showed up signed in, because signed-out
  // devices never take this restore-then-reload path at all.
  for (const [key, value] of keepEntries) _origSetItem(key, value);
  for (const [key, value] of Object.entries(row.data)) {
    _origSetItem(key, value);
  }
  sessionStorage.setItem("just-synced", "1");
  // A bare, immediate location.reload() risks iOS Safari/WKWebView
  // tearing the page down before these localStorage writes — including
  // the Supabase session key we just restored above — are actually
  // flushed to disk, not just written to the in-memory store. That's a
  // known iOS quirk and a plausible cause of a device getting signed out
  // after a sync-triggered reload. A short delay first gives it a moment
  // to flush before the page goes away.
  setTimeout(() => location.reload(), 150);
}

// Every other file's localStorage.setItem calls (habits.js's saveHabits,
// food.js, journal.js, blueprint.js, all of it) flow through here too,
// since this is the same global localStorage object everyone shares.
const _origSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (key, value) {
  // A remote copy is being written in and a reload is already scheduled
  // (see pullFromSupabase) -- drop any write that isn't that restore
  // itself (which bypasses this wrapper via _origSetItem). Anything else
  // reaching here during that window is necessarily based on
  // pre-restore state and would otherwise overwrite the freshly-applied
  // remote data before the reload picks it up. Supabase's own session
  // keys still pass through so an in-flight token refresh isn't dropped.
  if (applyingRemote && !isSupabaseInternalKey(key)) return;
  _origSetItem(key, value);
  if (!isSupabaseInternalKey(key)) schedulePush();
};

function showStep(step) {
  const emailForm = document.getElementById("sync-email-form");
  const codeForm = document.getElementById("sync-code-form");
  const accountBlock = document.getElementById("sync-account-block");
  if (!emailForm) return;
  emailForm.hidden = step !== "email";
  codeForm.hidden = step !== "code";
  accountBlock.hidden = step !== "account";
}

function renderSignedIn() {
  const emailEl = document.getElementById("sync-account-email");
  if (emailEl) emailEl.textContent = `Signed in as ${session.user.email}`;
  showStep("account");
}

async function initSync() {
  // Form listeners are wired up unconditionally, and every listener
  // preventDefault()s before anything else — otherwise, when Supabase
  // isn't configured yet (or the library failed to load), clicking
  // "Send code" falls through to a plain, un-intercepted HTML form
  // submit, which just reloads the page and looks exactly like nothing
  // happened. That silent failure is what actually broke the first time.
  const emailForm = document.getElementById("sync-email-form");
  const codeForm = document.getElementById("sync-code-form");
  const cancelBtn = document.getElementById("sync-code-cancel-btn");
  const signoutBtn = document.getElementById("sync-signout-btn");

  let pendingEmail = "";

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!window.supabase) {
      setSyncStatus("Supabase library failed to load — check your connection and reload.");
      return;
    }
    if (!supa) {
      setSyncStatus("Sync isn't configured yet — Supabase project URL/key are still placeholders in sync.js. See SUPABASE.md.");
      return;
    }
    const email = document.getElementById("sync-email").value.trim();
    if (!email) {
      setSyncStatus("Enter an email first.");
      return;
    }
    setSyncStatus("Sending code…");
    const { error } = await supa.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) {
      setSyncStatus(`Couldn't send code: ${error.message}`);
      return;
    }
    pendingEmail = email;
    setSyncStatus(`Code sent to ${email} — check your inbox.`);
    showStep("code");
  });

  codeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supa) return;
    const token = document.getElementById("sync-code").value.trim();
    if (!token) return;
    setSyncStatus("Verifying…");
    const { error } = await supa.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    if (error) {
      setSyncStatus(`Couldn't verify: ${error.message}`);
      return;
    }
    document.getElementById("sync-code").value = "";
    // onAuthStateChange (SIGNED_IN) takes it from here.
  });

  cancelBtn.addEventListener("click", () => {
    document.getElementById("sync-code").value = "";
    showStep("email");
    setSyncStatus("Not signed in");
  });

  signoutBtn.addEventListener("click", async () => {
    if (!supa) return;
    await supa.auth.signOut();
    // onAuthStateChange (SIGNED_OUT) takes it from here. Local data on
    // this device is left alone — signing out just disconnects sync.
  });

  if (!window.supabase) {
    setSyncStatus("Supabase library failed to load — check your connection.");
    return;
  }
  if (!supa) {
    setSyncStatus("Sync isn't configured yet — Supabase project URL/key are still placeholders in sync.js. See SUPABASE.md.");
    showStep("email");
    return;
  }

  const { data } = await supa.auth.getSession();
  session = data.session;
  if (session) {
    renderSignedIn();
    setSyncStatus("Connecting…");
    pullFromSupabase();
  } else {
    showStep("email");
    setSyncStatus("Not signed in");
    setSynced(false);
  }

  supa.auth.onAuthStateChange((event, newSession) => {
    session = newSession;
    if (event === "SIGNED_IN" && session) {
      renderSignedIn();
      setSyncStatus("Connecting…");
      pullFromSupabase();
    } else if (event === "SIGNED_OUT") {
      showStep("email");
      setSyncStatus("Not signed in");
      setSynced(false);
    }
  });

  if (sessionStorage.getItem("just-synced")) {
    sessionStorage.removeItem("just-synced");
    setSyncStatus(`Synced ${new Date().toLocaleTimeString()}`);
  }
}

initSync();
