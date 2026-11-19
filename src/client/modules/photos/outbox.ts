import { createStore, del, set, values, type UseStore } from "idb-keyval";
import { useSyncExternalStore } from "react";

import type { Me } from "@/shared/api";
import type { Photo } from "@/shared/photos";

import { api, errorMessage } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { keys } from "../../lib/session";
import { uploadFile } from "../../lib/upload";
import { toast } from "../../ui";
import { photoAdded, refreshProject } from "./data";
import { EXIF_READ_BYTES, readExifDate } from "./exif";
import { failureKind, newPhotoId, pickTakenAt, retryDelay, type LocalPhoto } from "./logic";
import { shrinkPhoto } from "./shrink";

// Photos on their way to the server. Every photo taken or chosen goes through
// here: it is written to the device first (IndexedDB), shrunk, then sent, and
// only leaves the device's keeping once the server has answered. With a
// network that takes a few seconds; without one the photo waits, through the
// app being closed, and goes when the network returns.

/** A photo as kept on the device until the server has it. */
type OutboxItem = {
  /** The photo's id, made here, so that sending it twice still makes one photo. */
  id: string;
  projectId: string;
  /** Who took it. It is only ever sent while this person is signed in. */
  ownerId: string;
  takenAt: string;
  caption: string | null;
  addedAt: number;
  file: Blob;
  filename: string;
  /** Shrunk, with its small image for the grid; false until then. */
  prepared: boolean;
  preview: Blob | null;
  /** The file is already in the server's storage: a new try does not send it again. */
  uploadId: string | null;
  /** Tries that failed. */
  attempts: number;
  error: string | null;
};

const SENT_AT_ONCE = 3;
/** An upload that makes no progress for this long is cancelled and tried again. */
const STALL = 45_000;
/** Long enough for the server to redraw a large original. */
const ANSWER = 90_000;
const NAME = "ead-photo-outbox";

let store: UseStore | undefined;
const db = () => (store ??= createStore(NAME, "photos"));

const items = new Map<string, OutboxItem>();
/** Photos the server has just taken, still shown from here until the gallery lists them. */
const sent = new Map<string, OutboxItem>();
const sending = new Set<string>();
/** Added since the app was opened and never failed: on their way, as far as the person can tell. */
const fresh = new Set<string>();
/** Could not be written to the device: they live as long as the app stays open. */
const unsaved = new Set<string>();
/** Already tried in the pass under way, so that a failure is not tried again at once. */
let tried = new Set<string>();
let passing = false;

// --- What the screens read ------------------------------------------------------

const listeners = new Set<() => void>();
const none: LocalPhoto[] = [];
let snapshot = none;

function stateOf(item: OutboxItem): LocalPhoto["state"] {
  if (!item.prepared) return "preparing";
  if (sending.has(item.id)) return "sending";
  if (!navigator.onLine) return "waiting";
  // Next in line: just added, or about to be picked up by the pass under way.
  return fresh.has(item.id) || (passing && !tried.has(item.id)) ? "sending" : "waiting";
}

function publish() {
  const view = (item: OutboxItem, state: LocalPhoto["state"]): LocalPhoto => ({
    id: item.id,
    projectId: item.projectId,
    ownerId: item.ownerId,
    takenAt: item.takenAt,
    caption: item.caption,
    state,
    error: item.error,
  });
  snapshot = [
    ...[...items.values()].map((item) => view(item, stateOf(item))),
    ...[...sent.values()].map((item) => view(item, "sent")),
  ];
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Every photo still on this device, whoever took it: a screen keeps its own person's. */
export function useLocalPhotos(): LocalPhoto[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => none,
  );
}

// Progress changes many times a second: only the tile of that photo listens.
const progress = new Map<string, number>();
const progressListeners = new Map<string, Set<() => void>>();

function setProgress(id: string, value: number | null) {
  if (value === null) progress.delete(id);
  else progress.set(id, value);
  progressListeners.get(id)?.forEach((listener) => listener());
}

/** How much of that photo has been sent, 0 to 1. */
export function useSendProgress(id: string): number {
  return useSyncExternalStore(
    (listener) => {
      const group = progressListeners.get(id) ?? new Set();
      progressListeners.set(id, group);
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) progressListeners.delete(id);
      };
    },
    () => progress.get(id) ?? 0,
    () => 0,
  );
}

// The small images, as addresses an <img> can show. They outlive the sending
// by a moment: the gallery shows them under the real thumbnail while it loads.
const previewUrls = new Map<string, string>();

/** The address of the small image of a photo that is, or just was, on this device. */
export function localPreviewUrl(id: string): string | null {
  const known = previewUrls.get(id);
  if (known) return known;
  const preview = (items.get(id) ?? sent.get(id))?.preview;
  if (!preview) return null;
  const url = URL.createObjectURL(preview);
  previewUrls.set(id, url);
  return url;
}

function forgetPreview(id: string) {
  const url = previewUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  previewUrls.delete(id);
}

// --- Keeping -------------------------------------------------------------------

// Another tab of the app changed the outbox: read it again.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(NAME);

let storageWarned = false;
/** One set per reading of the device under way: the ids changed here meanwhile. */
const readings = new Set<Set<string>>();
const changedHere = (id: string) => readings.forEach((changed) => changed.add(id));

/** Writes a photo to the device. If the device refuses, it is still sent while the app stays open. */
async function keep(item: OutboxItem) {
  items.set(item.id, item);
  changedHere(item.id);
  publish();
  try {
    await set(item.id, item, db());
    unsaved.delete(item.id);
    channel?.postMessage("changed");
  } catch {
    unsaved.add(item.id);
    if (!storageWarned)
      toast.warning("Cet appareil ne peut pas garder les photos en attente.", {
        description: "Laissez l'application ouverte jusqu'à la fin de l'envoi.",
        duration: 10_000,
      });
    storageWarned = true;
  }
}

async function forget(id: string) {
  items.delete(id);
  fresh.delete(id);
  unsaved.delete(id);
  changedHere(id);
  setProgress(id, null);
  publish();
  await del(id, db()).catch(() => {});
  channel?.postMessage("changed");
}

/** Brings what this tab knows in line with the device (another tab may have added or sent photos). */
async function readDevice() {
  const changed = new Set<string>();
  readings.add(changed);
  let stored: OutboxItem[];
  try {
    stored = await values<OutboxItem>(db());
  } catch {
    // No storage on this browser (private browsing…): the outbox lives in memory.
    return;
  } finally {
    readings.delete(changed);
  }
  // What this tab is sending, or changed while the device was being read, is
  // newer here than what was read.
  const ours = (id: string) => sending.has(id) || changed.has(id);
  const ids = new Set(stored.map((item) => item.id));
  for (const item of stored) if (!ours(item.id)) items.set(item.id, item);
  for (const id of [...items.keys()])
    if (!ids.has(id) && !ours(id) && !unsaved.has(id)) items.delete(id);
  publish();
}

let loaded: Promise<void> | undefined;
const ready = () => (loaded ??= readDevice());

// --- Adding ----------------------------------------------------------------------

/**
 * Takes in the files someone just shot or chose. When this returns they are
 * on the device and in the gallery; shrinking and sending follow on their
 * own. Gives the ids of the photos, for a caption typed right after.
 */
export async function addPhotos(
  projectId: string,
  ownerId: string,
  files: File[],
): Promise<{ ids: string[]; refused: number }> {
  await ready();
  // Asks the browser not to clear this site's storage when the device runs
  // short of space: photos may be waiting in it.
  void navigator.storage?.persist?.().catch(() => {});
  const ids: string[] = [];
  let refused = 0;
  for (const file of files) {
    // Phones do not always name a file's type: what is not an image is caught when drawn.
    if (file.type && !file.type.startsWith("image/")) {
      refused++;
      continue;
    }
    const exif = await file
      .slice(0, EXIF_READ_BYTES)
      .arrayBuffer()
      .then(readExifDate)
      .catch(() => null);
    const now = new Date();
    const id = newPhotoId();
    fresh.add(id);
    ids.push(id);
    await keep({
      id,
      projectId,
      ownerId,
      takenAt: pickTakenAt(exif, file.lastModified, now).toISOString(),
      caption: null,
      addedAt: now.getTime(),
      file,
      filename: file.name || "photo.jpg",
      prepared: false,
      preview: null,
      uploadId: null,
      attempts: 0,
      error: null,
    });
    void prepare();
  }
  return { ids, refused };
}

let preparing: Promise<void> | undefined;

/** Shrinks what has not been yet, one photo at a time: a decoded photo is 50 MB of memory. */
function prepare(): Promise<void> {
  return (preparing ??= prepareAll().finally(() => {
    preparing = undefined;
  }));
}

async function prepareAll() {
  for (;;) {
    const next = [...items.values()]
      .filter((item) => !item.prepared)
      .sort((a, b) => a.addedAt - b.addedAt)[0];
    if (!next) return;
    const shrunk = await shrinkPhoto(next.file).catch(() => null);
    const current = items.get(next.id);
    // Removed by the person in the meantime.
    if (!current) continue;
    if (!shrunk) {
      await forget(next.id);
      toast.error(`« ${next.filename} » ne peut pas être lue comme une photo.`, {
        description: "Choisissez une image en JPEG, ou prenez la photo avec l'application.",
        duration: 8000,
      });
      continue;
    }
    await keep({
      ...current,
      file: shrunk.file,
      filename: shrunk.file === next.file ? next.filename : "photo.jpg",
      preview: shrunk.preview,
      prepared: true,
    });
    void send();
  }
}

// --- Sending ---------------------------------------------------------------------

/** Sends the file, giving up if it stalls (the phone slept, the connection died). */
async function upload(item: OutboxItem): Promise<string> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), STALL);
  try {
    return await uploadFile({
      projectId: item.projectId,
      kind: "photo",
      file: item.file,
      filename: item.filename,
      signal: controller.signal,
      onProgress: (fraction) => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), STALL);
        // The last tenth is the server making the photo.
        setProgress(item.id, fraction * 0.9);
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the server to make the photo from the file it holds. */
async function create(item: OutboxItem): Promise<Photo> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER);
  try {
    return await api<Photo>(`/api/projects/${item.projectId}/photos`, {
      method: "POST",
      body: {
        id: item.id,
        uploadId: item.uploadId,
        takenAt: item.takenAt,
        caption: item.caption,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

type Outcome = "sent" | "discarded" | "kept" | "stop";

async function sendOne(first: OutboxItem): Promise<Outcome> {
  const id = first.id;
  const latest = () => items.get(id) ?? first;
  let resent = false;
  sending.add(id);
  setProgress(id, 0);
  publish();
  try {
    for (;;) {
      try {
        if (!latest().uploadId) {
          const uploadId = await upload(latest());
          await keep({ ...latest(), uploadId });
        }
        setProgress(id, 0.92);
        let photo = await create(latest());
        // A caption typed while the photo was on its way.
        if ((latest().caption ?? null) !== (photo.caption ?? null))
          photo = await api<Photo>(`/api/photos/${id}`, {
            method: "PATCH",
            body: { caption: latest().caption },
          });
        sent.set(id, latest());
        setTimeout(() => {
          sent.delete(id);
          publish();
        }, 10_000);
        setTimeout(() => forgetPreview(id), 120_000);
        await forget(id);
        photoAdded(first.projectId, photo);
        return "sent";
      } catch (error) {
        const kind = failureKind(error);
        if (kind === "resend" && !resent) {
          resent = true;
          await keep({ ...latest(), uploadId: null });
          continue;
        }
        if (kind === "invalid") {
          forgetPreview(id);
          await forget(id);
          return "discarded";
        }
        const noAnswer = kind === "offline" || kind === "signed-out";
        fresh.delete(id);
        await keep({
          ...latest(),
          attempts: latest().attempts + 1,
          // Without a network there is nothing to explain: the photo simply waits.
          error: noAnswer ? null : errorMessage(error),
        });
        return noAnswer ? "stop" : "kept";
      }
    }
  } finally {
    sending.delete(id);
    setProgress(id, null);
    publish();
  }
}

/**
 * One pass over what waits. Says whether something of the signed-in person
 * is left to try again later.
 */
async function pass(): Promise<boolean> {
  await readDevice();
  if (!items.size) return false;

  // What waits is only ever sent as the person who took it. The app may
  // already know that nobody, or somebody else, is signed in…
  const known = queryClient.getQueryData<Me | null>(keys.me);
  const waitsFor = (id: string) => [...items.values()].some((item) => item.ownerId === id);
  if (known === null || (known && !waitsFor(known.id))) return false;
  // …and before sending, the server says who it is.
  let me: Me;
  try {
    me = await api<Me>("/api/me");
  } catch (error) {
    for (const id of items.keys()) fresh.delete(id);
    return failureKind(error) !== "signed-out";
  }

  let stopped = false;
  let afterWaiting = 0;
  let discarded = 0;
  const projects = new Set<string>();
  const mine = () => [...items.values()].filter((item) => item.ownerId === me.id && item.prepared);
  const next = () =>
    stopped
      ? undefined
      : mine()
          .filter((item) => !sending.has(item.id) && !tried.has(item.id))
          .sort((a, b) => a.addedAt - b.addedAt)[0];

  const worker = async () => {
    for (let item = next(); item; item = next()) {
      tried.add(item.id);
      const waited = !fresh.has(item.id);
      const outcome = await sendOne(item);
      if (outcome === "sent") {
        projects.add(item.projectId);
        if (waited) afterWaiting++;
      } else if (outcome === "discarded") discarded++;
      else if (outcome === "stop") stopped = true;
    }
  };
  await Promise.all(Array.from({ length: SENT_AT_ONCE }, worker));

  for (const projectId of projects) void refreshProject(projectId);
  if (afterWaiting)
    toast.success(
      afterWaiting === 1
        ? "La photo en attente a été envoyée."
        : `Les ${afterWaiting} photos en attente ont été envoyées.`,
    );
  if (discarded)
    toast.error(
      discarded === 1
        ? "Une photo est illisible (fichier abîmé). Elle a été retirée de l'envoi."
        : `${discarded} photos sont illisibles (fichiers abîmés). Elles ont été retirées de l'envoi.`,
      { duration: 8000 },
    );
  return mine().length > 0;
}

let running: Promise<void> | undefined;
let again = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Sends what waits. Safe to call at any time: one pass runs at a time. */
function send(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  clearTimeout(retryTimer);
  tried = new Set();
  let left = false;
  running = (async () => {
    await ready();
    do {
      again = false;
      passing = true;
      publish();
      try {
        // Two tabs of the app share the outbox: one sends at a time, and the
        // other comes back later for what may be left.
        left = navigator.locks
          ? await navigator.locks.request(NAME, { ifAvailable: true }, (lock) =>
              lock ? pass() : true,
            )
          : await pass();
      } catch {
        // Whatever went wrong, what waits is still on the device.
        left = true;
      } finally {
        passing = false;
        publish();
      }
    } while (again);
  })().finally(() => {
    running = undefined;
    if (again) return void send();
    // Come back to what is left, a little later after each failure.
    if (left) retryTimer = setTimeout(() => void send(), retryDelay(++failures));
    else failures = 0;
  });
  return running;
}

/** A try asked for by the person or by the network coming back: at once, failures forgotten. */
export function sendNow(): Promise<void> {
  failures = 0;
  if (!running) return send();
  // The pass under way finishes first, then everything is tried afresh.
  return running.then(() => send());
}

// --- What the person may still change -----------------------------------------------

/**
 * Sets the caption of photos still on the device. Returns the ids that are
 * already with the server, for the caller to change there.
 */
export async function captionWaiting(ids: string[], caption: string | null): Promise<string[]> {
  const gone: string[] = [];
  for (const id of ids) {
    const item = items.get(id);
    // While it is being sent, the sender sees the new caption when the server answers.
    if (item) await keep({ ...item, caption });
    else gone.push(id);
  }
  return gone;
}

/** Gives up on a waiting photo. False if it is being sent at this very moment. */
export async function removeWaiting(id: string): Promise<boolean> {
  if (sending.has(id)) return false;
  forgetPreview(id);
  await forget(id);
  return true;
}

// --- Starting ------------------------------------------------------------------------

let started = false;

/**
 * Photos taken without a network wait on the device and are sent when it
 * returns. Called once when the app starts.
 */
export function startPhotoOutbox() {
  if (started) return;
  started = true;
  const wake = () => void sendNow();
  window.addEventListener("online", wake);
  window.addEventListener("offline", publish);
  // The phone slept, or the app comes back to the front.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });
  channel?.addEventListener("message", () => void readDevice());
  void ready().then(() => {
    void prepare();
    void send();
  });
}
