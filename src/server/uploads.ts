import { and, eq, lt, sql as raw } from "drizzle-orm";

import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";
import { badRequest, HttpError, notFound } from "./http";
import { newId } from "./ids";
import {
  plainType,
  safeFilename,
  storage,
  type BucketRules,
  type StoredFile,
  type UploadTarget,
} from "./storage";

// Files go from the browser straight to storage, in three steps: the app
// announces a file and gets a place to send it, sends it, then confirms.
// Only a confirmed upload can become a plan, a document or a photo.
//
// The link the browser gets is not bound to what was announced (hosted
// storage cannot do that), so nothing is trusted until the confirmation has
// compared what storage holds with the announcement. The link writes once:
// what was compared cannot be replaced afterwards. And because an announced
// file may never be sent, confirmed or even wanted, each person has a small
// allowance of unfinished uploads, and those left unfinished are removed.

export type UploadKind = "plan" | "document" | "photo";
export type Upload = typeof schema.uploads.$inferSelect;

const MB = 1024 * 1024;
const HOUR = 3_600_000;
const OFFICE = "application/vnd.openxmlformats-officedocument";

const RULES: Record<UploadKind, { maxSize: number; types: readonly string[]; label: string }> = {
  plan: {
    maxSize: 500 * MB,
    types: ["application/pdf"],
    label: "Les plans doivent être en PDF (500 Mo au plus).",
  },
  document: {
    maxSize: 200 * MB,
    types: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "text/plain",
      "text/csv",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      `${OFFICE}.wordprocessingml.document`,
      `${OFFICE}.wordprocessingml.template`,
      `${OFFICE}.spreadsheetml.sheet`,
      `${OFFICE}.spreadsheetml.template`,
      `${OFFICE}.presentationml.presentation`,
      `${OFFICE}.presentationml.slideshow`,
      `${OFFICE}.presentationml.template`,
      "application/zip",
      "application/vnd.dwg",
      "application/acad",
      "application/dxf",
      "image/vnd.dwg",
      // What browsers announce for a file they do not know (a DWG, often).
      "application/octet-stream",
    ],
    label: "Type de fichier non accepté, ou fichier de plus de 200 Mo.",
  },
  photo: {
    maxSize: 30 * MB,
    types: ["image/jpeg", "image/png", "image/webp"],
    label: "Les photos doivent être en JPEG, PNG ou WebP (30 Mo au plus).",
  },
};

/** Whether a file of this type and size may be announced as this kind. */
export function acceptsUpload(kind: UploadKind, contentType: string, size: number): boolean {
  const rule = RULES[kind];
  return rule.types.includes(contentType) && size > 0 && size <= rule.maxSize;
}

/**
 * What hosted storage itself is told to accept (ensureBuckets, at
 * deployment), whatever a link's holder sends. The private bucket receives
 * the browsers' uploads: every type and the largest size announced above.
 * The public bucket is only written by the server: the images it makes
 * (plan tiles and thumbnails in WebP, photos in JPEG; PNG for an image kept
 * as it came). Anything else the server ever writes there must be added.
 */
export const BUCKET_RULES: BucketRules = {
  private: {
    fileSizeLimit: Math.max(...Object.values(RULES).map((rule) => rule.maxSize)),
    allowedMimeTypes: [...new Set(Object.values(RULES).flatMap((rule) => rule.types))],
  },
  public: {
    fileSizeLimit: Math.max(...Object.values(RULES).map((rule) => rule.maxSize)),
    allowedMimeTypes: ["image/webp", "image/jpeg", "image/png"],
  },
};

/**
 * How many unfinished uploads one person may have at a time, and how much
 * they may announce in all. A phone sending the photos of a day in a row
 * stays far below; a script announcing files without end stops here.
 */
export const MAX_PENDING_UPLOADS = 30;
export const MAX_PENDING_BYTES = 2048 * MB;
/** How long an upload link works: fixed by Supabase, and the development folder follows. */
const LINK_LIFETIME = 2 * HOUR;
/** An upload must be confirmed within a day; after that it is removed. */
const ABANDONED_AFTER = 24 * HOUR;
/** Abandoned uploads removed per request, so that no request pays for a long clean-up. */
const SWEEP_BATCH = 10;

/** Whether one more upload of this size would exceed a person's allowance. */
export function exceedsAllowance(pending: { count: number; bytes: number }, size: number): boolean {
  return pending.count >= MAX_PENDING_UPLOADS || pending.bytes + size > MAX_PENDING_BYTES;
}

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
  if (!acceptsUpload(input.kind, input.contentType, input.size))
    throw badRequest(RULES[input.kind].label);

  // Housekeeping on the way: it must never be the reason an upload fails.
  await sweepAbandonedUploads().catch((error) => console.error("uploads: sweep failed", error));

  const id = newId();
  const storageKey = `u/${id}/${safeFilename(input.filename)}`;
  const upload = await db.transaction(async (tx) => {
    // One request at a time per person: requests sent together cannot each
    // find room for one more.
    await tx.execute(
      raw`select pg_advisory_xact_lock(hashtext('ead:uploads'), hashtext(${user.id}))`,
    );
    const [pending] = await tx
      .select({
        count: raw<number>`count(*)::int`,
        bytes: raw<number>`coalesce(sum(${schema.uploads.size}), 0)::float8`,
      })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.createdBy, user.id), eq(schema.uploads.status, "pending")));
    if (exceedsAllowance(pending, input.size))
      throw new HttpError(
        429,
        "too_many_uploads",
        "Trop d'envois de fichiers n'ont pas abouti à partir de votre compte. Réessayez plus tard : ils s'effacent d'eux-mêmes après une journée.",
      );
    const [row] = await tx
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
    return row;
  });
  const target = await storage().uploadTarget("private", storageKey, {
    contentType: input.contentType,
    size: input.size,
  });
  return { upload, target };
}

/**
 * Why a stored file is not the one announced, as a sentence for the sender;
 * null when it is. A store that records no type is not asked for it.
 */
export function uploadProblem(
  announced: { size: number; contentType: string },
  stored: StoredFile,
): string | null {
  if (stored.size < announced.size) return "Le fichier est arrivé incomplet. Réessayez.";
  const sameType =
    stored.contentType === null ||
    plainType(stored.contentType) === plainType(announced.contentType);
  if (stored.size > announced.size || !sameType)
    return "Le fichier reçu n'est pas celui qui était annoncé. Réessayez.";
  return null;
}

const olderThan = (upload: Upload, age: number) => Date.now() - upload.createdAt.getTime() > age;

/**
 * Checks that the announced file, and nothing else, arrived, and marks the
 * upload complete. A file that differs in size or type is deleted from
 * storage on the spot and the upload is refused.
 */
export async function completeUpload(user: SessionUser, uploadId: string): Promise<Upload> {
  const [upload] = await db
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.createdBy, user.id)))
    .limit(1);
  if (!upload) throw notFound("Téléversement introuvable.");
  if (upload.status === "complete") return upload;
  // Past this age the upload belongs to the clean-up (sweepAbandonedUploads).
  if (olderThan(upload, ABANDONED_AFTER))
    throw badRequest("Cet envoi a trop tardé. Recommencez-le.");
  const stored = await storage().stat("private", upload.storageKey);
  if (!stored) throw badRequest("Le fichier n'est pas arrivé. Réessayez.");
  const problem = uploadProblem(upload, stored);
  if (problem) {
    await storage().removePrefix("private", `u/${upload.id}`);
    // The row goes with the file once its link can no longer be used. Until
    // then it stays, unfinished: a link cannot be taken back, and once the
    // file is deleted it can write again. Whatever it wrote would be tracked
    // by nothing, outside the person's allowance and out of reach of the
    // clean-up. Kept, the row counts against the allowance and the clean-up
    // removes it together with anything the link has stored since.
    if (olderThan(upload, LINK_LIFETIME))
      await db.delete(schema.uploads).where(eq(schema.uploads.id, upload.id));
    throw badRequest(problem);
  }
  const [done] = await db
    .update(schema.uploads)
    .set({ status: "complete" })
    .where(eq(schema.uploads.id, upload.id))
    .returning();
  return done;
}

/**
 * Removes uploads that were announced but never confirmed within a day:
 * their files, then their rows. Called on the way by beginUpload, a few at a
 * time. By then their links expired long ago and completeUpload refuses
 * them, so nothing can be using them.
 */
export async function sweepAbandonedUploads(): Promise<number> {
  const abandoned = await db
    .select({ id: schema.uploads.id })
    .from(schema.uploads)
    .where(
      and(
        eq(schema.uploads.status, "pending"),
        lt(schema.uploads.createdAt, new Date(Date.now() - ABANDONED_AFTER)),
      ),
    )
    .limit(SWEEP_BATCH);
  for (const { id } of abandoned) {
    await storage().removePrefix("private", `u/${id}`);
    await db
      .delete(schema.uploads)
      .where(and(eq(schema.uploads.id, id), eq(schema.uploads.status, "pending")));
  }
  return abandoned.length;
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
