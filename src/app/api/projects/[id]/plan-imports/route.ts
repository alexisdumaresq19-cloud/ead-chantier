import { and, desc, eq, ne } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, route } from "@/server/http";
import { importDto } from "@/server/plans/import-dto";
import { createImport, runImportWorker } from "@/server/plans/imports";
import { takeUpload } from "@/server/uploads";

// Converting pages takes a few seconds each and goes on after the answer.
export const maxDuration = 300;

/** Imports not yet published, so the office can come back to them. */
export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
  const rows = await db
    .select()
    .from(schema.planImports)
    .where(and(eq(schema.planImports.projectId, id), ne(schema.planImports.status, "published")))
    .orderBy(desc(schema.planImports.createdAt));
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    status: r.status,
    pageCount: r.pageCount,
    createdAt: r.createdAt.toISOString(),
  }));
});

const input = z.object({
  uploadId: z.string(),
  folderId: z.string().nullish(),
  revisionLabel: z.string().trim().max(60).nullish(),
  issuedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

/** Starts bringing an uploaded PDF in. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  await projectToManage(user, id);
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
