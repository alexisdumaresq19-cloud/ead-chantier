import type { DocumentCategory } from "@/shared/documents";

import { ApiFailure, errorMessage } from "../../lib/api";

// The documents being sent, one file at a time: on a weak signal a single
// file gets the whole connection, and a failure concerns that file only.
// The queue lives outside the screens, so sending carries on while the
// person looks at something else in the app.

export type UploadStatus = "waiting" | "sending" | "saving" | "done" | "failed";

export type UploadItem = {
  id: string;
  projectId: string;
  filename: string;
  /** In bytes. */
  size: number;
  title: string;
  category: DocumentCategory;
  status: UploadStatus;
  /** 0 to 1: how much of the file has left the device. */
  progress: number;
  /** Why it failed, as a sentence. */
  error: string | null;
  /** It failed for lack of a network: it starts again by itself when the network is back. */
  offline: boolean;
};

export type UploadsState = {
  items: UploadItem[];
  /** The network went away: nothing more is sent until it comes back, or the person asks. */
  stalled: boolean;
};

export type NewUpload = { file: Blob; filename: string; title: string };

type Entry = UploadItem & {
  file: Blob;
  /** Set once the file is in storage: a retry then only has the document left to create. */
  uploadId: string | null;
  controller: AbortController | null;
};

export type UploadQueueDeps = {
  /** Sends the file to storage and answers the upload's id. */
  send(
    item: UploadItem & { file: Blob },
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<string>;
  /** Makes the file in storage a document of its project. */
  save(item: UploadItem, uploadId: string, signal: AbortSignal): Promise<unknown>;
  /** A document was added to this project. */
  onAdded?(projectId: string): void;
  /** Files are waiting or on their way (true), or nothing is (false). */
  onActivity?(active: boolean): void;
};

const view = (entry: Entry): UploadItem => ({
  id: entry.id,
  projectId: entry.projectId,
  filename: entry.filename,
  size: entry.size,
  title: entry.title,
  category: entry.category,
  status: entry.status,
  progress: entry.progress,
  error: entry.error,
  offline: entry.offline,
});

const isActive = (item: UploadItem) =>
  item.status === "waiting" || item.status === "sending" || item.status === "saving";

export function createUploadQueue(deps: UploadQueueDeps) {
  let entries: Entry[] = [];
  let stalled = false;
  let state: UploadsState = { items: [], stalled };
  let running: Entry | null = null;
  let active = false;
  let lastId = 0;
  const listeners = new Set<() => void>();

  function publish() {
    state = { items: entries.map(view), stalled };
    const nowActive = state.items.some(isActive);
    if (nowActive !== active) {
      active = nowActive;
      deps.onActivity?.(active);
    }
    listeners.forEach((listener) => listener());
  }

  function pump() {
    if (running || stalled) return;
    const next = entries.find((entry) => entry.status === "waiting");
    if (next) void run(next);
  }

  async function run(entry: Entry) {
    running = entry;
    const controller = new AbortController();
    entry.controller = controller;
    try {
      if (!entry.uploadId) {
        Object.assign(entry, { status: "sending", progress: 0 });
        publish();
        let shown = 0;
        entry.uploadId = await deps.send(
          entry,
          (fraction) => {
            entry.progress = Math.min(1, Math.max(0, fraction));
            // Progress arrives many times a second; screens hear of each half percent.
            const step = Math.floor(entry.progress * 200);
            if (step !== shown) {
              shown = step;
              publish();
            }
          },
          controller.signal,
        );
      }
      Object.assign(entry, { status: "saving", progress: 1 });
      publish();
      await deps.save(entry, entry.uploadId, controller.signal);
      entry.status = "done";
      deps.onAdded?.(entry.projectId);
    } catch (error) {
      // A cancelled upload is already off the list.
      if (!controller.signal.aborted) {
        const offline = error instanceof ApiFailure && error.offline;
        const message = errorMessage(error);
        Object.assign(entry, { status: "failed", error: message, offline });
        if (offline) stalled = true;
        // The files waiting behind it would only meet the same refusal: they
        // stop here with the same sentence, for the person to retry later.
        const holds = sharedRefusal(error, entry.projectId);
        if (holds)
          for (const other of entries)
            if (other.status === "waiting" && holds(other))
              Object.assign(other, { status: "failed", error: message, offline: false });
      }
    } finally {
      entry.controller = null;
      running = null;
      publish();
      pump();
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,

    /** Queues files for a project, all in the same category. */
    add(projectId: string, category: DocumentCategory, files: NewUpload[]) {
      for (const { file, filename, title } of files) {
        entries.push({
          id: `u${++lastId}`,
          projectId,
          filename,
          size: file.size,
          title,
          category,
          status: "waiting",
          progress: 0,
          error: null,
          offline: false,
          file,
          uploadId: null,
          controller: null,
        });
      }
      stalled = false;
      publish();
      pump();
    },

    /** Takes a file off the list; if it is on its way, the sending stops. */
    remove(id: string) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      entries = entries.filter((candidate) => candidate !== entry);
      entry.controller?.abort();
      publish();
    },

    /** Sends a failed file again. The others are left as they are. */
    retry(id: string) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (entry?.status !== "failed") return;
      Object.assign(entry, { status: "waiting", error: null, offline: false });
      stalled = false;
      publish();
      pump();
    },

    /** The network is back (or the person says so): what it interrupted starts again. */
    resume() {
      for (const entry of entries) {
        if (entry.status === "failed" && entry.offline)
          Object.assign(entry, { status: "waiting", error: null, offline: false });
      }
      stalled = false;
      publish();
      pump();
    },

    /** Forgets the files of a project that made it. */
    clearDone(projectId: string) {
      entries = entries.filter(
        (entry) => !(entry.projectId === projectId && entry.status === "done"),
      );
      publish();
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;

/**
 * Which waiting files a refusal also concerns, if it is not about this file
 * alone: the allowance of uploads is per person (429), and an archived
 * project (403) takes nothing more. A storage refusal (an expired link) and
 * any other answer concern the one file.
 */
export function sharedRefusal(
  error: unknown,
  projectId: string,
): ((item: Pick<UploadItem, "projectId">) => boolean) | null {
  if (!(error instanceof ApiFailure)) return null;
  if (error.status === 429) return () => true;
  if (error.status === 403 && error.code === "forbidden")
    return (item) => item.projectId === projectId;
  return null;
}

/** What a list of uploads amounts to, for a summary line. */
export function summarize(items: UploadItem[]) {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  // What a failed file had sent is lost: it starts over.
  const sent = items.reduce(
    (sum, item) => sum + (item.status === "failed" ? 0 : item.size * item.progress),
    0,
  );
  return {
    count: items.length,
    done: items.filter((item) => item.status === "done").length,
    failed: items.filter((item) => item.status === "failed").length,
    active: items.filter(isActive).length,
    /** 0 to 1, by weight: a large file counts for more than a small one. */
    progress: total > 0 ? sent / total : 0,
  };
}
