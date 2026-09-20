// Backup — export everything this app knows to a file you keep, and
// restore it again.
//
// Why this exists: every byte lives in this browser's localStorage.
// Supabase sync is a mirror, not a backup — its whole job is to make
// every device agree, which means a bad write or an accidental wipe
// agrees everywhere too, immediately. And on iOS, localStorage for a
// site that isn't installed to the home screen is evicted after about a
// week of not being opened. Until this file existed there was no second
// copy of any of it that Martin controlled.
//
// What the file contains: every localStorage key except two classes,
// both deliberately left out so the backup is safe to mail to yourself
// or drop in iCloud —
//   - `sb-*`, Supabase's own auth session tokens. A live session sitting
//     in a file that gets passed around is a bad idea, and it is
//     re-obtained by signing in again.
//   - `*-api-key`, the four client-side keys (Gemini, FoodData, Finnhub,
//     Twelve Data). Same reasoning; Settings is where they came from and
//     where they go back.
// Both classes are also left untouched on this device by a restore, so
// restoring a backup never signs you out or clears your keys.
//
// The storage shape is deliberately identical to sync.js's
// dumpLocalStorage() — a flat { key: rawStringValue } map — so a
// Supabase `app_state.data` row pasted into a file is a valid backup
// too, and vice versa.

(function () {
  const BACKUP_VERSION = 1;
  const LAST_BACKUP_KEY = "backup-last";
  const STALE_DAYS = 30;

  // Kept out of the file AND preserved across a restore. See the header.
  function isExcludedKey(key) {
    return key.startsWith("sb-") || key.endsWith("-api-key");
  }

  function snapshot() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (isExcludedKey(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function buildFile() {
    const data = snapshot();
    return {
      app: "batcave",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      keyCount: Object.keys(data).length,
      data,
    };
  }

  function fileName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `batcave-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  }

  // ------------------------------------------------------------------ UI

  function setStatus(text, tone) {
    const el = document.getElementById("backup-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-warn", tone === "warn");
    el.classList.toggle("is-good", tone === "good");
  }

  function daysSince(iso) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return null;
    return Math.floor((Date.now() - then.getTime()) / 86400000);
  }

  // The resting state of the status line: how much there is, how long
  // it's been, and a nudge once it's been too long. Deliberately just
  // this one line in Settings rather than a banner somewhere you can't
  // escape — a backup you get nagged about is a backup you learn to
  // dismiss.
  function renderStatus() {
    const count = Object.keys(snapshot()).length;
    const last = localStorage.getItem(LAST_BACKUP_KEY);
    if (!last) {
      setStatus(`${count} keys of data on this device, never backed up.`, "warn");
      return;
    }
    const days = daysSince(last);
    if (days === null) {
      setStatus(`${count} keys of data on this device.`);
      return;
    }
    const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    setStatus(`${count} keys of data. Last backup ${when}.`, days >= STALE_DAYS ? "warn" : "good");
  }

  function markBackedUp() {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  }

  // -------------------------------------------------------------- Export

  function exportToFile() {
    const name = fileName();
    try {
      const blob = new Blob([JSON.stringify(buildFile(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a timer rather than immediately: Safari reads the blob
      // after the click returns, and revoking synchronously there hands
      // you an empty file.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      markBackedUp();
      setStatus(`Saved ${name} to your downloads.`, "good");
    } catch (err) {
      setStatus(`Couldn't build the file (${err.message}). Try "Copy to clipboard" instead.`, "warn");
    }
  }

  // The iOS fallback. A standalone home-screen PWA has no visible
  // downloads folder and an <a download> there can dead-end silently, so
  // there has to be a second way to get the data off the device — paste
  // it into Notes, into a mail to yourself, anywhere at all.
  async function copyToClipboard() {
    const json = JSON.stringify(buildFile());
    try {
      await navigator.clipboard.writeText(json);
      markBackedUp();
      setStatus(`Copied ${json.length.toLocaleString()} characters — paste it somewhere safe.`, "good");
    } catch {
      setStatus('Clipboard blocked by the browser. Use "Download backup" instead.', "warn");
    }
  }

  // -------------------------------------------------------------- Import

  // Accepts either a file this module wrote, or a bare { key: value } map
  // — which is exactly what Supabase stores in app_state.data — so a row
  // copied out of the Supabase dashboard restores without reshaping.
  function extractData(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const inner = parsed.data;
    const candidate = inner && typeof inner === "object" && !Array.isArray(inner) ? inner : parsed;
    const keys = Object.keys(candidate);
    if (!keys.length) return null;
    // Every value in a localStorage dump is a string. If they aren't,
    // this is some other JSON file that happens to be an object, and
    // restoring it would write "[object Object]" into every key.
    if (!keys.every((key) => typeof candidate[key] === "string")) return null;
    return candidate;
  }

  function restore(data) {
    // Clear this device's own data first, so the restore is a true
    // snapshot rather than a merge that leaves orphans from whatever was
    // here before — but keep the auth session and the API keys, which
    // belong to the device rather than to the backup.
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isExcludedKey(key)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);

    // Straight through the normal (sync-wrapped) setItem: sync.js
    // debounces, so the whole restore costs one push, not one per key.
    for (const [key, value] of Object.entries(data)) {
      if (isExcludedKey(key)) continue;
      localStorage.setItem(key, value);
    }
  }

  // A restore is the most destructive thing in the app, so it takes two
  // deliberate acts: pick a file, then confirm on the button. The file is
  // parsed and validated at pick time, so the confirmation can say
  // exactly what is about to replace what, instead of asking "are you
  // sure?" about an unknown.
  let pending = null;
  let armedTimer = null;

  function disarm() {
    pending = null;
    clearTimeout(armedTimer);
    const btn = document.getElementById("backup-import-btn");
    if (btn) {
      btn.textContent = "Restore backup";
      btn.classList.remove("is-armed");
    }
  }

  async function handleFile(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setStatus("That file isn't valid JSON.", "warn");
      return;
    }
    const data = extractData(parsed);
    if (!data) {
      setStatus("That doesn't look like a BatCave backup.", "warn");
      return;
    }

    pending = data;
    const count = Object.keys(data).length;
    const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : "an unknown date";
    const btn = document.getElementById("backup-import-btn");
    if (btn) {
      btn.textContent = "Replace everything — tap to confirm";
      btn.classList.add("is-armed");
    }
    setStatus(`${count} keys, saved ${when}. Restoring replaces everything on this device.`, "warn");

    // Disarms itself, so a primed confirmation can't sit there for the
    // rest of the session and catch a later, unrelated tap.
    clearTimeout(armedTimer);
    armedTimer = setTimeout(() => {
      disarm();
      renderStatus();
    }, 30000);
  }

  async function confirmRestore() {
    const data = pending;
    disarm();
    if (!data) return;

    restore(data);
    setStatus(`Restored ${Object.keys(data).length} keys. Syncing and reloading…`, "good");

    // Push before reloading. Without this the reload races sync.js's
    // pull, which would read the restored data as "this device is
    // behind" and hand the old copy straight back.
    try {
      if (window.syncPushNow) await window.syncPushNow();
    } catch {
      // A failed push still leaves the restore correct on this device.
    }
    location.reload();
  }

  // -------------------------------------------------------------- Wiring

  const exportBtn = document.getElementById("backup-export-btn");
  const copyBtn = document.getElementById("backup-copy-btn");
  const importBtn = document.getElementById("backup-import-btn");
  const fileInput = document.getElementById("backup-file");
  if (!exportBtn || !fileInput || !importBtn) return;

  exportBtn.addEventListener("click", () => {
    exportToFile();
  });
  if (copyBtn) copyBtn.addEventListener("click", copyToClipboard);
  importBtn.addEventListener("click", () => {
    if (pending) confirmRestore();
    else fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    // Reset first, so picking the same file again later still fires a
    // change event.
    fileInput.value = "";
    if (file) handleFile(file);
  });

  renderStatus();

  // Alfred and anything else that wants the whole picture in one object.
  window.backupSnapshot = buildFile;
})();
