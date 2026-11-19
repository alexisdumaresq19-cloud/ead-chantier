import { and, eq, ne } from "drizzle-orm";

import { plainText } from "@/shared/plans";

import { db, schema } from "../db/client";
import { badRequest } from "../http";

/** Refuses a folder name the project already uses: two "Civil" could not be told apart. */
export async function assertFolderNameFree(projectId: string, name: string, exceptId?: string) {
  const others = await db
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
