import type { NextRequest } from "next/server";
import { z } from "zod";

import { assertOpen, projectFor } from "@/server/access";
import { refuseDemoUnlessAuthor } from "@/server/access-code/rules";
import { requireUser } from "@/server/auth";
import { body, forbidden, notFound, route } from "@/server/http";
import { removePhoto, setPhotoCaption } from "@/server/photos/changes";
import { canEditPhoto, photoOf, photoRow } from "@/server/photos/queries";
import { PHOTO_CAPTION_MAX } from "@/shared/photos";

/** The photo, for someone who may see its project. */
async function photoToSee(request: NextRequest, id: string) {
  const user = await requireUser(request);
  const row = await photoRow(id);
  // Someone outside the project gets the same answer as for a photo that
  // does not exist.
  const project = await projectFor(user, row.projectId).catch(() => {
    throw notFound("Photo introuvable.");
  });
  return { user, row, project };
}

/** Same, for its author or someone who manages the project, while the project is open. */
async function photoToChange(request: NextRequest, id: string) {
  const found = await photoToSee(request, id);
  refuseDemoUnlessAuthor(found.user, found.row.createdBy);
  if (!canEditPhoto(found.row, found.user))
    throw forbidden(
      "Seuls son auteur, les contremaîtres et le bureau peuvent modifier cette photo.",
    );
  assertOpen(found.user, found.project);
  return found;
}

export const GET = route<{ id: string }>(async (request, { id }) => {
  const { user, row, project } = await photoToSee(request, id);
  return photoOf(row, user, project);
});

const patch = z.object({ caption: z.string().trim().max(PHOTO_CAPTION_MAX).nullable() });

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const { user, row, project } = await photoToChange(request, id);
  const { caption } = await body(request, patch);
  const updated = await setPhotoCaption(row, caption || null);
  if (!updated) throw notFound("Photo introuvable.");
  return photoOf(updated, user, project);
});

/** Removes the photo for everyone, files included. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  const { row } = await photoToChange(request, id);
  if (!(await removePhoto(row))) throw notFound("Photo introuvable.");
  return { ok: true };
});
