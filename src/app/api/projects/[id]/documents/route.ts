import { z } from "zod";

import { projectFor, projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import {
  createDocument,
  documentCategory,
  documentTitle,
  isRecordId,
  listDocuments,
} from "@/server/documents";
import { body, notFound, route } from "@/server/http";
import { takeUpload } from "@/server/uploads";

/** An address that cannot name a project is answered like a project that does not exist. */
function projectId(id: string): string {
  if (!isRecordId(id)) throw notFound("Projet introuvable.");
  return id;
}

/** The project's documents, for everyone on it. */
export const GET = route<{ id: string }>(async (request, params) => {
  const user = await requireUser(request);
  const id = projectId(params.id);
  await projectFor(user, id);
  return listDocuments(id);
});

const input = z.object({
  uploadId: z.string().refine(isRecordId, "téléversement inconnu"),
  title: documentTitle,
  category: documentCategory,
});

/** Adds a file already sent to storage (kind "document") as a document. */
export const POST = route<{ id: string }>(async (request, params) => {
  const user = await requireUser(request);
  const id = projectId(params.id);
  await projectToManage(user, id);
  const data = await body(request, input);
  const upload = await takeUpload(user, data.uploadId, "document", id);
  return createDocument(user, id, upload, data);
});
