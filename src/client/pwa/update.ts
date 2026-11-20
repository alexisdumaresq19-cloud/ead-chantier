import { useSyncExternalStore } from "react";

import { api } from "../lib/api";
import { openedFromShell } from "./shell";

// Knowing that a newer version of the app is deployed. The page never
// reloads on its own: someone may be reading a plan. It tells (PwaHost shows
// a bar) and the person decides when.

const MINUTE = 60_000;
/** Coming back to the app or to the network asks again, but not more often than this. */
const MIN_GAP = MINUTE;
/** An app left open on a desk still learns of a new version. */
const EVERY = 15 * MINUTE;

/**
 * The version this page runs: the one its stored shell was kept for or,
 * when the server sent the page, the one the server names first.
 */
let pageVersion: string | null = null;
let lastAnswer = 0;
let asking = false;
let available = false;
let dismissed = false;

const listeners = new Set<() => void>();
function change(next: { available?: boolean; dismissed?: boolean }) {
  available = next.available ?? available;
  dismissed = next.dismissed ?? dismissed;
  listeners.forEach((listener) => listener());
}

/**
 * Asks the server which version it runs, and notes it when that is no longer
 * this page's. Throws without a network.
 */
export async function serverVersion(): Promise<string> {
  const { version } = await api<{ version: string }>("/api/version");
  pageVersion ??= version;
  if (version !== pageVersion) change({ available: true });
  return version;
}

async function ask() {
  if (available || asking || Date.now() - lastAnswer < MIN_GAP) return;
  asking = true;
  try {
    await serverVersion();
    lastAnswer = Date.now();
    // A changed worker file is a new version too: have the browser look.
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
  } catch {
    // No network, nothing learned: the next occasion asks again.
  } finally {
    asking = false;
  }
}

/** Starts asking the server, now and then, which version it runs. */
export function watchForUpdates() {
  pageVersion = openedFromShell();
  void ask();
  window.setInterval(() => void ask(), EVERY);
  window.addEventListener("online", () => void ask());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ask();
  });
}

/** A new service worker is installed and waits for this one's tabs to let go. */
export function workerIsWaiting() {
  change({ available: true });
}

/** Whether to offer the new version now. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => available && !dismissed,
    () => false,
  );
}

/** "Plus tard": the offer comes back the next time the app is opened. */
export function dismissUpdate() {
  change({ dismissed: true });
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Posts to a worker and waits until it says it heard (or a second, if it never does). */
function tell(worker: ServiceWorker, type: string): Promise<void> {
  const { port1, port2 } = new MessageChannel();
  const heard = new Promise<void>((resolve) => {
    port1.onmessage = () => resolve();
  });
  worker.postMessage({ type }, [port2]);
  return Promise.race([heard, wait(1000)]);
}

/**
 * "Mettre à jour": lets a waiting worker take over, then reloads from the
 * server. If the network fails at that moment, the stored version opens
 * again and the offer returns later.
 */
export async function applyUpdate() {
  try {
    const workers = navigator.serviceWorker;
    const registration = await workers?.getRegistration();
    if (workers && registration?.waiting) {
      const taken = new Promise<void>((resolve) =>
        workers.addEventListener("controllerchange", () => resolve(), { once: true }),
      );
      registration.waiting.postMessage({ type: "activate" });
      await Promise.race([taken, wait(4000)]);
    }
    // Tells the worker to wait for the server on the coming reload, where a
    // launch would fall back on the stored version after a few seconds.
    if (workers?.controller) await tell(workers.controller, "update");
  } finally {
    window.location.reload();
  }
}
