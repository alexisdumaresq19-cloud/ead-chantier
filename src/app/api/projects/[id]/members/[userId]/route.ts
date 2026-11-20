import { and, eq } from "drizzle-orm";

import { projectFor } from "@/server/access";
import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { route } from "@/server/http";
import { settleSiteCodes } from "@/server/people/links";

/** The office takes someone off the project. Their account stays. */
export const DELETE = route<{ id: string; userId: string }>(async (request, { id, userId }) => {
  const admin = await requireAdmin(request);
  await projectFor(admin, id);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.projectMembers)
      .where(
        and(eq(schema.projectMembers.projectId, id), eq(schema.projectMembers.userId, userId)),
      );
    // A foreman taken off the project no longer invites people to it.
    await settleSiteCodes(tx, userId);
  });
  return { ok: true };
});
