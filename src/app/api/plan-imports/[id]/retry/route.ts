import { eq } from "drizzle-orm";
import { after } from "next/server";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { notFound, route } from "@/server/http";
import { importDto } from "@/server/plans/import-dto";
import { retryFailedPages, runImportWorker } from "@/server/plans/imports";

export const maxDuration = 300;

/** Tries again the pages that could not be converted. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, id))
    .limit(1);
  if (!current) throw notFound("Import introuvable.");
  await projectToManage(user, current.projectId);
  await retryFailedPages(id);
  after(() => runImportWorker(id).catch((error) => console.error("plan import worker", error)));
  return importDto(id);
});
