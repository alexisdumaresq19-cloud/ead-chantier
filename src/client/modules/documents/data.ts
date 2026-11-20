import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import type { ProjectDocument } from "@/shared/documents";

import { api } from "../../lib/api";
import { count } from "../../lib/format";
import { queryClient } from "../../lib/query";
import { keys } from "../../lib/session";
import { uploadFile } from "../../lib/upload";
import { toast } from "../../ui";
import { createUploadQueue, summarize, type UploadsState } from "./upload-queue";

// The documents of a project as the screens fetch them, and the one queue of
// files being sent that all of them share.

export const documentsKey = (projectId: string) =>
  [...keys.project(projectId), "documents"] as const;

// The list stays on the device while its screen is away, so it still shows on
// a return without a network. A browser timer counts 24 days at most: asked
// for more (as the app-wide setting does), it rings at once and the list is lost.
const KEPT_FOR = 24 * 24 * 3600 * 1000;

export const useDocuments = (projectId: string) =>
  useQuery({
    queryKey: documentsKey(projectId),
    queryFn: () => api<ProjectDocument[]>(`/api/projects/${projectId}/documents`),
    gcTime: KEPT_FOR,
  });

/** After any change: the list, and the count on the project's home. */
export const refreshProject = (projectId: string) =>
  queryClient.invalidateQueries({ queryKey: keys.project(projectId) });

/** Changes the list on the device at once, then checks it against the server. */
export function changeDocuments(
  projectId: string,
  change: (documents: ProjectDocument[]) => ProjectDocument[],
) {
  queryClient.setQueryData<ProjectDocument[]>(documentsKey(projectId), (documents) =>
    documents ? change(documents) : documents,
  );
  return refreshProject(projectId);
}

// Leaving the page stops the files on their way, so the browser asks first.
// Saving a document on the device is also a "departure" for the browser,
// and must not ask.
let downloading = false;
const askBeforeLeaving = (event: BeforeUnloadEvent) => {
  if (!downloading) event.preventDefault();
};

/** Saves a file on the device, from a link that answers with a download. */
export function download(url: string) {
  downloading = true;
  window.location.assign(url);
  window.setTimeout(() => {
    downloading = false;
  }, 1000);
}

export const uploads = createUploadQueue({
  send: (item, onProgress, signal) =>
    uploadFile({
      projectId: item.projectId,
      kind: "document",
      file: item.file,
      filename: item.filename,
      onProgress,
      signal,
    }),
  save: (item, uploadId, signal) =>
    api(`/api/projects/${item.projectId}/documents`, {
      method: "POST",
      body: { uploadId, title: item.title, category: item.category },
      signal,
    }),
  onAdded: (projectId) => void refreshProject(projectId),
  onActivity(active) {
    if (active) {
      window.addEventListener("beforeunload", askBeforeLeaving);
    } else {
      window.removeEventListener("beforeunload", askBeforeLeaving);
      announceEnd();
    }
  },
});

/** Tells how the sending ended to someone who went to look at something else meanwhile. */
function announceEnd() {
  // On the sending screen, the result is already in front of the person.
  if (window.location.pathname.endsWith("/documents/ajouter")) return;
  const { done, failed } = summarize(uploads.getState().items);
  if (failed > 0)
    toast.error(
      "L'envoi des documents s'est arrêté avant la fin. Ouvrez Documents pour le reprendre.",
    );
  else if (done > 0) toast.success(count(done, "document ajouté", "documents ajoutés"));
}

if (typeof window !== "undefined") window.addEventListener("online", uploads.resume);

/** The files of this project being sent, or sent since the screen was last cleared. */
export function useUploads(projectId: string): UploadsState {
  const state = useSyncExternalStore(uploads.subscribe, uploads.getState, uploads.getState);
  return useMemo(
    () => ({
      items: state.items.filter((item) => item.projectId === projectId),
      stalled: state.stalled,
    }),
    [state, projectId],
  );
}
