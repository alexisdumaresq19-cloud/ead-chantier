import { clear, createStore, del, entries as readAll, set } from "idb-keyval";
import { useEffect, useSyncExternalStore } from "react";

import type { Plans, SheetDetail } from "@/shared/plans";

import { api, ApiFailure, errorMessage } from "../lib/api";
import { formatSize } from "../lib/format";
import { queryClient } from "../lib/query";
import { keys } from "../lib/session";
import { confirmAction, toast } from "../ui";
import { absoluteUrl, canStore, KEPT_CACHE, SEEN_CACHE } from "./caches";
import { FileMissing, keepFile, NetworkLost, pool, StorageFull, storedSize } from "./download";
import {
  estimateBytes,
  filesToKeep,
  isSpaceShort,
  keptTotals,
  sheetsStillThere,
  sheetsToFetch,
  unusedFolders,
  type KeptProject,
  type SheetFiles,
} from "./keep";
import { freeSpace, keepStorage } from "./storage";

// Projects kept on the device on purpose. A foreman does it at the office,
// before leaving for a site without signal: the plan list and every sheet go
// into the app's stored data, every tile and thumbnail into a cache of their
// own that the service worker serves and never trims.
//
// A download belongs to the app, not to the screen that started it: it goes
// on while the person looks at something else. What is done is noted sheet
// by sheet, so a lost connection, a closed app or a full disk only pauses it.

/** Files fetched at once: enough to fill a good connection, few enough for a weak phone. */
const PARALLEL = 4;
/** How long to wait before trying again when the browser gives no sign of the network. */
const RETRY_AFTER = 15_000;

export type Download = {
  /** "waiting": the network went away; the download goes on by itself when it returns. */
  phase: "preparing" | "downloading" | "waiting";
  sheetsDone: number;
  sheetsTotal: number;
  filesDone: number;
  filesTotal: number;
  bytes: number;
};

export type KeptEntry = {
  /** undefined while the device's records are being read. */
  kept: KeptProject | null | undefined;
  download: Download | null;
  /** Why the last download stopped, to show until the next attempt. */
  problem: string | null;
};

const READING: KeptEntry = { kept: undefined, download: null, problem: null };
const NOT_KEPT: KeptEntry = { kept: null, download: null, problem: null };
const PREPARING: Download = {
  phase: "preparing",
  sheetsDone: 0,
  sheetsTotal: 0,
  filesDone: 0,
  filesTotal: 0,
  bytes: 0,
};

const records = createStore("ead-kept", "projects");
const entries = new Map<string, KeptEntry>();
const running = new Map<string, { controller: AbortController; done: Promise<void> }>();
const listeners = new Set<() => void>();
let read: Promise<void> | undefined;
let ready = false;

const entry = (projectId: string) => entries.get(projectId) ?? (ready ? NOT_KEPT : READING);

function patch(projectId: string, change: Partial<KeptEntry>) {
  entries.set(projectId, { ...entry(projectId), ...change });
  listeners.forEach((listener) => listener());
}

async function save(kept: KeptProject): Promise<KeptProject> {
  await set(kept.projectId, kept, records);
  patch(kept.projectId, { kept });
  return kept;
}

/** Reads what the device says it keeps, once, and checks the files are still there. */
function readRecords(): Promise<void> {
  return (read ??= (async () => {
    try {
      const stored = await readAll<string, KeptProject>(records);
      const cache = stored.length > 0 && canStore() ? await caches.open(KEPT_CACHE) : null;
      const urls = cache ? (await cache.keys()).map((request) => request.url) : [];
      for (const [projectId, kept] of stored)
        entries.set(projectId, { ...NOT_KEPT, kept: sheetsStillThere(kept, urls, absoluteUrl) });
    } catch {
      // No storage in this browser (a private window): nothing is kept.
    }
    ready = true;
    listeners.forEach((listener) => listener());
  })());
}

/** What the device keeps of a project, and the download in progress if any. */
export function useKeptProject(projectId: string): KeptEntry {
  useEffect(() => void readRecords(), []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => entry(projectId),
    () => READING,
  );
}

/** Files and bytes of every sheet kept on this device: what sizes are estimated from. */
export function knownSizes(): { files: number; bytes: number } {
  return keptTotals(
    [...entries.values()].flatMap((each) => (each.kept ? Object.values(each.kept.sheets) : [])),
  );
}

/** Starts keeping a project, or goes on with a download that had stopped. */
export function keepProject(projectId: string) {
  if (running.has(projectId) || !canStore()) return;
  const controller = new AbortController();
  patch(projectId, { download: PREPARING, problem: null });
  void keepStorage();

  const run = async () => {
    try {
      await download(projectId, controller.signal);
      toast.success("Projet gardé sur cet appareil.");
    } catch (error) {
      if (!controller.signal.aborted) {
        const problem = explain(error);
        patch(projectId, { problem });
        toast.error(problem);
      } else if (!entry(projectId).kept?.keptAt) {
        // A first download that was cancelled leaves nothing behind.
        await forget(projectId).catch(() => {});
      }
    } finally {
      running.delete(projectId);
      patch(projectId, { download: null });
    }
  };
  const done = run();
  running.set(projectId, { controller, done });
  void stayAwake(done);
}

/** Stops a download. What was kept before stays; a first download is undone. */
export function cancelKeeping(projectId: string) {
  running.get(projectId)?.controller.abort();
}

/** Takes a project off the device. The app's stored data stays: every screen shares it. */
export async function removeKept(projectId: string) {
  // A download still writing would put the record back: let it stop first.
  const run = running.get(projectId);
  run?.controller.abort();
  await run?.done;
  await forget(projectId);
}

/** The device is no longer signed in: nothing of the projects stays on it. */
export async function forgetKeptProjects() {
  running.forEach((run) => run.controller.abort());
  entries.clear();
  listeners.forEach((listener) => listener());
  await clear(records).catch(() => {});
  if (canStore()) await Promise.all([KEPT_CACHE, SEEN_CACHE].map((name) => caches.delete(name)));
}

async function forget(projectId: string) {
  const kept = entry(projectId).kept;
  if (kept) await removeFolders(kept.folders);
  await del(projectId, records);
  patch(projectId, { kept: null, problem: null });
}

async function removeFolders(folders: string[]) {
  if (folders.length === 0) return;
  const cache = await caches.open(KEPT_CACHE);
  const prefixes = folders.map((folder) => `${absoluteUrl(folder)}/`);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => prefixes.some((prefix) => request.url.startsWith(prefix)))
      .map((request) => cache.delete(request)),
  );
}

function explain(error: unknown): string {
  if (error instanceof StorageFull)
    return "Il n'y a plus de place sur cet appareil. Libérez de l'espace, puis reprenez le téléchargement.";
  if (error instanceof FileMissing)
    return "Un plan a changé pendant le téléchargement. Reprenez-le pour avoir la dernière version.";
  if (error instanceof ApiFailure) return errorMessage(error);
  return "Le téléchargement s'est arrêté. Reprenez-le pour terminer.";
}

async function download(projectId: string, signal: AbortSignal) {
  const wanted = await untilDone(projectId, signal, () => prepare(projectId, signal));
  if (!(await roomFor(projectId, wanted))) {
    running.get(projectId)?.controller.abort();
    signal.throwIfAborted();
  }
  await untilDone(projectId, signal, () => fetchFiles(projectId, wanted, signal));

  // Old revisions and removed sheets leave the device with the download that replaces them.
  const kept = entry(projectId).kept!;
  await removeFolders(unusedFolders(kept, wanted));
  await save({
    projectId,
    keptAt: new Date().toISOString(),
    sheets: Object.fromEntries(wanted.map((sheet) => [sheet.sheetId, kept.sheets[sheet.sheetId]])),
    folders: wanted.map((sheet) => sheet.folder),
  });
}

/** Runs a step again each time the network comes back, until it ends otherwise. */
async function untilDone<T>(
  projectId: string,
  signal: AbortSignal,
  step: () => Promise<T>,
): Promise<T> {
  for (;;) {
    try {
      return await step();
    } catch (error) {
      if (signal.aborted || !(error instanceof NetworkLost)) throw error;
      patch(projectId, { download: { ...entry(projectId).download!, phase: "waiting" } });
      await networkBack(signal);
      signal.throwIfAborted();
    }
  }
}

/** Resolves when the browser says the network is back, or after a while: it is not always told. */
function networkBack(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, RETRY_AFTER);
    window.addEventListener("online", done);
    signal.addEventListener("abort", done);
  });
}

/** Fetches into the app's stored data, never answering from it. */
async function fresh<T>(queryKey: readonly unknown[], path: string): Promise<T> {
  try {
    // One try: when the network is gone, the download itself waits for it.
    // Kept on purpose, so never dropped for want of a screen showing it.
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: () => api<T>(path),
      staleTime: 0,
      gcTime: Infinity,
      retry: false,
    });
  } catch (error) {
    if (error instanceof ApiFailure && (error.offline || error.status >= 500))
      throw new NetworkLost();
    throw error;
  }
}

/** The plan list and each sheet's record: what the plan screens and the viewer read offline. */
async function prepare(projectId: string, signal: AbortSignal): Promise<SheetFiles[]> {
  patch(projectId, { download: { ...entry(projectId).download!, phase: "preparing" } });
  const plans = await fresh<Plans>(keys.plans(projectId), `/api/projects/${projectId}/plans`);
  const wanted = filesToKeep(plans);
  await pool(
    wanted,
    PARALLEL,
    async (sheet) => {
      await fresh<SheetDetail>(
        keys.sheet(projectId, sheet.sheetId),
        `/api/sheets/${sheet.sheetId}`,
      );
    },
    signal,
  );
  return wanted;
}

/** Says so before starting when the device looks too full; false if the person gives up. */
async function roomFor(projectId: string, wanted: SheetFiles[]): Promise<boolean> {
  const files = sheetsToFetch(entry(projectId).kept ?? null, wanted).reduce(
    (total, sheet) => total + sheet.urls.length,
    0,
  );
  const needed = estimateBytes(files, knownSizes());
  const free = await freeSpace();
  if (free === null || !isSpaceShort(needed, free)) return true;
  return confirmAction({
    title: "La place risque de manquer",
    text: `Ce projet demande environ ${formatSize(needed)} et il en reste environ ${formatSize(free)} sur cet appareil. Le téléchargement pourrait s'arrêter avant la fin.`,
    confirmLabel: "Télécharger quand même",
  });
}

/** Every file of every sheet, skipping what the device already holds. */
async function fetchFiles(projectId: string, wanted: SheetFiles[], signal: AbortSignal) {
  const [cache, seen] = await Promise.all([caches.open(KEPT_CACHE), caches.open(SEEN_CACHE)]);
  const present = new Set((await cache.keys()).map((request) => request.url));

  const before = entry(projectId).kept ?? { projectId, keptAt: null, sheets: {}, folders: [] };
  let kept = await save({
    ...before,
    folders: [...new Set([...before.folders, ...wanted.map((sheet) => sheet.folder)])],
  });

  const progress: Download = {
    phase: "downloading",
    sheetsDone: 0,
    sheetsTotal: wanted.length,
    filesDone: 0,
    filesTotal: wanted.reduce((total, sheet) => total + sheet.urls.length, 0),
    bytes: 0,
  };
  const report = () => patch(projectId, { download: { ...progress } });
  report();

  for (const sheet of wanted) {
    signal.throwIfAborted();
    const urls = sheet.urls.map(absoluteUrl);
    const missing = urls.filter((url) => !present.has(url));
    const known = kept.sheets[sheet.sheetId];
    if (known?.revisionId === sheet.revisionId && missing.length === 0) {
      progress.filesDone += urls.length;
      progress.bytes += known.bytes;
    } else {
      let bytes = 0;
      const count = (size: number) => {
        bytes += size;
        progress.bytes += size;
        progress.filesDone++;
        report();
      };
      // A sheet caught half-way: its first files are there, only weigh them.
      const held = urls.filter((url) => present.has(url));
      await pool(held, PARALLEL, async (url) => count(await storedSize(cache, url)), signal);
      await pool(
        missing,
        PARALLEL,
        async (url, stop) => count(await keepFile(url, { kept: cache, seen }, stop)),
        signal,
      );
      const done = {
        revisionId: sheet.revisionId,
        folder: sheet.folder,
        files: urls.length,
        bytes,
      };
      kept = await save({ ...kept, sheets: { ...kept.sheets, [sheet.sheetId]: done } });
    }
    progress.sheetsDone++;
    report();
  }
}

/** Keeps the screen on during a download: a phone that falls asleep stops it. */
async function stayAwake(until: Promise<unknown>) {
  if (!("wakeLock" in navigator)) return;
  let lock: WakeLockSentinel | undefined;
  // The browser takes the lock back each time the app leaves the screen.
  const take = async () => {
    if (document.visibilityState !== "visible") return;
    lock = await navigator.wakeLock.request("screen").catch(() => undefined);
  };
  document.addEventListener("visibilitychange", take);
  await take();
  await until;
  document.removeEventListener("visibilitychange", take);
  await lock?.release().catch(() => {});
}
