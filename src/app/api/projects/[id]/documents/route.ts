import { z } from "zod";

import { projectFor, projectToChange } from "@/server/access";
import { requireUser } from "@/server/auth";
import {
  createDocument,
  documentCategory,
  documentTitle,
  isRecordId,
  listDocuments,
} from "@/server/documents";
import { body, route } from "@/server/http";
import { takeUpload } from "@/server/uploads";

/** The project's documents, for everyone on it, archived project or not. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectFor(user, id);
  return listDocuments(id);
});

const input = z.object({
  uploadId: z.string().refine(isRecordId, "téléversement inconnu"),
  title: documentTitle,
  category: documentCategory,
});

/**
 * Adds a file already sent to storage (kind "document") as a document. Only
 * those who manage the project, and nobody but the office once it is archived.
 */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToChange(user, id);
  const data = await body(request, input);
  const upload = await takeUpload(user, data.uploadId, "document", id);
  return createDocument(user, id, upload, data);
});
