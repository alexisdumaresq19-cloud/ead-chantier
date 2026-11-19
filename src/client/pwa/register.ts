import { queryClient } from "../lib/query";
import { preloadScreens } from "../routes";
import { canStore, SHELL_CACHE, STATIC_CACHE } from "./caches";
import { watchInstallOffer } from "./install-offer";
import { storeShell } from "./shell";
import { keepStorage } from "./storage";
import { keepUnusedData } from "./stored-data";
import { serverVersion, watchForUpdates, workerIsWaiting } from "./update";

const ONCE = { once: true };
let started = false;

/** Installs the service worker that makes the app work without a network. */
export function registerPwa() {
  if (started) return;
  started = true;
  // First of all: the stored data is restored right after this.
  keepUnusedData(queryClient);
  watchInstallOffer();

  if (process.env.NODE_ENV !== "production") {
    void retireWorker();
    return;
  }
  watchForUpdates();
  // Installed on the home screen: the browser grants this without asking.
  // In a browser tab the question waits until a project is kept on purpose.
  if (window.matchMedia("(display-mode: standalone)").matches) void keepStorage();

  if (!("serviceWorker" in navigator)) return;
  const workers = navigator.serviceWorker;
  workers
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      // A worker that waits while another one runs is a new version.
      const noteWaiting = (worker: ServiceWorker | null) => {
        if (worker?.state === "installed" && workers.controller) workerIsWaiting();
      };
      noteWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => noteWaiting(worker));
      });
    })
    // Refused (a private window, a full disk): the app works, online only.
    .catch(() => {});

  // On the first visit the worker takes the page a moment after it loads.
  if (workers.controller) whenIdle(makeReadyForOffline);
  else workers.addEventListener("controllerchange", () => whenIdle(makeReadyForOffline), ONCE);
}

/** Runs once the first screen is drawn and the browser has nothing better to do. */
function whenIdle(task: () => void) {
  if ("requestIdleCallback" in window) window.requestIdleCallback(task, { timeout: 5000 });
  else setTimeout(task, 2000);
}

/**
 * Downloads every screen, then stores the page and its code for the worker.
 * Without a network it changes nothing and tries again when it returns.
 */
async function makeReadyForOffline() {
  const screens = await preloadScreens();
  const complete = screens.every((screen) => screen.status === "fulfilled");
  const stored = complete && (await serverVersion().then(storeShell, () => false));
  if (!stored) window.addEventListener("online", () => whenIdle(makeReadyForOffline), ONCE);
}

/**
 * Development: a worker left by a production build on this address would
 * serve its stored code over hot reload. It goes, with the code it stored;
 * tiles and photos are plain data and can stay.
 */
async function retireWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  // This very page may have come from that worker, which answers it until
  // the next load: start again, and empty its caches once it is out.
  if (navigator.serviceWorker.controller) return window.location.reload();
  if (canStore()) await Promise.all([SHELL_CACHE, STATIC_CACHE].map((name) => caches.delete(name)));
}
