import { z } from "zod";

import { projectFor } from "@/server/access";
import { requireUser } from "@/server/auth";
import { badRequest, body, route } from "@/server/http";
import { createPhoto } from "@/server/photos/changes";
import { listPhotos, photoOf } from "@/server/photos/queries";
import { isDay, PHOTO_CAPTION_MAX, PHOTO_ID_PATTERN, PHOTO_LIST_MAX } from "@/shared/photos";

// A 12-megapixel original takes a second or two to redraw.
export const maxDuration = 60;

const query = z.object({
  day: z.string().optional(),
  /** `photoCursor()` of the last photo already received. */
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z_[a-z0-9]{1,40}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(PHOTO_LIST_MAX).default(PHOTO_LIST_MAX),
});

/** The project's photos, newest first: all of them a page at a time, or one day's. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  const { day, before, limit } = query.parse(Object.fromEntries(request.nextUrl.searchParams));
  if (day !== undefined && !isDay(day)) throw badRequest("Ce jour n'existe pas.");
  const [takenAt, photoId] = before?.split("_") ?? [];
  const cursor = before ? { takenAt: new Date(takenAt), id: photoId } : undefined;
  if (cursor && Number.isNaN(cursor.takenAt.getTime())) throw badRequest("Suite introuvable.");
  return listPhotos(user, id, { day, before: cursor, limit });
});

const input = z.object({
  uploadId: z.string(),
  takenAt: z.iso.datetime({ offset: true }).nullish(),
  caption: z.string().trim().max(PHOTO_CAPTION_MAX).nullish(),
  id: z.string().regex(PHOTO_ID_PATTERN).optional(),
});

/** Adds a photo from an uploaded file. Anyone on the project may. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  const data = await body(request, input);
  const row = await createPhoto(user, id, {
    id: data.id,
    uploadId: data.uploadId,
    takenAt: data.takenAt ? new Date(data.takenAt) : undefined,
    caption: data.caption || null,
  });
  return photoOf(row, user);
});
