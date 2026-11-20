import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { projectToChange, projectToManage } from "@/server/access";
import { refuseDemoOnPlans } from "@/server/access-code/rules";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, route } from "@/server/http";
import { importDto } from "@/server/plans/import-dto";
import { createImport, needsWorker, pendingImports, runImportWorker } from "@/server/plans/imports";
import { dayInput } from "@/server/plans/input";
import { takeUpload } from "@/server/uploads";

// Converting pages takes a few seconds each and goes on after the answer.
export const maxDuration = 300;

/**
 * Imports not yet published, so the office can come back to them. The plan
 * list asks again every couple of seconds while pages are being converted,
 * and like the import's own page, each request keeps the conversion going.
 */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const pending = await pendingImports(id);
  const converting = pending.filter(
    (current) => current.status === "reading" || current.status === "processing",
  );
  if (!converting.length) return pending;
  for (const current of converting) {
    if (await needsWorker(current.id)) {
      after(() =>
        runImportWorker(current.id).catch((error) => console.error("plan import worker", error)),
      );
    }
  }
  // Read again: looking at an import may have moved it on to review.
  return pendingImports(id);
});

const input = z.object({
  uploadId: z.string(),
  folderId: z.string().nullish(),
  revisionLabel: z.string().trim().max(60).nullish(),
  issuedOn: dayInput.nullish(),
});

/** Starts bringing an uploaded PDF in. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  refuseDemoOnPlans(user);
  await projectToChange(user, id);
  const data = await body(request, input);
  const upload = await takeUpload(user, data.uploadId, "plan", id);
  if (data.folderId) {
    const [folder] = await db
      .select({ id: schema.planFolders.id })
      .from(schema.planFolders)
      .where(and(eq(schema.planFolders.id, data.folderId), eq(schema.planFolders.projectId, id)))
      .limit(1);
    if (!folder) throw badRequest("Dossier introuvable.");
  }
  const created = await createImport(user, upload, data);
  after(() =>
    runImportWorker(created.id).catch((error) => console.error("plan import worker", error)),
  );
  return importDto(created.id);
});
