import { and, eq } from "drizzle-orm";

import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";
import { badRequest, notFound } from "./http";
import { newId } from "./ids";
import { safeFilename, storage, type UploadTarget } from "./storage";

// Files go from the browser straight to storage, in three steps: the app
// announces a file and gets a place to send it, sends it, then confirms.
// Only a confirmed upload can become a plan, a document or a photo.

export type UploadKind = "plan" | "document" | "photo";
export type Upload = typeof schema.uploads.$inferSelect;

const MB = 1024 * 1024;

const RULES: Record<UploadKind, { maxSize: number; types: RegExp; label: string }> = {
  plan: {
    maxSize: 500 * MB,
    types: /^application\/pdf$/,
    label: "Les plans doivent être en PDF (500 Mo au plus).",
  },
  document: {
    maxSize: 200 * MB,
    types:
      /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/(plain|csv)|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|zip|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.dwg|acad|dxf|octet-stream)|image\/vnd\.dwg)$/,
    label: "Type de fichier non accepté, ou fichier de plus de 200 Mo.",
  },
  photo: {
    maxSize: 30 * MB,
    types: /^image\/(jpeg|png|webp)$/,
    label: "Les photos doivent être en JPEG, PNG ou WebP (30 Mo au plus).",
  },
};

export async function beginUpload(
  user: SessionUser,
  input: {
    projectId: string;
    kind: UploadKind;
    filename: string;
    contentType: string;
    size: number;
  },
): Promise<{ upload: Upload; target: UploadTarget }> {
  const rule = RULES[input.kind];
  if (!rule.types.test(input.contentType) || input.size <= 0 || input.size > rule.maxSize)
    throw badRequest(rule.label);

  const id = newId();
  const storageKey = `u/${id}/${safeFilename(input.filename)}`;
  const [upload] = await db
    .insert(schema.uploads)
    .values({
      id,
      projectId: input.projectId,
      kind: input.kind,
      storageKey,
      filename: input.filename.slice(0, 200),
      contentType: input.contentType,
      size: input.size,
      createdBy: user.id,
    })
    .returning();
  const target = await storage().uploadTarget("private", storageKey, {
    contentType: input.contentType,
  });
  return { upload, target };
}

/** Checks that the file really arrived, whole, and marks the upload complete. */
export async function completeUpload(user: SessionUser, uploadId: string): Promise<Upload> {
  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.createdBy, user.id)))
    .limit(1);
  if (!upload) throw notFound("Téléversement introuvable.");
  if (upload.status === "complete") return upload;
  const size = await storage().size("private", upload.storageKey);
  if (size === null) throw badRequest("Le fichier n'est pas arrivé. Réessayez.");
  if (size !== upload.size) throw badRequest("Le fichier est arrivé incomplet. Réessayez.");
  const [done] = await db
    .update(schema.uploads)
    .set({ status: "complete" })
    .where(eq(schema.uploads.id, upload.id))
    .returning();
  return done;
}

/** A confirmed upload of the expected kind and project, sent by this person. */
export async function takeUpload(
  user: SessionUser,
  uploadId: string,
  kind: UploadKind,
  projectId: string,
): Promise<Upload> {
  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(
      and(
        eq(schema.uploads.id, uploadId),
        eq(schema.uploads.createdBy, user.id),
        eq(schema.uploads.kind, kind),
        eq(schema.uploads.projectId, projectId),
      ),
    )
    .limit(1);
  if (!upload) throw notFound("Téléversement introuvable.");
  if (upload.status !== "complete") throw badRequest("Le téléversement n'est pas terminé.");
  return upload;
}
