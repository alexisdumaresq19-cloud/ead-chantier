import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { projectToChange } from "@/server/access";
import { refuseDemoOnPlans } from "@/server/access-code/rules";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, route } from "@/server/http";
import { sheetDetail, sheetRow } from "@/server/plans/queries";

/** Chooses which revision the site sees, to go back to an earlier one. */
export const POST = route<{ id: string }>(async (request, { id }) => {
  const user = await requireUser(request);
  refuseDemoOnPlans(user);
  const sheet = await sheetRow(id);
  await projectToChange(user, sheet.projectId);
  const { revisionId } = await body(request, z.object({ revisionId: z.string() }));
  const [revision] = await db
    .select({ id: schema.sheetRevisions.id })
    .from(schema.sheetRevisions)
    .where(
      and(
        eq(schema.sheetRevisions.id, revisionId),
        eq(schema.sheetRevisions.sheetId, id),
        eq(schema.sheetRevisions.status, "ready"),
      ),
    )
    .limit(1);
  if (!revision) throw badRequest("Révision introuvable.");
  await db
    .update(schema.sheets)
    .set({ currentRevisionId: revisionId })
    .where(eq(schema.sheets.id, id));
  return sheetDetail(await sheetRow(id));
});
