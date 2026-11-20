import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { projectFor, projectToChange } from "@/server/access";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, route } from "@/server/http";
import { lockPlanNames } from "@/server/plans/lock";
import { sheetDetail, sheetRow, sheetsByNumber } from "@/server/plans/queries";
import { sheetNumberKey } from "@/shared/plans";

export const GET = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  const sheet = await sheetRow(id);
  await projectFor(user, sheet.projectId);
  return sheetDetail(sheet);
});

async function sheetToChange(request: NextRequest, id: string) {
  const user = await requireUser(request);
  const sheet = await sheetRow(id);
  await projectToChange(user, sheet.projectId);
  return sheet;
}

const patch = z
  .object({
    number: z.string().trim().min(1).max(40),
    title: z.string().trim().max(200),
    folderId: z.string().nullable(),
    sort: z.int32(),
  })
  .partial();

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const sheet = await sheetToChange(request, id);
  const input = await body(request, patch);
  await db.transaction(async (tx) => {
    if (input.number !== undefined) {
      // Two sheets with one number could not be told apart, here or at the next import.
      await lockPlanNames(tx, sheet.projectId);
      const other = (await sheetsByNumber(sheet.projectId, tx)).get(sheetNumberKey(input.number));
      if (other && other.id !== id)
        throw badRequest(`Une autre feuille porte déjà le numéro ${other.number}.`);
    }
    if (input.folderId) {
      const [folder] = await tx
        .select({ id: schema.planFolders.id })
        .from(schema.planFolders)
        .where(
          and(
            eq(schema.planFolders.id, input.folderId),
            eq(schema.planFolders.projectId, sheet.projectId),
          ),
        )
        .limit(1);
      if (!folder) throw badRequest("Dossier introuvable.");
    }
    if (Object.keys(input).length)
      await tx.update(schema.sheets).set(input).where(eq(schema.sheets.id, id));
  });
  return sheetDetail(await sheetRow(id));
});

/** Takes the sheet off the site: the list, the search and its own address. Its revisions are kept. */
export const DELETE = route<{ id: string }>(async (request, { id }) => {
  await sheetToChange(request, id);
  await db.update(schema.sheets).set({ archivedAt: new Date() }).where(eq(schema.sheets.id, id));
  return { ok: true };
});
