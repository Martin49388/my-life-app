// Reminders: real push notifications, even with the app closed.
//
// How it fits together (see REMINDERS.md for setup):
//   1. This file asks for notification permission and subscribes this
//      device to Web Push (VAPID). The subscription goes into Supabase's
//      `push_subscriptions` table under the signed-in user (RLS: own rows).
//   2. What to be reminded of, and when, lives in localStorage
//      "reminders" — synced like everything else, so the sender reads
//      the same preferences from `app_state` for every device.
//   3. A GitHub Actions job (.github/workflows/reminders.yml) runs every
//      15 minutes, asks Supabase which subscriptions exist plus the few
//      app_state keys it needs, and sends a reminder only when it's due
//      AND still undone: no check-in today, calories not on target,
//      this week not reviewed, a goal behind pace.
//   4. sw.js shows the notification and opens the right section on tap.
//
// iPhone: Web Push only works for the app added to the Home Screen
// (iOS 16.4+), opened from there, and permission must come from a tap.
(function () {
  // Public half of the VAPID key pair — safe to commit, it's what every
  // browser is given anyway. The private half is a GitHub secret.
  const VAPID_PUBLIC_KEY = "BMtpNAuwm4pfKnnKQwMJBe47aOWhyETJJVPWnwFvTS9HS0VmRH_J_Yh9CeuvBgmpnlDPm23JM5kOxWmr7I5j0QY";
  const PREFS_KEY = "reminders";

  const KINDS = [
    { id: "checkin", label: "Morning check-in", hint: "skipped once you've checked in", time: "08:00" },
    { id: "food", label: "Log your food", hint: "skipped when calories are already on target", time: "20:30" },
    { id: "review", label: "Weekly review", hint: "Sundays, skipped once the week is written up", time: "19:00" },
    { id: "goals", label: "Goals slipping", hint: "Mondays, only if a goal is behind pace", time: "09:00" },
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function loadPrefs() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
    } catch {
      saved = {};
    }
    const prefs = {};
    for (const k of KINDS) prefs[k.id] = { on: true, time: k.time, ...(saved[k.id] || {}) };
    return prefs;
  }

  function savePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const configured = !VAPID_PUBLIC_KEY.startsWith("__");

  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function client() {
    return typeof supa !== "undefined" && supa ? supa : null;
  }

  async function currentUser() {
    const c = client();
    if (!c) return null;
    try {
      const { data } = await c.auth.getSession();
      return data?.session?.user || null;
    } catch {
      return null;
    }
  }

  async function currentSubscription() {
    if (!supported) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  function deviceName() {
    if (isIOS) return "iPhone";
    if (/Android/.test(navigator.userAgent)) return "Android";
    if (/Mac/.test(navigator.platform)) return "Mac";
    return "Browser";
  }

  async function saveSubscription(sub) {
    const c = client();
    const json = sub.toJSON();
    const { error } = await c.from("push_subscriptions").upsert(
      {
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        device: deviceName(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
    if (error) throw new Error(error.message);
  }

  async function turnOn() {
    setStatus("Asking for permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Notifications are blocked for Batcave. Allow them in your phone's Settings → Notifications → Batcave, then try again.", "warn");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    await saveSubscription(sub);
    // Make sure the sender sees the preferences right away.
    savePrefs(loadPrefs());
    if (window.syncPushNow) window.syncPushNow();
    await render();
    setStatus("Reminders are on for this device.", "good");
  }

  async function turnOff() {
    const sub = await currentSubscription();
    if (sub) {
      const c = client();
      if (c) await c.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    await render();
    setStatus("Reminders are off for this device.");
  }

  async function sendLocalTest() {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Batcave", {
      body: "This is what a reminder looks like. The real ones only come when something's still undone.",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "batcave-test",
      data: { url: "./index.html#overview" },
    });
  }

  // ---------------------------------------------------------------------
  // Settings card

  const box = document.getElementById("reminders-block");
  const body = document.getElementById("reminders-body");
  const statusEl = document.getElementById("reminders-status");

  function setStatus(text, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  }

  function prefsHtml(prefs, enabled) {
    return `<ul class="rm-list">${KINDS.map(
      (k) => `<li class="rm-row">
        <label class="rm-toggle">
          <input type="checkbox" data-rm-on="${k.id}" ${prefs[k.id].on ? "checked" : ""} ${enabled ? "" : "disabled"} />
          <span class="rm-text"><span class="rm-label">${k.label}</span><span class="rm-hint">${k.hint}</span></span>
        </label>
        <input type="time" class="rm-time" data-rm-time="${k.id}" value="${esc(prefs[k.id].time)}" aria-label="${k.label} time" ${enabled ? "" : "disabled"} />
      </li>`
    ).join("")}</ul>`;
  }

  async function render() {
    if (!box) return;
    const prefs = loadPrefs();
    let state;
    let action = "";
    if (!configured) {
      state = "Reminders aren't set up on the server yet — see REMINDERS.md.";
    } else if (!supported && isIOS && !isStandalone) {
      state = "On iPhone, reminders need Batcave on your Home Screen: tap Share → Add to Home Screen, then open it from there and come back here.";
    } else if (!supported) {
      state = "This browser can't receive push notifications.";
    } else if (!client() || !(await currentUser())) {
      state = "Sign in under Cross-device sync first — reminders are tied to your account so every device gets them.";
      action = `<button type="button" class="empty-btn" data-rm-goto-sync>Go to sign-in ↑</button>`;
    } else {
      const sub = await currentSubscription();
      const on = Boolean(sub) && Notification.permission === "granted";
      state = on ? "On for this device." : "Off for this device.";
      action = on
        ? `<button type="button" class="empty-btn" data-rm-test>Show a sample</button><button type="button" class="gl-ghost-btn" data-rm-off>Turn off here</button>`
        : `<button type="button" class="read-primary-btn" data-rm-on-btn>Turn on reminders</button>`;
    }
    body.innerHTML = `
      <p class="rm-state">${esc(state)}</p>
      ${action ? `<div class="rm-actions">${action}</div>` : ""}
      ${prefsHtml(prefs, true)}`;
  }

  if (box) {
    box.addEventListener("click", async (e) => {
      try {
        if (e.target.closest("[data-rm-on-btn]")) await turnOn();
        else if (e.target.closest("[data-rm-off]")) await turnOff();
        else if (e.target.closest("[data-rm-test]")) await sendLocalTest();
        else if (e.target.closest("[data-rm-goto-sync]")) document.getElementById("sync-email")?.focus();
      } catch (err) {
        setStatus(`Couldn't do that: ${err.message || err}`, "warn");
      }
    });
    box.addEventListener("change", (e) => {
      const prefs = loadPrefs();
      const on = e.target.closest("[data-rm-on]");
      const time = e.target.closest("[data-rm-time]");
      if (on) prefs[on.dataset.rmOn].on = on.checked;
      if (time && /^\d{2}:\d{2}$/.test(time.value)) prefs[time.dataset.rmTime].time = time.value;
      if (on || time) {
        savePrefs(prefs);
        setStatus("Saved.", "good");
      }
    });
  }

  // Tapping a notification opens index.html#<target> (see sw.js).
  function followHash() {
    const target = decodeURIComponent((location.hash || "").slice(1));
    if (!target) return;
    history.replaceState(null, "", location.pathname + location.search);
    if (target === "checkin" && window.openCheckin) {
      window.switchSection?.("overview");
      window.openCheckin();
    } else if (window.switchSection) {
      window.switchSection(target);
    }
  }

  window.addEventListener("hashchange", followHash);
  // After everything else has wired itself up.
  window.addEventListener("load", () => setTimeout(followHash, 50));

  window.renderReminders = render;
  render();
})();
