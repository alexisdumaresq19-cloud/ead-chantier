import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  ACCEPTED_FILES_LABEL,
  DOCUMENT_CATEGORIES,
  DOCUMENT_TITLE_MAX,
  FILE_PROBLEM_LABELS,
  fileProblem,
  tidyTitle,
  toCategory,
  type DocumentCategory,
  type ProjectDocument,
} from "@/shared/documents";

import { projectFor, projectToChange } from "./access";
import type { SessionUser } from "./auth";
import { db, schema } from "./db/client";
import { badRequest, HttpError, notFound } from "./http";
import { newId } from "./ids";
import { discardUpload, type Upload } from "./uploads";

// A project's documents. The file itself is the upload, in the private
// bucket; a document gives it a title and a category, and can be archived.

export const documentTitle = z
  .string()
  .transform(tidyTitle)
  .pipe(
    z
      .string()
      .min(1, "le titre est vide")
      .max(DOCUMENT_TITLE_MAX, `${DOCUMENT_TITLE_MAX} caractères au plus`),
  );
export const documentCategory = z.enum(DOCUMENT_CATEGORIES, "catégorie inconnue");

/**
 * Ids are made by the app, of lowercase letters and digits. Anything else
 * names no record, and some of it (a NUL byte) the database refuses outright.
 * route() keeps such ids out of an address; an id in a body is checked with this.
 */
export const isRecordId = (value: string) => /^[a-z0-9]{1,40}$/.test(value);

const rows = () =>
  db
    .select({ document: schema.documents, upload: schema.uploads, author: schema.users.name })
    .from(schema.documents)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.documents.uploadId))
    .leftJoin(schema.users, eq(schema.users.id, schema.documents.createdBy));

type Row = Awaited<ReturnType<typeof rows>>[number];

const documentDto = ({ document, upload, author }: Row): ProjectDocument => ({
  id: document.id,
  title: document.title,
  category: toCategory(document.category),
  filename: upload.filename,
  size: upload.size,
  addedAt: document.createdAt.toISOString(),
  addedBy: author,
});

/** The documents the site sees (archived ones are left out), newest first. */
export async function listDocuments(projectId: string): Promise<ProjectDocument[]> {
  const found = await rows()
    .where(and(eq(schema.documents.projectId, projectId), isNull(schema.documents.archivedAt)))
    .orderBy(desc(schema.documents.createdAt));
  return found.map(documentDto);
}

const gone = () => notFound("Ce document n'est plus disponible.");

async function findDocument(id: string): Promise<Row> {
  const [row] = await rows()
    .where(and(eq(schema.documents.id, id), isNull(schema.documents.archivedAt)))
    .limit(1);
  if (!row) throw gone();
  return row;
}

/**
 * The project is the document's own, never one named by the request. Someone
 * outside it gets the answer given for a document that does not exist.
 */
async function withAccess(
  user: SessionUser,
  id: string,
  check: typeof projectFor,
): Promise<{ row: Row; document: ProjectDocument }> {
  const row = await findDocument(id);
  try {
    await check(user, row.document.projectId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw gone();
    throw error;
  }
  return { row, document: documentDto(row) };
}

/** A document this person may read: they are on its project, or at the office. */
export const documentFor = (user: SessionUser, id: string) => withAccess(user, id, projectFor);

/**
 * A document this person may rename, move or archive: they manage its
 * project, and the project is open (or they are the office).
 */
export const documentToChange = (user: SessionUser, id: string) =>
  withAccess(user, id, projectToChange);

/** Makes a confirmed upload a document of the project. */
export async function createDocument(
  user: SessionUser,
  projectId: string,
  upload: Upload,
  input: { title: string; category: DocumentCategory },
): Promise<ProjectDocument> {
  // Storage takes any file announced as a plain download; documents are held
  // to their own list of types, by extension.
  // Such a file can never become a document: it is not kept either.
  const problem = fileProblem({ name: upload.filename, size: upload.size });
  if (problem) {
    await discardUpload(upload.id);
    throw badRequest(`${FILE_PROBLEM_LABELS[problem]}. ${ACCEPTED_FILES_LABEL}`);
  }

  // Asked twice for the same file (the answer was lost on a bad signal, or a
  // retry crossed the first try): the document made the first time is the
  // answer. The second request waits on the upload's row for the first to end.
  const id = await db.transaction(async (tx) => {
    await tx
      .select({ id: schema.uploads.id })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, upload.id))
      .for("update");
    const [existing] = await tx
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.uploadId, upload.id))
      .limit(1);
    if (existing) return existing.id;
    const created = newId();
    await tx.insert(schema.documents).values({
      id: created,
      projectId,
      category: input.category,
      title: input.title,
      uploadId: upload.id,
      createdBy: user.id,
    });
    return created;
  });
  // A document archived since then stays archived: the answer is that it is gone.
  return documentDto(await findDocument(id));
}

export async function updateDocument(
  id: string,
  input: { title?: string; category?: DocumentCategory },
): Promise<ProjectDocument> {
  if (input.title !== undefined || input.category !== undefined)
    await db.update(schema.documents).set(input).where(eq(schema.documents.id, id));
  return documentDto(await findDocument(id));
}

/** Takes the document off the project. The record and its file are kept. */
export async function archiveDocument(id: string): Promise<void> {
  await db
    .update(schema.documents)
    .set({ archivedAt: new Date() })
    .where(eq(schema.documents.id, id));
}
