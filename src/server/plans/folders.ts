import { and, eq, ne, sql as raw } from "drizzle-orm";

import { plainText, type PlanFolder } from "@/shared/plans";

import { db, schema } from "../db/client";
import { badRequest } from "../http";
import { newId } from "../ids";
import { lockPlanNames, type Transaction } from "./lock";

type FolderRow = typeof schema.planFolders.$inferSelect;

/** Refuses a folder name the project already uses: two "Civil" could not be told apart. */
async function assertFolderNameFree(
  tx: Transaction,
  projectId: string,
  name: string,
  exceptId?: string,
) {
  await lockPlanNames(tx, projectId);
  const others = await tx
    .select({ name: schema.planFolders.name })
    .from(schema.planFolders)
    .where(
      and(
        eq(schema.planFolders.projectId, projectId),
        exceptId ? ne(schema.planFolders.id, exceptId) : undefined,
      ),
    );
  if (others.some((other) => plainText(other.name.trim()) === plainText(name.trim())))
    throw badRequest("Un dossier porte déjà ce nom.");
}

/** Adds a folder after the project's last one. */
export async function createFolder(projectId: string, name: string): Promise<PlanFolder> {
  return db.transaction(async (tx) => {
    await assertFolderNameFree(tx, projectId, name);
    const [{ next }] = await tx
      .select({ next: raw<number>`coalesce(max(${schema.planFolders.sort}), 0)::int + 1` })
      .from(schema.planFolders)
      .where(eq(schema.planFolders.projectId, projectId));
    const [folder] = await tx
      .insert(schema.planFolders)
      .values({ id: newId(), projectId, name, sort: next })
      .returning();
    return { id: folder.id, name: folder.name, sort: folder.sort };
  });
}

export async function updateFolder(folder: FolderRow, changes: { name?: string; sort?: number }) {
  if (!Object.keys(changes).length) return;
  await db.transaction(async (tx) => {
    if (changes.name !== undefined)
      await assertFolderNameFree(tx, folder.projectId, changes.name, folder.id);
    await tx.update(schema.planFolders).set(changes).where(eq(schema.planFolders.id, folder.id));
  });
}
