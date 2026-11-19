import { eq } from "drizzle-orm";
import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, notFound, route } from "@/server/http";
import { assertFolderNameFree } from "@/server/plans/folders";

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
    z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int() }).partial(),
  );
  if (input.name !== undefined) await assertFolderNameFree(folder.projectId, input.name, id);
  if (Object.keys(input).length)
    await db.update(schema.planFolders).set(input).where(eq(schema.planFolders.id, id));
  return { ok: true };
});

/** Removes the folder; its sheets stay, outside any folder. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  await folderToManage(request, id);
  await db.delete(schema.planFolders).where(eq(schema.planFolders.id, id));
  return { ok: true };
});
