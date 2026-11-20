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
// allowance of unfinished uploads, and those left unfinished are removed.
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
 * they may announce in all. A phone sending the photos of a day in a row
 * stays far below; a script announcing files without end stops here.
 */
export const MAX_PENDING_UPLOADS = 30;
export const MAX_PENDING_BYTES = 2048 * MB;
/**
 * What one person may send in any 24 hours, finished or not (the office
 * excepted, which loads whole projects). Confirmed files stay in storage, so
 * without this the allowance above would only slow a script down. Chosen to
 * be out of reach of a day's work: a foreman's plans, a few hundred photos.
 */
export const MAX_DAILY_UPLOADS = 500;
export const MAX_DAILY_BYTES = 5 * 1024 * MB;
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
/** Abandoned uploads removed per request, so that no request pays for a long clean-up. */
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

/** Whether one more upload of this size would exceed what a person may send in a day. */
export function exceedsDailyAllowance(day: Usage, size: number): boolean {
  return day.count >= MAX_DAILY_UPLOADS || day.bytes + size > MAX_DAILY_BYTES;
}

const tooMany = (code: string, message: string) => new HttpError(429, code, message);

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
    const [used] = await tx
      .select({
        pending: raw<number>`(count(*) filter (where ${live}))::int`,
        pendingBytes: raw<number>`coalesce(sum(${schema.uploads.size}) filter (where ${live}), 0)::float8`,
        day: raw<number>`count(*)::int`,
        dayBytes: raw<number>`coalesce(sum(${schema.uploads.size}), 0)::float8`,
      })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.createdBy, user.id), newerThan(24 * HOUR)));
    if (exceedsAllowance({ count: used.pending, bytes: used.pendingBytes }, input.size))
      throw tooMany(
        "too_many_uploads",
        "Trop d'envois n'ont pas abouti. Réessayez plus tard\u00a0: ils s'effacent après trois heures.",
      );
    if (
      user.role !== "admin" &&
      exceedsDailyAllowance({ count: used.day, bytes: used.dayBytes }, input.size)
    )
      throw tooMany(
        "daily_upload_limit",
        "La limite d'envois pour une journée est atteinte. Réessayez demain, ou demandez au bureau de s'en charger.",
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

/** Marks an upload complete, unless it has been given up or finished meanwhile. */
function markComplete(id: string, executor: Pick<typeof db, "update"> = db) {
  return executor
    .update(schema.uploads)
    .set({ status: "complete" })
    .where(
      and(
        eq(schema.uploads.id, id),
        eq(schema.uploads.status, "pending"),
        newerThan(ABANDONED_AFTER),
      ),
    )
    .returning();
}

/**
 * Checks that the announced file, and nothing else, arrived, and marks the
 * upload complete. A file that differs in size or type is deleted from
 * storage on the spot and the upload is refused. Its row stays, unfinished,
 * until the clean-up: the link cannot be taken back and can write again now
 * that the file is gone, so the row goes on counting against the sender and
 * the clean-up removes whatever the link has stored since.
 */
export async function completeUpload(user: SessionUser, uploadId: string): Promise<Upload> {
  const mine = and(eq(schema.uploads.id, uploadId), eq(schema.uploads.createdBy, user.id));
  const [upload] = await db.select().from(schema.uploads).where(mine).limit(1);
  if (!upload) throw notFound("Téléversement introuvable.");
  if (upload.status === "complete") return upload;
  const stored = await storage().stat("private", upload.storageKey);
  if (!stored) throw badRequest(NOT_ARRIVED);
  const problem = uploadProblem(upload, stored);
  if (problem) {
    const outcome = await removeWrongFile(upload.id, problem);
    if (typeof outcome === "string") throw badRequest(outcome);
    return outcome;
  }
  // The announced file is there, and stays: a link writes once, and a file
  // is only deleted after a look that found it wrong (removeWrongFile).
  const [done] = await markComplete(upload.id);
  if (done) return done;
  // Finished by another confirmation in the meantime, or given up.
  const [now] = await db.select().from(schema.uploads).where(mine).limit(1);
  if (now?.status === "complete") return now;
  throw badRequest(TOO_LATE);
}

/**
 * Deletes a file that is not the announced one; returns the sentence for the
 * sender, or the upload if it turns out to be complete.
 *
 * Deleting frees the link to write again, so a deletion decided on an old
 * look could remove the right file, sent and confirmed since, and leave a
 * confirmed upload whose link is open. Confirmations of one upload therefore
 * take turns here (the row is locked), and each looks at storage again
 * before deleting anything. One that finds the row taken leaves the deleting
 * to the confirmation that holds it.
 */
async function removeWrongFile(uploadId: string, seen: string): Promise<Upload | string> {
  return db.transaction(async (tx) => {
    const [upload] = await tx
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.id, uploadId))
      .for("update", { skipLocked: true });
    if (!upload) return seen;
    if (upload.status === "complete") return upload;
    const stored = await storage().stat("private", upload.storageKey);
    if (!stored) return NOT_ARRIVED;
    const problem = uploadProblem(upload, stored);
    if (!problem) return (await markComplete(upload.id, tx))[0] ?? TOO_LATE;
    await storage().removePrefix("private", `u/${upload.id}`);
    return problem;
  });
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
 * Removes uploads given up unfinished (see ABANDONED_AFTER): their files,
 * then their rows. Called on the way by beginUpload, a few at a time: the
 * caller's own first, then anyone's, in no fixed order so that one upload
 * storage refuses to delete does not hold up the others. Their links have
 * expired and completeUpload refuses them, so nothing can be using them.
 */
export async function sweepAbandonedUploads(first?: string): Promise<number> {
  const abandoned = await db
    .select({ id: schema.uploads.id })
    .from(schema.uploads)
    .where(and(eq(schema.uploads.status, "pending"), notNewerThan(ABANDONED_AFTER)))
    .orderBy(raw`(${schema.uploads.createdBy} = ${first ?? ""}) desc nulls last`, raw`random()`)
    .limit(SWEEP_BATCH);
  let removed = 0;
  for (const { id } of abandoned) {
    try {
      await storage().removePrefix("private", `u/${id}`);
      const gone = await db
        .delete(schema.uploads)
        .where(
          and(
            eq(schema.uploads.id, id),
            eq(schema.uploads.status, "pending"),
            notNewerThan(ABANDONED_AFTER),
          ),
        )
        .returning({ id: schema.uploads.id });
      removed += gone.length;
    } catch (error) {
      console.error(`uploads: could not remove the abandoned upload ${id}`, error);
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
