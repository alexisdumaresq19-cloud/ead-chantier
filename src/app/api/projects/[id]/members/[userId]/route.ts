import { and, eq } from "drizzle-orm";

import { requireAdmin } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { route } from "@/server/http";

export const DELETE = route<{ id: string; userId: string }>(async (request, { id, userId }) => {
  await requireAdmin(request);
  await db
    .delete(schema.projectMembers)
    .where(and(eq(schema.projectMembers.projectId, id), eq(schema.projectMembers.userId, userId)));
  return { ok: true };
});
