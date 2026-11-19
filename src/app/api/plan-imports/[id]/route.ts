import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";

import { projectToManage } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, notFound, route } from "@/server/http";
import { importDto } from "@/server/plans/import-dto";
import { cancelImport, needsWorker, runImportWorker, saveDrafts } from "@/server/plans/imports";

export const maxDuration = 300;

async function importToManage(request: NextRequest, id: string) {
  const user = await requireUser(request);
  const [current] = await db
    .select()
    .from(schema.planImports)
    .where(eq(schema.planImports.id, id))
    .limit(1);
  if (!current) throw notFound("Import introuvable.");
  await projectToManage(user, current.projectId);
  return current;
}

/**
 * Progress of an import. The page asks every couple of seconds while pages
 * are being converted, and each request lends a hand: if pages are waiting
 * and few workers are busy, it starts one more.
 */
export const GET = route<{ id: string }>(async (request, { id }) => {
  await importToManage(request, id);
  if (await needsWorker(id)) {
    after(() => runImportWorker(id).catch((error) => console.error("plan import worker", error)));
  }
  return importDto(id);
});

const patch = z.object({
  folderId: z.string().nullable().optional(),
  revisionLabel: z.string().trim().max(60).nullable().optional(),
  issuedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  pages: z
    .array(
      z.object({
        id: z.string(),
        draftNumber: z.string().trim().max(40).optional(),
        draftTitle: z.string().trim().max(200).optional(),
        draftSkip: z.boolean().optional(),
      }),
    )
    .max(2000)
    .optional(),
});

/**
 * Saves what the office corrects while checking the import. Whether a page
 * is a new sheet or a new revision follows from its number.
 */
export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const current = await importToManage(request, id);
  if (current.status === "published") throw badRequest("Cet import est déjà publié.");
  const { pages, ...fields } = await body(request, patch);

  if (fields.folderId) {
    const [folder] = await db
      .select({ id: schema.planFolders.id })
      .from(schema.planFolders)
      .where(
        and(
          eq(schema.planFolders.id, fields.folderId),
          eq(schema.planFolders.projectId, current.projectId),
        ),
      )
      .limit(1);
    if (!folder) throw badRequest("Dossier introuvable.");
  }
  if (Object.keys(fields).length) {
    await db
      .update(schema.planImports)
      .set({ ...fields, revisionLabel: fields.revisionLabel === "" ? null : fields.revisionLabel })
      .where(eq(schema.planImports.id, id));
  }

  if (pages?.length) await saveDrafts(current, pages);
  return importDto(id);
});

export const DELETE = route<{ id: string }>(async (request, { id }) => {
  await importToManage(request, id);
  await cancelImport(id);
  return { ok: true };
});
