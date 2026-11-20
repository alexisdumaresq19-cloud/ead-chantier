import { and, eq } from "drizzle-orm";

import type { SessionUser } from "../auth";
import { db, schema } from "../db/client";
import { badRequest, HttpError } from "../http";
import { newId, newPublicKey } from "../ids";
import { storage } from "../storage";
import { discardUpload, takeUpload, type Upload } from "../uploads";
import { chooseTakenAt, NotAPhoto, processPhoto } from "./process";
import type { PhotoRow } from "./queries";

export type PhotoInput = {
  /** Made on the phone, so that the same photo sent twice is saved once. */
  id?: string;
  uploadId: string;
  takenAt?: Date;
  caption: string | null;
};

/**
 * The upload is gone or was never confirmed: the app sends the file again.
 * (A retry can cross its own first try, which has already used the upload.)
 */
const uploadMissing = (message: string) => new HttpError(409, "upload_missing", message);

/**
 * Takes the upload for one photo. Its row goes from "complete" back to
 * "pending" in a single statement: two requests arriving together cannot both
 * use it, and an upload taken this way can no longer be taken (takeUpload
 * wants it complete). Until the photo is made the file stays where it is.
 */
async function claimUpload(user: SessionUser, uploadId: string, projectId: string) {
  let upload: Upload;
  try {
    upload = await takeUpload(user, uploadId, "photo", projectId);
  } catch (error) {
    if (error instanceof HttpError) throw uploadMissing(error.message);
    throw error;
  }
  const [claimed] = await db
    .update(schema.uploads)
    .set({ status: "pending" })
    .where(and(eq(schema.uploads.id, upload.id), eq(schema.uploads.status, "complete")))
    .returning({ id: schema.uploads.id });
  if (!claimed) throw uploadMissing("Téléversement introuvable.");
  return upload;
}

/** A claimed upload the next try may use again (the server failed, not the file). */
const releaseUpload = (upload: Upload) =>
  db
    .update(schema.uploads)
    .set({ status: "complete" })
    .where(and(eq(schema.uploads.id, upload.id), eq(schema.uploads.status, "pending")))
    .returning({ id: schema.uploads.id })
    .then(
      (rows) => rows.length > 0,
      () => false,
    );

/** The original has no use once it made a photo or was refused: uploads.ts drops it. */
const dropOriginal = (upload: Upload) =>
  discardUpload(upload.id).catch((error) => console.error("photo original", upload.id, error));

/** The photo already made from this id by this person, if there is one. */
async function sameAsBefore(id: string, user: SessionUser, projectId: string) {
  const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, id)).limit(1);
  if (!row) return null;
  if (row.projectId !== projectId || row.createdBy !== user.id)
    throw new HttpError(409, "conflict", "Cette photo existe déjà.");
  return row;
}

/** Redraws the uploaded file, stores the two images and saves the photo. */
async function makePhoto(
  user: SessionUser,
  projectId: string,
  input: PhotoInput,
  upload: Upload,
): Promise<PhotoRow> {
  const original = await storage()
    .get("private", upload.storageKey)
    .catch(() => {
      throw uploadMissing("Le fichier envoyé est introuvable.");
    });
  const photo = await processPhoto(original).catch((error) => {
    throw error instanceof NotAPhoto
      ? badRequest(
          "Ce fichier n'est pas une photo lisible. Choisissez une image en JPEG, PNG ou WebP.",
          "invalid_image",
        )
      : error;
  });

  const imageKey = newPublicKey("p");
  const dropFiles = () =>
    storage()
      .removePrefix("public", imageKey)
      .catch((error) => console.error("photo files", imageKey, error));
  try {
    await Promise.all([
      storage().put("public", `${imageKey}/full.jpg`, photo.full, {
        contentType: "image/jpeg",
        immutable: true,
      }),
      storage().put("public", `${imageKey}/thumb.webp`, photo.thumb, {
        contentType: "image/webp",
        immutable: true,
      }),
    ]);
    const [row] = await db
      .insert(schema.photos)
      .values({
        id: input.id ?? newId(),
        projectId,
        imageKey,
        width: photo.width,
        height: photo.height,
        takenAt: chooseTakenAt(input.takenAt, photo.exifDate, new Date()),
        caption: input.caption,
        createdBy: user.id,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
  } catch (error) {
    await dropFiles();
    throw error;
  }

  // The same id was saved in the meantime by a request that crossed this one.
  await dropFiles();
  const first = await sameAsBefore(input.id!, user, projectId);
  if (!first) throw new Error(`photo ${input.id} neither saved nor found`);
  return first;
}

/** Turns an uploaded file into a photo of the project. */
export async function createPhoto(
  user: SessionUser,
  projectId: string,
  input: PhotoInput,
): Promise<PhotoRow> {
  // A phone that never got the answer sends the photo again under the same id.
  const before = input.id ? await sameAsBefore(input.id, user, projectId) : null;
  if (before) {
    // If it sent the file again too, that copy is of no use.
    const spare = await claimUpload(user, input.uploadId, projectId).catch(() => null);
    if (spare) await dropOriginal(spare);
    return before;
  }

  const upload = await claimUpload(user, input.uploadId, projectId);
  let putBack = false;
  try {
    return await makePhoto(user, projectId, input, upload);
  } catch (error) {
    // Not the file's fault (storage, database…): the upload is put back, so
    // that the phone's next try does not have to send the file again.
    if (!(error instanceof HttpError)) putBack = await releaseUpload(upload);
    throw error;
  } finally {
    // Once it has made a photo, or been refused, the original has no use:
    // the phone keeps its own copy until the server has answered.
    if (!putBack) await dropOriginal(upload);
  }
}

/** Null if the photo was removed in the meantime. */
export async function setPhotoCaption(
  row: PhotoRow,
  caption: string | null,
): Promise<PhotoRow | null> {
  const [updated] = await db
    .update(schema.photos)
    .set({ caption })
    .where(eq(schema.photos.id, row.id))
    .returning();
  return updated ?? null;
}

/** Removes the photo and its files. False if someone else had already removed it. */
export async function removePhoto(row: PhotoRow): Promise<boolean> {
  const removed = await db
    .delete(schema.photos)
    .where(eq(schema.photos.id, row.id))
    .returning({ id: schema.photos.id });
  if (!removed.length) return false;
  // The record goes first: a file left behind is only clutter, a record
  // without its files would be a broken photo in the gallery.
  await storage()
    .removePrefix("public", row.imageKey)
    .catch((error) => console.error("photo files", row.imageKey, error));
  return true;
}
