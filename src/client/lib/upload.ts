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

  await api(`/api/uploads/${ticket.uploadId}/complete`, { method: "POST", signal });
  onProgress?.(1);
  return ticket.uploadId;
}
