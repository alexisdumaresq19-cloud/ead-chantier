import { z } from "zod";

import { projectFor, projectToAddTo } from "@/server/access";
import { requireUser } from "@/server/auth";
import { badRequest, body, route } from "@/server/http";
import { createPhoto } from "@/server/photos/changes";
import { listPhotos, photoOf } from "@/server/photos/queries";
import {
  isDay,
  PHOTO_CAPTION_MAX,
  PHOTO_ID_PATTERN,
  PHOTO_LIST_MAX,
  readPhotoCursor,
} from "@/shared/photos";

// A 12-megapixel original takes a second or two to redraw.
export const maxDuration = 60;

const query = z.object({
  day: z.string().optional(),
  /** `photoCursor()` of the last photo already received. */
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PHOTO_LIST_MAX).default(PHOTO_LIST_MAX),
});

/** Where a page resumes; anything but a `photoCursor()` is refused in plain words. */
function cursorOf(before: string | undefined) {
  if (before === undefined) return undefined;
  const cursor = readPhotoCursor(before);
  if (!cursor) throw badRequest("Suite introuvable.");
  return cursor;
}

/** The project's photos, newest first: all of them a page at a time, or one day's. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const project = await projectFor(user, id);
  const { day, before, limit } = query.parse(Object.fromEntries(request.nextUrl.searchParams));
  if (day !== undefined && !isDay(day)) throw badRequest("Ce jour n'existe pas.");
  return listPhotos(user, project, { day, before: cursorOf(before), limit });
});

const input = z.object({
  uploadId: z.string().max(64),
  takenAt: z.iso.datetime({ offset: true }).nullish(),
  caption: z.string().trim().max(PHOTO_CAPTION_MAX).nullish(),
  id: z.string().regex(PHOTO_ID_PATTERN, "identifiant de photo invalide").optional(),
});

/** Adds a photo from an uploaded file. Anyone on the project may, while it is open. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const project = await projectToAddTo(user, id);
  const data = await body(request, input);
  const row = await createPhoto(user, id, {
    id: data.id,
    uploadId: data.uploadId,
    takenAt: data.takenAt ? new Date(data.takenAt) : undefined,
    caption: data.caption || null,
  });
  return photoOf(row, user, project);
});
