import type { Photo } from "@/shared/photos";

import { api } from "../../lib/api";
import { photoChanged, refreshProject } from "./data";
import { captionWaiting } from "./outbox";

/**
 * Gives a description to photos (or takes it away, with null), wherever they
 * are: one still on the device keeps it for when it is sent, the others are
 * changed in the project. Every screen that shows them follows.
 */
export async function describePhotos(projectId: string, ids: string[], caption: string | null) {
  const sent = await captionWaiting(ids, caption);
  const results = await Promise.allSettled(
    sent.map((id) =>
      api<Photo>(`/api/photos/${id}`, { method: "PATCH", body: { caption } }).then((photo) =>
        photoChanged(projectId, photo),
      ),
    ),
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  void refreshProject(projectId);
}
