import { useMemo, useSyncExternalStore } from "react";

import type { PlanImportDetail } from "@/shared/plans";

import { api, ApiFailure, errorMessage } from "../../lib/api";
import { queryClient } from "../../lib/query";
import { uploadFile } from "../../lib/upload";
import { planKeys } from "./data";

// PDFs on their way to the server. They are kept here, outside any screen, so
// that an upload goes on while its owner looks at something else and is still
// shown when they come back to the plans. One file is sent at a time: on a
// site's connection, two at once only make both slower.

export type PlanUpload = {
  id: string;
  projectId: string;
  name: string;
  size: number;
  status: "waiting" | "sending" | "starting" | "failed";
  /** 0 to 1, while sending. */
  progress: number;
  error: string | null;
};

type Job = {
  file: File;
  /** Set once the file is in storage: a retry only has to start the import. */
  uploadId?: string;
  controller?: AbortController;
  /** Failed for lack of network. */
  offline?: boolean;
  settle: (importId: string | null) => void;
};

let uploads: PlanUpload[] = [];
const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
let running = false;
let nextId = 1;

function set(next: PlanUpload[]) {
  uploads = next;
  listeners.forEach((listener) => listener());
  // Closing the tab now would lose the files being sent.
  listen(
    "beforeunload",
    warnBeforeLeaving,
    uploads.some((upload) => upload.status !== "failed"),
  );
  listen("online", retryWhenBackOnline, uploads.length > 0);
}

function listen(type: "beforeunload" | "online", listener: (event: Event) => void, on: boolean) {
  if (on) window.addEventListener(type, listener);
  else window.removeEventListener(type, listener);
}

function warnBeforeLeaving(event: Event) {
  event.preventDefault();
}

/** Files the network dropped are sent again by themselves when it returns. */
function retryWhenBackOnline() {
  for (const upload of uploads) {
    if (upload.status === "failed" && jobs.get(upload.id)?.offline) retryUpload(upload.id);
  }
}

const patch = (id: string, changes: Partial<PlanUpload>) =>
  set(uploads.map((upload) => (upload.id === id ? { ...upload, ...changes } : upload)));

const drop = (id: string) => {
  jobs.delete(id);
  set(uploads.filter((upload) => upload.id !== id));
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The project's PDFs being sent, in the order they were chosen. */
export function usePlanUploads(projectId: string): PlanUpload[] {
  const all = useSyncExternalStore(
    subscribe,
    () => uploads,
    () => uploads,
  );
  return useMemo(() => all.filter((upload) => upload.projectId === projectId), [all, projectId]);
}

/**
 * Sends PDFs and starts an import for each. Resolves when all of them are
 * done with the ids of the imports started; a file that fails stays in the
 * list to be tried again or removed, and counts once it is settled.
 */
export async function addPlanFiles(projectId: string, files: File[]): Promise<string[]> {
  const started = files.map(
    (file) =>
      new Promise<string | null>((settle) => {
        const id = `upload-${nextId++}`;
        jobs.set(id, { file, settle });
        set([
          ...uploads,
          {
            id,
            projectId,
            name: file.name,
            size: file.size,
            status: "waiting",
            progress: 0,
            error: null,
          },
        ]);
      }),
  );
  void work();
  return (await Promise.all(started)).filter((id): id is string => id !== null);
}

export function retryUpload(id: string) {
  if (!jobs.has(id)) return;
  patch(id, { status: "waiting", progress: 0, error: null });
  void work();
}

/** Gives up on a file, stopping it if it is being sent. */
export function removeUpload(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.controller?.abort();
  drop(id);
  job.settle(null);
}

async function work() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = uploads.find((upload) => upload.status === "waiting");
      if (!next) break;
      await send(next);
    }
  } finally {
    running = false;
  }
}

async function send({ id, projectId, name }: PlanUpload) {
  const job = jobs.get(id);
  if (!job) return;
  job.controller = new AbortController();
  job.offline = false;
  const { signal } = job.controller;
  try {
    if (!job.uploadId) {
      patch(id, { status: "sending", progress: 0 });
      const { file } = job;
      job.uploadId = await uploadFile({
        projectId,
        kind: "plan",
        // The server takes plans by their type; a PDF named as one is one.
        file: file.type === "application/pdf" ? file : file.slice(0, file.size, "application/pdf"),
        filename: name,
        onProgress: (progress) => {
          if (jobs.has(id)) patch(id, { progress });
        },
        signal,
      });
    }
    patch(id, { status: "starting", progress: 1 });
    const started = await api<PlanImportDetail>(`/api/projects/${projectId}/plan-imports`, {
      method: "POST",
      body: { uploadId: job.uploadId },
      signal,
    });
    if (!jobs.has(id)) return;
    drop(id);
    void queryClient.invalidateQueries({ queryKey: planKeys.imports(projectId) });
    job.settle(started.id);
  } catch (error) {
    // Removed while it was being sent: nothing to report.
    if (!jobs.has(id)) return;
    job.offline = error instanceof ApiFailure && error.offline;
    patch(id, {
      status: "failed",
      error: job.offline
        ? "Connexion perdue. L'envoi reprendra au retour du réseau."
        : errorMessage(error),
    });
  }
}
