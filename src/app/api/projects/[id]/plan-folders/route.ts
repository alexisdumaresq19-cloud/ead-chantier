import { eq, sql as raw } from "drizzle-orm";
import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { body, route } from "@/server/http";
import { newId } from "@/server/ids";
import { assertFolderNameFree } from "@/server/plans/folders";
import type { PlanFolder } from "@/shared/plans";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const { name } = await body(request, z.object({ name: z.string().trim().min(1).max(60) }));
  await assertFolderNameFree(id, name);
  const [{ next }] = await db
    .select({ next: raw<number>`coalesce(max(${schema.planFolders.sort}), 0)::int + 1` })
    .from(schema.planFolders)
    .where(eq(schema.planFolders.projectId, id));
  const [folder] = await db
    .insert(schema.planFolders)
    .values({ id: newId(), projectId: id, name, sort: next })
    .returning();
  return { id: folder.id, name: folder.name, sort: folder.sort } satisfies PlanFolder;
});
