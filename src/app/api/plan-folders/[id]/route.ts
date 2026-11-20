import { eq } from "drizzle-orm";
import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, notFound, route } from "@/server/http";
import { updateFolder } from "@/server/plans/folders";

async function folderToManage(request: Parameters<typeof requireUser>[0], id: string) {
  const user = await requireUser(request);
  const [folder] = await db
    .select()
    .from(schema.planFolders)
    .where(eq(schema.planFolders.id, id))
    .limit(1);
  if (!folder) throw notFound("Dossier introuvable.");
  await projectToManage(user, folder.projectId);
  return folder;
}

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const folder = await folderToManage(request, id);
  const input = await body(
    request,
    z.object({ name: z.string().trim().min(1).max(60), sort: z.int32() }).partial(),
  );
  await updateFolder(folder, input);
  return { ok: true };
});

/** Removes the folder; its sheets stay, outside any folder. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  await folderToManage(request, id);
  await db.delete(schema.planFolders).where(eq(schema.planFolders.id, id));
  return { ok: true };
});
