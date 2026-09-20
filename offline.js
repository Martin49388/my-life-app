// Registers the service worker, and owns the two small pieces of UI that
// come with it: an "Offline" pill when the network is gone, and an
// "Update ready" pill when a new version has been downloaded and is
// waiting to take over.
//
// Nothing in here reloads the page by itself. sync.js's long comment in
// pullFromSupabase is this repo's standing argument against code that
// decides on its own to reload — the update applies only when the pill is
// tapped.
//
// The offline state is also published as `data-offline` on <html>, so any
// section that wants to explain itself while the network is down (Markets
// sitting at "Loading…", News with no feed) can style or branch off it
// without each one having to listen for the events separately.

(function () {
  // ------------------------------------------------------------- Pills

  const bar = document.createElement("div");
  bar.className = "app-status";
  bar.id = "app-status";
  document.body.appendChild(bar);

  function pill(id) {
    return bar.querySelector(`[data-pill="${id}"]`);
  }

  function showPill(id, text, action) {
    let el = pill(id);
    if (!el) {
      el = document.createElement(action ? "button" : "span");
      if (action) el.type = "button";
      el.className = "app-status-pill";
      el.dataset.pill = id;
      if (action) el.addEventListener("click", action);
      bar.appendChild(el);
    }
    el.textContent = text;
  }

  function hidePill(id) {
    const el = pill(id);
    if (el) el.remove();
  }

  // ----------------------------------------------------------- Offline

  function renderOnlineState() {
    const offline = !navigator.onLine;
    document.documentElement.toggleAttribute("data-offline", offline);
    // Short enough for one line at 390px. Everything the app does with
    // its own data still works offline, so the pill only needs to explain
    // the part that doesn't: prices, headlines, Alfred.
    if (offline) showPill("offline", "Offline — live data paused");
    else hidePill("offline");
  }

  window.addEventListener("online", renderOnlineState);
  window.addEventListener("offline", renderOnlineState);
  renderOnlineState();

  // ----------------------------------------------------- Service worker

  if (!("serviceWorker" in navigator)) return;
  // A service worker needs a secure context: https:// in the real world,
  // localhost while developing. Opening index.html straight off the disk
  // as a file:// URL is neither, and registering there throws.
  if (location.protocol === "file:") return;

  // Set only by tapping the update pill. controllerchange fires on a
  // first install too — the worker's clients.claim() takes control of the
  // page that just registered it — and reloading there would mean every
  // first visit, and every update activation, silently reloaded itself.
  let updateRequested = false;

  function offerUpdate(worker) {
    showPill("update", "Update ready — tap to reload", () => {
      updateRequested = true;
      worker.postMessage("SKIP_WAITING");
    });
  }

  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      // Already waiting when the page loaded — an update finished
      // downloading during a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", () => {
          // `controller` is null on the very first install on the very
          // first visit. Offering an "update" there would be nonsense —
          // there is nothing to update from.
          if (incoming.state === "installed" && navigator.serviceWorker.controller) offerUpdate(incoming);
        });
      });
    })
    .catch(() => {
      // A failed registration isn't worth bothering anyone about: the app
      // behaves exactly as it did before this file existed, just without
      // the offline copy.
    });

  // The new worker has taken control. Reload only if that happened
  // because the user asked for it above — never on a first install, and
  // never twice.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });
})();
