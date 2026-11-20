import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import type { Me } from "@/shared/api";
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

export const useDocuments = (projectId: string) =>
  useQuery({
    queryKey: documentsKey(projectId),
    queryFn: () => api<ProjectDocument[]>(`/api/projects/${projectId}/documents`),
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
  save: async (item, uploadId, signal) => {
    const added = await api<ProjectDocument>(`/api/projects/${item.projectId}/documents`, {
      method: "POST",
      body: { uploadId, title: item.title, category: item.category },
      signal,
    });
    noteAddedHere(added.id);
    return added;
  },
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

// The documents this device sent for the demonstration account. The list
// names a document's author by name only, and the demonstration account may
// change only what it added (src/shared/demo.ts): what it sent from here is
// what the screens know to be its own. Under "ead:recents:", so a sign-out
// forgets it with the rest (session.ts); kept per account, since a new
// demonstration account is made when a visitor deletes this one.

const ADDED_MAX = 200;
const addedKey = (userId: string) => `ead:recents:documents-added:${userId}`;

/** The ids of the documents this device sent for this person (the demonstration account only). */
export function documentsAddedHere(userId: string): ReadonlySet<string> {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(addedKey(userId)) ?? "[]");
    return new Set(Array.isArray(kept) ? kept.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function noteAddedHere(documentId: string) {
  const me = queryClient.getQueryData<Me | null>(keys.me);
  if (!me?.demo) return;
  try {
    const ids = [documentId, ...[...documentsAddedHere(me.id)].filter((id) => id !== documentId)];
    window.localStorage.setItem(addedKey(me.id), JSON.stringify(ids.slice(0, ADDED_MAX)));
  } catch {
    // Local storage can be closed to the page (private mode): its documents
    // then show no controls, and nothing is offered that would be refused.
  }
}
