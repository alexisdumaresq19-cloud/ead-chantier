import { eq } from "drizzle-orm";

import { projectToChange } from "@/server/access";
import { refuseDemoOnPlans } from "@/server/access-code/rules";
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
  refuseDemoOnPlans(user);
  await projectToChange(user, current.projectId);
  return publishImport(user, id);
});
