import { z } from "zod";

import { requireUser } from "@/server/auth";
import {
  archiveDocument,
  documentCategory,
  documentTitle,
  documentToChange,
  updateDocument,
} from "@/server/documents";
import { body, route } from "@/server/http";

const patch = z.object({ title: documentTitle, category: documentCategory }).partial();

/** Renames the document or moves it to another category, on an open project. */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await documentToChange(user, id);
  return updateDocument(user.id, id, await body(request, patch));
});

/** Archives the document: the site no longer sees it. The project must be open. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await documentToChange(user, id);
  await archiveDocument(id);
  return { ok: true };
});
