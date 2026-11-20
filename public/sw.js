// EAD Chantier's service worker: what lets the app open at a site without
// signal. Hand-written and small on purpose. For each request it only
// chooses between the network and four caches:
//
//   shell   the app's page, the same for every address. The page stores it
//           itself, once all of its code is on the device
//           (src/client/pwa/shell.ts): a stored shell never waits, offline,
//           for code that was not downloaded.
//   static  hashed code and fonts (/_next/static/) and the /brand/ images.
//           Code of earlier versions is left in place: an open tab may still
//           need it. The page drops the old shell's own files when it stores
//           a new one; the rest goes the day this cache changes its name.
//   seen    plan tiles, thumbnails and photos that were displayed. Bounded.
//   kept    projects kept on purpose (src/client/pwa/kept.ts). Written by
//           the page, never trimmed here.
//
// Everything else goes straight to the network, /api/ above all: what the
// app fetches is kept by the app itself (TanStack Query, in IndexedDB).
//
// A name changes only when what its cache holds can no longer be used as it
// is; that cache is then emptied on the next launch and filled again with a
// network. The names are shared with src/client/pwa/caches.ts.
const SHELL = "ead-shell-v1";
const STATIC = "ead-static-v1";
const SEEN = "ead-seen-v1";
const KEPT = "ead-kept-v1";
const CACHES = [SHELL, STATIC, SEEN, KEPT];

// How long a launch waits for the server before opening what the device
// holds: enough for a weak signal to bring the latest version, short enough
// that a dead one does not look like a broken app.
const LAUNCH_TIMEOUT = 3000;
// After "Mettre à jour" the person asked for the new version: wait longer.
const UPDATE_TIMEOUT = 20000;

// A whole A1 sheet is about 55 files of 35 to 100 KB: this is some thirty
// sheets looked at from end to end, 50 to 150 MB. Past it the oldest go;
// what must stay is kept on purpose, in the other cache.
const SEEN_LIMIT = 1500;

let updateAskedAt = 0;
let seenWrites = 0;

// A new worker waits until the tabs of the old one are closed, or until the
// person presses "Mettre à jour": the code of an open tab keeps working.
self.addEventListener("message", (event) => {
  if (event.data?.type === "activate") self.skipWaiting();
  if (event.data?.type === "update") {
    updateAskedAt = Date.now();
    // The page reloads once it knows this was heard.
    event.ports[0]?.postMessage("heard");
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("ead-") && !CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      // Take the page that registered this worker without a reload.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // "no-store" is the page downloading a file it stores itself (a kept
  // project): handling it here would also file it under "seen".
  if (request.method !== "GET" || request.cache === "no-store") return;
  if (request.headers.has("range")) return;

  const url = new URL(request.url);
  const ours = url.origin === self.location.origin;
  if (ours && url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (ours && isAppAddress(url.pathname)) event.respondWith(openApp(event));
  } else if (ours && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(event, { refresh: false }));
  } else if (ours && url.pathname.startsWith("/brand/")) {
    // Not hashed: the stored copy answers and is replaced for the next time.
    event.respondWith(staticFile(event, { refresh: true }));
  } else if (isPublicFile(url, ours)) {
    event.respondWith(publicFile(event));
  }
});

/** Every address is a screen of the app, except the API, files and code. */
function isAppAddress(pathname) {
  return !/^\/(api|files|_next)\//.test(pathname) && !/\.[a-z0-9]+$/i.test(pathname);
}

/**
 * Plan tiles, thumbnails and photos: public and never changed once written.
 * On disk in development, on Supabase Storage in production.
 */
function isPublicFile(url, ours) {
  return ours
    ? url.pathname.startsWith("/files/public/")
    : url.pathname.startsWith("/storage/v1/object/public/ead-public/");
}

/**
 * A launch or a reload, at any address. The server answers first when it
 * can, so a new version arrives at the next launch; the stored shell answers
 * when the network is gone or too slow.
 */
async function openApp(event) {
  const shell = await caches.match("/", { cacheName: SHELL });
  const network = fetch(event.request).then((response) => {
    // A server in trouble sends an error page: the stored app is better.
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    return response;
  });
  if (!shell) return network.catch(offlinePage);

  const patient = Date.now() - updateAskedAt < UPDATE_TIMEOUT;
  updateAskedAt = 0;
  const tooSlow = new Promise((resolve) =>
    setTimeout(resolve, patient ? UPDATE_TIMEOUT : LAUNCH_TIMEOUT, shell),
  );
  return Promise.race([network.catch(() => shell), tooSlow]);
}

/** Before the app was ever stored on this device, there is only this to show. */
function offlinePage() {
  return new Response(
    `<!doctype html><html lang="fr-CA"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>EAD Chantier</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#fff;font:17px/1.5 system-ui,sans-serif;text-align:center">
<main style="max-width:22em;padding:24px"><h1 style="font-size:22px">Pas de réseau</h1>
<p style="color:#b8c0c8">L'application n'est pas encore sur cet appareil. Elle s'ouvrira dès que le réseau reviendra.</p>
<a href="" style="display:inline-block;margin-top:8px;padding:13px 24px;border-radius:12px;background:#fff;color:#0b0d10;font-weight:600;text-decoration:none">Réessayer</a>
</main>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Code, fonts and brand images: the stored copy first. */
async function staticFile(event, { refresh }) {
  const cached = await caches.match(event.request, { cacheName: STATIC, ignoreVary: true });
  if (cached && !refresh) return cached;
  const fetched = fetchAndStore(event, STATIC);
  return cached ?? fetched;
}

/** A kept copy, else a seen one, else the network (and it becomes seen). */
async function publicFile(event) {
  const options = { ignoreVary: true };
  return (
    (await caches.match(event.request, { cacheName: KEPT, ...options })) ??
    (await caches.match(event.request, { cacheName: SEEN, ...options })) ??
    fetchAndStore(event, SEEN)
  );
}

/**
 * Answers from the network and stores a copy without delaying the answer.
 * Only whole, readable answers are stored: an opaque one (an image asked
 * without CORS) would cost megabytes of quota for a few kilobytes.
 */
function fetchAndStore(event, cacheName) {
  const fetched = fetch(event.request);
  event.waitUntil(
    fetched
      .then((response) => {
        if (response.status !== 200 || response.type === "opaque") return;
        return store(cacheName, event.request, response.clone());
      })
      .catch(() => {}),
  );
  return fetched;
}

async function store(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  if (cacheName !== SEEN) return cache.put(request, response);
  try {
    await cache.put(request, response);
    // Counting every file each time would cost more than it saves.
    if (seenWrites++ % 50 === 0) await trim(cache, SEEN_LIMIT);
  } catch {
    // The device is full: give back half of what was merely seen.
    await trim(cache, SEEN_LIMIT / 2);
  }
}

/** Removes the oldest entries (a cache lists them in the order they came). */
async function trim(cache, limit) {
  const requests = await cache.keys();
  const excess = requests.slice(0, Math.max(0, requests.length - limit));
  await Promise.all(excess.map((request) => cache.delete(request)));
}
