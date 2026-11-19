import { eq } from "drizzle-orm";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { notFound, route } from "@/server/http";
import { publishImport } from "@/server/plans/imports";

/** Puts the checked sheets in front of the site. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, id))
    .limit(1);
  if (!current) throw notFound("Import introuvable.");
  await projectToManage(user, current.projectId);
  return publishImport(user, id);
});
