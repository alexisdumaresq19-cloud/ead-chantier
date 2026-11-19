import { z } from "zod";

import { requireUser } from "@/server/auth";
import {
  archiveDocument,
  documentCategory,
  documentTitle,
  documentToManage,
  updateDocument,
} from "@/server/documents";
import { body, route } from "@/server/http";

const patch = z.object({ title: documentTitle, category: documentCategory }).partial();

/** Renames the document or moves it to another category. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await documentToManage(user, id);
  return updateDocument(id, await body(request, patch));
});

/** Archives the document: the site no longer sees it. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await documentToManage(user, id);
  await archiveDocument(id);
  return { ok: true };
});
