import { and, desc, eq, sql as raw } from "drizzle-orm";

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
// allowance of unfinished uploads and a daily one per kind, and the uploads
// nobody can use any more are removed (sweepAbandonedUploads).
//
// A link cannot be taken back, and it writes again once the file it wrote is
// deleted. So an upload's file ("u/<id>/…") is deleted only here, by code
// that knows what the link can still do: completeUpload (a wrong file),
// discardUpload (a file a module no longer wants) and the clean-up. A row
// stays for as long as its link may write, so that whatever arrives is
// counted against its sender and removed.

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
 * they may announce in all: those whose link can still write (see
 * ABANDONED_AFTER). A phone sending the photos of a day in a row stays far
 * below; a script announcing files without end stops here.
 */
export const MAX_PENDING_UPLOADS = 30;
export const MAX_PENDING_BYTES = 2048 * MB;

/**
 * What one person may announce in any 24 hours, per kind, whatever became of
 * it: confirmed files stay in storage, so the allowance above alone would
 * only slow a script down. Each is several times a heavy day's work.
 */
export const DAILY_LIMITS: Record<UploadKind, { count: number; bytes: number }> = {
  // A busy site takes a few dozen photos a day, a few MB each.
  photo: { count: 300, bytes: 3 * 1024 * MB },
  // Documents arrive a few at a time: a contract, a set of specifications.
  document: { count: 100, bytes: 4 * 1024 * MB },
  // A plan set is a handful of large PDFs, sent again at each revision.
  plan: { count: 30, bytes: 6 * 1024 * MB },
};

/** How long an upload link works: fixed by Supabase, and the development folder follows. */
const LINK_LIFETIME = 2 * HOUR;
/**
 * When an unfinished upload is given up: an hour after its link stopped
 * working. The hour covers the moment between the row and the link being
 * made, the clocks, and a file that was still on its way when the link
 * expired. From then on it can no longer be confirmed, it no longer counts
 * against its sender, and the clean-up removes its file and its row.
 */
const ABANDONED_AFTER = LINK_LIFETIME + HOUR;
/**
 * When a confirmed upload that nothing has used is removed: a day leaves a
 * phone that lost its signal after sending the time to come back and use it.
 */
const UNUSED_AFTER = 24 * HOUR;
/** Uploads removed per request, so that no request pays for a long clean-up. */
const SWEEP_BATCH = 10;

const seconds = (duration: number) => Math.round(duration / 1000);
/** Compared on the database's clock, the same for every server. */
const newerThan = (duration: number) =>
  raw`${schema.uploads.createdAt} > now() - ${seconds(duration)}::int * interval '1 second'`;
const notNewerThan = (duration: number) =>
  raw`${schema.uploads.createdAt} <= now() - ${seconds(duration)}::int * interval '1 second'`;

type Usage = { count: number; bytes: number };

/** Whether one more upload of this size would exceed a person's allowance of unfinished uploads. */
export function exceedsAllowance(pending: Usage, size: number): boolean {
  return pending.count >= MAX_PENDING_UPLOADS || pending.bytes + size > MAX_PENDING_BYTES;
}

/** Whether one more upload of this kind and size would exceed what a person may send in a day. */
export function exceedsDailyAllowance(kind: UploadKind, day: Usage, size: number): boolean {
  const limit = DAILY_LIMITS[kind];
  return day.count >= limit.count || day.bytes + size > limit.bytes;
}

/** The one refusal of the allowance: the app waits instead of trying again in a loop. */
const tooMany = (message: string) => new HttpError(429, "too_many_uploads", message);

type Announcement = {
  projectId: string;
  kind: UploadKind;
  filename: string;
  contentType: string;
  size: number;
};

export async function beginUpload(
  user: SessionUser,
  input: Announcement,
): Promise<{ upload: Upload; target: UploadTarget }> {
  if (!acceptsUpload(input.kind, input.contentType, input.size))
    throw badRequest(RULES[input.kind].label);
  const filename = input.filename.slice(0, 200);
  const linkTo = (upload: Upload) =>
    storage().uploadTarget("private", upload.storageKey, {
      contentType: upload.contentType,
      size: upload.size,
    });

  // Housekeeping on the way: it must never be the reason an upload fails.
  await sweepAbandonedUploads(user.id).catch((error) =>
    console.error("uploads: sweep failed", error),
  );

  // A send that failed is announced again by the app. It gets the place it
  // already had, with a new link: trying again uses up nothing.
  const again = await retriedUpload(user, { ...input, filename });
  if (again) return { upload: again, target: await linkTo(again) };

  const id = newId();
  const storageKey = `u/${id}/${safeFilename(input.filename)}`;
  const upload = await db.transaction(async (tx) => {
    // One request at a time per person: requests sent together cannot each
    // find room for one more.
    await tx.execute(
      raw`select pg_advisory_xact_lock(hashtext('ead:uploads'), hashtext(${user.id}))`,
    );
    const live = raw`${schema.uploads.status} = 'pending' and ${newerThan(ABANDONED_AFTER)}`;
    const sameKind = raw`${schema.uploads.kind} = ${input.kind}`;
    const [used] = await tx
      .select({
        pending: raw<number>`(count(*) filter (where ${live}))::int`,
        pendingBytes: raw<number>`coalesce(sum(${schema.uploads.size}) filter (where ${live}), 0)::float8`,
        day: raw<number>`(count(*) filter (where ${sameKind}))::int`,
        dayBytes: raw<number>`coalesce(sum(${schema.uploads.size}) filter (where ${sameKind}), 0)::float8`,
      })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.createdBy, user.id), newerThan(24 * HOUR)));
    if (exceedsAllowance({ count: used.pending, bytes: used.pendingBytes }, input.size))
      throw tooMany(
        "Trop d'envois n'ont pas abouti. Réessayez plus tard\u00a0: ils s'effacent après trois heures.",
      );
    // The office is left out: it loads whole projects at once, and it is the
    // one that lets people in, so the limit would protect nothing from it.
    if (
      user.role !== "admin" &&
      exceedsDailyAllowance(input.kind, { count: used.day, bytes: used.dayBytes }, input.size)
    )
      throw tooMany(
        "Vous avez atteint la limite d'envois pour une journée. Réessayez demain, ou demandez au bureau.",
      );
    const [row] = await tx
      .insert(schema.uploads)
      .values({
        id,
        projectId: input.projectId,
        kind: input.kind,
        storageKey,
        filename,
        contentType: input.contentType,
        size: input.size,
        createdBy: user.id,
      })
      .returning();
    return row;
  });
  try {
    return { upload, target: await linkTo(upload) };
  } catch (error) {
    // No link was handed out, so nothing can arrive: the place is given back.
    await db.delete(schema.uploads).where(eq(schema.uploads.id, upload.id));
    throw error;
  }
}

/**
 * The unfinished upload this announcement repeats, if there is one whose
 * file has not arrived: the same file (name, size, type) for the same
 * project, by the same person. Its time starts again with the new link.
 */
async function retriedUpload(user: SessionUser, input: Announcement): Promise<Upload | null> {
  const [earlier] = await db
    .select()
    .from(schema.uploads)
    .where(
      and(
        eq(schema.uploads.createdBy, user.id),
        eq(schema.uploads.status, "pending"),
        eq(schema.uploads.projectId, input.projectId),
        eq(schema.uploads.kind, input.kind),
        eq(schema.uploads.filename, input.filename),
        eq(schema.uploads.contentType, input.contentType),
        eq(schema.uploads.size, input.size),
        newerThan(ABANDONED_AFTER),
      ),
    )
    .orderBy(desc(schema.uploads.createdAt))
    .limit(1);
  // A place that holds a file takes no other (the link writes once): that
  // upload is confirmed or given up, and this one starts afresh.
  if (!earlier || (await storage().stat("private", earlier.storageKey))) return null;
  const [renewed] = await db
    .update(schema.uploads)
    .set({ createdAt: raw`now()` })
    .where(
      and(
        eq(schema.uploads.id, earlier.id),
        eq(schema.uploads.status, "pending"),
        newerThan(ABANDONED_AFTER),
      ),
    )
    .returning();
  return renewed ?? null;
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

const NOT_ARRIVED = "Le fichier n'est pas arrivé. Réessayez.";
const TOO_LATE = "Cet envoi a trop tardé. Recommencez-le.";

/**
 * Checks that the announced file, and nothing else, arrived, and marks the
 * upload complete. A file that differs in size or type is deleted from
 * storage on the spot and the upload is refused. Its row stays, unfinished,
 * until the clean-up: the link cannot be taken back and can write again now
 * that the file is gone, so the row goes on counting against the sender and
 * the clean-up removes whatever the link has stored since.
 *
 * Confirmations of one upload take turns (the row is locked from the look at
 * the row to the deletion or the update). Deleting frees the link to write
 * again: a deletion decided on an earlier look could otherwise remove the
 * right file, sent and confirmed in the meantime, and leave a confirmed
 * upload whose link takes any file. A refusal is thrown once the transaction
 * is over, so that what it removed stays removed.
 */
export async function completeUpload(user: SessionUser, uploadId: string): Promise<Upload> {
  const outcome = await db.transaction(async (tx): Promise<Upload | HttpError> => {
    const [found] = await tx
      .select({ upload: schema.uploads, late: raw<boolean>`${notNewerThan(ABANDONED_AFTER)}` })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.createdBy, user.id)))
      .for("update");
    if (!found) return notFound("Téléversement introuvable.");
    const { upload, late } = found;
    if (upload.status === "complete") return upload;
    if (late) {
      // Its link is dead: nothing can arrive any more, so all of it goes.
      await storage().removePrefix("private", `u/${upload.id}`);
      await tx.delete(schema.uploads).where(eq(schema.uploads.id, upload.id));
      return badRequest(TOO_LATE);
    }
    const stored = await storage().stat("private", upload.storageKey);
    if (!stored) return badRequest(NOT_ARRIVED);
    const problem = uploadProblem(upload, stored);
    if (problem) {
      await storage().removePrefix("private", `u/${upload.id}`);
      return badRequest(problem);
    }
    // The announced file is there, and stays: the link writes once, and only
    // a confirmation holding this lock deletes a file it found wrong.
    const [done] = await tx
      .update(schema.uploads)
      .set({ status: "complete" })
      .where(eq(schema.uploads.id, upload.id))
      .returning();
    return done;
  });
  if (outcome instanceof HttpError) throw outcome;
  return outcome;
}

/**
 * For a module that no longer wants an upload it took (its document was
 * deleted, its photo has been resized): deletes the file now, and the row as
 * soon as the upload's link can no longer write. Until then the row goes
 * back to unfinished, so that anything the link writes again is counted
 * against the sender and removed by the clean-up. The row takes with it
 * whatever still refers to it.
 *
 * Modules use this and never remove "u/<id>" from storage themselves: a
 * confirmed upload whose file is gone has an open link and a row that says
 * "complete".
 */
export async function discardUpload(uploadId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.id, uploadId))
      .for("update");
    if (!upload) return;
    await storage().removePrefix("private", `u/${upload.id}`);
    const gone = await tx
      .delete(schema.uploads)
      .where(and(eq(schema.uploads.id, upload.id), notNewerThan(ABANDONED_AFTER)))
      .returning({ id: schema.uploads.id });
    if (!gone.length)
      await tx
        .update(schema.uploads)
        .set({ status: "pending" })
        .where(eq(schema.uploads.id, upload.id));
  });
}

/**
 * Uploads the clean-up removes, files and rows: those left unfinished past
 * their time (see ABANDONED_AFTER), whose links have expired and which
 * completeUpload refuses, and those confirmed more than a day ago that
 * nothing refers to (no plan import, no document; a photo removes its own
 * upload when it is made).
 */
const removable = () => raw`(
  (${schema.uploads.status} = 'pending' and ${notNewerThan(ABANDONED_AFTER)})
  or (${schema.uploads.status} = 'complete' and ${notNewerThan(UNUSED_AFTER)}
    and not exists (select 1 from ${schema.planImports}
      where ${schema.planImports.uploadId} = ${schema.uploads.id})
    and not exists (select 1 from ${schema.documents}
      where ${schema.documents.uploadId} = ${schema.uploads.id}))
)`;

/**
 * Removes a few uploads nobody can use any more (see removable). Called on
 * the way by beginUpload: the caller's own first, then anyone's, oldest
 * first. Each is removed in its own transaction, row locked, so a module
 * that is taking it meanwhile is never left without it, and one that storage
 * refuses to delete is kept for later without stopping the others.
 */
export async function sweepAbandonedUploads(first?: string): Promise<number> {
  const candidates = await db
    .select({ id: schema.uploads.id })
    .from(schema.uploads)
    .where(removable())
    .orderBy(
      raw`(${schema.uploads.createdBy} = ${first ?? ""}) desc nulls last`,
      schema.uploads.createdAt,
    )
    .limit(SWEEP_BATCH);
  let removed = 0;
  for (const { id } of candidates) {
    try {
      removed += await db.transaction(async (tx) => {
        // Looked at again under the lock; one being taken right now is skipped.
        const [upload] = await tx
          .select({ id: schema.uploads.id })
          .from(schema.uploads)
          .where(and(eq(schema.uploads.id, id), removable()))
          .for("update", { skipLocked: true });
        if (!upload) return 0;
        // The file first: if storage refuses, the row stays to try again.
        await storage().removePrefix("private", `u/${id}`);
        await tx.delete(schema.uploads).where(eq(schema.uploads.id, id));
        return 1;
      });
    } catch (error) {
      console.error(`uploads: could not remove the upload ${id}`, error);
    }
  }
  return removed;
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
