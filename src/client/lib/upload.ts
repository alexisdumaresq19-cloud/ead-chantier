import type { UploadTicket } from "@/shared/api";

import { api, ApiFailure } from "./api";

// Sends a file straight to storage: announce it, send it (with progress),
// confirm it. Returns the upload id to hand to the module's own endpoint.

export type UploadKind = "plan" | "document" | "photo";

export async function uploadFile(options: {
  projectId: string;
  kind: UploadKind;
  file: Blob;
  filename: string;
  /** 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { projectId, kind, file, filename, onProgress, signal } = options;
  const ticket = await api<UploadTicket>("/api/uploads", {
    method: "POST",
    body: {
      projectId,
      kind,
      filename,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    },
    signal,
  });

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(ticket.target.method, ticket.target.url);
    for (const [name, value] of Object.entries(ticket.target.headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(
            new ApiFailure(
              request.status,
              "upload_failed",
              "Le fichier n'a pas pu être envoyé. Réessayez.",
            ),
          );
    request.onerror = () =>
      reject(new ApiFailure(0, "offline", "Connexion perdue pendant l'envoi. Réessayez."));
    request.onabort = () => reject(new DOMException("Envoi annulé.", "AbortError"));
    signal?.addEventListener("abort", () => request.abort());
    request.send(file);
  });

  await confirm(ticket.uploadId, signal);
  onProgress?.(1);
  return ticket.uploadId;
}

/**
 * Tells the server the file is there. The file is in storage by now: if this
 * small request is lost on a weak signal, it is tried again a few times
 * rather than making the person send the whole file once more.
 */
async function confirm(uploadId: string, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      await api(`/api/uploads/${uploadId}/complete`, { method: "POST", signal });
      return;
    } catch (error) {
      const lost = error instanceof ApiFailure && (error.offline || error.status >= 500);
      if (!lost || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      signal?.throwIfAborted();
    }
  }
}
